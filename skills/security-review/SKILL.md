---
id: security-review
name: security-review
version: 2
layer: L1
domain: security
phases: planning, review
roles: planner, reviewer
priority: 85
description: "Native differential security review, insecure-default analysis, and static-pattern reasoning."
---

# security-review

Perform the security review natively; do not depend on external skill packs. Do not implement fixes. Verdict only.

Use three passes:

1. **Differential attack review** — identify new/changed trust boundaries, auth/authz decisions, parsers, deserialization, filesystem/network/process access, uploads, webhooks, redirects/proxies, secrets, tenant scoping, concurrency, and privileged configuration. Trace attacker-controlled input to side effects.
2. **Insecure-default review** — look for fail-open branches, default credentials, wildcard origins/permissions, debug/admin exposure, disabled verification, permissive fallback, missing tenant filters, broad service roles, unsigned/unvalidated inputs, and security controls that are optional when they should be mandatory.
3. **Static-pattern review** — search code for dangerous sinks/patterns relevant to the stack (command/SQL construction, path traversal, unsafe eval/deserialization, secret literals, raw HTML, weak crypto, SSRF/open proxy, missing webhook signature checks). Treat pattern matches as leads, then prove reachability/context before blocking.

Every finding must include evidence, exploit/precondition, impact, severity, and smallest corrective action. Distinguish vulnerability from hardening suggestion. Verdict: `APPROVE`, `REQUEST_CHANGES`, or `BLOCK`.
