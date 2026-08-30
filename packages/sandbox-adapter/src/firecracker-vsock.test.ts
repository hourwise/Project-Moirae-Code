import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRECRACKER_VSOCK_SOCKET_PATH,
  FatesGuestDiagnosticError,
  FatesVsockProtocolError,
  FirecrackerVsockTransport,
  firecrackerGuestVsockSocketPath,
  firecrackerVsockSocketPath,
  fatesProposalResultEnvelope,
  parseFatesGuestDiagnosticLine,
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

describe('bounded guest boot/vsock diagnostics', () => {
  it('accepts fixed stage names and bounded errno values only', () => {
    expect(parseFatesGuestDiagnosticLine('FATES_005A_GUEST_STAGE INIT_STARTED')).toEqual({ stage: 'INIT_STARTED' });
    expect(parseFatesGuestDiagnosticLine('FATES_005A_GUEST_STAGE AF_VSOCK_SOCKET_CREATED')).toEqual({ stage: 'AF_VSOCK_SOCKET_CREATED' });
    expect(parseFatesGuestDiagnosticLine('FATES_005A_GUEST_STAGE AF_VSOCK_SOCKET_FAILED errno=97')).toEqual({ stage: 'AF_VSOCK_SOCKET_FAILED', errno: 97 });
    for (const errno of [111, 2, 104, 11, 22]) {
      expect(parseFatesGuestDiagnosticLine(`FATES_005A_GUEST_STAGE AF_VSOCK_CONNECT_RETRY errno=${errno}`).errno).toBe(errno);
    }
    expect(() => parseFatesGuestDiagnosticLine('FATES_005A_GUEST_STAGE UNKNOWN errno=1')).toThrow(FatesGuestDiagnosticError);
    expect(() => parseFatesGuestDiagnosticLine('FATES_005A_GUEST_STAGE AF_VSOCK_CONNECT_RETRY errno=65536')).toThrow('outside');
    expect(() => parseFatesGuestDiagnosticLine(`FATES_005A_GUEST_STAGE INIT_STARTED ${'x'.repeat(256)}`)).toThrow('exceeds');
  });

  it('keeps the guest source diagnostic mode bounded and covers terminal socket/connect stages', () => {
    const source = readFileSync(fileURLToPath(new URL('./guest-fates-vsock-proposal-init.c', import.meta.url)), 'utf8');
    expect(source).toContain('#ifdef FATES_005A_GUEST_DIAGNOSTIC');
    expect(source).toContain('#define MAX_DIAGNOSTIC_EVENTS 32U');
    for (const stage of ['INIT_STARTED', 'CMDLINE_PARSED', 'EXECUTION_CONTRACT_VALID', 'AF_VSOCK_SOCKET_CREATED', 'AF_VSOCK_SOCKET_FAILED', 'AF_VSOCK_CONNECT_RETRY', 'AF_VSOCK_CONNECT_FAILED', 'AF_VSOCK_CONNECTED', 'PROPOSAL_SENT', 'RESULT_RECEIVED', 'RESULT_ALLOW']) {
      expect(source).toContain(`"${stage}"`);
    }
    expect(source).toMatch(/for \(unsigned int attempt = 0; attempt < 600U; attempt\+\+\)/);
    expect(source).toMatch(/connect_error != ENOENT && connect_error != ECONNREFUSED && connect_error != ECONNRESET && connect_error != EAGAIN/);
    expect(source).toContain('AF_VSOCK_SOCKET_FAILED');
    expect(source).toContain('AF_VSOCK_CONNECT_FAILED');
  });
});

describe('listener cleanup ownership', () => {
  it('closes successfully when the jail pathname becomes inaccessible after bind', async () => {
    if (process.platform !== 'linux' || process.getuid?.() === 0) return;
    const directory = await mkdtemp(join(tmpdir(), 'fates-vsock-inaccessible-'));
    const socketPath = join(directory, 'root', 'run', 'fates', 'vsock.sock_7000');
    const transport = new FirecrackerVsockTransport({ socketPath, connectTimeoutMs: 100 });
    try {
      await mkdir(join(directory, 'root', 'run', 'fates'), { recursive: true, mode: 0o755 });
      await transport.listen();
      expect((await lstat(socketPath)).isSocket()).toBe(true);
      await chmod(directory, 0o000);
      await expect(transport.close()).resolves.toBeUndefined();
    } finally {
      await chmod(directory, 0o700).catch(() => undefined);
      await transport.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not unlink a replacement socket after the owned transport is closed', async () => {
    if (process.platform !== 'linux') return;
    const directory = await mkdtemp(join(tmpdir(), 'fates-vsock-replacement-'));
    const socketPath = join(directory, 'vsock.sock_7000');
    const transport = new FirecrackerVsockTransport({ socketPath, connectTimeoutMs: 100 });
    let replacement: Server | undefined;
    try {
      await transport.listen();
      await transport.close();
      replacement = createServer();
      await new Promise<void>((resolve, reject) => {
        replacement.once('error', reject);
        replacement.listen(socketPath, resolve);
      });
      await transport.close();
      expect((await lstat(socketPath)).isSocket()).toBe(true);
    } finally {
      await transport.close().catch(() => undefined);
      if (replacement?.listening) await new Promise<void>((resolve) => replacement.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
