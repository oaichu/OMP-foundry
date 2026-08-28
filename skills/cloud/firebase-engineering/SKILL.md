---
id: firebase-engineering
version: 2
layer: L4
domain: cloud
activate_when:
  dependencies: firebase
phases: implementation
roles: implementer
priority: 50
description: Firebase rules and admin vs client.
---

# Firebase engineering

Treat client SDK access as hostile and security rules as the primary authorization plane for client-accessible data/storage.

- Rules must verify authenticated identity plus resource/tenant ownership for each read/write shape; do not rely on UI hiding paths.
- Admin SDK bypasses rules and therefore owns authorization explicitly on trusted server code.
- Keep service-account/admin credentials out of clients, source, logs, and downloadable config beyond intentionally public Firebase client identifiers.
- Design document paths/queries to be enforceable by rules; a schema that cannot express authorization safely is the wrong schema.
- Bound fan-out and document sizes; avoid hot documents/counters without a concurrency strategy.
- Make Cloud Function/event handlers idempotent and safe under duplicate/retried delivery.
- Version indexes/rules/config with the project when possible instead of relying on console state.

Use emulator/rules tests for allowed and denied identities, cross-tenant access, malformed writes, and storage paths affected by the change.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
