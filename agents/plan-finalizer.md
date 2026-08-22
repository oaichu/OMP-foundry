---
name: plan-finalizer
description: "Company /plan3 step 3. @advisor adjudicates and plan_commit locks docs/MASTER_PLAN.md."
tools: read, grep, glob, write, edit
model: "@advisor"
thinking-level: xhigh
blocking: true
read-summarize: true
autoloadSkills: three-stage-plan
---

READ PRODUCT, MASTER_PLAN_DRAFT, PLAN_REVIEW. WRITE `docs/MASTER_PLAN.md` with frontmatter `version`, `status: LOCKED`, `decision: ACCEPT|MODIFY|REJECT`. Adjudicate each finding ACCEPT/REJECT/MODIFY. REJECT → do not lock. Else `plan_commit` (unlockToken if revising). Never implement.
