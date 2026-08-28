---
id: cloud-engineering
version: 2
layer: L2
domain: cloud
activate_when:
  stacks: cloud, cloudflare
phases: planning, implementation
roles: planner, implementer
priority: 70
description: Least privilege, blast radius, cost.
---

# Cloud engineering

Design cloud resources around least privilege, bounded failure, reproducibility, and cost visibility.

- Scope identities/roles to the exact resource/action; avoid wildcard permissions and shared long-lived credentials.
- Put secrets in managed bindings/stores and rotate without code changes. Separate environments/accounts/projects when blast radius requires it.
- Make infrastructure/config reproducible in source where possible; dashboard-only changes create drift.
- Define quotas, concurrency, timeout/retry/backoff, retention, regional/data residency, and egress/cost assumptions.
- Keep public exposure intentional: network ingress, object/storage access, admin endpoints, CORS, and service-to-service auth.
- Use health/readiness semantics that reflect dependency needs without creating restart loops.
- Plan rollback and backward compatibility for infra/schema/deployment transitions.

Observability must let operators answer what failed, for whom, where, and at what cost without leaking secrets/PII. Avoid distributed components when a simpler architecture meets the locked constraints.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
