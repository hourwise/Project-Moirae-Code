# ADR-XXXX: Constrained Governed Action Request and Result Host

## Status

Proposed — design evidence only. This ADR does not implement a host surface or activate FATES-SLICE-002.

Clarified on 2026-08-09: design evidence only; no host surface is implemented,
FATES-SLICE-003A is not activated, and the Slice 02 compatibility lock is
unchanged.

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

## Pre-003A architecture clarification

This ADR remains design-only. The clarification below does not activate
FATES-SLICE-003A and does not change the Slice 02 compatibility lock, matrix,
snapshot, seal, or active-slice state.

The locked compatibility Moirae checkpoint
`a4783db271a61848c66ac4f6652a539bdb515e28` and the separate constrained-host
design checkpoint `bc48c25a1a5f793d69f38b3a7a2c05e50c9427d6` are different
references. The latter is the design lineage for this clarification; it is not
the compatibility lock and does not constitute an implemented host.

The existing Moirae security documents do not treat the IDE, renderer, or
ordinary extension host as a containment boundary. Any acceptance record that
does so is invalid. UI presentation, process-origin evidence, route evidence,
and OS/runtime containment are separate claims.

The future 003A proof must name the following properties independently. A
positive result for one property is not evidence for any other property.

| Property | What it means | What it does not mean |
| --- | --- | --- |
| Process-origin identity | Evidence that the intended Moirae host process, host instance, artifact, and launch/registration boundary initiated the request, with a correlation that is not model-supplied. | It does not prove that the process is contained, authoritative, credential-free, or impossible to bypass. |
| Governed route | Evidence that the request traversed the admitted Moirae -> Horae -> canonical Ananke -> authorized producer/effect boundary -> Horae -> Moirae path. | It does not prove that another process, extension, terminal, child, provider, or network path cannot produce an equivalent effect. |
| OS/runtime containment | Enforcement below the model and application layer that limits filesystem, process, syscall, network, environment, device, IPC, and host-resource access to the declared profile. | It cannot be inferred from an IDE window, a host name, a loopback address, an allowlist, or a process receipt. |
| Credential isolation | Raw credentials are inaccessible to the model-controlled process; a narrowly scoped operation, capability, or opaque reference is resolved only at the trusted effect boundary. | It does not follow from hiding a value in UI state, environment variables, Horae, Mnemosyne, or a model prompt. |
| Bypass resistance | Within a declared threat model, equivalent consequential effects cannot be obtained through an ungoverned alternate path, or the attempt is denied and evidenced. | It is stronger than route/origin proof and is not claimed by 003A. |

For 003A, the first two properties are the intended proof boundary. The last
three remain explicit nonclaims until a separate containment and credential
design is implemented and adversarially tested.

## Trust boundary and TCB model

The architecture has two orthogonal planes rather than one trust stack:

~~~text
[UI / IDE / renderer / ordinary extension / model-controlled execution]
  untrusted presentation and execution surface; not containment
                              |
                              v
[Moirae constrained host]
  narrow origin and route participant; no Ananke authority
                              |
                              v
[Horae]
  fresh discovery, composition, lifecycle, and typed relay; not authority
                              |
                              v
[Ananke]
  policy, approval, action authority, credential-bound effect boundary
                              |
                              v
[authorized producer / protected service]

Containment plane for a future profile:
[model-controlled process] -- OS/runtime enforcement --> [brokered capabilities/effects]
~~~

The model, prompt, renderer, ordinary extensions, terminal/tasks/debugger,
and model-controlled child processes are untrusted. They may request a
declared action, but they cannot establish identity, widen arguments, approve
an effect, or turn a descriptive receipt into containment. Runtime Contracts
can provide schema-valid neutral shapes; they do not become the authority
boundary.

For the 003A route/origin claim, the evidence TCB is limited to the trusted
launch/origin evidence, the constrained host's fixed validation, Horae's fresh
inspection and relay evidence, Ananke's canonical authority/effect boundary,
and the pinned structural contracts used to join the records. A UI is not in
that TCB merely because it renders the evidence.

For a future containment claim, the TCB must additionally include the target
OS/runtime or hypervisor enforcement and the trusted capability/credential
broker. A compromised host or model process must not be able to remove those
controls, mint a capability, or obtain a raw credential. This is a design
requirement for 003B, not a current property of Moirae Code.

## Exact 003A proof boundary and nonclaims

Subject to a separately activated owner scope, 003A may claim only that its
tested constrained host:

- is a real, independently running Moirae-side process with the intended
  artifact, host instance, and process-origin evidence;
- accepts only the fixed action and fixed argument schema;
- reaches the expected Horae route rather than a direct Ananke client;
- observes fresh Horae identity, endpoint, protocol, readiness, and handoff
  evidence before dispatch;
