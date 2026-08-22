---
id: data-engineering
version: 1
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

# Data
Expand-contract migrations. Index for the query you ship.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
