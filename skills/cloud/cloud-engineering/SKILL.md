---
id: cloud-engineering
version: 1
layer: L2
domain: cloud
activate_when:
  stacks: cloud, cloudflare
phases: planning, implementation
roles: planner, implementer
priority: 70
description: Least privilege, blast radius, cost.
---

# Cloud
No wildcard IAM. Secrets in bindings, not source.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
