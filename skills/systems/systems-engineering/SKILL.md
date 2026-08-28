---
id: systems-engineering
version: 2
layer: L2
domain: systems
activate_when:
  stacks: systems
  languages: rust, go
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 65
description: Concurrency, FFI, resource ownership.
---

# Systems engineering

Make ownership, concurrency, blocking, and resource lifetime explicit.

- Define which component owns memory, files, sockets, goroutines/tasks/threads, locks, and cancellation.
- Bound queues, buffers, retries, worker counts, and message sizes; backpressure must be intentional.
- Prefer message passing/immutable data when it simplifies races; when sharing mutable state, define lock/atomic ordering and invariants.
- Never hold locks across blocking/await operations unless the primitive and invariant explicitly require it.
- For FFI/unsafe code, document ownership, lifetime, thread-safety, alignment/layout, error conventions, and who releases resources.
- Handle partial reads/writes, EINTR/cancellation, shutdown, and dependency failure instead of assuming happy-path OS behavior.
- Profile before low-level optimization; preserve clarity around unsafe/concurrent boundaries.

Use race/thread sanitizers, Go race detector, Rust tooling, stress/property tests, or deterministic schedulers when relevant to the defect class.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
