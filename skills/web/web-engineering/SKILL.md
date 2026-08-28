---
id: web-engineering
version: 2
layer: L2
domain: web
activate_when:
  stacks: web
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 75
description: Web app structure, a11y, fetching, caching.
---

# Web engineering

Make server/client ownership, navigation, data freshness, and accessibility explicit.

- Prefer semantic HTML and native controls before ARIA. Preserve keyboard order, focus visibility, labels, landmarks, and reduced-motion behavior.
- Fetch data at the highest stable boundary that avoids waterfalls without overfetching. Define loading, empty, error, stale, and retry states.
- Cache by explicit ownership and invalidation rules; never cache authorization-sensitive responses under ambiguous keys.
- Keep URL/navigation state shareable when it represents user-visible location or filters.
- Avoid shipping secrets, server-only dependencies, or privileged policy to the browser.
- Bound client bundle cost and long tasks; lazy-load by meaningful interaction/route boundaries, not arbitrary component count.
- Treat hydration, offline/network transitions, duplicate submissions, and browser back/forward as real states.

Responsive behavior must preserve hierarchy and operability, not merely prevent overflow. Verify critical flows with keyboard and representative viewport states.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
