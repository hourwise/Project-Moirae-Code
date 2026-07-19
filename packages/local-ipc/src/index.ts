/**
 * Contract-only local IPC envelopes. No local transport, authentication, or
 * replay protection is implemented in Stage-A, and production code must not
 * treat IDs as authentication credentials.
 */
import { z } from 'zod';
import { CorrelationContextSchema } from 'project-runtime-contracts';

export const LocalIpcStatus = Object.freeze({
  implemented: false,
  transportAuthentication: 'unavailable',
  replayProtection: 'unavailable',
  allowedMethods: [] as string[],
});

export const IpcMessageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().min(1), z.number()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
  correlation: CorrelationContextSchema,
});
export type IpcMessage = z.infer<typeof IpcMessageSchema>;

export const IpcResponseSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string().min(1), z.number()]),
  result: z.unknown().optional(),
  error: z
    .object({ code: z.number(), message: z.string(), data: z.unknown().optional() })
    .optional(),
});
export type IpcResponse = z.infer<typeof IpcResponseSchema>;

export interface IpcTransport {
  send(message: IpcMessage): void;
  onMessage(handler: (message: IpcMessage) => void): void;
  close(): void;
}

export class LocalIpcTransportUnavailable extends Error {
  constructor() {
    super(
      'Local IPC transport authentication and replay protection are not implemented in Stage-A.',
    );
    this.name = 'LocalIpcTransportUnavailable';
  }
}

export function assertLocalIpcUnavailable(): never {
  throw new LocalIpcTransportUnavailable();
}
export type { IpcTransport as default };