- reaches the canonical Ananke decision and the authorized harmless producer
  exactly once through the tested route;
- preserves correlation and distinct producer identities through the typed
  result; and
- has no fixture-read API, provider route, direct-Ananke fallback, retry, or
  alternate IPC route in the tested host surface.

003A must not claim any of the following:

- host-wide filesystem, network, shell, raw-socket, subprocess, environment,
  device, IPC, or operating-system containment;
- credential isolation from the model-controlled process or from ordinary
  extensions, terminals, child processes, or provider libraries;
- malicious or ordinary extension containment;
- OS-level prevention of a direct Ananke invocation outside the tested host;
  or
- full local-machine security, global Moirae governance, or bypass resistance
  beyond the exact tested route.

Every future acceptance packet should report the five properties as separate
evidence labels, for example `process-origin: proven`, `governed-route:
proven`, `os-containment: not-claimed`, `credential-isolation: not-claimed`,
and `bypass-resistance: not-claimed`. These are evidence vocabulary, not a
request to change a Runtime Contracts schema.

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

## Future 003B boundary (not implemented)

003B is a future host-containment and bypass-resistance slice. It is not
activated by this ADR and has no implementation checkpoint. Its objective is
to show that a model-controlled process cannot obtain a protected effect or a
raw credential except through the declared capability and Ananke authority
boundary, within one named platform profile and threat model.

The first implementation profile should be one platform at a time. A Linux
restricted-process profile is a candidate because it can combine kernel-level
filesystem and syscall controls with process/resource isolation, but selecting
Linux first remains an owner decision. A 003B result on one platform must not
be presented as a cross-platform result.

The minimum attack and proof classes are:

| Class | Required negative evidence |
| --- | --- |
| Direct authority bypass | A process attempts a direct Ananke call, alternate local endpoint, alternate IPC, or a forged route receipt; the attempt is denied and cannot create an effect. |
| Filesystem and secret access | Attempts to read outside the declared workspace/profile, host configuration, credential stores, environment exports, or mounted secrets fail. |
| Process and syscall escape | Attempts to spawn an unauthorized shell, interpreter, debugger, helper, or child that escapes the profile fail or remain inside the enforced profile. |
| Network and service escape | Raw sockets, arbitrary egress, local-daemon access, metadata endpoints, and unapproved provider/service routes fail. |
| Extension and host escape | Ordinary extension, terminal, task, debugger, or browser paths are shown either outside the claimed profile or denied by an independently enforced boundary. |
| Credential misuse | No raw credential is present in the model-controlled process; only an approved opaque operation reaches the trusted broker/effect boundary. |
| Lifecycle and evidence | Kill, timeout, restart, stale identity, endpoint drift, and partial-result cases fail closed without retrying an unknown effect; evidence preserves principal, route, and correlation distinctions. |

The acceptance method must test the controls on the target OS/runtime rather
than infer them from a mode flag, configuration object, UI, or process receipt.

## Cross-platform enforcement strategy and technology assessment

Portable semantics are the invariant: deny undeclared capabilities, keep raw
credentials out of the agent process, route consequential effects through
Ananke, preserve provenance/correlation, and fail closed on identity or policy
drift. Enforcement is platform-specific. The project must not claim that a
portable TypeScript interface is itself an OS boundary.

The following is a design-time classification only. It selects no dependency,
does not change the sandbox adapter, and does not choose Firecracker or gVisor
merely because either is a strong isolation technology.

