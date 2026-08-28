---
id: verification
version: 2
layer: L1
domain: engineering
phases: qa, review
roles: qa, reviewer
priority: 91
description: Fresh command output before any pass claim.
---

# Verification

A pass claim requires fresh evidence from the current revision.

- Run the declared verification steps that cover the changed behavior; do not substitute a weaker command merely because it is convenient.
- Record command, exit status, and material output/evidence. Distinguish `PASS`, `FAIL`, `BLOCKED`, and `NOT_APPLICABLE`.
- A command that never exercised the target path is not proof of correctness.
- Investigate flaky or environmental failures enough to distinguish product defect from infrastructure noise; never relabel a failure as pass.
- Review warnings that indicate correctness, security, type, migration, or accessibility risk even when exit code is zero.
- For UI or runtime behavior, include representative state/route/platform evidence in addition to static checks when the contract requires it.

Do not claim completion from stale CI, another branch, cached output, or the implementer's statement. Verification is evidence collection, not optimism.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
