---
id: react-engineering
version: 1
layer: L3
domain: web
activate_when:
  dependencies: react
requires: typescript-engineering
conflicts: vue-engineering, svelte-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 78
description: React composition, state, rendering cost.
---

# React
Lift state only when shared. Memo when measured. Server components stay pure.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