| Primitive or project | Classification | Architectural assessment |
| --- | --- | --- |
| Linux Landlock | **EMBED** candidate | A future Linux profile can embed Landlock rules for path-oriented restrictions. The kernel documentation describes Landlock as an unprivileged, additive restriction mechanism; it is one layer, not the complete host boundary. [Linux Landlock](https://www.kernel.org/doc/html/latest/security/landlock.html) |
| Linux seccomp | **EMBED** candidate | A future profile can embed a carefully reviewed syscall policy as a narrowing layer. Seccomp reduces syscall exposure but the kernel documentation explicitly does not treat it as a complete sandbox. [Linux seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html) |
| Rootless containers | **WRAP** candidate | A rootless container runtime can wrap the process with user-namespace and runtime isolation. Docker documents that both daemon and container run without root in rootless mode, but its filesystem, cgroup, networking, mounts, and runtime configuration still require profile-specific proof. [Docker rootless mode](https://docs.docker.com/engine/security/rootless/) |
| gVisor | **STUDY** | gVisor inserts an application-kernel boundary and can be used by a container runtime, but its compatibility, deployment, and threat-model fit must be proven for the intended local profile. No selection is made. [gVisor documentation](https://gvisor.dev/docs/) |
| Firecracker | **STUDY** | Firecracker offers a microVM boundary with layered process and host controls, but the operational cost, image/runtime model, local desktop fit, and capability brokerage are unresolved. No selection is made. [Firecracker design](https://github.com/firecracker-microvm/firecracker/blob/main/docs/design.md) |
| Windows AppContainer | **STUDY** | AppContainer is a candidate Windows resource boundary with capability-controlled file, process, device, and network access. The exact packaged/unpackaged launch and IPC model must be tested for a desktop host. [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) |
| Windows Job Objects and restricted process tokens | **STUDY** | Job Objects are useful for process-tree lifecycle and resource controls, but they are not sufficient alone for the full security claim. Windows documents that security limitations are applied to each associated process, and breakaway behavior must be tested. [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [job security limits](https://learn.microsoft.com/en-us/windows/win32/procthread/job-object-security-and-access-rights) |
| macOS App Sandbox | **STUDY** | Entitlements can restrict files, network connections, and other resources, but the profile must verify helper/CLI inheritance, user-selected file access, IPC, and any exceptions. It is not evidence for arbitrary external processes. [Apple App Sandbox](https://developer.apple.com/documentation/security/app-sandbox) |
| Anthropic Sandbox Runtime | **STUDY** | This is a directly relevant agent-oriented wrapper that combines platform mechanisms and policy for filesystem/network restrictions. Its project documents platform differences and an alpha Windows implementation; it is useful comparative evidence, not a dependency or authority boundary for the Fates. [sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime) |
| Kubernetes Agent Sandbox | **DEFER** | This project is an orchestration API and explicitly delegates low-level isolation to runtimes such as gVisor or Kata. It is not a local desktop containment primitive for Moirae. [Agent Sandbox](https://github.com/kubernetes-sigs/agent-sandbox) |

Linux, Windows, and macOS therefore require separate enforcement profiles and
separate acceptance matrices. Windows may be harder to make equivalent because
identity, package/capability declarations, process-tree membership, IPC, and
desktop integration are distinct controls. macOS likewise requires explicit
entitlement and helper-process testing. These are reasons to keep portable
semantics separate from platform-specific proof, not reasons to weaken the
claim.

## Credential boundary and development workflows

The intended information flow is:

~~~text
[model-controlled agent]
    -> opaque capability / operation reference only
[Moirae host and Horae transport]
    -> reference and route evidence only; no raw credential
[Ananke authority + trusted credential broker]
    -> resolve and inject just in time at the effect boundary
[authorized producer / protected service]
~~~

The sandboxed agent must not receive a provider token, signing key, cookie,
keychain export, or long-lived bearer credential. Moirae may enforce the local
process boundary, but it must not become a second policy authority. Horae
carries opaque references and lifecycle evidence. Mnemosyne carries
non-secret provenance and must not become a secret store. Ananke, or a broker
explicitly owned by the Ananke authority boundary, resolves and injects the
credential for the exact approved operation.

A developer workflow that requires a local model or provider credential is a
separate development or unmanaged profile. It must be disclosed as outside
003A/003B credential-isolation claims, must not be used as evidence for a
governed consequential action, and must not silently turn an environment
variable or project file into an agent capability. No such workflow is
implemented by this ADR.

## Rule-of-Two and information-flow interaction

Containment can remove a sensitive-data or external-communication capability,
or force a trusted broker/mediator, but it cannot make model-generated content
trusted and cannot by itself satisfy the Rule of Two. A session combining
untrusted input, sensitive data, and external state change still needs a
verifiable reduction, independent mediation/containment, or supervision.

The ownership boundary remains:

- Moirae declares the host capabilities and reports the independently verified
  containment profile and its limitations;
- Horae composes capabilities, freshness, lifecycle, route, and safe
  transitions without becoming the authority;
- Ananke evaluates purpose, identity, policy, approval, destination, and the
  final action/declassification decision;
- Mnemosyne preserves source, claim, transformation, and destination
  provenance, never authority; and
- the model cannot satisfy Rule-of-Two or information-flow requirements by
  asserting a label, capability, or safety result.

This ADR adds no Rule-of-Two or information-flow implementation and no
Runtime Contracts fields. It records the future interaction so that a 003B
profile cannot be mistaken for a policy or provenance implementation.

## 003A activation gate

This clarification is the design prerequisite for any future 003A activation.
Activation would require a new owner-approved scope, an implemented Moirae
host, fresh cross-process evidence, and the acceptance tests already listed in
this ADR. Until that happens, the compatibility lock remains the separate
`a4783db271a61848c66ac4f6652a539bdb515e28` reference, the current design
lineage remains `bc48c25a1a5f793d69f38b3a7a2c05e50c9427d6`, and no tag or sealed
Slice 02 artifact is changed.

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
