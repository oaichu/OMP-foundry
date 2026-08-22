---
name: three-stage-plan
description: "Company /plan3: GLM drafts docs/planning/MASTER_PLAN_DRAFT.md, Grok writes PLAN_REVIEW.md, Sol locks docs/MASTER_PLAN.md via plan_commit. Use for /plan3, 3-stage-plan, or PLAN_CONFLICT."
---

# three-stage-plan

Sequential only. Orchestrator does not draft/critique/lock.

1. `docs/PRODUCT.md` must be approved (`product_approve`).
2. Spawn blocking `plan-drafter` → `docs/planning/MASTER_PLAN_DRAFT.md`.
3. Spawn blocking `plan-critic` → `docs/planning/PLAN_REVIEW.md` only.
4. Spawn blocking `plan-finalizer` → `docs/MASTER_PLAN.md` + `plan_commit`.
5. REJECT → another draft cycle (cap 2). Then stop.

After lock, workers cannot edit MASTER_PLAN. Conflicts → `report_conflict`.
