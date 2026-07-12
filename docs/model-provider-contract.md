# Model Provider Contract

This document describes the provider-neutral contract implemented in this repository and the limits of adapter parity. It does not claim that every provider supports the same behavior beyond what the public types and adapter code actually expose.

## Evidence Sources

- [packages/provider-sdk/src/index.ts](../packages/provider-sdk/src/index.ts)
- [packages/secret-broker/src/index.ts](../packages/secret-broker/src/index.ts)
- [packages/network-broker/src/index.ts](../packages/network-broker/src/index.ts)
- [integrations/openai-compatible/src/index.ts](../integrations/openai-compatible/src/index.ts)
- [integrations/anthropic/src/index.ts](../integrations/anthropic/src/index.ts)
- [integrations/google/src/index.ts](../integrations/google/src/index.ts)
- [integrations/deepseek/src/index.ts](../integrations/deepseek/src/index.ts)
- [integrations/llama-cpp/src/index.ts](../integrations/llama-cpp/src/index.ts)
- [integrations/mistral/src/index.ts](../integrations/mistral/src/index.ts)
- [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts)

## Stable Contract Surface

| Contract           | Purpose                                                                                                                                | Current repo status             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `ProviderManifest` | Declares provider identity, locality, credential mode, and default network policy                                                      | Implemented and contract-tested |
| `ModelDescriptor`  | Declares model identity, context limit, tool support, image support, structured-output support, streaming support, and capability tags | Implemented and contract-tested |
| `ModelProvider`    | Defines `discoverModels`, `countTokens`, `createCompletion`, `cancel`, and `healthCheck`                                               | Implemented and contract-tested |
| `ModelRequest`     | Defines request ID, model ID, messages, tools, and basic sampling controls                                                             | Implemented                     |
| `ModelEvent`       | Normalizes stream output as `text`, `tool_call`, `done`, or `error`                                                                    | Implemented                     |

## Adapter Matrix

| Adapter                              | Locality by manifest | Credential mode | Discovery approach                                  | Tool-call output                            | Structured output                         | Image support               | Health check                             | Cancellation         | Test coverage                                                                           |
| ------------------------------------ | -------------------- | --------------- | --------------------------------------------------- | ------------------------------------------- | ----------------------------------------- | --------------------------- | ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `@moirae/provider-openai-compatible` | `remote`             | `api_key`       | `/models` with fallback placeholder                 | Emits `tool_call` from response tool calls  | Descriptor says `false` in fallback model | Fallback model says `false` | Reachability check against `/models`     | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |
| `@moirae/provider-anthropic`         | `remote`             | `api_key`       | Known model list                                    | Emits `tool_call` from `tool_use` blocks    | `false` in descriptors                    | Mixed by model              | Reachability via `POST /v1/messages`     | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |
| `@moirae/provider-google`            | `remote`             | `api_key`       | Known model list                                    | Emits `tool_call` from `functionCall` parts | Mixed by model descriptors                | Mixed by model descriptors  | Reachability against model endpoint      | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |
| `@moirae/provider-deepseek`          | `remote`             | `api_key`       | Known model list                                    | Inherited from OpenAI-compatible adapter    | Mixed by model descriptors                | `false` in descriptors      | Custom health check                      | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |
| `@moirae/provider-llama-cpp`         | `local`              | `none`          | Inherited discovery with local fallback placeholder | Inherited from OpenAI-compatible adapter    | `false` in placeholder                    | `false` in placeholder      | Inherited from OpenAI-compatible adapter | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |
| `@moirae/provider-mistral`           | `remote`             | `api_key`       | Known model list                                    | Inherited from OpenAI-compatible adapter    | Mixed by model descriptors                | `false` in descriptors      | Custom health check                      | Caller-managed/no-op | [tests/contract/provider-adapters.test.ts](../tests/contract/provider-adapters.test.ts) |

## Behavioral Contract

### Authentication ownership

- `ProviderManifest.credentialMode` can be `none`, `api_key`, or `oauth`.
- The repository includes a secret-broker abstraction, but provider constructors currently accept keys directly.
- This means provider-key ownership is not fully centralized in current code. The intended broker exists as an interface, not as a bound runtime path.

