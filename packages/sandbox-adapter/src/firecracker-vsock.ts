import { createServer, type Server, type Socket } from 'node:net';
import type { VsockTransport } from './constrained-vsock.js';

const DEFAULT_MAX_FRAME_BYTES = 64 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 60_000;
const FIXED_PURPOSE_SOCKET = '/run/fates/vsock.sock';
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_VALUE = /^[A-Za-z0-9._:-]{1,256}$/;
const SOURCE_ID = /^file:[A-Za-z0-9._/-]{1,240}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const FATES_VSOCK_PROTOCOL = 'fates-vsock-proposal-v1' as const;

export interface FatesGuestProposal {
  action: 'governed.memory-admission';
  sourceId: string;
  sourceHash: string;
  memoryId: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface FatesGuestProposalEnvelope {
  version: '1';
  sessionId: string;
  requestId: string;
  method: 'proposal.submit';
  payload: FatesGuestProposal;
}

export interface FatesProposalResult {
  action: 'ALLOW' | 'DENY';
  reasonCode: string;
  candidateId?: string;
  governedState?: string;
  decisionId?: string;
}

export class FatesVsockProtocolError extends Error {
  constructor(readonly code: 'invalid_frame' | 'wrong_session' | 'method_not_allowed' | 'message_too_large', message: string) {
    super(message);
    this.name = 'FatesVsockProtocolError';
  }
}

export function parseFatesGuestProposal(frame: string, expectedSessionId: string, maxMessageBytes = DEFAULT_MAX_FRAME_BYTES): FatesGuestProposalEnvelope {
  if (Buffer.byteLength(frame, 'utf8') > maxMessageBytes) throw new FatesVsockProtocolError('message_too_large', 'Fates proposal exceeds the configured bound');
  let parsed: unknown;
  try { parsed = JSON.parse(frame); } catch { throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal is not JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal must be an object');
  const envelope = parsed as Record<string, unknown>;
  if (envelope['version'] !== '1' || typeof envelope['sessionId'] !== 'string' || !SESSION_ID.test(envelope['sessionId']) || typeof envelope['requestId'] !== 'string' || !REQUEST_ID.test(envelope['requestId']) || envelope['method'] !== 'proposal.submit' || !('payload' in envelope)) {
    throw new FatesVsockProtocolError(envelope['sessionId'] === expectedSessionId ? 'invalid_frame' : 'wrong_session', 'Fates proposal envelope identity is invalid');
  }
  if (envelope['sessionId'] !== expectedSessionId) throw new FatesVsockProtocolError('wrong_session', 'Fates proposal session does not match the launched guest');
  const envelopeFields = new Set(['version', 'sessionId', 'requestId', 'method', 'payload']);
  if (Object.keys(envelope).some((key) => !envelopeFields.has(key))) throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal envelope contains an unsupported field');
  const payload = envelope['payload'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal payload must be an object');
  const value = payload as Record<string, unknown>;
  const allowed = new Set(['action', 'sourceId', 'sourceHash', 'memoryId', 'idempotencyKey', 'correlationId']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal contains an unsupported field');
  if (value['action'] !== 'governed.memory-admission' || typeof value['sourceId'] !== 'string' || value['sourceId'].includes('..') || !SOURCE_ID.test(value['sourceId']) || typeof value['sourceHash'] !== 'string' || !SHA256.test(value['sourceHash']) || typeof value['memoryId'] !== 'string' || !SAFE_VALUE.test(value['memoryId']) || typeof value['idempotencyKey'] !== 'string' || !SAFE_VALUE.test(value['idempotencyKey']) || typeof value['correlationId'] !== 'string' || !SAFE_VALUE.test(value['correlationId'])) {
    throw new FatesVsockProtocolError('invalid_frame', 'Fates proposal fields are invalid');
  }
  return { version: '1', sessionId: envelope['sessionId'], requestId: envelope['requestId'], method: 'proposal.submit', payload: value as unknown as FatesGuestProposal };
}

export function fatesProposalResultEnvelope(sessionId: string, requestId: string, payload: FatesProposalResult): string {
  if (!SESSION_ID.test(sessionId) || !REQUEST_ID.test(requestId)) throw new TypeError('Fates proposal response identity is invalid');
  if (!payload || (payload.action !== 'ALLOW' && payload.action !== 'DENY') || !SAFE_VALUE.test(payload.reasonCode)) throw new TypeError('Fates proposal response is invalid');
  const fields = new Set(['action', 'reasonCode', 'candidateId', 'governedState', 'decisionId']);
  if (Object.keys(payload).some((key) => !fields.has(key))) throw new TypeError('Fates proposal response contains an unsupported field');
  for (const field of ['candidateId', 'governedState', 'decisionId'] as const) {
    if (payload[field] !== undefined && !SAFE_VALUE.test(payload[field])) throw new TypeError(`Fates proposal response ${field} is invalid`);
  }
  return JSON.stringify({ version: '1', sessionId, requestId, method: 'proposal.result', payload });
}

export interface FirecrackerVsockTransportOptions {
  /** Host-side AF_UNIX listener path: Firecracker's uds_path followed by _<guest-port>. */
  socketPath: string;
  maxFrameBytes?: number;
  connectTimeoutMs?: number;
  /** Test-only seam; production construction must use the real Linux platform. */
  platform?: NodeJS.Platform;
}

/**
 * Resolve the host path for the fixed-purpose UDS after jailer has chrooted
 * Firecracker. The returned path is not a TCP endpoint and is only usable
 * after a real VMM has created the socket.
 */
export function firecrackerVsockSocketPath(jailRootPath: string): string {
  if (!jailRootPath || jailRootPath.includes('..')) throw new TypeError('jailer root path is invalid');
  // This is a Linux guest/jailer path even when the contract module is unit
  // tested on Windows; node:path.join would emit backslashes there.
  return `${jailRootPath.replace(/\/+$/, '')}${FIXED_PURPOSE_SOCKET}`;
}

/**
 * Resolve the host AF_UNIX listener used for a guest-initiated connection.
 * Firecracker appends the guest destination port to the configured base UDS.
 */
export function firecrackerGuestVsockSocketPath(jailRootPath: string, guestPort: number): string {
  if (!Number.isSafeInteger(guestPort) || guestPort <= 0 || guestPort > 0xffffffff) throw new TypeError('guest vsock port is invalid');
  return `${firecrackerVsockSocketPath(jailRootPath)}_${guestPort}`;
}

/**
 * Real host half of Firecracker's guest-initiated vsock bridge. Firecracker
 * connects the guest's AF_VSOCK request to this host AF_UNIX listener.
 */
export class FirecrackerVsockTransport implements VsockTransport {
  readonly kind = 'firecracker-vsock-uds' as const;
  readonly socketPath: string;
  private readonly maxFrameBytes: number;
  private readonly connectTimeoutMs: number;
  private server: Server | undefined;
  private socket: Socket | undefined;
  private listening: Promise<void> | undefined;
  private connectionReady: Promise<void> | undefined;
  private resolveConnection: (() => void) | undefined;
  private rejectConnection: ((error: unknown) => void) | undefined;
  private closed = false;
  private input = Buffer.alloc(0);
  private readonly queued: string[] = [];
  private readonly waiters: Array<{ resolve: (frame: string) => void; reject: (error: unknown) => void; signal?: AbortSignal; abort?: () => void }> = [];

  constructor(options: FirecrackerVsockTransportOptions) {
    if (options.platform !== undefined && options.platform !== 'linux') throw new TypeError('Firecracker vsock requires Linux; no fallback is permitted');
    if (!options.socketPath || !options.socketPath.startsWith('/') || options.socketPath.includes('..')) throw new TypeError('Firecracker vsock socket path must be absolute and non-traversing');
    if (!Number.isSafeInteger(options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES) || (options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES) <= 0) throw new TypeError('Firecracker vsock frame bound is invalid');
    if (!Number.isSafeInteger(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS) || (options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS) <= 0) throw new TypeError('Firecracker vsock connect timeout is invalid');
    if ((options.platform ?? process.platform) !== 'linux') throw new TypeError('Firecracker vsock requires Linux; no fallback is permitted');
    this.socketPath = options.socketPath;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  async listen(): Promise<void> {
    if (this.closed) throw new Error('Firecracker vsock transport is closed');
    if (this.server?.listening) return;
    if (this.listening) return this.listening;
    this.listening = new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => this.accept(socket));
      this.server = server;
      let settled = false;
      server.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          this.fail(error);
        }
      });
      server.once('close', () => {
        if (!this.closed) this.fail(new Error('Firecracker guest-vsock listener closed'));
      });
      server.listen(this.socketPath, () => {
        settled = true;
        resolve();
      });
    }).finally(() => {
      this.listening = undefined;
    });
    return this.listening;
  }

  private accept(socket: Socket): void {
    if (this.closed || (this.socket && !this.socket.destroyed)) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    this.connectionReady = undefined;
    this.resolveConnection?.();
    this.resolveConnection = undefined;
    this.rejectConnection = undefined;
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (error) => this.fail(error instanceof Error ? error : new Error('Firecracker vsock socket failed')));
    socket.once('close', () => {
      if (!this.closed) this.fail(new Error('Firecracker guest-vsock connection closed'));
    });
  }

  private async waitForConnection(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connectionReady) return this.connectionReady;
    let timer: NodeJS.Timeout | undefined;
    this.connectionReady = new Promise<void>((resolve, reject) => {
      this.resolveConnection = resolve;
      this.rejectConnection = reject;
      timer = setTimeout(() => {
        this.resolveConnection = undefined;
        this.rejectConnection = undefined;
        reject(new Error(`timed out waiting for guest AF_VSOCK connection: ${this.socketPath}`));
      }, this.connectTimeoutMs);
    });
    try {
      return await this.connectionReady;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async send(frame: string): Promise<void> {
    if (this.closed) throw new Error('Firecracker vsock transport is closed');
    if (frame.includes('\n') || frame.includes('\r')) throw new Error('Firecracker vsock frame contains a line break');
    if (Buffer.byteLength(frame, 'utf8') > this.maxFrameBytes) throw new Error('Firecracker vsock frame exceeds the configured bound');
    await this.listen();
    await this.waitForConnection();
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error('Firecracker guest-vsock connection is not established');
    await new Promise<void>((resolve, reject) => {
      socket.write(`${frame}\n`, (error?: Error | null) => error ? reject(error) : resolve());
    });
  }

  async receive(signal?: AbortSignal): Promise<string> {
    if (this.closed) throw new Error('Firecracker vsock transport is closed');
    await this.listen();
    await this.waitForConnection();
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    return new Promise<string>((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: undefined as (() => void) | undefined };
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Firecracker vsock receive cancelled'));
      };
      waiter.abort = abort;
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = new Error('Firecracker vsock transport is closed');
    this.rejectWaiters(error);
    this.input = Buffer.alloc(0);
    this.queued.length = 0;
    this.rejectConnection?.(error);
    this.resolveConnection = undefined;
    this.rejectConnection = undefined;
    this.socket?.destroy();
    this.socket = undefined;
    const server = this.server;
    this.server = undefined;
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    // The listener path belongs to the acceptance session. Never unlink it here;
    // jail/session cleanup owns that path.
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    this.input = Buffer.concat([this.input, chunk]);
    if (this.input.length > this.maxFrameBytes + 1 && !this.input.includes(0x0a)) {
      this.fail(new Error('Firecracker vsock frame exceeds the configured bound'));
      return;
    }
    while (true) {
      const newline = this.input.indexOf(0x0a);
      if (newline < 0) return;
      const frame = this.input.subarray(0, newline);
      this.input = this.input.subarray(newline + 1);
      if (frame.length > this.maxFrameBytes) {
        this.fail(new Error('Firecracker vsock frame exceeds the configured bound'));
        return;
      }
      const text = frame.toString('utf8');
      const waiter = this.waiters.shift();
      if (waiter) {
        if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
        waiter.resolve(text);
      } else {
        if (this.queued.length >= 1) {
          this.fail(new Error('Firecracker guest-vsock message queue is bounded to one frame'));
          return;
        }
        this.queued.push(text);
      }
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectWaiters(error);
    this.rejectConnection?.(error);
    this.resolveConnection = undefined;
    this.rejectConnection = undefined;
    this.socket?.destroy();
    this.socket = undefined;
    this.server?.close();
    this.server = undefined;
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.signal && waiter.abort) waiter.signal.removeEventListener('abort', waiter.abort);
      waiter.reject(error);
    }
  }
}

export { FIXED_PURPOSE_SOCKET as FIRECRACKER_VSOCK_SOCKET_PATH };
