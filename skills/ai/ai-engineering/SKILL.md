---
id: ai-engineering
version: 1
layer: L2
domain: ai
activate_when:
  dependencies: openai, ai
phases: planning, implementation
roles: planner, implementer
priority: 60
description: Eval, prompt isolation, no secret leakage to models.
---

# AI
Untrusted model output. Never put secrets in prompts.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
