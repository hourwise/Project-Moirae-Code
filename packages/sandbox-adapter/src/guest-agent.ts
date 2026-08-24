import { spawn } from 'node:child_process';
import { type ConstrainedVsockMethod, type VsockEnvelope, type VsockTransport } from './constrained-vsock.js';

const MAX_ARGUMENTS = 32;
const MAX_ARGUMENT_LENGTH = 1024;
const WORKLOAD_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REQUEST_METHODS = new Set<ConstrainedVsockMethod>(['workload.start', 'workload.cancel', 'credential.deliver']);

export interface GuestWorkloadDefinition {
  run(argumentsList: string[], signal: AbortSignal): Promise<unknown>;
}

export interface GuestCredentialDelivery {
  leaseId: string;
  destination: string;
  secret: string;
}

export interface GuestWorkloadAgentOptions {
  sessionId: string;
  transport: VsockTransport;
  workloads: ReadonlyMap<string, GuestWorkloadDefinition>;
  onCredential?: (delivery: GuestCredentialDelivery) => Promise<void> | void;
  maxMessageBytes?: number;
  maxConcurrentWorkloads?: number;
}

export class GuestWorkloadAgentError extends Error {
  constructor(readonly code: 'invalid_frame' | 'wrong_session' | 'method_not_allowed' | 'message_too_large' | 'workload_not_found' | 'workload_running' | 'workload_capacity' | 'credential_rejected' | 'agent_stopped', message: string) {
    super(message);
    this.name = 'GuestWorkloadAgentError';
  }
}

/**
 * Guest-side endpoint for the fixed-purpose channel. It accepts only the
 * three host-issued methods, keeps active workload state inside the guest,
 * and returns bounded result/error acknowledgements. The transport is still
 * injected so a Linux AF_VSOCK listener can be supplied by the guest image.
 */
export class GuestWorkloadAgent {
  private readonly maxMessageBytes: number;
  private readonly maxConcurrentWorkloads: number;
  private readonly active = new Map<string, AbortController>();
  private stopped = false;

