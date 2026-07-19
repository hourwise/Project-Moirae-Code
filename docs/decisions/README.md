# ADR Index

This index lists ADR-style documents currently present in the repository.

## Current ADRs

| ADR                                                                       | Status                            | Date       | Location                                                                                                                           | Notes                                                                                                                                        |
| ------------------------------------------------------------------------- | --------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-0001` Project Adrasteia Stage-A Host Boundary                        | Accepted                          | 2026-07-18 | [ADR-0001](./ADR-0001-project-adrasteia-stage-a-host-boundary.md)                                                                  | Immutable baseline adoption, trusted host context, inspection-only peers, proposal boundary, and explicit deferrals.                         |
| `ADR-XXXX` Moirae Code Host Enforcement for Dual-Principal MCP Delegation | Accepted — Implementation Pending | 2026-07-14 | [../ADR-XXXX-dual-principal-host-delegation-and-compatibility.md](../ADR-XXXX-dual-principal-host-delegation-and-compatibility.md) | Supersedes the Fates adoption ADR and defines host-specific enforcement responsibilities.                                                    |
| `ADR-XXXX` Fates Dual-Principal and Compatibility Contract                | Superseded                        | 2026-07-13 | [../ADR-XXXX-fates-dual-principal-and-compatibility-contract.md](../ADR-XXXX-fates-dual-principal-and-compatibility-contract.md)   | Superseded by the Moirae Code Host Enforcement ADR.                                                                                          |
| `ADR-XXXX` Content Preflight User Experience                              | Proposed                          | 2026-07-12 | [../ADR-XXXX-moirae-code-content-preflight-user-experience.md](../ADR-XXXX-moirae-code-content-preflight-user-experience.md)       | Defines user-visible inspection, exposure labels, approval scope, stale-state behavior, and Mnemosyne visibility for governed content access |

## Notes

- ADR identifiers remain placeholders until the repository adopts a numbering scheme.
- ADR files are currently stored at the `docs/` root rather than under `docs/decisions/`.
- This index does not reinterpret ADR status. It reports the status declared in the ADR itself.
