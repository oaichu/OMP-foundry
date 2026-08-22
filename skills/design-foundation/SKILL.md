---
id: design-foundation
name: design-foundation
version: 1
layer: L1
domain: design
phases: design
roles: designer
priority: 88
activate_when:
  stacks: web, android, windows
description: "Foundry /design after plan lock."
---

# design-foundation

Use `ui-ux-pro-max` for visual decisions only.

Write `docs/DESIGN.md` + platform design-system sources. Preview must build. User runs `/design approve` to `design_lock`. Backend-only → `/design skip`.
