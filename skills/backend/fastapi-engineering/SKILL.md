---
id: fastapi-engineering
version: 2
layer: L3
domain: backend
activate_when:
  languages: python
phases: implementation
roles: implementer
priority: 62
description: FastAPI/Pydantic contracts.
---

# FastAPI engineering

Treat Pydantic models and HTTP status semantics as public contracts.

- Separate request, domain, and response models when persistence/internal fields differ.
- Put authentication and reusable policy resolution in dependencies, but perform resource-specific authorization with the loaded resource.
- Use async endpoints only when the entire hot I/O path is async; do not call blocking libraries from the event loop.
- Bound uploads, pagination, query complexity, and outbound calls; set client timeouts explicitly.
- Translate domain failures to intentional HTTP errors; do not expose Python exceptions or validation internals unnecessarily.
- Manage database/session lifetime per request or unit of work; commit once the invariant is satisfied and roll back on failure.
- Use lifespan hooks for process-owned resources rather than hidden module side effects.

Test dependency overrides, authz failure, validation, transaction rollback, and schema compatibility for changed endpoints.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
