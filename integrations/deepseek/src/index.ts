/**
 * @moirae/provider-deepseek — DeepSeek API adapter.
 *
 * DeepSeek implements the OpenAI-compatible chat completions API, so this
 * adapter is a thin wrapper around the generic OpenAI-compatible provider
 * with DeepSeek-specific defaults and known models.
 */

import {
  OpenAICompatibleProvider,
  type OpenAICompatibleConfig,
} from '@moirae/provider-openai-compatible';
import type { ModelDescriptor, ProviderManifest, ProviderHealth } from '@moirae/provider-sdk';

const DEEPSEEK_KNOWN_MODELS: ModelDescriptor[] = [
  {
    id: 'deepseek-chat',
    displayName: 'DeepSeek V3',
    providerId: 'deepseek',
    locality: 'remote',
    contextLimit: 128_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'structured_output'],
  },
  {
    id: 'deepseek-reasoner',
    displayName: 'DeepSeek R1',
    providerId: 'deepseek',
    locality: 'remote',
    contextLimit: 128_000,
    supportsTools: false,
    supportsImages: false,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'reasoning'],
  },
  {
    id: 'deepseek-coder',
    displayName: 'DeepSeek Coder V3',
    providerId: 'deepseek',
    locality: 'remote',
    contextLimit: 128_000,
    supportsTools: true,
    supportsImages: false,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'coding', 'structured_output'],
  },
];

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  override readonly manifest: ProviderManifest = {
    id: 'deepseek',
    displayName: 'DeepSeek',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };

  constructor(config: DeepSeekConfig) {
    super({
      baseUrl: config.baseUrl ?? 'https://api.deepseek.com',
      apiKey: config.apiKey,
    });
  }

  override async discoverModels(): Promise<ModelDescriptor[]> {
    return DEEPSEEK_KNOWN_MODELS;
  }

  override async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const res = await fetch('https://api.deepseek.com/v1/models', {
        headers: { Authorization: `Bearer (await this.getApiKey?.())` },
      });
      return { available: res.ok || res.status === 401, latencyMs: Date.now() - start, activeRequests: 0 };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }
}
