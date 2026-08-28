---
id: mobile-engineering
version: 2
layer: L2
domain: mobile
activate_when:
  stacks: mobile, android
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 75
description: Mobile lifecycle, offline, permissions.
---

# Mobile engineering

Design for lifecycle interruption, constrained resources, unreliable network, and platform policy.

- Persist durable user/work state needed after process death; keep ephemeral view state separate.
- Never perform blocking I/O on the main/UI thread. Cancel or detach work according to lifecycle ownership.
- Request permissions at the moment a feature needs them, explain purpose in UX, and handle deny/permanent-deny/revocation paths.
- Treat network as unavailable/slow/reordered. Define retry, offline, duplicate submission, and conflict behavior.
- Minimize background work, wakeups, location/sensor use, and battery/network consumption.
- Protect credentials and sensitive local data using platform facilities; do not log tokens/PII.
- Respect back navigation, deep links, rotation/configuration changes, accessibility, font scaling, and system insets.

Verify cold start, resume after kill, offline/reconnect, permission denial, and representative low-resource states for affected flows.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
