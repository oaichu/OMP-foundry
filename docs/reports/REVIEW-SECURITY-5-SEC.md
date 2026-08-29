# Security Review: Task 5 — Document Sidecars and Validate the Complete Stack

FOUNDRY_REVIEW SECURITY-5 APPROVE

## Verdicts

- **Spec compliance:** APPROVE
- **Quality/security:** APPROVE
- **Actionable finding count:** 0

## Evidence reviewed

- Task 5 requirements brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-5-brief.md`
- Task 5 implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-5-report.md`
- Task 5 review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-5-review.diff`
- Resulting documentation artifacts:
  - `README.md` (Security pipeline, `/security` CLI, policies, fixed-argv guarantees, tool caveats, skill stack, command & architecture tables)
  - `skills/SOURCES.md` (Native provenance, research attribution, sidecar boundaries, no-vendoring policy)
- Resulting skill and script artifacts:
  - `skills/security/finding-verification/SKILL.md` (version alignment)
  - `skills/security/scanners/SKILL.md` (version alignment)
  - `skills/security/supply-chain/SKILL.md` (version alignment)
  - `skills/web/shadcn-ui/SKILL.md` (version alignment)
  - `skills/web/web-interface-guidelines/SKILL.md` (version alignment)
  - `scripts/check-omp-contract.ts` (safe absent-root handling)
- Resulting test artifacts:
  - `tests/router-v2.test.ts` (design-quality context suppression assertion)
  - `tests/security-runner.test.ts` (type cleanup)
  - `tests/verify-runner.test.ts` (test timeout stabilization)
  - `tests/security-skills.test.ts` (native security control plane & documentation contracts)

Per review instructions, no formatters, linters, project-wide tests, or external scanners were executed. Implementer-reported verification demonstrates full project health:
- `bun test tests/security-skills.test.ts`: 6 pass, 0 fail, 58 expectations (404ms)
- `bun test`: 275 pass, 0 fail, 1092 expectations across 27 files (28.86s)
- `bun run typecheck`: clean exit code 0 (`tsc --noEmit`)
- `bun run check:omp-contract`: clean exit code 0 (clean skip when `OMP_SOURCE` is absent)
- `npm pack --dry-run`: clean exit code 0 (93 files packed; includes `src/security-runner.ts`, native security skills, agents, rules, templates; excludes `.superpowers` and `node_modules`)
- External tool availability: honestly recorded as `NOT_RUN` / `BLOCKED` without false claims of clean scans or Codex Security equivalence
- Branch diff inspection: clean working directory on `feat/frontend-skill-stack`, 0 whitespace errors.

## Executive assessment

Task 5 delivers comprehensive, rigorous, and truthful documentation for the entire governed security engine and sidecar ecosystem while validating the integrity of the distribution package and test suite.

Key strengths:
1. **Accurate 6-Stage Pipeline Documentation (`README.md`)**:
   - Accurately details the full pipeline lifecycle: `Context → Scan → Review → Finding Verification → Triage → Release Gate`.
   - Explains context-first orientation, parent-owned fixed-argv scan sidecars, 3-pass differential review, technical proof thresholds (`TRUE_POSITIVE`, `FALSE_POSITIVE`, `NEEDS-MORE-INFO`), strict triage mappings (`ACCEPT`, `DISMISS`, `NEEDS-MORE-INFO`), and SHA-bound release gating.

2. **Complete `/security` Command Reference & Policy Semantics**:
   - Accurately documents `/security status` (read-only health check, zero subprocesses, zero mutations), `/security diff` (diff-scoped secret scanning with `--log-opts`), `/security full` (complete multi-tool SARIF scanning), and `/security codeql` (deep semantic analysis).
   - Explains `.omp/config.yml` security policies: `optional` (informative), `release-required` (release gate checks freshness & pass status), and `required` (hard blocker on missing/failed tools).
   - Explains commit SHA freshness binding in `.omp/security/latest.json`.

3. **Strict Fixed-Argv, No-Autofix & No-Shell Guarantees**:
   - Clearly states that sidecars execute strictly via fixed string arrays (`VerifyStep`) without shell intermediaries (`sh -c`, `cmd.exe`).
   - Documents diagnostic-only inspection flags (forbidding `--fix`/`--autofix`) and credential-isolated temporary sandboxes.

4. **Honest Tool Ecosystem Boundaries & Caveats**:
   - **Semgrep OSS**: AST pattern matching, explicit approved configs (`p/security-audit`), mandatory `--metrics=off`, forbidden `auto`/`p/auto` configs, intra-file scope.
   - **Gitleaks**: Regex & entropy scanning, mandatory `--redact`, diff mode `--log-opts`, explicit upstream feature-complete maintenance caveat.
   - **Trivy**: Lockfile SBOM vuln & misconfig scanning (`fs --scanners vuln,misconfig,secret --format sarif .`), DB currency dependence.
   - **CodeQL**: Whole-program semantic analysis, strict OSI License Gate (enforcing the public-is-not-enough rule), valid DB/suite paths, flexible build modes (`none`, `autobuild`, manual).

5. **No-Vendoring & Sidecar Isolation Guarantee**:
   - Clarifies that scanner binaries run as parent-extension sidecars; no tools, skill packs, or prompt corpora are vendored into the repository or treated as runtime dependencies.
   - Explicitly forbids false claims of clean scans or Codex Security equivalence when external tools are absent, documenting `UNASSESSED`, `PARTIAL_COVERAGE`, `TOOL_ERROR`, and `BLOCKED` states.

6. **Skill Metadata & Test Hardening**:
   - Synchronized skill versions to standard `version: 2`.
   - Cleaned unused test imports and stabilized test timeouts.
   - Contract checker handles missing local OMP source gracefully without masking true failures.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| Document 6-stage security pipeline | PASS | `README.md:178-193`: Complete ASCII diagram and 6-stage lifecycle descriptions. |
| Document `/security` commands & modes | PASS | `README.md:195-202`: Table covering `status`, `diff`, `full`, `codeql` modes and behaviors. |
| Document security policies & freshness | PASS | `README.md:204-213`: Documents `optional`, `release-required`, `required`, and HEAD commit SHA binding. |
| Document fixed-argv, no-autofix, no-shell | PASS | `README.md:215-221`: Documents array execution, no shell interpreters, diagnostic-only flags, and isolated env. |
| Document tool boundaries & caveats | PASS | `README.md:223-231`: Detailed table for Semgrep OSS (`--metrics=off`), Gitleaks (maintenance caveat), Trivy (SBOM scope), CodeQL (OSI license gate & public-is-not-enough rule). |
| Document sidecar boundaries & no-vendoring | PASS | `README.md:233-239` & `skills/SOURCES.md`: Explains host-sidecar execution, read-only subagents, no vendoring, and non-pass states without false equivalence claims. |
| Update command & architecture maps | PASS | `README.md:339-368`: Registered `/security` in Command Reference and `src/security-runner.ts` in Architecture Map. |
| Skill version & catalog consistency | PASS | `skills/*/*.md`: Version 2 bump across security and web skills; `tests/security-skills.test.ts` passes. |
| Packaging & full verification validation | PASS | Implementer report confirms zero exit codes on `bun test`, `typecheck`, `check:omp-contract`, and `npm pack --dry-run` (93 files, no `.superpowers`/`node_modules`). |

## Quality/security review

The documentation and supporting adjustments adhere to high standards of security and clarity:
- **Truth in Security Reporting**: The documentation rigorously avoids overpromising scanner capabilities, explicitly highlighting intra-file limits for Semgrep OSS, maintenance status for Gitleaks, database currency for Trivy, and the OSI license gate for CodeQL.
- **Fail-Closed Verification**: Clear documentation of non-pass exit states ensures developers and downstream operators understand when scans are partial, unrun, or blocked.
- **Clean Distribution Integrity**: Packaging dry-run verifies that no test fixtures, temporary scan directories (`.omp/security/runs/`), or development artifacts are packaged into the release artifact.

## Actionable findings

None. Task 5 documentation, skill catalog updates, and verification suite validations are complete, accurate, and fully compliant with all specification requirements.