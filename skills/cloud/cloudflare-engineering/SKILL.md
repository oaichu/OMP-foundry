---
id: cloudflare-engineering
version: 1
layer: L3
domain: cloud
activate_when:
  stacks: cloudflare
  files: wrangler.toml, wrangler.jsonc
phases: implementation, planning
roles: implementer, planner
priority: 73
description: Workers, bindings, no leaked secrets.
---

# Cloudflare
Bindings over env strings. Wait until I/O. No floating promises.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
