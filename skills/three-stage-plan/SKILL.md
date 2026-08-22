---
id: three-stage-plan
name: three-stage-plan
version: 1
layer: L1
domain: planning
phases: planning
roles: planner
priority: 96
description: "Foundry /plan3: draft → critique → human lock."
---

# three-stage-plan

Sequential only. Orchestrator does not draft/critique/lock.

1. `docs/PRODUCT.md` approved via `/foundry-approve product`.
2. Spawn blocking `plan-drafter` → `docs/planning/MASTER_PLAN_DRAFT.md`.
3. Spawn blocking `plan-critic` → `docs/planning/PLAN_REVIEW.md` only.
4. Spawn blocking `plan-finalizer` → write `docs/MASTER_PLAN.md` only. Do not call `plan_commit`.
5. Stop. Human runs `/foundry-approve plan`.

Conflicts → `report_conflict`. Reopen only via human `/plan-revise`.
