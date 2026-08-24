import { describe, expect, it } from 'vitest';
import { InMemorySecretBroker, SecretLeaseManager } from '@moirae/secret-broker';
import { ConstrainedVsockChannel, GuestWorkloadController, type VsockTransport } from './constrained-vsock.js';

class FakeVsockTransport implements VsockTransport {
  readonly sent: string[] = [];
  private response: string | undefined;
  private waiter: ((frame: string) => void) | undefined;

  async send(frame: string): Promise<void> {
    this.sent.push(frame);
    const request = JSON.parse(frame) as { sessionId: string; requestId: string; method: string; payload: Record<string, unknown> };
    this.response = JSON.stringify({
      version: '1', sessionId: request.sessionId, requestId: request.requestId,
      method: request.method === 'credential.deliver' ? 'credential.ack' : request.method === 'workload.cancel' ? 'workload.result' : 'workload.result',
      payload: request.method === 'credential.deliver' ? { accepted: true } : { state: 'completed' },
    });
    if (this.waiter && this.response) {
      const response = this.response;
      this.response = undefined;
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter(response);
    }
  }

  async receive(): Promise<string> {
    if (this.response) {
      const response = this.response;
      this.response = undefined;
      return response;
    }
    return new Promise((resolve) => { this.waiter = resolve; });
  }

  close(): void {}
}

class DeferredVsockTransport implements VsockTransport {
  readonly sent: string[] = [];
  private readonly queued: string[] = [];
  private waiter: ((frame: string) => void) | undefined;

  send(frame: string): void {
    this.sent.push(frame);
  }

