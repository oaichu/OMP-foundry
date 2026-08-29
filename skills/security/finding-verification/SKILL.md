---
id: security-finding-verification
version: 1
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

## Finding Classification

Classify each analyzed item into exactly one category:
- `TRUE_POSITIVE`: Reachable vulnerability with demonstrable data flow or control bypass, realistic preconditions, and measurable impact.
- `FALSE_POSITIVE`: Unreachable path, effective upstream sanitization/validation, design-intended behavior, or tool pattern mismatch.

## Triage Disposition

Assign an actionable disposition:
- `ACCEPT`: Validated vulnerability requiring remediation. Document evidence, minimal reproductive path or preconditions, impact, and remediation guidance.
- `DISMISS`: Verified false positive or documented acceptable risk. Provide clear technical rationale and proof of non-exploitability.
- `NEEDS-MORE-INFO`: Insufficient context, missing deployment architecture, or unverified runtime environment. Specify the exact missing evidence required.

## Operational Rules

- Ground all claims in code evidence (exact file, line range, variable names).
- Never fabricate exploit chains or claim theoretical issues without reachable execution paths.
- Verdict only; do not implement application fixes.