### Discovery

- Every adapter must implement `discoverModels()`.
- Some adapters return static known-model lists.
- The OpenAI-compatible adapter tries a live `/models` call and falls back to a placeholder model if unreachable.
- The repository does not require live discovery for all providers.

### Streaming

- The contract surface is streaming-friendly because `createCompletion()` returns `AsyncIterable<ModelEvent>`.
- The adapters still use non-streaming HTTP requests in several places and then emit normalized events after the full response arrives.
- This repo therefore supports a streaming-shaped contract, not guaranteed token-by-token provider streaming parity.

### Structured output

- `ModelDescriptor.supportsStructuredOutput` exists.
- `ModelRequest` does not currently include a response schema or a provider-neutral structured-output envelope.
- The repository can describe structured-output support in metadata, but it does not yet define a provider-neutral structured-output request contract.

### Tool proposals and interception

- `ModelEvent` includes `tool_call`.
- The current provider contract can surface tool proposals from the model.
- The repository does not yet define the full Horae-to-Ananke interception contract for those tool proposals because the shared workflow and approval types are still blocked upstream.

### Cancellation

- Every provider implements `cancel(requestId)`.
- Current adapters treat cancellation as caller-managed or no-op because provider APIs often do not expose request cancellation directly.
- This repository cannot claim full in-flight provider-side cancellation.

### Retries

- No provider-neutral retry policy is defined in `@moirae/provider-sdk`.
- Current adapters do not implement shared retry, backoff, or idempotency behavior.

### Usage accounting

- `countTokens()` is part of the contract.
- Current implementations use rough estimates in multiple adapters rather than provider-native tokenization APIs.
- The repository can describe token estimation, not billing-grade usage accounting.

### Context limits

- `ModelDescriptor.contextLimit` is part of the stable contract and is exercised by tests.
- Values are adapter-supplied metadata and should not be treated as verified live provider guarantees.

### Multimodal support

- Descriptors expose `supportsImages`.
- `ChatMessage.content` is currently just `string`.
- The repository can represent image capability metadata, but it does not yet define a provider-neutral multimodal request payload.

### Local models

- `llama.cpp` declares `locality: 'local'` and `credentialMode: 'none'`.
- `OpenAICompatibleProvider` is generic enough to target local servers, but its own manifest defaults to `remote`.
- The repository can label some adapters as local, but it does not prove host-level privacy or network isolation for every local deployment.

### Errors and rate limits

- `ModelEvent` includes normalized `error` events with `code` and `message`.
- `ProviderHealth` optionally includes `rateLimitRemaining`.
- Error normalization is adapter-specific and not yet bound to a single shared error taxonomy.

### Privacy and redaction

- The provider SDK comment says adapters receive prepared prompts and not direct filesystem, database, credential, or MCP access.
- The repository does not yet implement a shared redaction pipeline or outbound prompt scrubber before provider transmission.

## Claims This Repository Can Support

- Provider-neutral manifest, model, request, event, cancellation, and health-check interfaces.
- Adapter-level locality and credential-mode metadata.
- Contract tests that verify adapters conform to the shared surface without live provider credentials.

## Claims This Repository Cannot Yet Support

- Full feature parity across providers.
- Provider-neutral structured-output requests.
- Verified billing-grade token counts.
- Centralized provider-key ownership through the secret broker.
- End-to-end interception of tool proposals by Horae and Ananke.
- Uniform retry, backoff, rate-limit recovery, or privacy-redaction behavior.

## Open Questions

- Provider-key ownership: should callers construct adapters with raw keys, or should the supervisor or broker own all provider credentials?
- Local-model guarantees: what exact claims, if any, may Moirae make about local privacy when the endpoint is user-configured?
- Version pinning versus negotiation: the adapters expose protocol versions, but there is no repo-wide negotiation strategy for provider features.

## Documentation Conflicts

- The contract metadata can mark `supportsStructuredOutput` or `supportsImages`, but the request surface is still text-only. The metadata is therefore broader than the present request contract.
- The repository contains a secret-broker abstraction, while current provider constructors still accept raw API keys directly. The intended ownership model is not yet resolved in code.
