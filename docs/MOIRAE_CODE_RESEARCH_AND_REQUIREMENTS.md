# Moirae Code — Research Additions and Requirements

## Purpose

Moirae Code should be a governed, model-independent coding environment built around:

- Horae for orchestration
- Ananke for policy and approval
- Mnemosyne for durable memory
- Runtime Contracts for interoperability

It should not be merely another coding agent. It should be a stable coding surface where different models can work under consistent project rules.

## Governed Skill Registry

Capabilities:

- import standard skill folders
- inspect manifest
- show licence and provenance
- display requested permissions
- scan through Reticle
- classify trust state
- install restricted
- pin revision
- update with review
- rollback
- record project-specific outcomes

Skill kinds:

```ts
type SkillKind = 'guidance' | 'workflow' | 'executable';
```

## Capability-based workers

1. Analyse task requirements.
2. Resolve required capabilities.
3. Instantiate the minimum workers.
4. Give minimum context.
5. Give minimum authority.
6. Set lifetime and cancellation path.
7. Collect typed results and evidence.
8. Terminate or release workers.

> No worker exists merely because a role template exists.

## Project state outside chat

The chat is temporary. The project state must survive:

- model replacement
- IDE restart
- computer restart
- provider outage
- context exhaustion
- agent failure
- human handoff

UI should expose:

- active task
- project truth
- unresolved conflicts
- stale records
- restart pack
- branch and commit
- approvals
- runtime
- active skills
- evidence and outputs

## Provider abstraction

Support:

- local models
- direct APIs
- OpenAI-compatible endpoints
- enterprise gateways
- user-controlled routing
- explicit fallback policy

Controls:

- provider/model selection
- cost limits
- data residency
- tool support
- context limits
- fallback rules
- local/remote indicator
- observed reliability
- privacy warning
- explicit provider-switch notice

Do not build around free-tier aggregators.

## Sandbox execution

Execution modes:

- host
- restricted process
- container
- microVM
- remote sandbox

Before approval, show repository scope, network scope, secrets, limits, expected side effects, cleanup plan, and evidence capture.

## Content preflight UX

Before file content is exposed to models or memory, present a first-class inspection step that shows source identity and trust class, detected type and size, structural facts, scanner status, high-level risk flags, exposure level, truncation or redaction state, approval state, stale receipts, and Mnemosyne eligibility.

Progressive disclosure should move through structure only, sanitized details, selected content, and full content. Detector rules, regexes, private scanner configuration, hidden policy exceptions, and redacted sensitive content must stay hidden.

## Task lifecycle

Every task should support:

- create
- plan
- approve
- run
- pause
- resume
- cancel
- recover
- hand off
- close
- archive

Cancellation should stop new actions, signal workers, preserve partial results, clean temporary resources, and produce a restart/handoff record.

## Git integration

Track:

- repository
- branch
- base commit
- working tree
- changed/staged/untracked files
- generated files
- tests
- conflicts
- checkpoints

Push, force-push, branch deletion, and release creation should be governed by Ananke.

## IDE surfaces

- chat
- task panel
- memory panel
- approvals panel
- runtime panel
- content preflight inspector
- skill registry
- execution log
- evidence viewer
- tests
- Git view
- model/provider selector

Governance must not be hidden behind a normal chat panel.

## Laws of Moirae Code

1. The project, not the chat, is the enduring unit of work.
2. No model is trusted merely because it is powerful.
3. No skill is trusted merely because it is installed.
4. No worker receives excess context or authority.
5. Every meaningful side effect is governed.
6. Every task has a lifecycle and cancellation path.
7. Every output retains provenance.
8. Provider changes are explicit.
9. Project memory remains portable.
10. The user can inspect how work was produced.

## Build order

### Phase 1

- VSCodium shell
- runtime registration
- provider adapters
- project identity
- task panel
- Mnemosyne view
- Ananke approval panel
- content preflight inspector

### Phase 2

- governed skill registry
- task lifecycle
- cancellation
- Git checkpoints
- execution evidence
- sandbox adapter

### Phase 3

- capability resolver
- framework adapters
- local/remote routing
- skill performance history
- handoff/export

### Phase 4

- advanced isolation
- team mode
- signed skills
- public validation harness
- curated skill catalogue
