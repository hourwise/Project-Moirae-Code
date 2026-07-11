/**
 * @moirae/local-ipc — Authenticated local inter-process communication.
 *
 * Provides JSON-RPC 2.0 transport over stdio and local domain sockets.
 * All messages include session identity, correlation IDs, and replay protection.
 */

export interface IpcMessage {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: unknown;
  correlationId?: string;
  sessionId?: string;
}

export interface IpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface IpcTransport {
  send(message: IpcMessage): void;
  onMessage(handler: (message: IpcMessage) => void): void;
  close(): void;
}

export type { IpcTransport as default };
