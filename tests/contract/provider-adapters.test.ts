/**
 * Contract Tests — Provider Adapters
 *
 * Verifies that every ModelProvider adapter conforms to the ModelProvider
 * interface contract. Tests: manifest shape, model discovery, token counting,
 * health check, and error handling — all without requiring live API keys.
 */

import { describe, it, expect } from 'vitest';
import type { ModelProvider, ModelDescriptor, ProviderManifest } from '@moirae/provider-sdk';
import { OpenAICompatibleProvider } from '@moirae/provider-openai-compatible';
import { AnthropicProvider } from '@moirae/provider-anthropic';
import { GoogleProvider } from '@moirae/provider-google';
import { DeepSeekProvider } from '@moirae/provider-deepseek';
import { LlamaCppProvider } from '@moirae/provider-llama-cpp';
import { MistralProvider } from '@moirae/provider-mistral';

// ═══════════════════════════════════════════════════════════════
// CONTRACT CHECKS (applied to every provider)
// ═══════════════════════════════════════════════════════════════

function validateManifest(manifest: ProviderManifest): void {
  expect(manifest.id).toBeTruthy();
  expect(manifest.displayName).toBeTruthy();
  expect(['local', 'remote', 'hybrid']).toContain(manifest.locality);
  expect(['none', 'api_key', 'oauth']).toContain(manifest.credentialMode);
  expect([
    'loopback-only',
    'provider-endpoints-only',
    'unrestricted',
  ]).toContain(manifest.defaultNetworkPolicy);
}

function validateModelDescriptor(model: ModelDescriptor, providerId: string): void {
  expect(model.id).toBeTruthy();
  expect(model.displayName).toBeTruthy();
  expect(model.providerId).toBe(providerId);
  expect(['local', 'remote', 'hybrid']).toContain(model.locality);
  expect(model.contextLimit).toBeGreaterThan(0);
  expect(typeof model.supportsTools).toBe('boolean');
  expect(typeof model.supportsStreaming).toBe('boolean');
  expect(Array.isArray(model.capabilities)).toBe(true);
  expect(model.capabilities.length).toBeGreaterThan(0);
}

function validateHealth(health: { available: boolean; latencyMs: number }): void {
  expect(typeof health.available).toBe('boolean');
  expect(typeof health.latencyMs).toBe('number');
}

async function testProviderContract(
  provider: ModelProvider,
  expectedProviderId: string,
  expectedLocality: 'local' | 'remote',
): Promise<void> {
  // 1. Manifest
  validateManifest(provider.manifest);
  expect(provider.manifest.id).toBe(expectedProviderId);
  expect(provider.manifest.locality).toBe(expectedLocality);

  // 2. Model discovery
  const models = await provider.discoverModels();
  expect(Array.isArray(models)).toBe(true);
  expect(models.length).toBeGreaterThan(0);
  for (const model of models) {
    validateModelDescriptor(model, expectedProviderId);
  }

  // 3. Token counting
  const tokens = await provider.countTokens({
    modelId: models[0]!.id,
    messages: [{ role: 'user', content: 'Hello, world!' }],
  });
  expect(tokens.input).toBeGreaterThan(0);
  expect(tokens.total).toBeGreaterThan(0);

  // 4. Health check
  const health = await provider.healthCheck();
  validateHealth(health);

  // 5. Cancel is a no-op when no request is active
  await expect(provider.cancel('nonexistent-request')).resolves.toBeUndefined();

  // 6. Completion produces error when no API key / unreachable
  const events: unknown[] = [];
  for await (const event of provider.createCompletion({
    requestId: 'test-001',
    modelId: models[0]!.id,
    messages: [{ role: 'user', content: 'Hello' }],
    maxTokens: 10,
  })) {
    events.push(event);
  }
  // Without a real API key, this should produce at least one event (likely an error)
  expect(events.length).toBeGreaterThan(0);
  // The first event is typically an error when no auth
  const firstEvent = events[0] as { type: string };
  expect(['error', 'text', 'done']).toContain(firstEvent.type);
}

// ═══════════════════════════════════════════════════════════════
// PER-PROVIDER TESTS
// ═══════════════════════════════════════════════════════════════

describe('OpenAI-Compatible Provider', () => {
  const provider = new OpenAICompatibleProvider({
    baseUrl: 'https://api.openai.com/v1',
  });

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'openai-compatible', 'remote');
  });

  it('has correct manifest metadata', () => {
    expect(provider.manifest.displayName).toBe('OpenAI-Compatible Provider');
    expect(provider.manifest.credentialMode).toBe('api_key');
  });
});

describe('Anthropic Provider', () => {
  const provider = new AnthropicProvider({ apiKey: 'test-key' });

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'anthropic', 'remote');
  });

  it('returns known Claude models', async () => {
    const models = await provider.discoverModels();
    const modelIds = models.map((m) => m.id);
    expect(modelIds.some((id) => id.includes('claude'))).toBe(true);
  });

  it('supports tools on all models', async () => {
    const models = await provider.discoverModels();
    for (const model of models) {
      expect(model.supportsTools).toBe(true);
    }
  });
});

describe('Google Provider', () => {
  const provider = new GoogleProvider({ apiKey: 'test-key' });

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'google', 'remote');
  });

  it('returns Gemini models with 1M+ context', async () => {
    const models = await provider.discoverModels();
    for (const model of models) {
      expect(model.contextLimit).toBeGreaterThanOrEqual(1_000_000);
    }
  });
});

describe('DeepSeek Provider', () => {
  const provider = new DeepSeekProvider({ apiKey: 'test-key' });

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'deepseek', 'remote');
  });

  it('includes DeepSeek Coder model', async () => {
    const models = await provider.discoverModels();
    const coderModel = models.find((m) => m.id === 'deepseek-coder');
    expect(coderModel).toBeDefined();
    expect(coderModel!.capabilities).toContain('coding');
  });

  it('DeepSeek R1 does not support tools (reasoning model)', async () => {
    const models = await provider.discoverModels();
    const r1 = models.find((m) => m.id === 'deepseek-reasoner');
    expect(r1).toBeDefined();
    expect(r1!.supportsTools).toBe(false);
  });
});

describe('llama.cpp Provider', () => {
  const provider = new LlamaCppProvider();

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'llama-cpp', 'local');
  });

  it('is local-only with no credentials required', () => {
    expect(provider.manifest.locality).toBe('local');
    expect(provider.manifest.credentialMode).toBe('none');
  });

  it('uses loopback-only network policy', () => {
    expect(provider.manifest.defaultNetworkPolicy).toBe('loopback-only');
  });
});

describe('Mistral Provider', () => {
  const provider = new MistralProvider({ apiKey: 'test-key' });

  it('conforms to ModelProvider contract', async () => {
    await testProviderContract(provider, 'mistral', 'remote');
  });

  it('includes Codestral model', async () => {
    const models = await provider.discoverModels();
    const codestral = models.find((m) => m.id === 'codestral-latest');
    expect(codestral).toBeDefined();
    expect(codestral!.capabilities).toContain('fill-in-the-middle');
  });
});
