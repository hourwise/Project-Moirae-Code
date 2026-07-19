# ADR-0001: Project Adrasteia Stage-A Host Boundary and Pinned Fates Inspection

- Status: Accepted
- Date: 2026-07-18
- Project: Project Moirae Code
- Related: `ADR-XXXX-dual-principal-host-delegation-and-compatibility.md` (accepted host-principal direction); content-preflight ADR remains Proposed/Deferred.

## Decision

Moirae Code adopts the immutable Project Adrasteia release `project-runtime-contracts@0.4.0` from tag `adrasteia-adoption-v0.4.0-protocol-1.4.0`, source commit `124b6aee2629a3147739934ad5f1b45b32c8ba46`, and SHA-256 `11ee062b079f74d2a4558af315c9b9b12a6aede291d409c48f038d93c416e2c2`.

The host runtime name is `moirae-code`. It implements protocol `1.4.0`, accepts `1.0.0–1.4.0`, and uses canonical semantic negotiation. `@moirae/runtime-contracts` is a deprecated re-export facade; new portable imports come from `project-runtime-contracts`, and host-only concepts come from `@moirae/host-contracts`.

Moirae Code is an inspection-only host in Stage-A. It composes trusted host context from canonical dual-principal execution context, bounded scope, correlation, project/workspace identity, and host identity. Model, prompt, tool, and IPC content cannot override those values. Historical grant, approval, audit, and state-handle references are descriptive only.

## Pinned peers

- Ananke: `ananke-adrasteia-adoption-v0.1.0-protocol-1.4.0` at `dcbb115c5798072221afdd2e4fdd36e786defddf`; public sanitized runtime-inspection endpoints only.
- Mnemosyne: `mnemosyne-adrasteia-adoption-v0.1.0-protocol-1.4.0` at `f4ab76a9760f856d78908d35facceb068d78c8e5`; transport-neutral/MCP inspection callback only.
- Horae: `horae-adrasteia-adoption-v0.1.0-protocol-1.4.0` at `52e14fa574f7427f62747fe84d2789aec25b94e3`; embedded/CLI/transport-neutral inspection only.

Peer health and readiness remain peer reports. Local PID, port, crash, restart, and freshness observations remain separate. The supervisor does not spawn Fates or infer health from an HTTP status.

## Consequences

- Ananke execute/approve/deny/audit clients fail closed with a Stage-A unsupported error.
- Mnemosyne memory/context operations fail with `QualifiedContextBoundaryUnavailable`.
- Horae session operations fail with `HoraeSessionTransportUnavailable`; no HTTP session API is invented.
- Provider configuration stores credential references and leases secrets only at request time. In-memory credential storage remains test/development-only; platform keychain work is deferred.
- Provider error messages are sanitized; headers and raw response bodies are not surfaced.
- Sandbox execution returns `unavailable` without started/completed events or a success exit code.
- Local IPC is contract-only and explicitly has no implemented authentication or replay protection.
- Skill import, installation, enablement, exposure, and authorization are separate states; exposure never grants execution authority.

## Explicitly deferred and ungoverned

This decision does not implement Ananke-governed execution or approval UX, Mnemosyne qualified retrieval, Horae sessions, Fate spawning, full MCP transport, production credential keychain, sandbox execution, terminal/Git/debugger interception, extension allowlisting, content preflight, durable recovery, or a full chat UX.

Terminal, built-in Git, debugger/tasks, third-party extensions, and direct provider paths remain ungoverned and are displayed as such. Content preflight remains Proposed/Deferred because the baseline declares `contentPreflightIncluded: false`.

## Validation and rollback

The baseline and pins are recorded in `docs/integration/adrasteia-baseline.json`. `npm run verify:adrasteia` verifies package, lockfile URL, installed exports, remote artifact digest, protocol facts, and preflight exclusion. `npm run verify:peers` resolves all checkpoint tags.

Rollback consists of removing the immutable package adoption and the adapter/coordinator packages in one change; it must not substitute a mutable branch, a local path dependency, or a regenerated tarball.
