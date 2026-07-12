# Extension Security Model

This document covers extension handling as evidenced by the current repository. It distinguishes implemented package contracts from proposed marketplace and isolation posture.

## Evidence Sources

- [apps/moirae-core-extension/package.json](../apps/moirae-core-extension/package.json)
- [apps/moirae-core-extension/src/extension.ts](../apps/moirae-core-extension/src/extension.ts)
- [packages/runtime-contracts/src/moirae/index.ts](../packages/runtime-contracts/src/moirae/index.ts)
- [packages/skill-registry/src/types.ts](../packages/skill-registry/src/types.ts)
- [packages/skill-registry/src/registry.ts](../packages/skill-registry/src/registry.ts)
- [packages/skill-registry/src/reticle.ts](../packages/skill-registry/src/reticle.ts)
- [docs/THIRD_PARTY.md](./THIRD_PARTY.md)
- [docs/Moirae Code — proposed product blue.txt](./Moirae%20Code%20%E2%80%94%20proposed%20product%20blue.txt)
- [tests/contract/skill-registry.test.ts](../tests/contract/skill-registry.test.ts)
- [tests/adversarial/skill-registry.test.ts](../tests/adversarial/skill-registry.test.ts)

## Scope Boundary

- The repository implements a governed skill registry for Moirae skills.
- The repository does not implement equivalent enforcement for ordinary VS Code extensions.
- The first-party Moirae extension is itself a normal VS Code extension scaffold and should not be treated as proof that broader extension governance is already in force.

## Current and Proposed Posture

| Posture                   | Meaning                                                            | Current repo evidence                                                                                                               | Current status                                                 | Bypass risk                                                                         |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Unrestricted              | Extension runs with normal editor privileges                       | Blueprint explicitly warns extensions generally have the same permissions as the editor; no enforcement code narrows them           | This is the practical current state for ordinary extensions    | Extension can bypass Moirae tool, network, filesystem, or credential routes         |
| Allowlisted               | Only listed publishers or extensions may run in protected contexts | `ExtensionPolicy.allowlistMode`, `allowedPublishers`, and `blockedPublishers` types exist                                           | Scaffolded as configuration types only                         | No repository code applies the policy to real extension installs                    |
| Trusted publisher         | Publisher reputation or trust status affects admission             | `ExtensionPolicy.requireSignature` and skill-registry publisher trust exist, but only skill registry enforces publisher trust today | Proposed for extensions; partially implemented for skills only | Ordinary extensions can still run without Moirae publisher trust enforcement        |
| Integrity-pinned          | Specific extension revisions are hash-bound or signature-bound     | `BundledExtension.hash`, `BundledExtension.signatureStatus`, and packaging metadata types exist                                     | Proposed                                                       | Extension updates can change behavior without Moirae-side verification in this repo |
| Capability-scoped         | Extension receives only declared capabilities                      | No extension capability-enforcement code exists                                                                                     | Designed only                                                  | Extension host APIs remain broad                                                    |
| Isolated                  | Extension runs in a constrained process or sandbox                 | VS Code extension-host separation exists upstream, but no extra Moirae isolation is implemented here                                | Designed only                                                  | Extension can still act with editor-equivalent privilege inside the host boundary   |
| Denied direct tool access | Extension cannot invoke tools except through governed APIs         | No repository code restricts non-Moirae extensions from using their own processes, HTTP calls, or editor APIs                       | Not enforced                                                   | Extension can bypass Ananke entirely                                                |

## Permission Classes and Current Evidence

| Permission area             | Current evidence                                                                                                                                                   | What is implemented                                    | What is not implemented                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------ |
| Network                     | [packages/network-broker/src/index.ts](../packages/network-broker/src/index.ts), [packages/policy-profiles/src/index.ts](../packages/policy-profiles/src/index.ts) | Shared policy vocabulary for outbound modes            | Per-extension network mediation                                    |
| Credentials                 | [packages/secret-broker/src/index.ts](../packages/secret-broker/src/index.ts)                                                                                      | Secret-broker interface and in-memory implementation   | Per-extension credential grants, brokered injection, or revocation |
| Filesystem                  | Blueprint and README require governed access paths                                                                                                                 | No extension-specific filesystem fencing               | Protected-workspace enforcement for extension file access          |
| Child processes             | `CommandSandboxConfig.allowChildProcesses` exists                                                                                                                  | Policy field only                                      | Extension-host child-process restrictions                          |
| Publisher and version trust | `ExtensionPolicy`, `BundledExtension`, skill trust states, Reticle scanner                                                                                         | Moirae skill trust lifecycle is implemented and tested | Equivalent extension install/update lifecycle is not implemented   |

## Skill Registry vs Extension Governance

The strongest implemented governance logic in this repository applies to Moirae skills, not generic VS Code extensions.

Implemented and tested for skills:

- Manifest schema validation.
- Reticle scanning with deterministic findings and verdicts.
- Trust states such as `unclassified`, `pending_review`, `trusted`, `flagged`, `blocked`, and `revoked`.
- Import, inspect, trust, install, pin, update, rollback, and outcome recording.

Not implemented for ordinary extensions:

- Comparable manifest enforcement.
- Comparable installation gates.
- Comparable runtime permission scoping.
- Comparable rollback, quarantine, or vulnerability response.

## Practical Model for the First-Party Extension

The first-party extension currently:

- activates on startup;
- contributes four tree views under the `moirae` container;
- shows placeholder messages when Mnemosyne, Ananke, or the supervisor are not connected.

It does not yet:

- implement a chat participant or custom webview chat surface;
- enforce extension policy over the rest of the editor;
- prove that approvals, evidence review, or content preflight are wired end to end.

## Claims This Repository Should Avoid

- That extensions are currently sandboxed beyond normal VS Code boundaries.
- That Microsoft Marketplace packages are governed by Moirae.
- That signature verification, version pinning, or quarantine is already enforced for editor extensions.
- That third-party extensions are denied direct tool, filesystem, network, or process access.

## Open Questions

- Default extension policy: should protected workspaces default to allowlist mode, first-party only, or another policy?
- Marketplace restrictions: current docs point to Open VSX and future self-hosting, but no implementation defines the exact install source rules yet.
- Version pinning vs negotiation: packaging metadata can pin bundled artifacts, but there is no extension update policy engine here.
- Update impact on trust: no repository code states whether extension updates revoke prior trust automatically.
- Capability scoping: the repository does not define a concrete capability model for ordinary extensions yet.
