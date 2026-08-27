---
id: design-quality
version: 1
layer: L2
domain: design, ux
phases: design, review, qa
roles: designer, reviewer, qa
priority: 92
activate_when:
  stacks: web, android, windows
description: "Design critic and visual QA gate for hierarchy, accessibility, responsive behavior, interaction, motion, and style drift."
---

# Design quality

Gate UI on hierarchy/readability; contrast and non-color semantics; keyboard/focus and touch targets; reduced motion; responsive overflow and content density; empty/loading/error/disabled states; purposeful motion; effect/performance budgets; and consistency with locked tokens and visual language. Treat effect-heavy Neumorphism, Glassmorphism, Liquid Glass, and Spatial UI as suspect when affordance or contrast degrades. Verdict is PASS or BLOCKED with specific fixes. During Design write the QA checklist into `docs/DESIGN.md`; during Review/QA never edit locked Design - report implementation drift instead.
