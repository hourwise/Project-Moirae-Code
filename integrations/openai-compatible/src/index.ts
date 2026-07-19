/** OpenAI-compatible provider with request-time credential leases only. */
import {
  sanitizeProviderError,
  validateProviderEndpoint,
  type ModelProvider,
  type ModelDescriptor,
  type ProviderManifest,
  type ModelRequest,
  type ModelEvent,
  type TokenCountRequest,
  type TokenCount,
  type ProviderHealth,
  type ProviderCredentialAccessor,
  type ProviderCredentialReference,
} from '@moirae/provider-sdk';
import type { RuntimeIdentity } from 'project-runtime-contracts';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  credential?: ProviderCredentialReference;
  credentialAccessor?: ProviderCredentialAccessor;
  fetchImpl?: typeof fetch;
  modelMap?: Record<string, string>;
  /** Only local loopback adapters may opt in to HTTP. */
  localLoopback?: boolean;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly identity: RuntimeIdentity = {
    runtime: 'openai-compatible-adapter',
    version: '0.1.0',
    protocolVersion: '1.4.0',
    minimumProtocolVersion: '1.0.0',
  };
  readonly manifest: ProviderManifest = {
    id: 'openai-compatible',
    displayName: 'OpenAI-Compatible Provider',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };
  protected readonly config: OpenAICompatibleConfig;
  protected readonly request: typeof fetch;

  constructor(config: OpenAICompatibleConfig) {
    validateProviderEndpoint(config.baseUrl, config.localLoopback ? 'local' : 'remote');
    this.config = config;
    this.request = config.fetchImpl ?? fetch;
  }

  protected async authorizationHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    if (!this.config.credential || !this.config.credentialAccessor) return {};
    const lease = await this.config.credentialAccessor.lease(this.config.credential, signal);
    return lease ? { Authorization: `Bearer ${lease.value}` } : {};
  }

  async discoverModels(): Promise<ModelDescriptor[]> {
    try {
      const response = await this.request(`${this.config.baseUrl}/models`, {
        headers: await this.authorizationHeaders(),
      });
      if (!response.ok) return this.fallbackModels();
      const body = (await response.json()) as { data?: Array<{ id: string }> };
      const models = (body.data ?? []).map((model) => this.model(model.id));
      return models.length > 0 ? models : this.fallbackModels();
    } catch {
      return this.fallbackModels();
    }
  }

  async countTokens(request: TokenCountRequest): Promise<TokenCount> {
    const estimated = Math.ceil(
      request.messages.map((message) => message.content).join(' ').length / 4,
    );
    return { input: estimated, total: estimated };
  }

  async *createCompletion(request: ModelRequest): AsyncIterable<ModelEvent> {
    try {
      const response = await this.request(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await this.authorizationHeaders()) },
        body: JSON.stringify({
          model: this.config.modelMap?.[request.modelId] ?? request.modelId,
          messages: request.messages,
          tools: request.tools?.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
          stop: request.stop,
          stream: false,
        }),
      });
      if (!response.ok) {
        yield {
          type: 'error',
          code: 'PROVIDER_ERROR',
          message: sanitizeProviderError(response.status),
        };
        return;
      }
      const body = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
          };
          finish_reason?: string;
        }>;
      };
      const choice = body.choices?.[0];
      for (const call of choice?.message?.tool_calls ?? [])
        yield {
          type: 'tool_call',
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        };
      if (choice?.message?.content) yield { type: 'text', content: choice.message.content };
      yield { type: 'done', finishReason: choice?.finish_reason ?? 'stop' };
    } catch {
      yield { type: 'error', code: 'CONNECTION_ERROR', message: 'Provider connection failed.' };
    }
  }

  async cancel(_requestId: string): Promise<void> {
    /* This non-streaming adapter has no cancellable request handle. */
  }
  async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const response = await this.request(`${this.config.baseUrl}/models`, {
        headers: await this.authorizationHeaders(),
      });
      return {
        available: response.ok || response.status === 401,
        latencyMs: Date.now() - start,
        activeRequests: 0,
      };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }

  protected model(id: string): ModelDescriptor {
    return {
      id,
      displayName: id,
      providerId: this.manifest.id,
      locality: this.manifest.locality,
      contextLimit: 128_000,
      supportsTools: true,
      supportsImages: false,
      supportsStructuredOutput: false,
      supportsStreaming: true,
      capabilities: ['chat', 'tools'],
    };
  }
  private fallbackModels(): ModelDescriptor[] {
    return [this.model('gpt-4o')];
  }
}
