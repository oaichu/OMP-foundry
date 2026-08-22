---
id: security-review
name: security-review
version: 1
layer: L1
domain: security
phases: planning, review
roles: planner, reviewer
priority: 85
description: "Diff review + insecure defaults + semgrep."
---

# security-review

Load on demand:

- `skill://differential-review` — PR/diff attacker thinking
- `skill://insecure-defaults` — default/fail-open config
- `skill://semgrep` — static patterns

Do not implement fixes. Verdict only.
