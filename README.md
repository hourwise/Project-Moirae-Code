# Project Moirae Code

> A local-first, model-agnostic coding environment in which Horae coordinates the work, Mnemosyne governs what is remembered and revealed, and Ananke governs what may actually happen.

**Product promise:** Use almost any coding model, local or hosted, without surrendering control of what it remembers, what it can access, or what it is allowed to do.

---

## ⚡ Current Status — July 2026

**Moirae Code monorepo:** 12 packages + 10 integrations building cleanly. 162 tests passing across 9 suites. Blocked waiting on upstream dependencies.

**Blockers (external repos):**

| Blocker                                                  | Repo                                                                               | Status                       | Impact                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ananke needs production hardening                        | [Project-Ananke](https://github.com/hourwise/Project-Ananke)                       | Phase 1 prototype (60 tests) | Phase 1 headless loop cannot integrate without production auth, real MCP validation, and Agent SDK           |
| Mnemosyne MCP + Ananke adapter incomplete                | [Project-Mnemosyne](https://github.com/hourwise/Project-Mnemosyne)                 | Milestones 8-9 in progress   | Horae cannot retrieve governed context packs or route safety signals                                         |
| Horae not implemented                                    | [Project-Horae](https://github.com/hourwise/Project-Horae)                         | Design docs only, no code    | Cannot compose runtimes, plan capabilities, or orchestrate sessions                                          |
| Runtime Contracts missing workflow/memory/approval types | [project-runtime-contracts](https://github.com/hourwise/project-runtime-contracts) | v1.1.0 base contracts only   | Missing types for tool proposals, model descriptors, context packs, evidence, cancellation, streaming events |

Capability-by-capability upstream status lives in [docs/upstream-dependency-matrix.md](docs/upstream-dependency-matrix.md).

**What we can do now (unblocked):**

- ✅ Provider adapters: Anthropic (Claude), Google (Gemini), DeepSeek, llama.cpp, Mistral — all built
- ✅ Tool manifest validator with risk scoring, publisher trust, and integrity checks — built
- ✅ Governed skill registry: import, inspect, Reticle scan, trust classify, install, pin, update, rollback — built
- ✅ Sandbox execution adapter: 5 modes, risk-based mode selection, config validation, approval preview, path/network checks — built
- ✅ Supervisor health check polling, crash recovery with escalation tiers — built
- ✅ Moirae-specific types: supervisor configs, packaging manifests, update manifests, extension policies — built
- ✅ 162 contract + adversarial tests passing across 9 suites
- Continue developing `@moirae/runtime-contracts` types that don't duplicate external contracts
- Design the IDE surface components: task panel, memory panel, approvals panel, runtime panel, content preflight inspector, skill registry, execution log, evidence viewer

**Next task once unblocked:** Implement Horae runtime-core (registry → capability planner → session orchestrator → governed vertical slice)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      MOIRAE CODE UI                          │
│  Editor │ Terminal │ Git │ Chat │ Memory │ Approvals │ Audit │
└──────────────────────────────┬───────────────────────────────┘
                               │ VS Code Extension API
┌──────────────────────────────▼───────────────────────────────┐
│                 MOIRAE CORE EXTENSION                        │
└──────────────────────────────┬───────────────────────────────┘
                               │ authenticated local IPC
┌──────────────────────────────▼───────────────────────────────┐
│                    MOIRAE SUPERVISOR                          │
└──────────────┬──────────────────┬───────────────────┬────────┘
               │                  │                   │
       ┌───────▼───────┐  ┌──────▼────────┐  ┌──────▼────────┐
       │     HORAE     │  │    ANANKE     │  │  MNEMOSYNE   │
       │ Orchestration │  │ Authority     │  │ Memory        │
       │ Model routing │  │ Policy/audit  │  │ Provenance    │
       └───────┬───────┘  └──────▲────────┘  └──────▲────────┘
               │                 │                   │
               └────────┬────────┴─────────┬─────────┘
                        │                  │
               ┌────────▼────────┐  ┌─────▼────────────┐
               │ Tool/MCP Broker │  │ Model Providers  │
               └─────────────────┘  └──────────────────┘
```

**Critical boundary:** The model must never directly possess unrestricted filesystem, shell, Git, network, or credential access. The required path is:

```
User request → Horae creates proposed operation → Ananke evaluates authority
→ approval if required → tool broker executes narrowly scoped action
→ Ananke records outcome → Mnemosyne optionally records eligible memory
→ UI presents result and evidence
```

---

## The Fates (Core Services)

| Fate                  | Role                            | Repository                                                                         | Status                                                                     |
| --------------------- | ------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Ananke**            | Authority & Outcome Control     | [Project-Ananke](https://github.com/hourwise/Project-Ananke)                       | Phase 1 prototype — 60 tests passing, 7 safety scenarios verified          |
| **Mnemosyne**         | Controlled Project Memory       | [Project-Mnemosyne](https://github.com/hourwise/Project-Mnemosyne)                 | MVP — 8 of 9 milestones complete, MCP + Ananke adapter in progress         |
| **Horae**             | Orchestration & Model Mediation | [Project-Horae](https://github.com/hourwise/Project-Horae)                         | Design docs only — awaiting implementation                                 |
| **Runtime Contracts** | Shared protocol layer           | [project-runtime-contracts](https://github.com/hourwise/project-runtime-contracts) | v1.1.0 — base identity, capability, health, session, composition contracts |

---

## Monorepo Structure

```12 first-party packages
│   ├── runtime-contracts/            ✅ Shared types, schemas, Moirae-specific types
│   ├── local-ipc/                    ✅ JSON-RPC transport types
│   ├── provider-sdk/                 ✅ ModelProvider interface + events
│   ├── tool-sdk/                     ✅ ToolManifest, RiskClass, ManifestValidator
│   ├── policy-profiles/              ✅ Standard + Strict profiles
│   ├── secret-broker/                ✅ OS keychain abstraction
│   ├── network-broker/               ✅ 5-level outbound connection policy
│   ├── supervisor/                   ✅ Health checks + crash recovery
│   ├── skill-registry/               ✅ Governed skill import, inspect, trust, install, update, rollback
│   ├── sandbox-adapter/              ✅ 5 execution modes, risk-based selection, config validation, evidence capture
│   ├── ui-components/                🔶 Component interfaces designed (Phase 1olicy
│   ├── supervisor/                   ✅ Process lifecycle scaffold
│   ├── ui-components/                🔶 Placeholder (Phase 2)
│   └── update-service/               🔶 Placeholder (Phase 3)
├── apps/                             # 2 applications
│   ├── moirae-core-extension/        ✅ VS Code extension scaffold
│   └── diagnostics-cli/              ✅ Working CLI tool
├── integrations/                     # 9 typed clients + adapters
│   ├── ananke-client/                ✅ HTTP client for Ananke Gateway
│   ├── mnemosyne-client/             ✅ MCP client for Almanac tools
│   ├── horae-client/                 ✅ HTTP client for Horae sessions
│   ├── openai-compatible/            ✅ Full adapter (universal fallback)
│   ├── anthropic/                    ✅ Claude Opus/Sonnet/Haiku adapter
│   ├── google/                       ✅ Gemini 2.5 Pro/Flash adapter
│   ├── deepseek/                     ✅ DeepSeek V3/R1/Coder adapter
│   ├── llama-cpp/                    ✅ llama.cpp server adapter
│   └── git/                          🔶 Placeholder
├── packaging/                        # windows/ linux/ macos/
├── tests/                            # contract/ integration/ adversarial/ compatibility/ e2e/
├── upstream/vscodium/                # VSCodium thin fork location
├── scripts/                          # postinstall + environment-check
└── docs/                             # Blueprint, Roadmap, Research, Third-Party
```

✅ = implemented and building &nbsp; 🔶 = placeholder for later phase

---

## The Laws of Moirae Code

1. **The project, not the chat, is the enduring unit of work.** — Project state survives model replacement, IDE restart, provider outage, and context exhaustion. The chat is temporary; the project persists.
2. **No model is trusted merely because it is powerful.** — Every model operates under the same governed constraints. Capability does not imply authority.
3. **No skill is trusted merely because it is installed.** — Skills require manifests, provenance, trust classification, and explicit user grant. Unknown skills default to denial.
4. **No worker receives excess context or authority.** — Capability-based workers receive only the minimum context, tools, and permissions for the current task, with explicit lifetime and cancellation paths.
5. **Every meaningful side effect is governed.** — Model intent is not authority. All consequential actions pass through Ananke: proposal → policy evaluation → approval binding → scoped execution → typed outcome.
6. **Every task has a lifecycle and cancellation path.** — Tasks support: create, plan, approve, run, pause, resume, cancel, recover, hand off, close, and archive. Cancellation stops new actions, signals workers, preserves partial results, and produces a restart record.
7. **Every output retains provenance.** — Memory is evidence, not truth. Every retained item carries source, confidence, reliability, sensitivity, and expiry. Model inference cannot silently become permanent project fact.
8. **Provider changes are explicit.** — The user always knows which model, provider, and locality is active. Fallback must not silently weaken privacy, governance, or data boundaries.
9. **Project memory remains portable.** — The Mnemosyne Almanac is project-scoped, not locked to a single editor, model, or machine. It can be exported, encrypted, and transferred.
10. **The user can inspect how work was produced.** — Every action is attributable and auditable. The chain from request → context → model → proposal → authority → execution → evidence → memory remains visible.

---

## Core Concepts

### Governed Skill Registry

Skills are imported, inspected, and governed — not blindly trusted. Each skill has a kind (`guidance`, `workflow`, or `executable`), a manifest with licence and provenance, requested permissions, and a trust classification. Skills are installed with restrictions, revision-pinned, updated with review, and can be rolled back. Reticle scans skills before admission. Project-specific outcomes are recorded per skill.

### Capability-Based Workers

Workers are instantiated per task with the minimum required capabilities. The pattern:

1. Analyse task requirements
2. Resolve required capabilities
3. Instantiate minimum workers with minimum context and authority
4. Set explicit lifetime and cancellation path
5. Collect typed results and evidence
6. Terminate or release workers

No worker exists merely because a role template exists.

### Project State Outside Chat

The chat session is ephemeral. The project state must survive: model replacement, IDE restart, computer restart, provider outage, context exhaustion, agent failure, and human handoff. The IDE surfaces: active task, project truth, unresolved conflicts, stale records, restart pack, branch and commit state, pending approvals, runtime health, active skills, evidence, and outputs.

### Sandbox Execution

Execution modes are selected by risk: host, restricted process, container, microVM, or remote sandbox. Before approval, the user sees: repository scope, network scope, secrets involved, resource limits, expected side effects, cleanup plan, and evidence capture strategy.

### Content Preflight UX

Before file content is exposed to models or memory, Moirae Code presents a first-class content preflight experience. The UI surfaces source identity and trust class, detected type and size, structural facts, scanner status, high-level risk flags, exposure level, truncation or redaction state, approval state, stale receipts, and Mnemosyne eligibility without exposing detector internals.

Disclosure is progressive: structure only, sanitized details, selected content, then full content. If a source changes, prior approvals become visibly stale, access stops, and the user is offered re-scan and re-evaluation rather than silent trust reuse.

### Task Lifecycle

Every task supports: create → plan → approve → run → pause → resume → cancel → recover → hand off → close → archive. Cancellation stops new actions, signals workers, preserves partial results, cleans temporary resources, and produces a restart or handoff record.

---

## Development Sequence

```
Phase 1: VSCodium Shell + Runtime Registration + Provider Adapters
         + Project Identity + Task Panel + Mnemosyne View + Ananke Approvals
    ↓
Phase 2: Governed Skill Registry + Task Lifecycle + Cancellation
         + Git Checkpoints + Execution Evidence + Sandbox Adapter
    ↓
Phase 3: Capability Resolver + Framework Adapters + Local/Remote Routing
         + Skill Performance History + Handoff/Export
    ↓
Phase 4: Advanced Isolation + Team Mode + Signed Skills
         + Public Validation Harness + Curated Skill Catalogue
```

---

## Key Architectural Decision

**Do not fork VSCodium deeply.** Instead use: thin branded distribution + substantial first-party extension + separately supervised control plane + independent Ananke, Mnemosyne, Horae services. This preserves upstream security updates, independent testing, reuse outside Moirae, and a strong security boundary.

---

## Documentation

- [Product Architecture](docs/product-architecture.md) â€” Responsibilities, process boundaries, authority, and failure effects by component
- [Trust Boundaries](docs/trust-boundaries.md) â€” What Moirae currently governs, what bypasses it, and which controls are still planned
- [Extension Security Model](docs/extension-security-model.md) â€” Current versus proposed extension posture, trust states, and bypass risks
- [Model Provider Contract](docs/model-provider-contract.md) â€” Provider-neutral contract surface and limits of adapter parity
- [Upstream Dependency Matrix](docs/upstream-dependency-matrix.md) â€” Capability-by-capability dependency and blocker tracking for Horae, Ananke, Mnemosyne, and runtime contracts
- [Governed Path](docs/governed-path.md) â€” Intended request-to-outcome path and current bypass surfaces
- [ADR Index](docs/decisions/README.md) â€” ADR inventory and current statuses

- [Product Blueprint](docs/Moirae%20Code%20—%20proposed%20product%20blue.txt) — Full architectural proposal
- [Roadmap & Build Plan](docs/ROADMAP.md) — Detailed build plan with blockers and dependencies
- [Third-Party Dependencies](docs/THIRD_PARTY.md) — External libraries, services, and registries
