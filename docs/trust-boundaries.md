# Trust Boundaries

This document describes what Moirae Code currently governs, what remains outside governance, and which controls are only planned. It is intentionally conservative: it does not describe proposed controls as present-day enforcement.

## Evidence Sources

- [README.md](../README.md)
- [docs/ROADMAP.md](./ROADMAP.md)
- [docs/THIRD_PARTY.md](./THIRD_PARTY.md)
- [docs/Moirae Code — proposed product blue.txt](./Moirae%20Code%20%E2%80%94%20proposed%20product%20blue.txt)
- [apps/moirae-core-extension/src/extension.ts](../apps/moirae-core-extension/src/extension.ts)
- [packages/network-broker/src/index.ts](../packages/network-broker/src/index.ts)
- [packages/policy-profiles/src/index.ts](../packages/policy-profiles/src/index.ts)
- [packages/secret-broker/src/index.ts](../packages/secret-broker/src/index.ts)
- [integrations/git/src/index.ts](../integrations/git/src/index.ts)
- [integrations/mnemosyne-client/src/index.ts](../integrations/mnemosyne-client/src/index.ts)
- [tests/adversarial/prompt-injection.test.ts](../tests/adversarial/prompt-injection.test.ts)

## Boundary Matrix

| Surface                                      | Current repo evidence                                                                                          | What Moirae or Ananke control now                                           | What remains outside governance today                                                                       | Required posture from existing docs                                                                 | Status                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| VS Code terminal and shell tasks             | Mentioned in README and blueprint; no terminal interception code in repo                                       | No direct control in repository code                                        | A user or extension can still use the editor terminal outside the governed path                             | Broker, sandbox, classify, and mark terminal execution before trusting it as governed               | Designed only                                  |
| Debug adapters and launch configurations     | VSCodium and debugger are listed as host features in [docs/THIRD_PARTY.md](./THIRD_PARTY.md)                   | No Moirae control implemented                                               | Debugger-driven filesystem, process, and network activity sits outside current Moirae enforcement           | Mark as outside governance unless explicitly brokered or disabled in restricted modes               | Designed only                                  |
| Direct filesystem APIs in the extension host | First-party extension is a normal VS Code extension; blueprint notes extensions are highly privileged          | No repository code fences filesystem APIs by extension or policy profile    | Any extension-host code can access normal editor APIs                                                       | Restrict, broker, or disable direct filesystem actions in protected workspaces                      | Not enforced                                   |
| Built-in Git UI and direct `git` CLI         | Git adapter exists only as placeholder; README and blueprint treat governed Git as future work                 | No current Git governance path exists in repo code                          | Built-in Git UI, external Git clients, and terminal Git remain outside Moirae governance                    | Route Git operations through typed governed adapters or clearly mark them as ungoverned             | Not enforced                                   |
| Third-party extensions                       | Extension policy types exist, but no enforcement code does                                                     | None beyond documentation intent                                            | Third-party extensions retain ordinary editor privileges                                                    | Use allow/deny policy, signature checks, pinning, quarantine, and restricted-workspace behavior     | Designed or scaffolded only                    |
| First-party Moirae extension                 | Placeholder tree views exist                                                                                   | Can present Moirae status placeholders only                                 | It does not yet establish a governed path for chat, approvals, or evidence                                  | Treat as UI scaffold, not as proof of enforcement                                                   | Scaffolded                                     |
| Embedded MCP clients                         | Mnemosyne client API exists, but transport is `TODO`; other MCP execution surfaces are not present             | No live MCP governance is running from this repo                            | External MCP processes and direct MCP servers can still exist outside Moirae                                | Run each MCP server in isolated processes and route tool use through governed execution             | Designed only                                  |
| Direct provider HTTP access                  | Provider adapters perform direct `fetch` calls                                                                 | Adapter contract limits inputs to prepared prompts and tool definitions     | Caller-owned credentials, retry policy, redaction, and transport governance are not centrally enforced here | Broker credentials, constrain network policy, and intercept tool proposals before execution         | Implemented but only at adapter-contract level |
| External CLIs and child processes            | Supervisor spawn path is stubbed; policy profiles define `allowChildProcesses`, but no enforcement code exists | No current generic subprocess governance                                    | Any CLI launched outside future tool runners bypasses Moirae                                                | Sandbox, cap output, restrict working directory, and limit child processes                          | Designed only                                  |
| Browser and outbound network access          | Network broker types and policy profiles exist; no enforcement implementation found                            | No live broker enforcement in repo code                                     | Extensions, tools, terminals, and local processes can still reach the network directly                      | Use brokered modes such as `blocked`, `loopback_only`, `provider_endpoints`, and `approved_domains` | Scaffolded                                     |
| Local credentials                            | Secret-broker interface and in-memory implementation exist                                                     | Storage rules are documented; no product-wide injection path is implemented | Provider constructors currently accept API keys directly, so key ownership is unresolved                    | Use OS keychain-backed brokering and avoid repo, chat, and audit storage                            | Scaffolded                                     |
| Local model servers                          | `llama-cpp` adapter is local and loopback-only by manifest; OpenAI-compatible can also target local endpoints  | Manifest metadata can express locality and loopback intent                  | No repository code proves local-only execution beyond adapter configuration                                 | Mark local-model routing explicitly and avoid overstating isolation guarantees                      | Implemented but not host-enforced              |

## What Can Bypass Governance Today

- Manual use of the integrated terminal.
- Built-in Git UI and external Git clients.
- VS Code debug adapters and tasks.
- Third-party extensions with ordinary editor privileges.
- Any provider, CLI, or local server invoked outside future governed brokers.
- Direct edits, file writes, or process launches performed by the user or another extension outside the Moirae path.

## What This Repo Can Honestly Claim

- Provider adapters are designed to receive prepared prompts rather than direct filesystem, database, credential, or MCP access.
- Tool manifests, policy profiles, network modes, and secret-broker interfaces define the intended control vocabulary.
- Adversarial tests document several misuse patterns that future enforcement must detect or reject.

## What This Repo Cannot Yet Claim

- That terminal execution is governed.
- That Git always routes through Ananke.
- That all filesystem or network access is sandboxed.
- That extensions are allowlisted, pinned, isolated, or permission-scoped in practice.
- That local models are automatically private beyond their configured endpoint and locality metadata.
- That degraded-governance UX is consistently surfaced in the product.

## Open Questions

- Terminal governance: should the integrated terminal ever be treated as governed, or only as an explicitly marked bypass surface?
- Debug adapters: should protected workspaces disable launch configurations that can mutate host state?
- Intentional ungoverned mode: no repository evidence currently defines whether such a mode exists.
- Child-process rights: policy-profile types define `allowChildProcesses`, but the enforcement boundary and owner are unresolved.
- Degraded-governance UX: supervisor events can represent degraded state, but the user-facing fallback behavior is not implemented.
- Network exceptions: no repository code defines how emergency or user-approved exceptions should be represented or audited.
