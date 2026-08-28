---
id: cloudflare-engineering
version: 2
layer: L3
domain: cloud
activate_when:
  stacks: cloudflare
  files: wrangler.toml, wrangler.jsonc
phases: implementation, planning
roles: implementer, planner
priority: 73
description: Workers, bindings, no leaked secrets.
---

# Cloudflare engineering

Design for isolate limits, edge caching semantics, and explicit bindings.

- Use Workers bindings for secrets/resources; never bake credentials into source or client-visible config.
- Await required I/O; use `waitUntil` only for non-response work that is safe to retry/lose according to the contract. No floating promises.
- Put timeouts and bounded retries around upstream fetches. Validate target URLs when proxying to prevent SSRF/open-proxy behavior.
- Make cache keys include every representation/auth dimension that changes output; do not cache private responses under shared keys.
- Respect CPU/memory/subrequest/body limits and stream large responses where appropriate.
- For Durable Objects/KV/D1/R2, choose based on consistency/ownership semantics rather than convenience and document the tradeoff.
- Restrict CORS to the required origins/methods/headers; CORS is not authorization.

Test local/unit logic plus deployed-runtime-sensitive behavior when bindings/cache/edge semantics are changed. Track free-tier/quota assumptions as constraints, not guarantees.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
