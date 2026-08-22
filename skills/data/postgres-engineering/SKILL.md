---
id: postgres-engineering
version: 1
layer: L3
domain: data
activate_when:
  dependencies: pg, postgres, @prisma/client
phases: planning, implementation
roles: planner, implementer
priority: 76
description: Postgres anywhere.
---

# Postgres
RLS or equivalent. No SELECT *. Migrations expand-contract.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