  receive(): Promise<string> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => { this.waiter = resolve; });
  }

  respond(requestId: string, method: string, payload: unknown = {}): void {
    const request = JSON.parse(this.sent.find((frame) => JSON.parse(frame).requestId === requestId)!) as { sessionId: string };
    const frame = JSON.stringify({ version: '1', sessionId: request.sessionId, requestId, method, payload });
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = undefined;
      waiter(frame);
    } else this.queued.push(frame);
  }

  close(): void {}
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ConstrainedVsockChannel', () => {
  it('routes only bounded workload and credential messages for one session', async () => {
    const transport = new FakeVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, transport });
    const controller = new GuestWorkloadController({ channel });

    await expect(controller.start({ workloadId: 'workload.fixed', arguments: ['--bounded'] })).resolves.toEqual({ state: 'completed' });
    await expect(controller.cancel('operator requested cancellation')).resolves.toEqual({ state: 'completed' });
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent.join('\n')).not.toContain('http');
  });

  it('delivers a scoped credential once and does not return the raw value through the controller', async () => {
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project-a', 'raw-secret');
    const leases = new SecretLeaseManager(broker, { now: () => '2026-08-24T12:00:00.000Z' });
    const transport = new FakeVsockTransport();
    const controller = new GuestWorkloadController({
      channel: new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, transport }),
      credentialLeases: leases,
      credentialMode: 'development',
    });
    const lease = await leases.issue({ service: 'provider', account: 'project-a', scope: ['guest:session_001'] });

    const result = await controller.deliverCredential(lease.leaseId, 'guest:session_001');

    expect(result).toMatchObject({ leaseId: lease.leaseId });
    expect(JSON.stringify(result)).not.toContain('raw-secret');
    expect(transport.sent.join('\n')).toContain('credential.deliver');
    expect(transport.sent.join('\n')).toContain('raw-secret');
    await expect(controller.deliverCredential(lease.leaseId, 'guest:session_001')).rejects.toMatchObject({ code: 'consumed' });
  });

  it('refuses raw long-lived credential delivery in strict mode before consuming the lease', async () => {
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project-a', 'raw-secret');
    const leases = new SecretLeaseManager(broker, { now: () => '2026-08-24T12:00:00.000Z' });
    const transport = new FakeVsockTransport();
    const controller = new GuestWorkloadController({
      channel: new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, transport }),
      credentialLeases: leases,
    });
    const lease = await leases.issue({ service: 'provider', account: 'project-a', scope: ['guest:session_001'] });

    await expect(controller.deliverCredential(lease.leaseId, 'guest:session_001')).rejects.toMatchObject({ code: 'method_not_allowed' });
    expect(transport.sent.join('\n')).not.toContain('raw-secret');
    await expect(controller.deliverCredential(lease.leaseId, 'guest:session_001')).rejects.not.toMatchObject({ code: 'consumed' });
  });

  it('rejects wrong-session frames and oversized outbound payloads', async () => {
    const transport = new FakeVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, maxMessageBytes: 80, transport });
    await expect(channel.send('workload.start', { workloadId: 'x'.repeat(100) })).rejects.toMatchObject({ code: 'message_too_large' });
    const identityChannel = new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, transport });
    transport.receive = async () => JSON.stringify({ version: '1', sessionId: 'session_other', requestId: 'request_1', method: 'workload.result', payload: {} });
    await expect(identityChannel.request('workload.cancel', { reason: 'stop' }, 100)).rejects.toMatchObject({ code: 'wrong_session' });
  });

  it('correlates concurrent reversed responses and rejects mismatched response methods', async () => {
    const transport = new DeferredVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_concurrent', guestCid: 42, guestPort: 7000, transport });
    const first = channel.request('workload.start', { workloadId: 'first' });
    const second = channel.request('workload.cancel', { reason: 'second' });
    await eventually(() => transport.sent.length === 2);
    const firstId = (JSON.parse(transport.sent[0]!) as { requestId: string }).requestId;
    const secondId = (JSON.parse(transport.sent[1]!) as { requestId: string }).requestId;
    transport.respond(secondId, 'workload.result', { which: 'second' });
    transport.respond(firstId, 'workload.result', { which: 'first' });
    await expect(first).resolves.toEqual({ which: 'first' });
    await expect(second).resolves.toEqual({ which: 'second' });

    const mismatch = channel.request('workload.start', { workloadId: 'mismatch' });
    await eventually(() => transport.sent.length === 3);
    const mismatchId = (JSON.parse(transport.sent[2]!) as { requestId: string }).requestId;
    transport.respond(mismatchId, 'credential.ack');
    await expect(mismatch).rejects.toMatchObject({ code: 'response_mismatch' });
  });

  it('ignores late timed-out responses and rejects every pending request on close', async () => {
    const transport = new DeferredVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_timeout', guestCid: 42, guestPort: 7000, transport });
    const timedOut = channel.request('workload.start', { workloadId: 'late' }, 10);
    await expect(timedOut).rejects.toMatchObject({ code: 'timeout' });
    const lateId = (JSON.parse(transport.sent[0]!) as { requestId: string }).requestId;
    const live = channel.request('workload.start', { workloadId: 'live' }, 500);
    await eventually(() => transport.sent.length === 2);
    const liveId = (JSON.parse(transport.sent[1]!) as { requestId: string }).requestId;
    transport.respond(lateId, 'workload.result', { poisoned: true });
    transport.respond(liveId, 'workload.result', { live: true });
    await expect(live).resolves.toEqual({ live: true });

    const pendingA = channel.request('workload.start', { workloadId: 'a' }, 500);
    const pendingB = channel.request('workload.cancel', { reason: 'b' }, 500);
    await channel.close();
    await expect(pendingA).rejects.toMatchObject({ code: 'closed' });
    await expect(pendingB).rejects.toMatchObject({ code: 'closed' });
  });

  it('bounds outstanding requests', async () => {
    const transport = new DeferredVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_bound', guestCid: 42, guestPort: 7000, maxOutstandingRequests: 1, transport });
    const first = channel.request('workload.start', { workloadId: 'one' });
    await expect(channel.request('workload.start', { workloadId: 'two' })).rejects.toMatchObject({ code: 'too_many_outstanding' });
    await channel.close();
    await expect(first).rejects.toMatchObject({ code: 'closed' });
  });
});
