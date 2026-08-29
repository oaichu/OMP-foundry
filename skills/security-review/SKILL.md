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

## Review Principles

- **Context-first orientation**: Ground the review in system architecture, trust boundaries, data sensitivity, and threat profile before inspecting diffs.
- **Risk-first differential review**: Evaluate changes, commit history, and blast radius. Prioritize high-risk surfaces: auth, authz, public APIs, input parsing, secrets, and business logic.
- **Leads vs. proof**: Treat static-pattern matches and scanner output as leads, not definitive proof; confirm reachability, context, and exploit preconditions.
- **Explicit coverage limits**: State what was reviewed and explicitly document unassessed areas or limits.
- **Handoff**: Route candidate findings to finding verification and triage for data-flow and threat-model confirmation.

## Three Review Passes

1. **Differential attack review** — inspect changed code for differential risk, new/altered trust boundaries, auth/authz enforcement, API contracts, injection vectors, deserialization, filesystem/network/process access, uploads, webhooks, redirects/proxies, secrets handling, tenant scoping, concurrency, and business logic flaws. Trace attacker-controlled input from source to sink.
2. **Insecure-default review** — inspect code for insecure-default configurations, fail-open branches, default credentials, wildcard origins/permissions, debug/admin exposure, disabled verification, permissive fallback, missing tenant filters, broad service roles, unsigned/unvalidated inputs, and optional controls that should be mandatory.
3. **Static-pattern review** — search for known static-pattern anti-patterns and dangerous sinks (command/SQL injection, path traversal, unsafe eval/deserialization, hardcoded secrets, raw HTML, weak crypto, SSRF/open proxy, missing signature checks). Prove reachability and context before flagging.

## Finding Format & Verdict

Every finding must include:
- Evidence (file, line, code excerpt)
- Exploit/precondition and attack scenario
- Impact and severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`)
- Smallest corrective action (guidance only; do not write the fix)

Distinguish true vulnerabilities from defense-in-depth hardening suggestions.

Verdict: `APPROVE`, `REQUEST_CHANGES`, or `BLOCK`.
