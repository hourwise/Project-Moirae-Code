import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '@moirae/provider-openai-compatible';
import { AnthropicProvider } from '@moirae/provider-anthropic';
import { GoogleProvider } from '@moirae/provider-google';
import { DeepSeekProvider } from '@moirae/provider-deepseek';
import { MistralProvider } from '@moirae/provider-mistral';
import { LlamaCppProvider } from '@moirae/provider-llama-cpp';
import type { ProviderCredentialAccessor } from '@moirae/provider-sdk';

const fetchStub: typeof fetch = async (input) => {
  const url = String(input);
  if (url.includes('messages'))
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    );
  if (url.includes('generateContent'))
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      }),
    );
  return new Response(
    JSON.stringify({
      data: [{ id: 'test-model' }],
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    }),
  );
};
const credentials: ProviderCredentialAccessor = {
  lease: async () => ({ value: 'test-credential' }),
};
const credential = { providerId: 'test', accountId: 'test-account', scope: ['completion'] };

async function completion(provider: {
  createCompletion(request: {
    requestId: string;
    modelId: string;
    messages: Array<{ role: 'user'; content: string }>;
  }): AsyncIterable<{ type: string; message?: string }>;
}): Promise<Array<{ type: string; message?: string }>> {
  const events = [];
  for await (const event of provider.createCompletion({
    requestId: 'request-1',
    modelId: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
  }))
    events.push(event);
  return events;
}

describe('provider credential and redaction boundary', () => {
  it('uses a request-time lease and never serializes an apiKey field', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://provider.invalid/v1',
      credential,
      credentialAccessor: credentials,
      fetchImpl: fetchStub,
    });
    expect(JSON.stringify(provider)).not.toContain('test-credential');
    expect(await provider.discoverModels()).toHaveLength(1);
    expect(await completion(provider)).toContainEqual(expect.objectContaining({ type: 'text' }));
  });
  it('sanitizes provider error bodies', async () => {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://provider.invalid/v1',
      fetchImpl: async () => new Response('Bearer secret-body', { status: 500 }),
    });
    const events = await completion(provider);
    expect(events[0]).toEqual({
      type: 'error',
      code: 'PROVIDER_ERROR',
      message: 'PROVIDER_ERROR: HTTP 500',
    });
    expect(JSON.stringify(events)).not.toContain('secret-body');
  });
  it('uses lease-backed adapters without live network calls', async () => {
    const providers = [
      new AnthropicProvider({ credential, credentialAccessor: credentials, fetchImpl: fetchStub }),
      new GoogleProvider({ credential, credentialAccessor: credentials, fetchImpl: fetchStub }),
      new DeepSeekProvider({ credential, credentialAccessor: credentials, fetchImpl: fetchStub }),
      new MistralProvider({ credential, credentialAccessor: credentials, fetchImpl: fetchStub }),
      new LlamaCppProvider({ fetchImpl: fetchStub }),
    ];
    for (const provider of providers) {
      expect((await provider.discoverModels()).length).toBeGreaterThan(0);
      expect((await completion(provider)).length).toBeGreaterThan(0);
      await expect(provider.cancel('missing')).resolves.toBeUndefined();
    }
  });
});
