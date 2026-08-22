---
id: nextjs-engineering
version: 1
layer: L3
domain: web
activate_when:
  dependencies: next
  files: next.config.ts, next.config.mjs, next.config.js
requires: react-engineering, typescript-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 82
description: App Router, cache, server/client split.
---

# Next.js
Default server. Mark client only for interactivity. No accidental static leaks of secrets.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
