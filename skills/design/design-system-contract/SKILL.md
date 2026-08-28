---
id: design-system-contract
version: 1
layer: L2
domain: design, ux
phases: design
roles: designer
priority: 93
activate_when:
  stacks: web, android, windows
description: "Freeze a durable DESIGN.md contract from primitive through semantic and component tokens before implementation."
---

# Design system contract

Treat `docs/DESIGN.md` as the UI source of truth. Freeze Primitive -> Semantic -> Component tokens before code: color, typography, spacing, radius, border, elevation/material, and motion. Specify responsive and density rules, component anatomy and states, interaction/focus behavior, dark/high-contrast behavior, platform adaptations, representative screens, and preview evidence. Every component value should trace to a semantic token; exceptions must be explicit. No production-source writes during Design.
