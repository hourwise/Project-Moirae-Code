# ADR-XXXX: Moirae Code Host Enforcement for Dual-Principal MCP Delegation

- **Status:** Accepted — Implementation Pending
- **Date:** 2026-07-14
- **Supersedes:** [ADR-XXXX: Adoption of the Fates Dual-Principal and Compatibility Contract](./ADR-XXXX-fates-dual-principal-and-compatibility-contract.md)
- **Parent decision:** Dual-Principal Identity, Scoped MCP Delegation, and Cross-Runtime Compatibility
- **Related decision:** MCP 2026-07-28 Stateless Compatibility Architecture
- **Project:** Project Moirae Code
- **Decision scope:** Host/client composition, user consent, protocol negotiation, credential custody, retries, extensions, and bypass prevention

## Context

Moirae Code is the user-facing host and MCP client environment. It receives model tool proposals, displays approvals, manages integrations, and composes Horae, Ananke, and Mnemosyne.

Its process and extension environment can also create bypass paths through terminals, child processes, direct HTTP, filesystem APIs, provider SDKs, or unrestricted extensions.

Modern MCP places greater responsibility on clients for discovery, per-request metadata, negotiation, retries, input collection, and application state.

## Decision

Moirae Code SHALL act as a governed host, not merely a transport client.

Every model-proposed tool call SHALL pass through the documented path:

```text
User/model request
  → Moirae host
  → Horae context and workflow
  → Ananke policy and approval
  → protected tool/server adapter
  → outcome
  → optional Mnemosyne update
```

Moirae Code SHALL NOT expose long-lived upstream credentials to the model, renderer, arbitrary extensions, untrusted child processes, or generated project files.

## Dual-principal host context

Moirae Code SHALL maintain separate identities for:

- authenticated user or service principal;
- acting model/agent;
- host runtime;
- extension or plugin where it participates;
- represented principal where delegated operation requires it.

User identity SHALL not erase agent identity. Model identity SHALL not substitute for user authority.

## Protocol-era negotiation

The MCP client layer SHALL be isolated behind an adapter supporting:

- legacy handshake-based MCP;
- modern `server/discover`-based MCP;
- automatic negotiation where appropriate;
- explicit modern-only pinning;
- diagnostics showing negotiated version and era;
- bounded timeouts and clear fallback behaviour;
- special handling for spawn-per-invocation stdio servers.

Migration to beta or new major SDKs SHALL be a deliberate dependency change with tests, not an automatic consequence of this ADR.

## Server and tool admission

Discovery SHALL not equal trust.

Before enabling a server or tool, Moirae Code SHALL obtain or display:

- server identity and origin;
- transport and endpoint;
- supported protocol era/version;
- requested credentials and scope;
- tool capabilities and risk classes;
- whether provider enforcement is fine-grained or coarse;
- whether traffic is routed through Ananke;
- known bypass or extension risks;
- degraded-governance conditions.

## Approval and input UX

Moirae Code SHALL visually distinguish:

- ordinary user input requested by an MCP server;
- Ananke approval required;
- credential or login required;
- stale or changed request;
- protocol incompatibility;
- retry of an indeterminate action;
- denial;
- degraded governance.

An `input_required` response MUST NOT be presented as though approval has already been granted.

Approval screens SHALL display the material bound fields: principals, server, tool, arguments or summary, tenant/resource scope, purpose, expiry, and repeat policy.

## Credential custody

Provider API keys and refresh tokens SHALL be held only by a protected broker or approved secure store.

The renderer, model, arbitrary extensions, and project workspace SHALL receive only:

- non-secret integration identifiers;
- short-lived scoped tokens where strictly required;
- broker references;
- redacted status.

## Retry behaviour

Moirae Code SHALL not blindly retry side-effecting operations.

Before retry it SHALL:

1. reuse the original idempotency key;
2. ask Ananke for retry disposition;
3. display indeterminate status where completion is unknown;
4. avoid creating a fresh approval that broadens the action;
5. preserve workflow and attempt history.

## Extension and terminal boundary

Moirae Code SHALL document which surfaces are:

- governed;
- brokered;
- sandboxed;
- restricted;
- merely observed;
- ungoverned.

No claim of a non-bypassable chokepoint may be made while arbitrary extensions, terminals, child processes, direct network clients, or provider keys can execute equivalent actions outside Ananke.

## State handles

Opaque workflow or memory handles SHALL be treated as sensitive references, not permissions.

Moirae Code SHALL avoid placing reusable handles into model context unless necessary and SHALL redact them from crash reports, telemetry, and user-visible logs.

## Security invariants

1. Model tool proposals cannot directly invoke protected tools.
2. User and agent identities remain separately visible and auditable.
3. Credentials remain outside renderer, model, extension, and workspace boundaries.
4. Discovery does not auto-enable a server.
5. Input collection does not imply approval.
6. Retry cannot silently duplicate an external action.
7. Protocol fallback cannot bypass Ananke or weaken identity propagation.
8. Ungoverned surfaces are clearly disclosed until technically constrained.

## Implementation sequence

1. Import canonical request, principal, compatibility, and handle contracts.
2. Centralise all MCP clients behind one adapter.
3. Add legacy/modern negotiation and diagnostics.
4. Add server-admission and compatibility UI.
5. Add separate input-required, approval, credential, denial, and indeterminate states.
6. Route credentials through the broker.
7. Add idempotency-aware retry UX.
8. Add extension/terminal bypass tests and enforcement milestones.
9. Add redaction tests for logs, crash records, context, and generated files.

## Acceptance criteria

- Equivalent legacy and modern calls traverse the same governed path.
- The UI identifies both user and acting agent for approval.
- No long-lived provider key reaches model context, renderer state, arbitrary extensions, or project files.
- A failed or timed-out side-effecting call is not retried without Ananke disposition.
- Modern `input_required` and Ananke approval are visibly distinct.
- The product clearly marks any remaining ungoverned execution surfaces.
