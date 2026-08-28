---
id: typescript-engineering
version: 2
layer: L3
domain: web
activate_when:
  languages: typescript
  files: tsconfig.json
requires:
phases: implementation, review
roles: implementer, reviewer
priority: 80
description: Strict TS, no any leakage, exact types at boundaries.
---

# TypeScript engineering

Use types to encode invariants at module boundaries, not to decorate already-unsafe data.

- Parse/validate `unknown` from network, storage, environment, JSON, and model/tool output before narrowing.
- Keep `any` out of exported APIs and cross-module data. Prefer `unknown`, generics, discriminated unions, branded/opaque IDs, and exhaustive `never` checks where they clarify contracts.
- Avoid boolean flag combinations that admit invalid states; model states as tagged variants.
- Distinguish absent, nullable, and empty values intentionally; do not silence strictness with non-null assertions.
- Keep runtime enums/constants aligned with their type source; avoid duplicated string unions when one source can derive the other.
- Use `satisfies` when checking structure without widening useful literals.

Do not fix type errors with blanket casts. A cast is acceptable only at a proven boundary and should be locally justified. Typecheck is necessary evidence, not sufficient behavioral verification.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
