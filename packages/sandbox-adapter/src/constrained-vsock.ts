import { randomUUID } from 'node:crypto';
import { SecretLeaseManager, type CredentialLease } from '@moirae/secret-broker';

export type ConstrainedVsockMethod =
  | 'workload.start'
  | 'workload.cancel'
  | 'credential.deliver'
  | 'workload.result'
  | 'workload.error'
  | 'credential.ack';

const OUTBOUND_METHODS = new Set<ConstrainedVsockMethod>(['workload.start', 'workload.cancel', 'credential.deliver']);
const RESPONSE_METHODS = new Set<ConstrainedVsockMethod>(['workload.result', 'workload.error', 'credential.ack']);
const WORKLOAD_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface VsockEnvelope {
  version: '1';
  sessionId: string;
  requestId: string;
  method: ConstrainedVsockMethod;
  payload: unknown;
}

export interface VsockTransport {
  send(frame: string): Promise<void> | void;
  receive(signal?: AbortSignal): Promise<string>;
  close(): Promise<void> | void;
}

export interface ConstrainedVsockChannelOptions {
  sessionId: string;
  guestCid: number;
  guestPort: number;
  maxMessageBytes?: number;
  transport: VsockTransport;
  now?: () => number;
}

export class VsockChannelError extends Error {
  constructor(readonly code: 'closed' | 'invalid_frame' | 'wrong_session' | 'method_not_allowed' | 'message_too_large' | 'timeout' | 'cancelled' | 'guest_error', message: string) {
    super(message);
    this.name = 'VsockChannelError';
  }
}

/**
 * Fixed-purpose host↔guest channel. It has no network fallback, arbitrary
 * method dispatch, or implicit session switching; the Firecracker profile
 * remains responsible for proving the CID/socket attachment on Linux.
 */
export class ConstrainedVsockChannel {
  private readonly maxMessageBytes: number;
  private readonly now: () => number;
  private closed = false;
  private receiverStarted = false;
  private readonly pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();

