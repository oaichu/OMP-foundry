---
id: security-finding-verification
version: 2
layer: L2
domain: security, triage
phases: review, qa
roles: reviewer, qa
priority: 90
activate_when:
  stacks: web, backend, android, windows, cloud, systems, mobile
description: "Verify security findings with threat-model, data-flow, false-positive, and triage gates."
---

# security-finding-verification

Verify and triage candidate security findings using rigorous threat-model and data-flow validation. Never invent exploitability or assume ungrounded attack capabilities.

## Verification Methodology

1. **Data-Flow & Reachability**: Trace source-to-sink reachability across callers, middlewares, and data transformations. Check whether attacker-controlled input reaches the sensitive sink without adequate sanitization, validation, type coercion, or authorization gates.
2. **Threat Model & Preconditions**: Identify the required attacker position (unauthenticated external, authenticated tenant, privileged operator, local process), network access, and preconditions. Do not assume capabilities not present in the threat model.
3. **Exploitability Assessment**: Confirm if the defect is realistically exploitable in context. Verify defense-in-depth mitigations (e.g., CSP, memory protections, network isolation) while focusing on primary boundary controls.

## Classification & Proof Thresholds

Apply a classification only when its definitive proof threshold is satisfied:
- `TRUE_POSITIVE`: Demonstrated source-to-sink reachability or control bypass with realistic attack preconditions and measurable security impact.
- `FALSE_POSITIVE`: Conclusive proof of unreachability, robust upstream sanitization/validation/typing, architectural mitigation, or scanner rule mismatch.

If the evidence is insufficient to prove either `TRUE_POSITIVE` or `FALSE_POSITIVE`, do not guess or force a classification. Emit `NEEDS-MORE-INFO` with the exact missing evidence, unverified runtime assumptions, or deployment specifics required.

## Triage Disposition & Valid Relationships

Assign an actionable disposition that strictly maps to the proven classification:
- `ACCEPT`: Validated vulnerability requiring remediation. Valid ONLY for proven `TRUE_POSITIVE` findings. Document evidence, minimal reproductive preconditions, impact, and remediation guidance. False positives must never be accepted. If governance accepts residual risk, the finding remains a classified `TRUE_POSITIVE` (risk acceptance never reclassifies a true positive or overrides the finding into a false-positive dismissal).
- `DISMISS`: Conclusively refuted candidate. Valid ONLY for proven `FALSE_POSITIVE` findings. Provide concrete technical rationale and code proof of non-exploitability or rule mismatch. Unresolved candidate findings or unverified assumptions must never be dismissed.
- `NEEDS-MORE-INFO`: Unresolved candidate finding where the proof threshold for `TRUE_POSITIVE` or `FALSE_POSITIVE` is not met. Specify the exact missing evidence, reproducer, or runtime context required to reach a definitive verdict. Unresolved candidates must never be silently dismissed or prematurely accepted.

## Operational Rules

- Ground all claims in code evidence (exact file, line range, variable names).
- Never fabricate exploit chains or claim theoretical issues without reachable execution paths.
- Enforce strict, unambiguous classification-disposition mappings: `TRUE_POSITIVE` -> `ACCEPT`, `FALSE_POSITIVE` -> `DISMISS`, insufficient proof -> `NEEDS-MORE-INFO`.
- Risk acceptance is a governance decision that does not turn true positives or unresolved findings into `DISMISS`.
- Verdict only; do not implement application fixes.
