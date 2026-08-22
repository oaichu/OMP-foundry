---
id: typescript-engineering
version: 1
layer: L3
domain: web
activate_when:
  languages: typescript
  files: tsconfig.json
requires: 
phases: implementation, review
roles: implementer, reviewer
priority: 80
description: Strict TS, no any leakage, exact types at boundaries.
---

# TypeScript
No implicit any at public APIs. Discriminated unions over flags.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
