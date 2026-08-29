---
id: security-scanners
version: 1
layer: L2
domain: security, tooling
phases: review, qa
roles: reviewer, qa
priority: 88
activate_when:
  stacks: web, backend, android, windows, cloud, systems, mobile
description: "Plan fixed-argv security scans and preserve explicit tool, coverage, and SARIF status evidence."
---

# security-scanners

Plan and execute security tool scans using deterministic fixed-argv invocations. Redact sensitive output, preserve structured SARIF reports, and explicitly account for scanner limitations.

## Scanner Execution Standards

1. **Fixed Argv Invocations**: Use discrete argument arrays directly when launching security scanners (Semgrep, Gitleaks, Trivy, CodeQL). Never interpolate arguments into shell strings or execute via `sh -c` / `cmd.exe` intermediaries.
2. **Output Redaction**: Sanitize scanner outputs, stdout/stderr streams, and execution logs to redact sensitive secrets, API keys, tokens, and credentials before persisting or sharing artifacts.
3. **SARIF & Evidence Preservation**: Generate and preserve SARIF (Static Analysis Results Interchange Format) outputs whenever supported. Retain tool metadata, rule IDs, physical locations, error levels, and coverage metrics.
4. **Exit-State Interpretation**: Distinguish tool failures (configuration syntax errors, missing dependencies, crash exit codes) from security finding alerts. Interpret scanner exit codes according to each tool's documented semantics.

## Tool Boundaries & Limitations

- **Semgrep**: Excels at AST-based pattern matching and intra-file rules; does not perform whole-program inter-procedural data-flow or pointer analysis across complex boundaries.
- **CodeQL**: Deep inter-procedural query analysis requires successful code compilation and extractors; cannot analyze uncompiled source states or dynamically generated runtime structures.
- **Gitleaks**: High-accuracy regex and entropy secret detection; may produce false positives on test fixtures or fail to detect complex split-token assembly.
- **Trivy**: Comprehensive vulnerability and misconfiguration scanning; requires up-to-date vulnerability databases and depends on lockfile completeness.
