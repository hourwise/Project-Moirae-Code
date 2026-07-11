# Moirae Code — Third-Party Dependencies & External Additions

> This document catalogues all external libraries, services, registries, protocols, and tools that Moirae Code depends on, integrates with, or evaluates for inspiration. It also identifies what must be built from scratch vs. what can be adopted.

---

## Table of Contents

1. [Adopt As Base (Foundation)](#adopt-as-base-foundation)
2. [Integrate As Services (Runtime Dependencies)](#integrate-as-services-runtime-dependencies)
3. [Build As First-Party (Original Development)](#build-as-first-party-original-development)
4. [Adapt From Official Samples](#adapt-from-official-samples)
5. [Evaluate For Inspiration (Not Dependency)](#evaluate-for-inspiration-not-dependency)
6. [Replace Or Avoid](#replace-or-avoid)
7. [Licensing Audit](#licensing-audit)
8. [Supply Chain Requirements](#supply-chain-requirements)

---

## Adopt As Base (Foundation)

These are direct dependencies that form the foundation of Moirae Code. They should be used with a thin adaptation layer, not a deep fork.

### VSCodium / Code-OSS

| Attribute | Detail |
|-----------|--------|
| **Repository** | [VSCodium/vscodium](https://github.com/VSCodium/vscodium) |
| **License** | MIT |
| **Usage** | Editor foundation, workbench, terminal, extension host, Git UI, debugger, settings, commands, keybindings, accessibility |
| **Fork Strategy** | **Thin fork only.** Minimize patches to the editor core. Rebrand, pre-install extension, configure safe defaults. |
| **Why Not Deep Fork** | Deep forks create merge debt with upstream security updates. VSCodium already strips Microsoft telemetry and branding. |
| **Key Customizations** | Product icons, about dialog, default settings (Open VSX registry, trusted extensions), pre-bundled Moirae extension |

### Electron (via VSCodium)

| Attribute | Detail |
|-----------|--------|
| **License** | MIT |
| **Usage** | Cross-platform desktop shell (inherited from Code-OSS) |
| **Security Requirements** | Renderer sandboxing enabled, context isolation enabled, no Node integration in remote content, restrictive CSP, secure-content-only, explicit permission handlers, no disabled webSecurity, no arbitrary navigation from webviews |
| **Verification** | Must audit and verify Electron security settings in the VSCodium build configuration |

### Node.js

| Attribute | Detail |
|-----------|--------|
| **Version** | 22+ LTS |
| **License** | MIT |
| **Usage** | Runtime for supervisor, all three Fates, CLI tools, build tooling |

### SQLite

| Attribute | Detail |
|-----------|--------|
| **Version** | 3.x (via better-sqlite3 or equivalent native binding) |
| **License** | Public Domain |
| **Usage** | Ananke audit store, Mnemosyne Almanac store, Horae registry, policy store, approval store, workspace metadata |
| **Mode** | WAL (Write-Ahead Logging) required for concurrent read/write |
| **Storage Layout** | Separate database files per runtime under `.project-moirae/ananke/`, `.project-moirae/mnemosyne/`, `.project-moirae/horae/` |

---

## Integrate As Services (Runtime Dependencies)

These are external services, protocols, and registries that Moirae connects to at runtime.

### Open VSX (Extension Marketplace)

| Attribute | Detail |
|-----------|--------|
| **URL** | [open-vsx.org](https://open-vsx.org) |
| **License** | Eclipse Public License 2.0 |
| **Usage** | Default extension marketplace (replaces Microsoft Marketplace) |
| **Self-Hosting** | Can be self-hosted for a curated Moirae registry |
| **Restrictions** | Must NOT redistribute Microsoft Marketplace packages (license restriction) |
| **Curated Registry** | Future self-hosted instance that proxies approved Open VSX packages while publishing first-party Moirae extensions |

### MCP (Model Context Protocol)

| Attribute | Detail |
|-----------|--------|
| **Specification** | [modelcontextprotocol.io](https://modelcontextprotocol.io) |
| **SDK** | `@modelcontextprotocol/sdk` (MIT) |
| **Usage** | Stdio/HTTP transport for MCP servers (filesystem, Git, shell, browser, APIs) |
| **Moirae's Relationship** | Moirae is an MCP host that governs MCP clients and servers. Ananke governs tool calls regardless of transport (MCP, HTTP, stdio, CLI). |
| **Risk** | Evolving specification — must track changes and version-pin server manifests. MCP authorization model distinguishes HTTP from stdio. |

### Model Provider APIs

These are external HTTP APIs that Horae adapts to. Credentials are stored exclusively in the OS keychain.

| Provider | Type | Auth Method | Adapter Priority |
|----------|------|-------------|-----------------|
| **Ollama** | Local | None (loopback) | 🔴 Critical — primary local provider |
| **llama.cpp server** | Local | None (loopback) | 🟡 High |
| **LM Studio** | Local | None (loopback) | 🟢 Medium |
| **Generic OpenAI-compatible** | Local/Remote | API key | 🔴 Critical — universal fallback |
| **Anthropic (Claude)** | Remote | API key | 🟡 High |
| **OpenAI** | Remote | API key | 🟡 High |
| **Google Gemini** | Remote | API key | 🟢 Medium |
| **DeepSeek** | Remote | API key | 🟢 Medium |
| **Mistral** | Remote | API key | 🟢 Medium |

### OS Credential Stores

| Platform | Store | Usage |
|----------|-------|-------|
| **Windows** | Windows Credential Manager | API keys, OAuth refresh tokens |
| **macOS** | Keychain | API keys, OAuth refresh tokens |
| **Linux** | Secret Service / libsecret | API keys, OAuth refresh tokens |

### Git Integration

| Component | Usage |
|-----------|-------|
| **Git (CLI)** | Core Git operations |
| **Git Credential Manager** | Git authentication to providers (GitHub, GitLab, etc.) |
| **SSH Agent** | SSH key-based Git authentication |
| **gh CLI** (optional) | GitHub-specific operations via official CLI |

---

## Build As First-Party (Original Development)

These components must be built from scratch as they define Moirae's unique value. They may consume the adopted foundations and integrated services listed above.

### moirae-core-extension

First-party VS Code extension providing: chat surface, model selector, memory explorer, approval UX, audit timeline, runtime health dashboard, project onboarding, and configuration UI.

- **Depends on:** VS Code Extension API, Moirae Supervisor (via local IPC)
- **Must NOT depend on:** GitHub Copilot, any proprietary chat extension

### moirae-supervisor

Local control plane managing: process startup/shutdown, service discovery, health monitoring, database migrations, crash recovery, local session credentials, component version compatibility.

- **Depends on:** Node.js 22+, SQLite
- **Must NOT:** Run all Fates inside the extension host (separate processes)

### moirae-provider-sdk

Model adapter SDK defining: `ModelProvider` interface, streaming events, token counting, capability declarations, authentication hooks, error normalization.

- **Depends on:** Runtime Contracts (model descriptor types)
- **Design Constraint:** Provider adapters receive prepared prompts from Horae — not direct filesystem, database, credential, or MCP access

### moirae-tool-sdk

Tool manifest SDK defining: tool manifests, side-effect declarations, input/output schemas, evidence objects, compensation metadata, execution constraints.

- **Depends on:** Runtime Contracts (tool proposal types)
- **Design Constraint:** Unknown tools default to denial or isolation

### moirae-runtime-contracts (extensions to existing)

Extensions to [project-runtime-contracts](https://github.com/hourwise/project-runtime-contracts) adding: workflow types, model descriptor types, context pack types, tool proposal types, approval types, memory types, audit types, evidence types, cancellation types, policy version types.

- **Must NOT contain:** Engines, persistence, policies, databases, runtime behavior
- **Principle:** Types only. All logic stays in the runtimes.

### moirae-local-ipc

Authenticated local communication between the extension and supervisor using JSON-RPC/MCP over stdio or local domain socket.

### moirae-secret-broker

OS-keychain abstraction for API keys and OAuth tokens. Never stores credentials in settings.json, repository files, Mnemosyne memory, plaintext SQLite, chat transcripts, environment dumps, or audit payloads.

### moirae-network-broker

Outbound connection policy enforcement with modes: blocked, loopback-only, provider endpoints only, approved domains, unrestricted (with warning).

### moirae-ui-components

Shared React/webview components for approval cards, diff review, memory cards, audit timeline, policy status indicators, and runtime health.

### moirae-policy-profiles

Default policy profiles shipped with Moirae: Standard (local dev), Strict (no network), Enterprise (admin-managed), etc.

### moirae-update-service

Auto-updater with signed update manifests, release channels (stable/beta/nightly), and rollback capability.

### Integration Clients

| Client | Purpose |
|--------|---------|
| `ananke-client` | Typed client for Ananke HTTP API (execute, approve, deny, audit query) |
| `mnemosyne-client` | Typed client for Mnemosyne MCP tools (search, context_pack, write_memory, revalidate, etc.) |
| `horae-client` | Typed client for Horae session API (start, send, cancel, workflow state) |
| `git-adapter` | Wraps Git CLI operations as governed tools |
| `github-adapter` | Typed GitHub capability provider (issues.read, contents.read, branch.push, pull_request.create) |

---

## Adapt From Official Samples

Use official VS Code extension samples and documentation as reference material for implementation patterns. These are NOT dependencies — they are learning resources.

| Resource | Adapted For |
|----------|-------------|
| VS Code Extension Samples | Custom views, tree views, webviews, authentication providers, secret storage, test integration |
| VS Code Chat API Samples | Chat participants, language-model provider integration |
| VS Code Terminal API | Terminal/task integration |
| Electron Security Guidelines | Renderer sandboxing, context isolation, CSP configuration |

---

## Evaluate For Inspiration (Not Dependency)

These open-source projects are studied for UX and architectural patterns. **None may become a direct dependency.** Their concepts can be adapted but governance must remain Moirae's.

### Continue (continue.dev)

| Attribute | Detail |
|-----------|--------|
| **Studied For** | Provider abstraction patterns, prompt streaming, context providers, diff handling, codebase indexing, model configuration UX |
| **Why Not A Dependency** | Architecture centers on the model as the authority. Moirae's authority layer (Ananke) must remain independent. |
| **Adaptable Concepts** | Provider interface design, chat UX patterns, diff presentation |

### Cline / Roo Code

| Attribute | Detail |
|-----------|--------|
| **Studied For** | Step-based tool presentation, file-diff approval UX, terminal output display, session checkpoints, browser/tool display |
| **Why Not A Dependency** | Broad implicit authority model; model-owned approval logic; unstructured success states |
| **Adaptable Concepts** | Approval card design, step visualization, checkpoint UX |

### OpenHands / Aider

| Attribute | Detail |
|-----------|--------|
| **Studied For** | Git checkpointing, patch application, repository maps, test-and-fix loops, headless operation |
| **Why Not A Dependency** | Bypasses structured governance; model has direct filesystem access |
| **Adaptable Concepts** | Git integration patterns, repository mapping, automated test loops (behind Ananke) |

---

## Replace Or Avoid

These are explicitly NOT used, and Moirae must provide alternatives.

### GitHub Copilot / Copilot Chat

| Replaced By | Reason |
|-------------|--------|
| Moirae Chat (first-party) | Proprietary dependency; Moirae must function without any Copilot entitlement |
| *Note* | A compatible third-party Copilot extension may be user-installable but is not bundled or required |

### Microsoft Marketplace

| Replaced By | Reason |
|-------------|--------|
| Open VSX (default) + self-hosted curated registry (future) | Marketplace license restrictions; curation and governance requirements |

### Direct Model-to-Shell Implementations

| Replaced By | Reason |
|-------------|--------|
| Model → structured proposal → Ananke policy → scoped runner → typed outcome | Unrestricted shell access violates Law II (intent ≠ authority) and Law X (tools untrusted until declared) |

### Raw Conversation-Log Memory

| Replaced By | Reason |
|-------------|--------|
| Mnemosyne's extracted, scoped, provenance-backed Almanac memory | Unstructured memory violates Law V (memory is evidence, not truth) |

### Shared Unrestricted Environment Variables

| Replaced By | Reason |
|-------------|--------|
| Process-specific secret injection via OS keychain | Prevents credential leakage between components |

### Monolithic IDE Service

| Replaced By | Reason |
|-------------|--------|
| Separately versioned and supervised Ananke, Mnemosyne, Horae processes | Law XVI (Fates remain separable); crash isolation; independent testing |

---

## Licensing Audit

All direct dependencies must be compatible with Moirae Code's licensing.

| Component | License | Commercial Use | Distribution | Modification |
|-----------|---------|---------------|-------------|-------------|
| VSCodium / Code-OSS | MIT | ✅ | ✅ | ✅ |
| Electron | MIT | ✅ | ✅ | ✅ |
| Node.js | MIT | ✅ | ✅ | ✅ |
| TypeScript | Apache 2.0 | ✅ | ✅ | ✅ |
| SQLite | Public Domain | ✅ | ✅ | ✅ |
| Open VSX | EPL 2.0 | ✅ | ✅ | ✅ |
| MCP SDK | MIT | ✅ | ✅ | ✅ |
| Zod | MIT | ✅ | ✅ | ✅ |
| Vitest | MIT | ✅ | ✅ | ✅ |
| better-sqlite3 | MIT | ✅ | ✅ | ✅ |

**Key restrictions:**
- Microsoft Marketplace extensions have license restrictions on redistribution — must use Open VSX
- VSCodium binaries are built from MIT-licensed Code-OSS source
- All first-party Moirae code should be MIT or Apache 2.0 licensed

---

## Supply Chain Requirements

For every release of Moirae Code:

- [ ] **Locked dependencies** (package-lock.json / npm-shrinkwrap.json for all packages)
- [ ] **SBOM** (Software Bill of Materials) in SPDX format
- [ ] **Reproducible build** target
- [ ] **Signed installers** (Windows Authenticode, macOS notarization)
- [ ] **Signed update manifests**
- [ ] **Dependency vulnerability scanning** (npm audit / Dependabot / Snyk)
- [ ] **Secret scanning** (prevent credential leakage in source)
- [ ] **License compliance scanning** (ensure all deps are compatible)
- [ ] **Provenance attestations** (SLSA / npm provenance)
- [ ] **Pinned GitHub Actions** (commit SHA, not tags)
- [ ] **Release channel separation** (stable / beta / nightly)
- [ ] **Rollback mechanism** for auto-updates
