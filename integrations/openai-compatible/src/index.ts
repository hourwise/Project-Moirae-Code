/**
 * @moirae/provider-openai-compatible — Generic OpenAI-compatible API adapter.
 *
 * This is the most critical provider adapter because it allows any service
 * that implements the OpenAI chat completions API to work with Moirae Code
 * without bespoke adapter changes (Ollama, llama.cpp, LM Studio, vLLM, etc.).
 */

import type { ModelProvider, ModelDescriptor, ProviderManifest, ModelRequest, ModelEvent, TokenCountRequest, TokenCount, ProviderHealth } from '@moirae/provider-sdk';
import { RUNTIME_NAMES } from '@moirae/runtime-contracts';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  modelMap?: Record<string, string>;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly identity = {
    runtime: 'openai-compatible-adapter',
    version: '0.1.0',
    protocolVersion: '1.1.0',
  };

  readonly manifest: ProviderManifest = {
    id: 'openai-compatible',
    displayName: 'OpenAI-Compatible Provider',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };

  constructor(protected config: OpenAICompatibleConfig) {}

  async discoverModels(): Promise<ModelDescriptor[]> {
    try {
      const res = await fetch(`${this.config.baseUrl}/models`, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const models = (body.data ?? []).map((m) => ({
        id: m.id,
        displayName: m.id,
        providerId: this.manifest.id,
        locality: this.manifest.locality,
        contextLimit: 128_000,
        supportsTools: true,
        supportsImages: false,
        supportsStructuredOutput: false,
        supportsStreaming: true,
        capabilities: ['chat', 'tools'],
      }));
      if (models.length > 0) return models;
    } catch {
      // API unreachable — return fallback placeholder
    }
    return [{
      id: 'gpt-4o',
      displayName: 'GPT-4o (fallback)',
      providerId: this.manifest.id,
      locality: this.manifest.locality,
      contextLimit: 128_000,
      supportsTools: true,
      supportsImages: false,
      supportsStructuredOutput: false,
      supportsStreaming: true,
      capabilities: ['chat', 'tools'],
    }];
  }

  async countTokens(request: TokenCountRequest): Promise<TokenCount> {
    // Approximate: ~4 chars per token
    const text = request.messages.map((m) => m.content).join(' ');
    const estimated = Math.ceil(text.length / 4);
    return { input: estimated, total: estimated };
  }

  async *createCompletion(request: ModelRequest): AsyncIterable<ModelEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.modelMap?.[request.modelId] ?? request.modelId,
          messages: request.messages,
          tools: request.tools?.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          stop: request.stop,
          stream: false,
        }),
      });
    } catch (err) {
      yield { type: 'error', code: 'CONNECTION_ERROR', message: err instanceof Error ? err.message : 'Connection failed' };
      return;
    }

    if (!res.ok) {
      yield { type: 'error', code: 'PROVIDER_ERROR', message: `HTTP ${res.status}: ${await res.text()}` };
      return;
    }

    const body = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
        finish_reason?: string;
      }>;
    };

    const choice = body.choices?.[0];
    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        yield { type: 'tool_call', id: tc.id, name: tc.function.name, arguments: tc.function.arguments };
      }
    }
    if (choice?.message?.content) {
      yield { type: 'text', content: choice.message.content };
    }
    yield { type: 'done', finishReason: choice?.finish_reason ?? 'stop' };
  }

  async cancel(_requestId: string): Promise<void> {
    // OpenAI-compatible cancel via AbortController (caller-managed).
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      await fetch(`${this.config.baseUrl}/models`, {
        headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
      });
      return { available: true, latencyMs: Date.now() - start, activeRequests: 0 };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }
}
