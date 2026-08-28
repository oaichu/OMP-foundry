---
id: code-review
version: 2
layer: L1
domain: engineering
phases: review
roles: reviewer
priority: 88
description: Verdict only. Do not implement the fix.
---

# Code review

Review independently; do not implement fixes. Verdict is `APPROVE`, `REQUEST_CHANGES`, or `BLOCK`.

Check in this order:
- scope and locked-plan/AATP compliance;
- correctness and edge cases at changed boundaries;
- security, authorization, data integrity, concurrency, error handling, and resource lifecycle;
- tests: whether they prove behavior and would catch the defect class;
- maintainability: ownership, duplication, coupling, dead paths, accidental complexity;
- performance/accessibility/platform concerns when relevant.

Every blocking finding must cite the concrete code path or behavior, consequence, severity, and smallest acceptable correction. Separate proven defects from suggestions. Do not demand stylistic rewrites when existing conventions are sound. Do not approve based on diff appearance alone: inspect call sites and contracts touched by the change.

An absent test is blocking only when the changed behavior is materially unverified. Fresh verification evidence is required for pass claims.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
