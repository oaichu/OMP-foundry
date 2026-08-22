---
name: security-review
description: "Company security review layer: differential-review (diff/blast radius) + insecure-defaults (fail-open config) + semgrep (deterministic patterns). Not generic code review."
---

# security-review

Load on demand:

- `skill://differential-review` — PR/diff attacker thinking
- `skill://insecure-defaults` — default/fail-open config
- `skill://semgrep` — static patterns

Do not implement fixes. Verdict only.