  constructor(private readonly options: GuestWorkloadAgentOptions) {
    if (!options.sessionId.trim()) throw new TypeError('guest agent sessionId is required');
    this.maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
    this.maxConcurrentWorkloads = options.maxConcurrentWorkloads ?? 1;
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) throw new TypeError('guest agent maxMessageBytes is invalid');
    if (!Number.isSafeInteger(this.maxConcurrentWorkloads) || this.maxConcurrentWorkloads <= 0 || this.maxConcurrentWorkloads > 8) throw new TypeError('guest agent maxConcurrentWorkloads is invalid');
  }

  async run(signal?: AbortSignal): Promise<void> {
    if (this.stopped) throw new GuestWorkloadAgentError('agent_stopped', 'guest agent is stopped');
    while (!signal?.aborted && !this.stopped) {
      let frame: string;
      try {
        frame = await this.options.transport.receive(signal);
      } catch (error) {
        if (signal?.aborted || this.stopped) return;
        throw error;
      }
      await this.handle(frame);
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    await this.options.transport.close();
  }

  private async handle(frame: string): Promise<void> {
    try {
      const envelope = this.parse(frame);
      if (envelope.method === 'workload.start') {
        void this.start(envelope).catch((error) => this.reportError(envelope.requestId, error));
        return;
      }
      else if (envelope.method === 'workload.cancel') await this.cancel(envelope);
      else await this.deliverCredential(envelope);
    } catch (error) {
      await this.reportError(safeEnvelope(frame).requestId, error);
    }
  }

  private async reportError(requestId: string, error: unknown): Promise<void> {
    await this.send({
      version: '1',
      sessionId: this.options.sessionId,
      requestId,
      method: 'workload.error',
      payload: { code: error instanceof GuestWorkloadAgentError ? error.code : 'workload_failed' },
    });
  }

  private async start(envelope: VsockEnvelope): Promise<void> {
    const payload = asRecord(envelope.payload);
    const workloadId = stringValue(payload['workloadId']);
    if (!WORKLOAD_ID.test(workloadId)) throw new GuestWorkloadAgentError('invalid_frame', 'guest workloadId is invalid');
    const argumentsList = boundedArguments(payload['arguments']);
    const workload = this.options.workloads.get(workloadId);
    if (!workload) throw new GuestWorkloadAgentError('workload_not_found', 'guest workload is not registered');
    if (this.active.has(workloadId)) throw new GuestWorkloadAgentError('workload_running', 'guest workload is already running');
    if (this.active.size >= this.maxConcurrentWorkloads) throw new GuestWorkloadAgentError('workload_capacity', 'guest workload capacity is exhausted');
    const controller = new AbortController();
    this.active.set(workloadId, controller);
    try {
      const result = await workload.run(argumentsList, controller.signal);
      await this.send({ version: '1', sessionId: this.options.sessionId, requestId: envelope.requestId, method: 'workload.result', payload: { workloadId, result } });
    } catch {
      await this.send({ version: '1', sessionId: this.options.sessionId, requestId: envelope.requestId, method: 'workload.error', payload: { workloadId, code: controller.signal.aborted ? 'cancelled' : 'workload_failed' } });
    } finally {
      this.active.delete(workloadId);
    }
  }

  private async cancel(envelope: VsockEnvelope): Promise<void> {
    const payload = asRecord(envelope.payload);
    const workloadId = payload['workloadId'] === undefined ? undefined : stringValue(payload['workloadId']);
    if (workloadId) this.active.get(workloadId)?.abort();
    else for (const controller of this.active.values()) controller.abort();
    await this.send({ version: '1', sessionId: this.options.sessionId, requestId: envelope.requestId, method: 'workload.result', payload: { state: 'cancel_requested', workloadId } });
  }

  private async deliverCredential(envelope: VsockEnvelope): Promise<void> {
    const payload = asRecord(envelope.payload);
    const leaseId = stringValue(payload['leaseId']);
    const destination = stringValue(payload['destination']);
    const secret = stringValue(payload['secret']);
    if (!this.options.onCredential || destination !== `guest:${this.options.sessionId}` || secret.length > 64 * 1024) {
      throw new GuestWorkloadAgentError('credential_rejected', 'guest credential destination is not accepted');
    }
    try {
      await this.options.onCredential({ leaseId, destination, secret });
    } catch {
      throw new GuestWorkloadAgentError('credential_rejected', 'guest credential sink rejected delivery');
    }
    await this.send({ version: '1', sessionId: this.options.sessionId, requestId: envelope.requestId, method: 'credential.ack', payload: { leaseId, accepted: true } });
  }

  private parse(frame: string): VsockEnvelope {
    if (Buffer.byteLength(frame, 'utf8') > this.maxMessageBytes) throw new GuestWorkloadAgentError('message_too_large', 'guest frame exceeds the configured bound');
    let parsed: unknown;
    try { parsed = JSON.parse(frame); } catch { throw new GuestWorkloadAgentError('invalid_frame', 'guest frame is not JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new GuestWorkloadAgentError('invalid_frame', 'guest frame must be an object');
    const value = parsed as Record<string, unknown>;
    if (value['version'] !== '1' || value['sessionId'] !== this.options.sessionId || typeof value['requestId'] !== 'string' || typeof value['method'] !== 'string' || !('payload' in value)) {
      throw new GuestWorkloadAgentError(value['sessionId'] === this.options.sessionId ? 'invalid_frame' : 'wrong_session', 'guest frame identity is invalid');
    }
    if (!REQUEST_METHODS.has(value['method'] as ConstrainedVsockMethod)) throw new GuestWorkloadAgentError('method_not_allowed', 'guest method is not allowlisted');
    return value as unknown as VsockEnvelope;
  }

  private async send(envelope: VsockEnvelope): Promise<void> {
    const frame = JSON.stringify(envelope);
    if (Buffer.byteLength(frame, 'utf8') > this.maxMessageBytes) throw new GuestWorkloadAgentError('message_too_large', 'guest response exceeds the configured bound');
    await this.options.transport.send(frame);
  }
}

export interface BoundedProcessWorkloadOptions {
  command: string;
  cwd: string;
  maxDurationMs: number;
  maxOutputBytes: number;
  allowArguments?: (argumentsList: string[]) => boolean;
  environment?: NodeJS.ProcessEnv;
}

/** Fixed-command guest workload handler with no shell and bounded output/time. */
export function createBoundedProcessWorkload(options: BoundedProcessWorkloadOptions): GuestWorkloadDefinition {
  if (!options.command.trim() || !options.cwd.trim()) throw new TypeError('guest process command and cwd are required');
  if (!Number.isSafeInteger(options.maxDurationMs) || options.maxDurationMs <= 0) throw new TypeError('guest process duration is invalid');
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) throw new TypeError('guest process output bound is invalid');
  return {
    run(argumentsList, signal) {
      if (options.allowArguments && !options.allowArguments(argumentsList)) return Promise.reject(new Error('guest workload arguments are not allowed'));
      return new Promise((resolve, reject) => {
        const child = spawn(options.command, argumentsList, { cwd: options.cwd, shell: false, windowsHide: true, env: options.environment ?? { PATH: process.env['PATH'], LANG: process.env['LANG'] } });
        let stdout = '';
        let stderr = '';
        let outputBytes = 0;
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, options.maxDurationMs);
        const abort = () => child.kill('SIGTERM');
        signal.addEventListener('abort', abort, { once: true });
        const collect = (target: 'stdout' | 'stderr') => (chunk: Buffer) => {
          outputBytes += chunk.byteLength;
          if (outputBytes > options.maxOutputBytes) { child.kill('SIGTERM'); return; }
          if (target === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
        };
        child.stdout.on('data', collect('stdout'));
        child.stderr.on('data', collect('stderr'));
        child.once('error', (error) => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error); });
        child.once('close', (code, terminatedBy) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (signal.aborted) return reject(new Error('guest workload cancelled'));
          if (timedOut) return reject(new Error('guest workload timed out'));
          if (outputBytes > options.maxOutputBytes) return reject(new Error('guest workload output exceeded bound'));
          if (code !== 0) return reject(new Error(`guest workload exited with ${code ?? terminatedBy ?? 'unknown'}`));
          resolve({ exitCode: code, stdout, stderr });
        });
      });
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GuestWorkloadAgentError('invalid_frame', 'guest payload must be an object');
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new GuestWorkloadAgentError('invalid_frame', 'guest payload string is required');
  return value;
}

function boundedArguments(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ARGUMENTS || value.some((item) => typeof item !== 'string' || item.length > MAX_ARGUMENT_LENGTH)) throw new GuestWorkloadAgentError('invalid_frame', 'guest workload arguments exceed the bound');
  return value as string[];
}

function safeEnvelope(frame: string): { requestId: string } {
  try {
    const value = JSON.parse(frame) as Record<string, unknown>;
    if (typeof value['requestId'] === 'string') return { requestId: value['requestId'] };
  } catch { /* report a fixed request id for malformed input */ }
  return { requestId: 'invalid_request' };
}
