# Scoped credential delivery

Moirae now has a host-side lease boundary for the final credential delivery step:

1. A trusted host asks `SecretLeaseManager` for a short-lived lease over a service,
   account, and explicit destination scope.
2. The manager reads the raw value from the configured `SecretBroker` but returns only
   lease metadata.
3. `GuestWorkloadController` consumes the lease before invoking the constrained vsock
   callback. The raw value is present only in that one host-to-guest delivery frame.
4. The lease is not reusable after success, expiry, revocation, or a failed delivery.

The vsock channel accepts only `workload.start`, `workload.cancel`, and
`credential.deliver` outbound methods, with `workload.result`, `workload.error`, and
`credential.ack` responses. Every frame is bound to one session ID and one bounded
message size. The channel has no TCP/network fallback and does not authenticate based
on a message ID alone.

This is a portable host-boundary implementation, not Linux/KVM containment evidence.
The Firecracker profile still requires Linux x86_64, `/dev/kvm`, pinned artifacts, the
fixed host vsock endpoint, and a real guest agent before a production execution claim
can be made. The current tests use an injected transport to exercise identity, scope,
one-shot, timeout, and fail-closed behaviour without pretending to prove the host OS.
