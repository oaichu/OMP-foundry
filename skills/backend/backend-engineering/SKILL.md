---
id: backend-engineering
version: 1
layer: L2
domain: backend
activate_when:
  stacks: backend
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 75
description: API contracts, authz, idempotency, jobs.
---

# Backend
Authorize every resource. Idempotent writes. Explicit errors.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
