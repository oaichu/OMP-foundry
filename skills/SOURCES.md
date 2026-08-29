# Native skill provenance policy

OMP Foundry ships its engineering skill catalog as self-contained control-plane guidance. Runtime skill resolution must not require external `skill://` packs, cloned repositories, npm skill bundles, or remote prompt corpora.

The catalog distills stable engineering practice, platform documentation knowledge, security review patterns, and lessons from public agent-skill ecosystems into original Foundry-native rules. External projects may be reviewed as research inputs, but are never auto-synced or treated as runtime authorities. The shipped text is an original Foundry distillation, remote rules are not vendored, and current official docs must be fetched when freshness matters.

Policy:
- one Foundry capability owner per concern;
- compact `SKILL.md` control planes, progressively/JIT loaded by the existing resolver;
- deterministic code/tests own governance and lifecycle, not prose skills;
- upstream-specific facts that can go stale should be verified against current official documentation during project work rather than frozen into the catalog;
- no external skill pointer may be required for correctness or security review.

## Reviewed research inputs

- `anthropics/skills` (Apache-2.0): Frontend Design art direction, subject-grounded intent, typography/layout/signature choices, and two-pass critique.
- `shadcn-ui/ui` (MIT): component composition, registry patterns, and semantic token conventions.
- `vercel-labs/agent-skills`: Web Interface Guidelines review formatting, interaction contracts, and live rule retrieval pattern.

## Reviewed security research inputs

- `trailofbits/skills` (https://github.com/trailofbits/skills, CC-BY-SA-4.0): Security testing methodologies, finding verification patterns, differential review concepts, and triage protocols. Research and sidecar input only; no text or rules vendored.
- `JeremyMorgan/code-review-skills` (https://github.com/JeremyMorgan/code-review-skills, CC0-1.0): Static review checklists, risk-first change review patterns, and reviewer prompt guidance.
- `sabakan0123/claude-security-skills` (https://github.com/sabakan0123/claude-security-skills, unresolved license): Public repository reviewed for security analysis catalog ideas; due to unresolved license status, no code, text, or rules are copied or vendored. Used solely as an external research reference.

## Official security tooling sources

- Semgrep (`https://github.com/semgrep/semgrep`, LGPL-2.1 / proprietary): AST-based static analysis patterns and SARIF integration standards.
- Gitleaks (`https://github.com/gitleaks/gitleaks`, MIT): Secret detection patterns, entropy scanning, and redaction protocols.
- Trivy (`https://github.com/aquasecurity/trivy`, Apache-2.0): Vulnerability database matching, lockfile SBOM inspection, and misconfiguration scanning.
- CodeQL (`https://github.com/github/codeql`, MIT / proprietary engine): Inter-procedural data flow modeling and SARIF report structure.

All security tooling links and research inputs represent design references and sidecar tools, not runtime dependencies or vendored corpora. Foundry enforces a strict no-vendoring policy for all control-plane skills.