  constructor(private readonly options: ConstrainedVsockChannelOptions) {
    if (!options.sessionId.trim()) throw new TypeError('vsock sessionId is required');
    if (!Number.isSafeInteger(options.guestCid) || options.guestCid < 3) throw new TypeError('vsock guestCid is invalid');
    if (!Number.isSafeInteger(options.guestPort) || options.guestPort <= 0) throw new TypeError('vsock guestPort is invalid');
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) throw new TypeError('vsock maxMessageBytes is invalid');
  }

  async send(method: Extract<ConstrainedVsockMethod, 'workload.start' | 'workload.cancel' | 'credential.deliver'>, payload: unknown, requestId = `vsock_${randomUUID()}`): Promise<string> {
    this.assertOpen();
    if (!OUTBOUND_METHODS.has(method)) throw new VsockChannelError('method_not_allowed', `Outbound vsock method is not allowed: ${method}`);
    const envelope: VsockEnvelope = { version: '1', sessionId: this.options.sessionId, requestId, method, payload };
    const frame = JSON.stringify(envelope);
    this.assertSize(frame);
    await this.options.transport.send(frame);
    return envelope.requestId;
  }

  async request(
    method: Extract<ConstrainedVsockMethod, 'workload.start' | 'workload.cancel' | 'credential.deliver'>,
    payload: unknown,
    timeoutMs = 5_000,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('vsock timeoutMs is invalid');
    const requestId = `vsock_${randomUUID()}`;
    this.ensureReceiver();
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new VsockChannelError('timeout', 'vsock request timed out'));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new VsockChannelError('cancelled', 'vsock request was cancelled'));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, {
        resolve: (value) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(value); },
        reject: (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); },
      });
    });
    try {
      await this.send(method, payload, requestId);
    } catch (error) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      pending?.reject(error);
      throw error;
    }
    return response;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const error = new VsockChannelError('closed', 'vsock channel is closed');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    await this.options.transport.close();
  }

  private ensureReceiver(): void {
    if (this.receiverStarted) return;
    this.receiverStarted = true;
    void this.receiveLoop();
  }

  private async receiveLoop(): Promise<void> {
    while (!this.closed) {
      let response: VsockEnvelope;
      try {
        response = this.parseFrame(await this.options.transport.receive());
      } catch (error) {
        if (this.closed) return;
        this.closed = true;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        await this.options.transport.close();
        return;
      }
      const pending = this.pending.get(response.requestId);
      if (!pending) continue;
      this.pending.delete(response.requestId);
      if (response.method === 'workload.error') pending.reject(new VsockChannelError('guest_error', 'guest workload reported an error'));
      else pending.resolve(response.payload);
    }
  }

  private parseFrame(frame: string): VsockEnvelope {
    this.assertSize(frame);
    let parsed: unknown;
    try { parsed = JSON.parse(frame); } catch { throw new VsockChannelError('invalid_frame', 'vsock frame is not JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new VsockChannelError('invalid_frame', 'vsock frame must be an object');
    const value = parsed as Record<string, unknown>;
    if (value['version'] !== '1' || value['sessionId'] !== this.options.sessionId || typeof value['requestId'] !== 'string' || typeof value['method'] !== 'string' || !('payload' in value)) {
      throw new VsockChannelError(value['sessionId'] === this.options.sessionId ? 'invalid_frame' : 'wrong_session', 'vsock frame identity is invalid');
    }
    if (!RESPONSE_METHODS.has(value['method'] as ConstrainedVsockMethod)) throw new VsockChannelError('method_not_allowed', `Inbound vsock method is not allowed: ${value['method']}`);
    return value as unknown as VsockEnvelope;
  }

  private assertSize(frame: string): void {
    if (Buffer.byteLength(frame, 'utf8') > this.maxMessageBytes) throw new VsockChannelError('message_too_large', 'vsock frame exceeds the configured bound');
  }

  private assertOpen(): void {
    if (this.closed) throw new VsockChannelError('closed', 'vsock channel is closed');
  }
}

export interface GuestWorkloadStart {
  workloadId: string;
  arguments?: string[];
}

export interface GuestWorkloadControllerOptions {
  channel: ConstrainedVsockChannel;
  credentialLeases?: SecretLeaseManager;
}

/** Host-side workload lifecycle and scoped credential hand-off over the channel. */
export class GuestWorkloadController {
  constructor(private readonly options: GuestWorkloadControllerOptions) {}

  async start(request: GuestWorkloadStart, timeoutMs?: number, signal?: AbortSignal): Promise<unknown> {
    if (!WORKLOAD_ID.test(request.workloadId)) throw new TypeError('guest workloadId is invalid');
    const args = request.arguments ?? [];
    if (args.length > 32 || args.some((argument) => typeof argument !== 'string' || argument.length > 1024)) throw new TypeError('guest workload arguments exceed the bound');
    return this.options.channel.request('workload.start', { workloadId: request.workloadId, arguments: args }, timeoutMs, signal);
  }

  async cancel(reason: string, workloadIdOrTimeout?: string | number, timeoutMs?: number, signal?: AbortSignal): Promise<unknown> {
    if (!reason.trim() || reason.length > 256) throw new TypeError('guest cancellation reason is invalid');
    const workloadId = typeof workloadIdOrTimeout === 'string' ? workloadIdOrTimeout : undefined;
    const effectiveTimeoutMs = typeof workloadIdOrTimeout === 'number' ? workloadIdOrTimeout : timeoutMs;
    if (workloadId !== undefined && !WORKLOAD_ID.test(workloadId)) throw new TypeError('guest workloadId is invalid');
    return this.options.channel.request('workload.cancel', { reason, workloadId }, effectiveTimeoutMs, signal);
  }

  async deliverCredential(leaseId: string, destination: string, timeoutMs?: number, signal?: AbortSignal): Promise<CredentialLease> {
    if (!this.options.credentialLeases) throw new VsockChannelError('method_not_allowed', 'credential delivery is not configured');
    const lease = await this.options.credentialLeases.deliver(leaseId, destination, async (secret, context) => {
      await this.options.channel.request('credential.deliver', { leaseId: context.leaseId, destination: context.destination, secret }, timeoutMs, signal);
    });
    return lease;
  }
}
