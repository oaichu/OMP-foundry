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

Plan scanner evaluation and adjudicate security tool evidence. Governed workers (reviewer, QA) operate shell-free and read-only; scanner execution and artifact persistence remain parent-extension-owned through the `/security` runner.

## Reviewer & QA Role Boundaries

- **Evidence Adjudication Only**: Reviewers and QA never launch scanners, spawn shell commands, write SARIF files, persist execution artifacts, or bypass AATP work orders.
- **Parent Runner Interaction**: Request and interpret evidence produced by the parent-owned `/security` runner. Ensure all analyzed outputs are properly redacted.
- **Explicit Non-Pass States**:
  - `UNASSESSED`: Missing parent execution or absent runner artifacts must be flagged as explicit non-pass/unassessed states rather than assumed secure.
  - `PARTIAL_COVERAGE`: Incomplete scanner runs or unanalyzed changed files must be documented as explicit coverage gaps.
  - `TOOL_ERROR`: Tool crashes, configuration failures, or missing scanner rules are tool errors (non-pass), not security findings or clean bills of health.

## Evidence Adjudication Standards

1. **Fixed-Argv Verification**: Verify that scanner runs configured by the parent runner used deterministic fixed-argv parameter arrays without shell intermediaries (`sh -c` / `cmd.exe`).
2. **Redacted Artifacts**: Confirm scanner outputs, logs, and findings have sensitive tokens, credentials, and PII redacted before evidence persistence.
3. **SARIF Evaluation**: Adjudicate structured SARIF evidence, verifying rule IDs, severities, physical source locations, and tool coverage metadata.
4. **Exit-State Evaluation**: Distinguish execution-level errors from security findings according to each tool's documented exit codes.

## Tool Boundaries & Limitations

- **Semgrep**: Excels at AST pattern matching and intra-file rules; does not perform whole-program inter-procedural data-flow or pointer analysis across complex component boundaries.
- **CodeQL**: Deep inter-procedural query analysis requires a compatible, successfully extracted database and configured query suite. Coverage and build requirements depend on the target language, extractor, repository setup, selected build mode (such as `none`, `autobuild`, or manual build invocation depending on language support and tradeoffs), and desired analysis coverage. Cannot analyze dynamic runtime behavior, unextracted dependencies, or generated code not captured in the extracted database.
- **Gitleaks**: High-accuracy regex and entropy secret detection; may flag test fixtures as false positives or miss split-token / dynamic credential assembly.
- **Trivy**: Vulnerability and misconfiguration scanning depends on vulnerability database freshness and complete lockfile synchronization.
