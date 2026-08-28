---
id: nextjs-engineering
version: 2
layer: L3
domain: web
activate_when:
  dependencies: next
  files: next.config.ts, next.config.mjs, next.config.js
requires: react-engineering, typescript-engineering
phases: implementation, review
roles: implementer, reviewer
priority: 82
description: App Router, cache, server/client split.
---

# Next.js engineering

Default to server execution; create client boundaries only for browser state, effects, or interactive event handling.

- Keep secrets, privileged fetches, filesystem/database access, and authorization on the server.
- Make cache behavior explicit per data source: static, revalidated, request-dynamic, or uncached. Never rely on accidental framework defaults for security-sensitive freshness.
- Prevent waterfalls by fetching independent data concurrently and colocating server data near the route/layout boundary that owns it.
- Use route handlers/server actions as trust boundaries: validate input, authenticate, authorize resource access, and make writes idempotent where retries are possible.
- Keep serialization across server/client boundaries small and intentional.
- Treat redirects, `notFound`, loading, error, and suspense states as part of the route contract.
- Avoid forcing an entire tree client-side because one leaf is interactive.

Review build output/runtime target assumptions before using Node-only APIs. Verify production build plus changed route behavior, not dev server alone.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
