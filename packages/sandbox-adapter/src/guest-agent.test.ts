import { describe, expect, it } from 'vitest';
import { InMemorySecretBroker, SecretLeaseManager } from '@moirae/secret-broker';
import { ConstrainedVsockChannel, GuestWorkloadController, type VsockTransport } from './constrained-vsock.js';
import { createBoundedProcessWorkload, GuestWorkloadAgent, type GuestWorkloadDefinition } from './guest-agent.js';

class LinkTransport implements VsockTransport {
  private peer?: LinkTransport;
  private closed = false;
  private readonly queue: string[] = [];
  private readonly waiters: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = [];

  connect(peer: LinkTransport): void { this.peer = peer; }
  send(frame: string): void {
    if (this.closed || !this.peer) throw new Error('transport closed');
    const waiter = this.peer.waiters.shift();
    if (waiter) waiter.resolve(frame); else this.peer.queue.push(frame);
  }
  receive(signal?: AbortSignal): Promise<string> {
    if (this.closed) return Promise.reject(new Error('transport closed'));
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('transport receive cancelled'));
      }, { once: true });
    });
  }
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter.reject(new Error('transport closed'));
  }
}

function link(): [LinkTransport, LinkTransport] {
  const host = new LinkTransport();
  const guest = new LinkTransport();
  host.connect(guest);
  guest.connect(host);
  return [host, guest];
}

describe('GuestWorkloadAgent', () => {
  it('executes an allowlisted guest workload over the constrained channel', async () => {
    const [hostTransport, guestTransport] = link();
    const workloads = new Map<string, GuestWorkloadDefinition>([['echo', { run: async (args) => ({ state: 'completed', args }) }]]);
    const agent = new GuestWorkloadAgent({ sessionId: 'session_guest_1', transport: guestTransport, workloads });
    const running = agent.run();
    const controller = new GuestWorkloadController({ channel: new ConstrainedVsockChannel({ sessionId: 'session_guest_1', guestCid: 42, guestPort: 7000, transport: hostTransport }) });

    await expect(controller.start({ workloadId: 'echo', arguments: ['bounded'] })).resolves.toEqual({ workloadId: 'echo', result: { state: 'completed', args: ['bounded'] } });
    await agent.stop();
    await expect(running).resolves.toBeUndefined();
  });

  it('propagates cancellation to the active guest workload', async () => {
    const [hostTransport, guestTransport] = link();
    const workloads = new Map<string, GuestWorkloadDefinition>([['wait', { run: (_args, signal) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ cancelled: true }), { once: true })) }]]);
    const agent = new GuestWorkloadAgent({ sessionId: 'session_guest_2', transport: guestTransport, workloads });
    const runningAgent = agent.run();
    const controller = new GuestWorkloadController({ channel: new ConstrainedVsockChannel({ sessionId: 'session_guest_2', guestCid: 42, guestPort: 7000, transport: hostTransport }) });
    const started = controller.start({ workloadId: 'wait' });
    await expect(controller.cancel('operator requested cancellation', 'wait')).resolves.toMatchObject({ state: 'cancel_requested', workloadId: 'wait' });
    await expect(started).resolves.toEqual({ workloadId: 'wait', result: { cancelled: true } });
    await agent.stop();
    await expect(runningAgent).resolves.toBeUndefined();
  });

  it('delivers one scoped credential into the guest sink and supports bounded process handlers', async () => {
    const [hostTransport, guestTransport] = link();
    let receivedSecret = '';
    const agent = new GuestWorkloadAgent({ sessionId: 'session_guest_3', transport: guestTransport, workloads: new Map(), credentialMode: 'development', onCredential: ({ secret }) => { receivedSecret = secret; } });
    const runningAgent = agent.run();
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project', 'guest-secret');
    const leases = new SecretLeaseManager(broker, { now: () => '2026-08-24T14:00:00.000Z' });
    const lease = await leases.issue({ service: 'provider', account: 'project', scope: ['guest:session_guest_3'] });
    const controller = new GuestWorkloadController({ channel: new ConstrainedVsockChannel({ sessionId: 'session_guest_3', guestCid: 42, guestPort: 7000, transport: hostTransport }), credentialLeases: leases, credentialMode: 'development' });
    await controller.deliverCredential(lease.leaseId, 'guest:session_guest_3');
    expect(receivedSecret).toBe('guest-secret');
    await expect(controller.deliverCredential(lease.leaseId, 'guest:session_guest_3')).rejects.toMatchObject({ code: 'consumed' });
    await agent.stop();
    await expect(runningAgent).resolves.toBeUndefined();

    const processWorkload = createBoundedProcessWorkload({ command: process.execPath, cwd: process.cwd(), maxDurationMs: 2_000, maxOutputBytes: 128, allowArguments: (args) => args.length === 2 && args[0] === '-e' });
    await expect(processWorkload.run(['-e', 'process.stdout.write("guest")'], new AbortController().signal)).resolves.toMatchObject({ stdout: 'guest', exitCode: 0 });
  });
});
