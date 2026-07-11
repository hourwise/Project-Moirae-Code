/**
 * @moirae/provider-google — Google Gemini API adapter.
 *
 * Implements the ModelProvider contract for Google's Generative Language API
 * (Gemini models). Supports Gemini 2.5 Pro, Flash, and Nano.
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
  ChatMessage,
  ToolDefinition,
} from '@moirae/provider-sdk';

// ── Gemini API Types ────────────────────────────────────────

interface GeminiContent {
  role?: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
}

interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: GeminiTool[];
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    stopSequences?: string[];
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { role: string; parts: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
}

// ── Known Gemini Models ─────────────────────────────────────

const KNOWN_MODELS: ModelDescriptor[] = [
  {
    id: 'gemini-2.5-pro',
    displayName: 'Gemini 2.5 Pro',
    providerId: 'google',
    locality: 'remote',
    contextLimit: 1_048_576,
    supportsTools: true,
    supportsImages: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'images', 'structured_output'],
  },
  {
    id: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    providerId: 'google',
    locality: 'remote',
    contextLimit: 1_048_576,
    supportsTools: true,
    supportsImages: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    capabilities: ['chat', 'tools', 'images'],
  },
];

// ── Message Conversion ──────────────────────────────────────

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text: msg.content }] });
  }
  return contents;
}

function toGeminiTools(tools: ToolDefinition[] | undefined): GeminiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

// ── Provider Implementation ─────────────────────────────────

export interface GoogleConfig {
  apiKey: string;
  baseUrl?: string;
}

export class GoogleProvider implements ModelProvider {
  readonly identity = {
    runtime: 'google-adapter',
    version: '0.1.0',
    protocolVersion: '1.1.0',
  };

  readonly manifest: ProviderManifest = {
    id: 'google',
    displayName: 'Google Gemini',
    locality: 'remote',
    credentialMode: 'api_key',
    defaultNetworkPolicy: 'provider-endpoints-only',
  };

  private readonly baseUrl: string;

  constructor(private config: GoogleConfig) {
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com';
  }

  async discoverModels(): Promise<ModelDescriptor[]> {
    return KNOWN_MODELS;
  }

  async countTokens(request: TokenCountRequest): Promise<TokenCount> {
    const text = request.messages.map((m) => m.content).join(' ');
    // Gemini tokenizer: roughly 1 token ≈ 4 chars
    const estimated = Math.ceil(text.length / 4);
    return { input: estimated, total: estimated };
  }

  async *createCompletion(request: ModelRequest): AsyncIterable<ModelEvent> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const chatMessages = request.messages.filter((m) => m.role !== 'system');

    const body: GeminiRequest = {
      contents: toGeminiContents(chatMessages),
      tools: toGeminiTools(request.tools),
      generationConfig: {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        stopSequences: request.stop,
      },
    };

    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: [{ text: systemMessages.map((m) => m.content).join('\n\n') }],
      };
    }

    const url = `${this.baseUrl}/v1beta/models/${request.modelId}:generateContent?key=${this.config.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorCode = 'PROVIDER_ERROR';
      if (res.status === 401 || res.status === 403) errorCode = 'AUTHENTICATION_ERROR';
      if (res.status === 429) errorCode = 'RATE_LIMIT_EXCEEDED';
      yield { type: 'error', code: errorCode, message: `HTTP ${res.status}: ${errorText}` };
      return;
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];

    if (!candidate?.content?.parts) {
      yield { type: 'done', finishReason: candidate?.finishReason ?? 'STOP' };
      return;
    }

    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        yield {
          type: 'tool_call',
          id: part.functionCall.name,
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args),
        };
      } else if (part.text) {
        yield { type: 'text', content: part.text };
      }
    }

    yield { type: 'done', finishReason: candidate.finishReason ?? 'STOP' };
  }

  async cancel(_requestId: string): Promise<void> {
    // Gemini does not support cancellation of in-flight requests.
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const start = Date.now();
      const url = `${this.baseUrl}/v1beta/models/gemini-2.5-flash?key=${this.config.apiKey}`;
      const res = await fetch(url);
      return { available: res.ok, latencyMs: Date.now() - start, activeRequests: 0 };
    } catch {
      return { available: false, latencyMs: 0, activeRequests: 0, message: 'Unreachable' };
    }
  }
}
