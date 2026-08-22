---
id: devops-engineering
version: 1
layer: L2
domain: devops
activate_when:
  files: Dockerfile, docker-compose.yml
phases: planning, qa
roles: planner, qa
priority: 65
description: CI, rollback, observability.
---

# DevOps
Rollback path before deploy. Logs have request ids.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
