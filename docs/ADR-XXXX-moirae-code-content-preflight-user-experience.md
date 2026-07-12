# ADR-XXXX: Content Preflight User Experience in Moirae Code

- **Status:** Proposed
- **Date:** 2026-07-12
- **Decision owners:** Moirae Code maintainers
- **Applies to:** Moirae Code
- **Depends on:** Horae routing, Ananke decisions, Runtime Contracts receipt types

## Context

Content preflight must be understandable when files are blocked, truncated, redacted, downgraded, or refused for memory ingestion. A completely silent security layer would confuse users, while exposing detector internals would weaken protection.

## Decision

Moirae Code will present content preflight as a first-class inspection and approval experience.

The UI will show:

- source identity and trust class;
- detected type and size;
- structural facts;
- scanner status;
- high-level risk flags;
- exposure level;
- truncation, redaction, or field limits;
- approval state;
- stale receipt state;
- Mnemosyne eligibility.

Private lexicons, regexes, and detector rules remain hidden.

## Example Presentation

```text
README.md
✓ Known text format
✓ 18.4 KB
✓ No embedded objects
⚠ 2 instruction-like regions
Access: Selected content allowed
Memory: Eligible with provenance
```

```text
invoice.pdf
⚠ Embedded script detected
⚠ 14 external references
⚠ Source-controlled metadata removed
Access: Structural summary only
Memory: Not eligible
```

## Exposure Labels

| Contract value       | UI label          |
| -------------------- | ----------------- |
| `NONE`               | Blocked           |
| `DERIVED_ONLY`       | Structure only    |
| `SANITIZED_METADATA` | Sanitized details |
| `SELECTED_CONTENT`   | Selected content  |
| `FULL_CONTENT`       | Full content      |

## Approval Experience

Approval dialogs show:

- requested exposure;
- requesting agent/runtime;
- purpose and destination;
- relevant risk flags;
- stable source identity;
- exact fields, excerpt, or full-content scope;
- invalidation conditions.

Approvals must be specific. A vague “trust forever” option is not offered unless explicitly supported by policy.

## Stale-State Behaviour

After source mutation:

- previous approval is visibly invalidated;
- stale receipt remains historical only;
- agent access stops;
- re-scan and re-evaluation are offered.

## Progressive Disclosure

The user may move through:

1. structural summary;
2. sanitized metadata;
3. selected excerpt;
4. full content.

Each elevation remains subject to Ananke.

## Memory Visibility

Where Mnemosyne is enabled, show:

- ingestion eligibility;
- exposure surface used;
- truncation state;
- memories citing the source;
- stale effects after source change;
- exclusions caused by risk.

## Noise Control

- Informational: details only.
- Advisory: non-blocking badge.
- Restrictive: warning and downgraded access.
- Approval required: explicit action.
- Blocking: denial or quarantine.

The UI must avoid presenting weak signals as certainty.

## Security Boundaries

Do not expose complete keyword lists, detector regexes, private scanner configuration, hidden policy exceptions, or redacted sensitive content.

## Consequences

### Positive

- Makes security decisions understandable.
- Reduces confusion around partial access.
- Exposes provenance and stale state clearly.
- Supports controlled escalation.

### Negative

- Adds UI complexity.
- Requires careful wording and accessibility work.
- Approval prompts may interrupt workflows.

## Acceptance Criteria

- File views display status and exposure level.
- Approval dialogs bind to exact source, destination, purpose, and scope.
- Changed files invalidate approvals visibly.
- Provenance is inspectable without exposing detector internals.
- Mnemosyne eligibility and stale-memory effects are visible.
- Status is not communicated by colour alone.
