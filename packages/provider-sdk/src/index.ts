/**
 * @moirae/provider-sdk — Stable interface for model provider adapters.
 *
 * Horae consumes model profiles through this contract. Provider adapters
 * implement this interface. Adapters receive prepared prompts — never direct
 * filesystem, database, credential, or MCP access.
 */

import { randomUUID } from 'node:crypto';
import type { HostOperationContext, HostToolProposal } from '@moirae/host-contracts';
import type { RuntimeIdentity } from 'project-runtime-contracts';

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

/** Serializable provider configuration contains a reference, never secret material. */
export interface ProviderCredentialReference {
  providerId: string;
  accountId: string;
  scope: string[];
}

export interface ProviderCredentialLease {
  value: string;
  expiresAt?: string;
}
export interface ProviderCredentialAccessor {
  lease(
    reference: ProviderCredentialReference,
    signal?: AbortSignal,
  ): Promise<ProviderCredentialLease | null>;
}

export function sanitizeProviderError(status: number): string {
  const code =
    status === 401 || status === 403
      ? 'AUTHENTICATION_ERROR'
      : status === 429
        ? 'RATE_LIMIT_EXCEEDED'
        : 'PROVIDER_ERROR';
  // Provider response bodies can contain request echoes and credentials; never propagate them by default.
  return `${code}: HTTP ${status}`;
}

export function validateProviderEndpoint(raw: string, locality: ProviderManifest['locality']): URL {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' && !(locality === 'local' && url.protocol === 'http:'))
  ) {
    throw new Error('Provider endpoint violates the configured network policy.');
  }
  if (locality === 'local' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Local providers must use a loopback endpoint.');
  }
  return url;
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

/**
 * Converts a provider tool event to a proposal only. This function has no
 * client, shell, filesystem, network, sandbox, approval, or execution access.
 */
export function captureToolCallProposal(
  context: HostOperationContext,
  provider: { providerId: string; modelId: string },
  event: Extract<ModelEvent, { type: 'tool_call' }>,
  capability = 'tool.proposed',
): HostToolProposal {
  let argumentsValue: Record<string, unknown> | null = null;
  let status: HostToolProposal['status'] = 'proposed';
  let reason: string | undefined;
  try {
    const parsed: unknown = JSON.parse(event.arguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Tool arguments must be a JSON object.');
    argumentsValue = parsed as Record<string, unknown>;
  } catch {
    status = 'malformed';
    reason = 'Provider emitted malformed tool arguments.';
  }
  const keys = argumentsValue ? Object.keys(argumentsValue).sort().slice(0, 16) : [];
  return {
    proposalId: randomUUID(),
    status,
    context,
    providerId: provider.providerId,
    modelId: provider.modelId,
    toolName: event.name,
    arguments: argumentsValue,
    argumentSummary: argumentsValue
      ? `object keys: ${keys.join(', ') || '(none)'}`
      : 'arguments unavailable',
    capability,
    scope: context.scope,
    purpose: context.purpose,
    correlation: context.correlation,
    createdAt: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
}

// ── Provider Health ─────────────────────────────────────────

export interface ProviderHealth {
  available: boolean;
  latencyMs: number;
  activeRequests: number;
  rateLimitRemaining?: number;
  message?: string;
}
