import { describe, expect, it } from 'vitest';
import { InMemorySecretBroker, SecretLeaseManager } from '@moirae/secret-broker';
import { ConstrainedVsockChannel, GuestWorkloadController, type VsockTransport } from './constrained-vsock.js';

class FakeVsockTransport implements VsockTransport {
  readonly sent: string[] = [];
  private response: string | undefined;

  async send(frame: string): Promise<void> {
    this.sent.push(frame);
    const request = JSON.parse(frame) as { sessionId: string; requestId: string; method: string; payload: Record<string, unknown> };
    this.response = JSON.stringify({
      version: '1', sessionId: request.sessionId, requestId: request.requestId,
      method: request.method === 'credential.deliver' ? 'credential.ack' : request.method === 'workload.cancel' ? 'workload.result' : 'workload.result',
      payload: request.method === 'credential.deliver' ? { accepted: true } : { state: 'completed' },
    });
  }

  async receive(): Promise<string> {
    if (!this.response) throw new Error('no response queued');
    const response = this.response;
    this.response = undefined;
    return response;
  }

  close(): void {}
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
    });
    const lease = await leases.issue({ service: 'provider', account: 'project-a', scope: ['guest:session_001'] });

    const result = await controller.deliverCredential(lease.leaseId, 'guest:session_001');

    expect(result).toMatchObject({ leaseId: lease.leaseId });
    expect(JSON.stringify(result)).not.toContain('raw-secret');
    expect(transport.sent.join('\n')).toContain('credential.deliver');
    expect(transport.sent.join('\n')).toContain('raw-secret');
    await expect(controller.deliverCredential(lease.leaseId, 'guest:session_001')).rejects.toMatchObject({ code: 'consumed' });
  });

  it('rejects wrong-session frames and oversized outbound payloads', async () => {
    const transport = new FakeVsockTransport();
    const channel = new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, maxMessageBytes: 80, transport });
    await expect(channel.send('workload.start', { workloadId: 'x'.repeat(100) })).rejects.toMatchObject({ code: 'message_too_large' });
    const identityChannel = new ConstrainedVsockChannel({ sessionId: 'session_001', guestCid: 42, guestPort: 7000, transport });
    transport.receive = async () => JSON.stringify({ version: '1', sessionId: 'session_other', requestId: 'request_1', method: 'workload.result', payload: {} });
    await expect(identityChannel.request('workload.cancel', { reason: 'stop' }, 100)).rejects.toMatchObject({ code: 'wrong_session' });
  });
});
