---
id: vue-engineering
version: 2
layer: L3
domain: web
activate_when:
  dependencies: vue
conflicts: react-engineering, svelte-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 72
description: Vue SFC, reactivity, routing.
---

# Vue engineering

Keep reactivity local, explicit, and ownership-driven.

- Prefer `computed` for derived state; use watchers for external side effects, not routine derivation.
- Avoid destructuring reactive objects in ways that silently lose reactivity; use refs/toRefs where appropriate.
- Keep props immutable and emit intentional events or expose explicit model contracts for two-way state.
- Scope stores to genuinely shared application state; do not turn convenience into a global mutable graph.
- Clean up subscriptions, timers, observers, and async races created by component lifecycle.
- Use stable keys and preserve route/query state when it is part of user-visible navigation.
- Keep SSR/browser-only boundaries explicit in Nuxt or SSR setups.

Verify loading/error/empty states and navigation restoration, not just component rendering. Watch deep watchers, broad reactive objects, accidental recomputation, and mutation across ownership boundaries.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
