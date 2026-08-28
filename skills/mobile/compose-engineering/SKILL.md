---
id: compose-engineering
version: 2
layer: L3
domain: mobile
activate_when:
  stacks: android
phases: implementation, design
roles: implementer, designer
priority: 74
description: Jetpack Compose UI.
---

# Compose engineering

Build UI from state-down/events-up ownership.

- Hoist state only to the owner that coordinates it; keep durable screen state in lifecycle-aware holders and save only what must survive recreation/process death.
- Keep composables side-effect free except through dedicated effect APIs with correct keys and cleanup.
- Use stable semantic keys for lazy collections and avoid recreating expensive objects during recomposition.
- Collect observable state lifecycle-aware; prevent background collectors from surviving their owner.
- Respect edge-to-edge/insets, font scaling, TalkBack semantics, focus traversal, minimum touch targets, and reduced-motion expectations.
- Prefer immutable/stable models across UI boundaries and avoid passing mutable collections as implicit state channels.
- Separate navigation arguments/IDs from loaded domain state; validate deep-link inputs.

Use profiling/recomposition tools only when needed; do not prematurely annotate everything as stable. Verify previews/screens for loading, empty, error, large font, dark/high-contrast where applicable, and rotation/process recreation.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
