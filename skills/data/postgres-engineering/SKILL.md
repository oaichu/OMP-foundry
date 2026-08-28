---
id: postgres-engineering
version: 2
layer: L3
domain: data
activate_when:
  dependencies: pg, postgres, @prisma/client
phases: planning, implementation
roles: planner, implementer
priority: 76
description: Postgres anywhere.
---

# Postgres engineering

Use Postgres constraints and transaction semantics deliberately.

- Prefer primary/foreign keys, unique/check constraints, and correct nullability to application-only invariants.
- Inspect query plans for critical paths; index predicates/order/join keys that the shipped queries actually use.
- Select only needed columns on hot paths; avoid accidental row amplification and N+1 queries.
- Keep transactions short and define lock ordering for multi-row updates. Retry serialization/deadlock failures only when the operation is safe to retry.
- Use `FOR UPDATE`/advisory locks only when the invariant truly needs serialization; do not use locks as a substitute for idempotency.
- For multi-tenant data, enforce isolation at the strongest practical layer; RLS is appropriate when policy can be expressed and connection context is trustworthy.
- Migrate with expand-contract and avoid table rewrites/long locks on large production tables without a rollout plan.

Test unique/conflict races and migration compatibility, not only single-threaded CRUD.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
