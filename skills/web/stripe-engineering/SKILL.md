---
id: stripe-engineering
version: 1
layer: L4
domain: saas
activate_when:
  dependencies: stripe
phases: implementation, review
roles: implementer, reviewer
priority: 64
description: Stripe webhooks and idempotency.
---

# Stripe
Verify signatures. Idempotent webhook handlers.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
