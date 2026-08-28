---
id: security
version: 2
layer: L1
domain: security
phases: planning, review, qa
roles: planner, reviewer, qa
priority: 92
description: Threats, authz, secrets, fail-closed defaults.
---

# Security

Model the trust boundary before choosing controls.

- Treat client identity, tenant/resource IDs, model output, webhooks, uploaded content, network peers, and serialized state as untrusted until verified.
- Authenticate the actor and authorize the specific action on the specific resource server-side. Never infer tenancy from client-supplied scope alone.
- Validate syntax, size, type, and semantic invariants at ingress; encode/escape at output sinks.
- Keep secrets out of source, logs, URLs, prompts, client bundles, crash payloads, and persisted artifacts. Minimize credential scope and lifetime.
- Fail closed for auth, policy, signature, and integrity checks. Make privileged defaults explicit.
- Bound retries, parsers, decompression, uploads, fan-out, and expensive queries to resist resource abuse.
- For crypto/signatures, use established primitives and constant-time library operations; do not invent protocols.

Review both intended controls and bypass paths: alternate endpoints, stale caches, race windows, background jobs, migrations, admin tooling, and error fallbacks.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
