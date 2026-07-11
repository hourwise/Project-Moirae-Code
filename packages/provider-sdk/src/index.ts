/**
 * @moirae/provider-sdk — Stable interface for model provider adapters.
 *
 * Horae consumes model profiles through this contract. Provider adapters
 * implement this interface. Adapters receive prepared prompts — never direct
 * filesystem, database, credential, or MCP access.
 */

import type { RuntimeIdentity } from '@moirae/runtime-contracts';

// ── Model Descriptor ────────────────────────────────────────

export interface ModelDescriptor {
  id: string;
  displayName: string;
  providerId: string;
  locality: 'local' | 'remote' | 'hybrid';
  contextLimit: number;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  capabilities: string[];
}

// ── Provider Manifest ───────────────────────────────────────

export interface ProviderManifest {
  id: string;
  displayName: string;
  locality: 'local' | 'remote' | 'hybrid';
  credentialMode: 'none' | 'api_key' | 'oauth';
  defaultNetworkPolicy: 'loopback-only' | 'provider-endpoints-only' | 'unrestricted';
}

// ── Model Provider Interface ────────────────────────────────

export interface ModelProvider {
  readonly identity: RuntimeIdentity;
  readonly manifest: ProviderManifest;

  discoverModels(): Promise<ModelDescriptor[]>;
  countTokens(request: TokenCountRequest): Promise<TokenCount>;
  createCompletion(request: ModelRequest): AsyncIterable<ModelEvent>;
  cancel(requestId: string): Promise<void>;
  healthCheck(): Promise<ProviderHealth>;
}

// ── Request / Response Types ────────────────────────────────

export interface TokenCountRequest {
  modelId: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface TokenCount {
  input: number;
  total: number;
}

export interface ModelRequest {
  requestId: string;
  modelId: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stop?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

// ── Streaming Events ────────────────────────────────────────

export type ModelEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'done'; finishReason: string }
  | { type: 'error'; code: string; message: string };

// ── Provider Health ─────────────────────────────────────────

export interface ProviderHealth {
  available: boolean;
  latencyMs: number;
  activeRequests: number;
  rateLimitRemaining?: number;
  message?: string;
}
