---
id: embedded-engineering
version: 1
layer: L2
domain: embedded
activate_when:
  languages: c, rust
phases: planning, implementation
roles: planner, implementer
priority: 55
description: Timing, memory, hardware interfaces.
---

# Embedded
No unbounded alloc on hot path. State machines over threads.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
