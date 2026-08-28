---
id: svelte-engineering
version: 2
layer: L3
domain: web
activate_when:
  dependencies: svelte
conflicts: react-engineering, vue-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 72
description: Svelte runes/stores and SSR.
---

# Svelte engineering

Use the framework's reactive primitives to express ownership, not hidden shared mutation.

- Prefer derived state over synchronization effects; keep effects limited to external systems.
- Keep shared stores/runes small and domain-owned. Do not make component-local state globally writable for convenience.
- Preserve stable identity for keyed collections when component state follows an entity.
- Clean up timers, subscriptions, observers, and external resources on lifecycle exit.
- Keep SSR-safe code free of unconditional browser globals and client-only side effects.
- Separate server-loaded/private data from values intentionally serialized to the browser.
- Treat form submission, progressive enhancement, navigation, loading, and error states as first-class behavior.

Avoid reactive loops and expensive broad recomputation. Verify production build/SSR path when used, plus representative user interactions and route state.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
