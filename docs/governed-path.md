# Governed Path

This document traces the intended governed path through Moirae Code and distinguishes it from current bypasses. It uses repository evidence only.

## Evidence Sources

- [README.md](../README.md)
- [docs/ROADMAP.md](./ROADMAP.md)
- [docs/Moirae Code — proposed product blue.txt](./Moirae%20Code%20%E2%80%94%20proposed%20product%20blue.txt)
- [apps/moirae-core-extension/src/extension.ts](../apps/moirae-core-extension/src/extension.ts)
- [packages/provider-sdk/src/index.ts](../packages/provider-sdk/src/index.ts)
- [packages/runtime-contracts/src/results/index.ts](../packages/runtime-contracts/src/results/index.ts)
- [packages/supervisor/src/index.ts](../packages/supervisor/src/index.ts)
- [integrations/ananke-client/src/index.ts](../integrations/ananke-client/src/index.ts)
- [integrations/horae-client/src/index.ts](../integrations/horae-client/src/index.ts)
- [integrations/mnemosyne-client/src/index.ts](../integrations/mnemosyne-client/src/index.ts)
- [integrations/git/src/index.ts](../integrations/git/src/index.ts)

## Intended Path

| Step                                                    | Intended behavior                                                      | Current repo evidence                                                                                                                  | Current status                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1. User request enters Moirae UI                        | User starts a task in the Moirae extension or future chat surface      | Placeholder tree views exist in the first-party extension                                                                              | Scaffolded                              |
| 2. Session and runtime context are established          | Supervisor and IPC connect the extension to local runtimes             | Local IPC message types and supervisor config exist                                                                                    | Scaffolded                              |
| 3. Horae composes the session                           | Horae chooses profile, capabilities, and runtime composition           | Horae client methods exist; no service implementation exists here                                                                      | Blocked upstream                        |
| 4. Mnemosyne retrieves context                          | Task-specific context pack is requested from governed memory           | Mnemosyne client API surface exists; transport is `TODO`                                                                               | Blocked upstream and locally scaffolded |
| 5. Provider adapter receives prepared prompt            | Model provider gets normalized messages and tool definitions only      | `ModelProvider` contract explicitly says adapters receive prepared prompts, not direct filesystem, database, credential, or MCP access | Implemented at contract level           |
| 6. Model emits text or tool proposals                   | Provider returns `text`, `tool_call`, `done`, or `error` events        | `ModelEvent` is implemented; adapters emit normalized events                                                                           | Implemented and contract-tested         |
| 7. Horae converts tool proposal into governed operation | Tool proposal is shaped for approval and execution                     | Shared proposal and approval types are still missing upstream                                                                          | Blocked                                 |
| 8. Ananke evaluates authority                           | Policy engine allows, denies, or requests approval                     | Ananke client can call execute, approve, deny, and audit endpoints                                                                     | Client only                             |
| 9. Tool runner executes scoped action                   | Tool, Git, shell, or MCP action executes through a narrow broker       | [Sandbox adapter](../packages/sandbox-adapter/src/adapter.ts) validates config, selects mode by risk, and defines evidence contract; process spawning is stubbed. Git adapter remains placeholder-only. | Implemented at validation/contract level; execution stubbed |
| 10. Outcome is returned                                 | Execution produces typed outcome state and evidence                    | `OutcomeState` and `Outcome` are implemented in shared contracts                                                                       | Implemented at contract level           |
| 11. Mnemosyne updates governed memory                   | Eligible outcomes or source-backed facts are written or revalidated    | Mnemosyne client method signatures exist                                                                                               | Scaffolded                              |
| 12. UI shows evidence, approvals, and audit             | User inspects results, audit, evidence, and stale or invalidated state | UI component interfaces exist; extension UI is placeholder-only                                                                        | Scaffolded                              |

## Outcome States Available to the Path

The shared result contract already defines outcome states that the governed path is expected to use:

- `COMPLETED`
- `FAILED`
- `DENIED`
- `WAITING_FOR_APPROVAL`
- `APPROVAL_INVALIDATED`
- `STALE_STATE`
- `TIMED_OUT`
- `PARTIAL_SUCCESS`
- `CANCELLED`
- `COMPENSATION_REQUIRED`
- `DEGRADED`

These states are implemented in [packages/runtime-contracts/src/results/index.ts](../packages/runtime-contracts/src/results/index.ts) and covered by [tests/contract/runtime-contracts.test.ts](../tests/contract/runtime-contracts.test.ts). They are not proof that the full path emits all of them end to end today.

## What Is Actually Prevented Today

- Provider adapters do not accept direct filesystem, database, credential, or MCP handles through the provider SDK contract.
- Skill registry logic can block or flag dangerous skills before activation.
- Shared policy and result vocabularies exist so upstream runtimes can use consistent state names.

## What Is Planned but Not Yet Enforced

- End-to-end tool proposal interception by Horae and Ananke.
- Scoped execution via a tool or command broker.
- Governed Git routing for commit, diff, branch, and push operations.
- Governed terminal and shell execution.
- Governed memory retrieval and writeback through a live Mnemosyne transport.
- Content preflight approval flow tied to exact source, purpose, destination, and stale-state invalidation.

## Bypass Matrix

| Bypass surface                          | Prevented now | Planned control                                                                | Notes                                                            |
| --------------------------------------- | ------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Integrated terminal                     | No            | Sandbox and brokered command execution                                         | Current terminal remains outside the governed path               |
| Built-in Git UI or external Git clients | No            | Governed Git adapter behind Ananke                                             | Current Git adapter is placeholder-only                          |
| Third-party extensions                  | No            | Extension allow/deny policy, pinning, quarantine, protected-workspace controls | No enforcement code yet                                          |
| Debug adapters                          | No            | Restricted profiles or explicit marking                                        | No repo implementation yet                                       |
| Direct provider use outside Moirae      | No            | Provider selection and brokering through Horae                                 | Adapter packages alone do not prevent direct use                 |
| External CLIs                           | No            | Governed tool runner and command sandbox ([sandbox-adapter](../packages/sandbox-adapter/src/adapter.ts)) | Sandbox validation and mode selection implemented; process spawning stubbed |
| Direct file edits by the user           | No            | None; should be treated as outside the governed path                           | User action can invalidate prior approvals or memory assumptions |

## Open Questions

- Whether terminal activity can ever count as governed rather than merely audited or marked.
- Whether there is an intentional ungoverned mode for advanced users.
- Whether Git governance is mandatory for all Git surfaces or only for Moirae-initiated Git actions.
- How degraded-governance UX should look when Horae, Ananke, or Mnemosyne are unavailable.
