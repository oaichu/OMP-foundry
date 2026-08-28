---
id: node-engineering
version: 2
layer: L3
domain: backend
activate_when:
  dependencies: express, fastify, hono
phases: implementation, review
roles: implementer, reviewer
priority: 70
description: Node HTTP servers.
---

# Node engineering

Keep the event loop responsive and lifecycle explicit.

- Validate/normalize request data before business logic; centralize typed error translation without swallowing causes.
- Put deadlines on outbound HTTP/database/cache calls and propagate abort signals when libraries support them.
- Avoid synchronous filesystem/crypto/compression work on request hot paths; move CPU-heavy work off the event loop.
- Stream large payloads instead of buffering blindly; cap body/upload/decompression sizes.
- Await or deliberately detach every promise with an owned error path. No floating background work tied to request objects.
- Close servers, pools, workers, timers, and subscriptions cleanly on shutdown.
- Do not rely on process memory for correctness across replicas.

For Express/Fastify/Hono, keep framework handlers thin; business rules should remain testable without HTTP objects. Verify rejection paths for malformed input, timeout, cancellation, duplicate writes, and downstream failure.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
