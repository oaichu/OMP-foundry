---
id: ai-engineering
version: 2
layer: L2
domain: ai
activate_when:
  dependencies: openai, ai
phases: planning, implementation
roles: planner, implementer
priority: 60
description: Eval, prompt isolation, no secret leakage to models.
---

# AI engineering

Treat model output as untrusted probabilistic data and make the deterministic system own policy.

- Never place credentials, private keys, unrestricted database dumps, or unnecessary sensitive data into prompts/tool context.
- Separate system/developer policy from user-controlled content and retrieved documents; delimit provenance so prompt injection cannot silently become authority.
- Validate structured model/tool output against a schema and re-authorize every side effect in deterministic code.
- Give tools least privilege, narrow parameters, bounded output, and explicit timeout/retry/approval semantics.
- Define eval cases before prompt/model changes: success criteria, adversarial cases, refusal boundaries, latency/cost, and regression thresholds.
- Make fallbacks explicit for malformed output, timeout, provider failure, rate limits, and context truncation.
- Cache only when prompt/model/tool/version and user/tenant privacy dimensions are part of the key.

Do not use model confidence as an authorization or correctness proof. Log enough metadata for debugging/evals without retaining sensitive prompt content by default.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
