/**
 * @moirae/provider-mistral — Mistral AI API adapter.
 *
 * Mistral implements an OpenAI-compatible chat completions endpoint at api.mistral.ai.
 * This adapter extends the generic OpenAI-compatible provider with Mistral-specific
 * defaults, known models, and metadata.
 */

import { OpenAICompatibleProvider } from '@moirae/provider-openai-compatible';
import type { ModelDescriptor, ProviderManifest, ProviderHealth } from '@moirae/provider-sdk';

const MISTRAL_KNOWN_MODELS: ModelDescriptor[] = [
  {
    id: 'mistral-large-latest',
    displayName: 'Mistral Large',
    providerId: 'mistral',
    locality: 'remote',
    contextLimit: 128_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'structured_output'],
  },
  {
    id: 'mistral-medium-latest',
    displayName: 'Mistral Medium',
    providerId: 'mistral',
    locality: 'remote',
    contextLimit: 32_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools'],
  },
  {
    id: 'mistral-small-latest',
    displayName: 'Mistral Small',
    providerId: 'mistral',
    locality: 'remote',
    contextLimit: 32_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools'],
  },
  {
    id: 'codestral-latest',
    displayName: 'Codestral',
    providerId: 'mistral',
    locality: 'remote',
    contextLimit: 256_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'coding', 'fill-in-the-middle'],
  },
];

export interface MistralConfig {
  apiKey: string;
  baseUrl?: string;
}

export class MistralProvider extends OpenAICompatibleProvider {
  override readonly manifest: ProviderManifest = {
    id: 'mistral',
    displayName: 'Mistral AI',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };

  constructor(config: MistralConfig) {
    super({
      baseUrl: config.baseUrl ?? 'https://api.mistral.ai/v1',
      apiKey: config.apiKey,
    });
  }

  override async discoverModels(): Promise<ModelDescriptor[]> {
    // Mistral uses its own known model catalog rather than relying on
    // the generic /models endpoint which may be unreachable.
    return MISTRAL_KNOWN_MODELS;
  }

  override async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${this.config.apiKey ?? ''}` },
      });
      return { available: res.ok || res.status === 401, latencyMs: Date.now() - start, activeRequests: 0 };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }
}
