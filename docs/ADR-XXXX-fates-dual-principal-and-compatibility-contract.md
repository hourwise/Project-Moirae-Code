# ADR-XXXX: Adoption of the Fates Dual-Principal and Compatibility Contract

## Status

Superseded

Superseded on 2026-07-14 by
[ADR-XXXX: Moirae Code Host Enforcement for Dual-Principal MCP Delegation](./ADR-XXXX-dual-principal-host-delegation-and-compatibility.md).

## Context

This repository participates in the Fates ecosystem and is governed by the
canonical dual-principal identity, scoped delegation, standalone-operation,
and cross-runtime compatibility ADR maintained in
[Project Runtime Contracts](https://github.com/hourwise/project-runtime-contracts).

## Decision

This repository adopts the canonical ADR and shall:

- preserve separate user and agent identities;
- use shared Runtime Contracts types rather than redefining them;
- remain independently buildable and testable;
- declare supported protocol and sibling-runtime versions;
- prevent direct bypass of Ananke for governed actions;
- implement only the responsibilities assigned to this runtime;
- participate in cross-repository compatibility testing.

## Repository-specific responsibilities

Moirae Code is the user-facing IDE, local host, and integration surface for the
Fates ecosystem. It shall:

- present user, agent, task, approval, memory, evidence, audit, and runtime
  state without merging user identity with agent identity;
- supervise local runtime processes, service discovery, health reporting,
  compatibility checks, and explicit degraded-mode behavior without assuming
  Horae's orchestration authority;
- route governed actions through Ananke and treat Ananke as the final authority
  for policy, approval, and execution decisions;
- consume Mnemosyne memory as scoped, provenance-bearing evidence and never as
  current permission or action authority;
- use Horae for session and capability orchestration without moving policy
  authority into the IDE, supervisor, model broker, or adapters;
- broker model, tool, network, filesystem, Git, sandbox, and credential access
  through documented, least-privilege interfaces, without exposing
  unrestricted upstream credentials or execution handles to agents;
- own only Moirae-specific host, supervisor, packaging, update, extension, and
  presentation contracts, while importing shared cross-runtime contracts from
  Project Runtime Contracts;
- remain usable as a standalone repository through local mocks, adapters, and
  clear unavailable or degraded outcomes when sibling runtimes are absent; and
- maintain versioned compatibility declarations and pinned integration tests
  for supported Ananke, Mnemosyne, Horae, and Runtime Contracts releases.

## Verification

Compliance is verified through:

- standalone build and test CI;
- Runtime Contracts conformance tests;
- cross-repository compatibility review;
- pinned integration tests where applicable.
