import { describe, expect, it } from 'vitest';
import {
  FIRECRACKER_VSOCK_SOCKET_PATH,
  FatesVsockProtocolError,
  FirecrackerVsockTransport,
  firecrackerGuestVsockSocketPath,
  firecrackerVsockSocketPath,
  fatesProposalResultEnvelope,
  parseFatesGuestProposal,
} from './firecracker-vsock.js';

const proposal = JSON.stringify({
  version: '1',
  sessionId: 'fates-session-1',
  requestId: 'req_fates_005a_001',
  method: 'proposal.submit',
  payload: {
    action: 'governed.memory-admission',
    sourceId: 'file:docs/fates-005c.md',
    sourceHash: 'a'.repeat(64),
    memoryId: 'memory_fates_005c_001',
    idempotencyKey: 'fates-005c-idempotency-001',
    correlationId: 'cor_fates_005a_001',
  },
});

describe('Firecracker vsock transport boundary', () => {
  it('uses the fixed-purpose UDS path relative to the jail root', () => {
    expect(FIRECRACKER_VSOCK_SOCKET_PATH).toBe('/run/fates/vsock.sock');
    expect(firecrackerVsockSocketPath('/srv/jailer/firecracker/fates-session-1/root')).toBe('/srv/jailer/firecracker/fates-session-1/root/run/fates/vsock.sock');
    expect(firecrackerGuestVsockSocketPath('/srv/jailer/firecracker/fates-session-1/root', 7000)).toBe('/srv/jailer/firecracker/fates-session-1/root/run/fates/vsock.sock_7000');
  });

  it('rejects non-Linux construction and never accepts a TCP-shaped endpoint', () => {
    expect(() => new FirecrackerVsockTransport({ socketPath: '/tmp/fates.sock', platform: 'win32' })).toThrow('Linux');
    expect(() => new FirecrackerVsockTransport({ socketPath: '127.0.0.1:7000', platform: 'linux' })).toThrow('absolute');
  });
});

describe('FATES guest proposal protocol', () => {
  it('parses only the bounded guest-to-host proposal shape', () => {
    expect(parseFatesGuestProposal(proposal, 'fates-session-1')).toMatchObject({
      method: 'proposal.submit',
      sessionId: 'fates-session-1',
      payload: { action: 'governed.memory-admission', sourceId: 'file:docs/fates-005c.md' },
    });
  });

  it('rejects session confusion and unsupported fields', () => {
    expect(() => parseFatesGuestProposal(proposal, 'other-session')).toThrow(FatesVsockProtocolError);
    const extra = JSON.parse(proposal);
    extra.payload.secret = 'must-not-cross';
    expect(() => parseFatesGuestProposal(JSON.stringify(extra), 'fates-session-1')).toThrow('unsupported field');
  });

  it('produces a typed result without credential or provider fields', () => {
    const result = JSON.parse(fatesProposalResultEnvelope('fates-session-1', 'req_fates_005a_001', { action: 'ALLOW', reasonCode: 'FATES_GOVERNED_PATH_COMPLETED' }));
    expect(result).toMatchObject({ version: '1', method: 'proposal.result', payload: { action: 'ALLOW' } });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|credential|provider/i);
  });
});
