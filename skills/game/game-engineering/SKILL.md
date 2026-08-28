---
id: game-engineering
version: 2
layer: L2
domain: game
activate_when:
  files: project.godot
phases: planning, implementation
roles: planner, implementer
priority: 55
description: Frame budget, determinism, content pipeline.
---

# Game engineering

Protect frame budget and keep simulation ownership clear.

- Put deterministic gameplay/physics updates in the engine's appropriate fixed-step path; presentation may interpolate but must not change simulation truth accidentally.
- Avoid per-frame allocation, scene-tree scans, synchronous asset I/O, shader compilation, or expensive pathfinding on the render hot path.
- Keep entity/content definitions data-driven where that reduces code duplication, but validate external/mod content before use.
- Separate simulation state, presentation state, input mapping, persistence, and network authority.
- Pool only measured high-churn objects; pools add lifecycle complexity and stale-state risk.
- Define pause, save/load, scene transition, restart, and failure recovery behavior explicitly.
- For multiplayer, establish authoritative state, prediction/reconciliation boundaries, and cheat-sensitive trust assumptions.

Profile representative scenes and worst-case entity/effect counts. Test deterministic/replay/save migration invariants when those systems are touched.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
