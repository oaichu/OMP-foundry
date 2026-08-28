---
id: refactoring
version: 2
layer: L1
domain: engineering
phases: implementation
roles: implementer
priority: 60
description: Behavior-preserving structural change inside AATP scope.
---

# Refactoring

Refactor only to simplify the scoped implementation or remove demonstrated structural risk.

- Preserve observable behavior unless the AATP explicitly changes it.
- Establish tests or other behavioral evidence before moving boundaries.
- Prefer small mechanical transformations: rename, extract, inline, split responsibility, remove duplication, tighten types, simplify dependency direction.
- Keep public API changes intentional and update all consumers atomically inside allowed scope.
- Delete superseded paths instead of retaining compatibility shims indefinitely.
- Stop when the requested change is easy to reason about; do not turn a local task into architecture renovation.

Do not mix unrelated cleanup, formatting churn, dependency upgrades, or speculative abstractions into the work order. If a necessary refactor crosses `allowed_files` or changes a locked interface, report the conflict rather than expanding scope silently.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
