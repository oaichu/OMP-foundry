---
id: systems-engineering
version: 1
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

# Systems
Ownership explicit. No data races. Unsafe is reviewed.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
