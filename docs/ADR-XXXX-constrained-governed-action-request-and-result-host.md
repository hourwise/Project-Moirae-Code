# ADR-XXXX: Constrained Governed Action Request and Result Host

## Status

Proposed — design evidence only. This ADR does not implement a host surface or activate FATES-SLICE-002.

## Context

The locked Stage-A host at a4783db271a61848c66ac4f6652a539bdb515e28 is inspection-only. Its Ananke mutation methods and Horae session methods fail closed, and the extension merely renders inspection tree views. Those are correct current boundaries, but no surface can originate and receive the candidate governed action:

~~~text
fates.slice02.inspect-fixed-fixture.v1
~~~

The proposed Slice 02 topology is separate local processes over loopback HTTP. This ADR defines the only Moirae-facing participant: a test-only or equivalently narrow constrained host that calls Horae, never Ananke directly.

## Proposed decision

A future implementation may add a separate constrained Slice 02 host command or surface. It is not a general extension capability, terminal, IPC service, provider adapter, shell, or fixture reader. It may issue only:

~~~json
{
  "action": "fates.slice02.inspect-fixed-fixture.v1",
  "arguments": {
    "fixtureId": "fates.slice02.fixed-fixture.v1",
    "expectedSha256": "<64 lowercase hexadecimal characters>"
  }
}
~~~

The host accepts no path, URI, command, arbitrary action, additional action argument, environment-derived fixture location, or model-supplied identity. It holds no fixture path, cannot open the fixture locally, and has no Ananke execution client or fallback. Its one outbound action route is the admitted Horae local HTTP handoff.

## Host identity, origin, and route verification

The constrained host obtains its authenticated host/service principal and separate acting-agent principal from a trusted local host boundary or harness launch configuration, never from model text or action JSON. It constructs one initiating correlation ID per request and preserves it unchanged through its request/result presentation.

Before it sends the request, the host must verify the expected Horae route using the separately configured loopback endpoint and a fresh inspection record. It requires:

- expected runtime name Horae, instance/endpoint receipt, and artifact/checkpoint identity;
- protocol compatibility with the fixed Stage-A range;
- fresh healthy and ready status within the Horae ADR's 1,000 ms bound;
- the exact Slice 02 handoff capability/action identity;
- the expected request schema ID and SHA-256 receipt.

The host records its own Moirae origin identity, instance, artifact/checkpoint identity, schema receipt, and initial correlation. Horae retains that origin and adds its own route identifiers. The host does not decide policy, claim Ananke authority, or rewrite the returned decision/outcome.

## Expected presentation

The result surface must present, as typed data rather than inferred status:

- requested action and the two accepted arguments;
- Horae route state and route/event identifiers;
- Ananke decision identity/status and typed outcome/result;
- fixture identifier and expected/actual digest when Ananke returned one;
- initiating correlation and distinct Moirae, Horae, and Ananke producer identifiers;
- explicit limitations and the route-specific bypass claim.

A direct Ananke connection, local fixture read, unknown action, malformed/expanded argument set, absent/stale/incompatible Horae inspection, timeout, or malformed origin/schema record fails closed. There is no automatic retry, direct-Ananke fallback, provider fallback, or alternate IPC route.

## Harness and bypass boundary

The Slice 02 harness must disable or prove absent for the constrained host process:

| Surface | Required Slice 02 posture |
| --- | --- |
| Direct Ananke action client | Not linked/configured; failure is reported, never fallback. |
| Fixture path/file access | Not supplied to the host; direct access attempt is a test failure. |
| Provider/network route | No provider configuration and no external network; assert zero calls. |
| Shell, terminal, task runner, child process | Not exposed by the constrained host process. |
| Arbitrary IPC or package imports | No generic IPC method or sibling-runtime direct import is used. |
| Environment substitution | No action/location value may be resolved from environment input. |

The following remain explicitly **outside the Slice 02 claim**, not silently governed: the ordinary VS Code terminal, tasks, debugger, extension host APIs, built-in Git, third-party extensions, external CLIs, direct provider use outside the constrained host, and other SDK routes. The host must render that limitation as part of test evidence.

## Failure and cancellation semantics

Before it receives a valid Horae dispatch/relay result, the host reports Horae's typed unavailable, stale, incompatible, malformed, timed_out, or indeterminate state without converting it into Ananke denial. An Ananke denial is displayed as Ananke denial, not as a Moirae error.

Cancellation is minimal. The host may cancel a request only before Horae confirms dispatch; once dispatched it records either the authoritative typed relay or Horae's timeout/indeterminate result. It does not assume a canceled request prevented an Ananke read, and it does not retry.

## Acceptance tests before implementation approval

The future implementation plan must define tests for:

1. positive constrained request and typed result presentation through Horae;
2. unsupported action and extra-argument rejection before dispatch;
3. proof that direct Ananke fallback is prohibited;
4. proof that the tested route cannot read the fixture from Moirae;
5. stale, unavailable, incompatible, and endpoint-identity-drift Horae refusal;
6. initiating-correlation preservation and distinct producer identifiers;
7. exact rendered Ananke decision/outcome versus Horae route state;
8. bypass limitation reporting and a zero provider/network assertion.

Mocks may cover host rendering but cannot stand in for the three-runtime route evidence.

## Consumer checkpoint and handoff

Before Integration may run final proof, Moirae Code must provide a clean, pushed, green checkpoint; exact host artifact/checkpoint identity; expected Horae route identity; host-origin/schema/correlation evidence; test report; disabled-harness surfaces; explicit global limitations; and a handoff packet naming the exact Horae and Ananke checkpoints consumed.

## Consequences and exclusions

This ADR does not make Moirae Code globally governed. It does not approve terminal, task, debugger, extension, Git, shell, provider, browser, credential, sandbox, workflow, persistence, retry, compensation, remote OAuth, MCP 2026, memory, or content-preflight work. No Project Adrasteia type, package version, or protocol change is required by this host design.
