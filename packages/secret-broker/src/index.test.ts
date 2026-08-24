import { describe, expect, it } from 'vitest';
import { InMemorySecretBroker, SecretLeaseError, SecretLeaseManager } from './index.js';

describe('SecretLeaseManager', () => {
  it('keeps credentials host-side and delivers a lease only once to an allowed destination', async () => {
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project-a', 'super-secret');
    const manager = new SecretLeaseManager(broker, { now: () => '2026-08-24T12:00:00.000Z' });
    const lease = await manager.issue({ service: 'provider', account: 'project-a', scope: ['guest:session-1'] });
    let delivered = '';

    const consumed = await manager.deliver(lease.leaseId, 'guest:session-1', (secret, context) => {
      delivered = secret;
      expect(context.leaseId).toBe(lease.leaseId);
      expect(context.destination).toBe('guest:session-1');
    });

    expect(delivered).toBe('super-secret');
    expect(JSON.stringify(lease)).not.toContain('super-secret');
    expect(JSON.stringify(consumed)).not.toContain('super-secret');
    await expect(manager.deliver(lease.leaseId, 'guest:session-1', () => undefined)).rejects.toMatchObject({ code: 'consumed' });
  });

  it('rejects scope expansion and expired leases before invoking delivery', async () => {
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project-a', 'secret');
    let now = '2026-08-24T12:00:00.000Z';
    const manager = new SecretLeaseManager(broker, { now: () => now, maxTtlMs: 1_000 });
    const lease = await manager.issue({ service: 'provider', account: 'project-a', scope: ['guest:session-1'] }, 500);

    await expect(manager.deliver(lease.leaseId, 'guest:session-2', () => undefined)).rejects.toMatchObject({ code: 'invalid_scope' });
    now = '2026-08-24T12:00:01.000Z';
    await expect(manager.deliver(lease.leaseId, 'guest:session-1', () => undefined)).rejects.toMatchObject({ code: 'expired' });
  });

  it('consumes a lease even when the effect boundary fails and never leaks the callback error', async () => {
    const broker = new InMemorySecretBroker();
    await broker.set('provider', 'project-a', 'secret');
    const manager = new SecretLeaseManager(broker, { now: () => '2026-08-24T12:00:00.000Z' });
    const lease = await manager.issue({ service: 'provider', account: 'project-a', scope: ['guest:session-1'] });

    await expect(manager.deliver(lease.leaseId, 'guest:session-1', () => { throw new Error('raw transport detail'); })).rejects.toEqual(
      expect.objectContaining({ code: 'delivery_failed', message: 'Credential delivery failed at the effect boundary' }),
    );
    await expect(manager.deliver(lease.leaseId, 'guest:session-1', () => undefined)).rejects.toBeInstanceOf(SecretLeaseError);
    expect(manager.get(lease.leaseId)).toMatchObject({ leaseId: lease.leaseId });
  });
});
