/**
 * @moirae/provider-llama-cpp — llama.cpp server adapter.
 *
 * llama.cpp's server mode exposes an OpenAI-compatible /v1/chat/completions
 * endpoint. This adapter wraps the generic OpenAI-compatible provider with
 * llama.cpp-specific defaults (local-only, no auth required).
 */

import { OpenAICompatibleProvider } from '@moirae/provider-openai-compatible';
import type { ModelDescriptor, ProviderManifest } from '@moirae/provider-sdk';

export interface LlamaCppConfig {
  baseUrl?: string;
}

export class LlamaCppProvider extends OpenAICompatibleProvider {
  readonly manifest: ProviderManifest = {
    id: 'llama-cpp',
    displayName: 'llama.cpp',
    locality: 'local',
    credentialMode: 'none',
    defaultNetworkPolicy: 'loopback-only',
  };

  constructor(config: LlamaCppConfig = {}) {
    super({ baseUrl: config.baseUrl ?? 'http://127.0.0.1:8080' });
  }

  override async discoverModels(): Promise<ModelDescriptor[]> {
    try {
      const models = await super.discoverModels();
      return models.map((m) => ({
        ...m,
        providerId: this.manifest.id,
        locality: 'local' as const,
      }));
    } catch {
      // llama.cpp server may be offline — return an unknown placeholder
      return [
        {
          id: 'local-model',
          displayName: 'Local Model (llama.cpp)',
          providerId: this.manifest.id,
          locality: 'local',
          contextLimit: 128_000,
          supportsTools: false,
          supportsImages: false,
          supportsStructuredOutput: false,
          supportsStreaming: true,
          capabilities: ['chat'],
        },
      ];
    }
  }
}
