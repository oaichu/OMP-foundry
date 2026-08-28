---
id: data-engineering
version: 2
layer: L2
domain: data
activate_when:
  stacks: saas
  dependencies: pg, postgres
phases: planning, implementation
roles: planner, implementer
priority: 68
description: Schema, indexes, migrations.
---

# Data engineering

Model invariants in schema and migration strategy, not only application code.

- Define ownership, keys, uniqueness, nullability, lifecycle, retention, and tenant isolation for persisted entities.
- Choose indexes from actual access paths and cardinality; every index has write/storage cost.
- Use expand-migrate-contract for live schema evolution when old and new code may overlap.
- Make backfills resumable, bounded, observable, and safe to retry. Avoid one giant transaction for large data movement.
- Preserve provenance/time semantics explicitly where ordering/audit matters.
- Bound queries and pagination; avoid offset pagination at unbounded scale when stable cursors are required.
- Keep derived/cache data reconstructible unless the plan makes it authoritative.

For destructive changes, define rollback or explain why rollback is impossible and how recovery works. Verify migration on representative old data plus new-code reads/writes.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
