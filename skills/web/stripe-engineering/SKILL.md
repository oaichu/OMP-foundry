---
id: stripe-engineering
version: 2
layer: L4
domain: saas
activate_when:
  dependencies: stripe
phases: implementation, review
roles: implementer, reviewer
priority: 64
description: Stripe webhooks and idempotency.
---

# Stripe engineering

Treat Stripe as an external source of signed events, not as a synchronous extension of local state.

- Verify webhook signatures against the raw request body before parsing/transformation.
- Make event handling idempotent using event IDs or a domain idempotency key persisted with the resulting state transition.
- Expect duplicate, delayed, and out-of-order events; derive transitions from current authoritative state rather than arrival order alone.
- Keep secret keys server-side and scope restricted keys where possible. Never trust client-provided price, amount, subscription, or customer ownership.
- Link Stripe objects to local tenant/user ownership explicitly and re-check that mapping on privileged actions.
- Separate checkout/session creation from fulfillment; fulfill only from verified server-side state/event evidence.
- Record enough event/transition metadata for reconciliation without logging payment secrets or sensitive payloads unnecessarily.

Test duplicate delivery, invalid signature, stale event, partial failure, and retry behavior for changed flows.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
