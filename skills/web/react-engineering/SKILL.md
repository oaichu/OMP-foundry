---
id: react-engineering
version: 2
layer: L3
domain: web
activate_when:
  dependencies: react
requires: typescript-engineering
conflicts: vue-engineering, svelte-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 78
description: React composition, state, rendering cost.
---

# React engineering

Keep rendering pure and state ownership minimal.

- Derive values during render when possible; do not mirror props or computable data into effects/state.
- Put state at the lowest common owner that truly coordinates consumers. Separate server state, URL state, form state, and ephemeral UI state.
- Effects are for synchronization with external systems; every effect needs intentional dependencies and cleanup when it owns resources.
- Preserve component identity deliberately; use stable semantic keys, never array indexes for reorderable stateful lists.
- Memoize only measured expensive work or referential contracts; do not blanket `memo/useMemo/useCallback`.
- Keep context narrow and stable; avoid global providers for rapidly changing local data.
- In server-capable React, keep server components pure and introduce client boundaries only where interactivity/browser APIs require them.

Test user-visible behavior with realistic interaction rather than component internals. Watch stale closures, races between requests, duplicate submissions, and state reset caused by key/tree changes.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
