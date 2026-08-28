---
id: backend-engineering
version: 2
layer: L2
domain: backend
activate_when:
  stacks: backend
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 75
description: API contracts, authz, idempotency, jobs.
---

# Backend engineering

Design boundaries around explicit contracts and failure semantics.

- Validate input at ingress and authorize each resource/action after identity resolution.
- Make API errors stable and machine-readable; distinguish validation, authn, authz, conflict, missing resource, rate/resource limits, dependency failure, and internal faults.
- Define idempotency for retried writes, jobs, and webhooks. Persist the decision when duplicate side effects would be harmful.
- Bound request size, pagination, concurrency, retries, timeouts, and background work. Never let user input create unbounded fan-out.
- Keep transactions as small as the consistency invariant permits; define retry behavior for transient conflicts.
- Background jobs need ownership, deduplication, retry/backoff, poison handling, observability, and safe re-entry.
- Propagate cancellation/deadlines to downstream I/O where supported.

Do not leak stack traces, secrets, internal IDs, or cross-tenant data in errors/logs. Prefer boring explicit interfaces over hidden middleware behavior.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
