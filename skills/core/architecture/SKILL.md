---
id: architecture
version: 2
layer: L1
domain: engineering
phases: planning, review
roles: planner, reviewer
priority: 100
description: System boundaries, module ownership, dependency direction.
---

# Architecture

Make boundaries explicit before abstractions. Prefer existing modules and one source of truth; do not create a parallel subsystem for migration convenience.

- Identify ownership, public interfaces, trust boundaries, data/control flow, persistence, and external dependencies.
- Keep dependency direction acyclic and toward stable policy. Domain logic must not depend on transport/UI/storage details unless the locked plan requires it.
- Separate reversible choices from expensive-to-reverse contracts. Preserve compatibility only when it is a stated requirement.
- Reject hidden global state, circular ownership, duplicated business rules, distributed transactions without necessity, and abstractions with only one speculative consumer.
- For migrations, define cutover, rollback, data compatibility, and the moment the old path is removed.

Review architecture against the locked plan, then against the actual diff. A structurally elegant change that violates plan scope is still wrong.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
