/**
 * @moirae/provider-anthropic — Anthropic Claude API adapter.
 *
 * Implements the ModelProvider contract for Anthropic's Messages API.
 * Supports Claude Opus, Sonnet, and Haiku models with tool use.
 * Credentials are held by the secret-broker, never exposed to models.
 */

import type {
  ModelProvider,
  ModelDescriptor,
  ProviderManifest,
  ModelRequest,
  ModelEvent,
  TokenCountRequest,
  TokenCount,
  ProviderHealth,
} from '@moirae/provider-sdk';

// ── Anthropic API Types ─────────────────────────────────────

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicModelsResponse {
  data: Array<{ id: string; display_name: string; created_at: string }>;
}

// ── Known Anthropic Models ──────────────────────────────────

const KNOWN_MODELS: ModelDescriptor[] = [
  {
    id: 'claude-sonnet-4-20250514',
    displayName: 'Claude Sonnet 4',
    providerId: 'anthropic',
    locality: 'remote',
    contextLimit: 200_000,
    supportsTools: true,
    supportsImages: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'images'],
  },
  {
    id: 'claude-opus-4-20250514',
    displayName: 'Claude Opus 4',
    providerId: 'anthropic',
    locality: 'remote',
    contextLimit: 200_000,
    supportsTools: true,
    supportsImages: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'images'],
  },
  {
    id: 'claude-haiku-3-5-20241022',
    displayName: 'Claude Haiku 3.5',
    providerId: 'anthropic',
    locality: 'remote',
    contextLimit: 200_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools'],
  },
];

// ── Provider Implementation ─────────────────────────────────

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
}

export class AnthropicProvider implements ModelProvider {
  readonly identity = {
    runtime: 'anthropic-adapter',
    version: '0.1.0',
    protocolVersion: '1.1.0',
  };

  readonly manifest: ProviderManifest = {
    id: 'anthropic',
    displayName: 'Anthropic',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };

  private readonly baseUrl: string;

  constructor(private config: AnthropicConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
  }

  async discoverModels(): Promise<ModelDescriptor[]> {
    // Return known models (Anthropic's models list endpoint requires API version header)
    return KNOWN_MODELS;
  }

  async countTokens(request: TokenCountRequest): Promise<TokenCount> {
    const text = request.messages.map((m) => m.content).join('\n');
    // Claude tokenizer: roughly 1 token ≈ 3.5 chars for English
    const estimated = Math.ceil(text.length / 3.5);
    return { input: estimated, total: estimated };
  }

  async *createCompletion(request: ModelRequest): AsyncIterable<ModelEvent> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const chatMessages = request.messages.filter((m) => m.role !== 'system');

    const body: {
      model: string;
      max_tokens: number;
      messages: AnthropicMessage[];
      system?: string;
      tools?: AnthropicTool[];
      temperature?: number;
      stop_sequences?: string[];
    } = {
      model: request.modelId,
      max_tokens: request.maxTokens ?? 4096,
      messages: chatMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join('\n\n');
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop) body.stop_sequences = request.stop;

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorCode = 'PROVIDER_ERROR';
      if (res.status === 401) errorCode = 'AUTHENTICATION_ERROR';
      if (res.status === 429) errorCode = 'RATE_LIMIT_EXCEEDED';
      if (res.status === 400) errorCode = 'INVALID_REQUEST';
      yield { type: 'error', code: errorCode, message: `HTTP ${res.status}: ${errorText}` };
      return;
    }

    const data = (await res.json()) as AnthropicResponse;

    for (const block of data.content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        yield {
          type: 'tool_call',
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        };
      } else if (block.type === 'text' && block.text) {
        yield { type: 'text', content: block.text };
      }
    }

    const finishReason = data.stop_reason === 'tool_use' ? 'tool_calls' : (data.stop_reason ?? 'stop');
    yield { type: 'done', finishReason };
  }

  async cancel(_requestId: string): Promise<void> {
    // Anthropic does not support cancellation of in-flight requests via API.
    // Cancellation is handled via AbortController on the caller side.
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-3-5-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      // 200 or 4xx with a valid response = endpoint reachable
      return { available: res.ok || res.status === 400 || res.status === 401, latencyMs: Date.now() - start, activeRequests: 0 };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }
}
