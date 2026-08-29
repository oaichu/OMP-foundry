# Security Task 2 Fix Round 1 — Scoped Re-review

FOUNDRY_REVIEW SECURITY-2-FIX APPROVE

## Scope and evidence

This re-review evaluates the eight findings from `docs/reports/REVIEW-SECURITY-2.md` and checks for regressions introduced by Fix Round 1. Evidence reviewed:

- Task brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-report.md`
- Fix review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-fix-review.diff`
- Source artifact: `src/security-runner.ts`
- Test artifact: `tests/security-runner.test.ts`
- Execution, path, and Git runtime contracts: `src/verify-runner.ts`, `src/paths.ts`, `src/git-runtime.ts`, `src/release.ts`
- SPDX license list reference data: verified OSI approval status for allowlist entries

Per the assigned review scope, no formatters, linters, project-wide tests, or external scanners were executed. The implementer report records 42 passing tests and 99 expectations; all source and test diffs were inspected directly.

## Finding status

### 1. High — Existing invalid security config silently downgrades required release gate to optional

**Status: RESOLVED**

`securityReleaseReady` in `src/security-runner.ts:634-697` explicitly checks if `.omp/config.yml` or `.omp/config.yaml` exists on disk before reading. When an existing configuration file exceeds `MAX_CONFIG_BYTES` (512 KiB), is a symlink or non-regular file (e.g. directory), fails path resolution via `safeRepoPath`, encounters a filesystem read failure, or produces a parse error (`config.error`), `securityReleaseReady` immediately returns `ready: false` with `status: "BLOCKED"`. Only a genuine `ENOENT` (both `.omp/config.yml` and `.omp/config.yaml` absent) defaults to `parseSecurityConfig("")` with optional policy and `NOT_REQUIRED` status.

Tests at `tests/security-runner.test.ts:25-69` verify genuine ENOENT, >512 KiB config, directory config, and syntax/parse error paths.

### 2. High — Unvalidated manifest JSON can satisfy release gate without being a complete or policy-compatible run

**Status: RESOLVED**

`validateSecurityRunManifest` in `src/security-runner.ts:544-632` performs thorough runtime schema validation on manifest JSON:
- Requires non-null object with valid `runId` (`/^[a-zA-Z0-9_-]{1,64}$/`), valid mode (`full`, `diff`, or `codeql`), valid policy (`optional`, `release-required`, or `required`), and valid commit HEAD (`/^[a-zA-Z0-9_.-]{7,64}$/`).
- Enforces valid ISO timestamp strings and requires `completedAt >= startedAt`.
- Validates that `coverage` contains non-negative integers for `requested`, `completed`, `blocked`, and `notRun`, and enforces the exact arithmetic invariant `requested === completed + blocked + notRun`.
- Validates the `tools` array: length matches `requested`, entries are objects with recognized `SecurityToolId`, no duplicate tool IDs exist, statuses are valid enums, and `argv` is an array of strings.
- Enforces tool status tally equality: `completed === count(PASS, FAIL)`, `blocked === count(BLOCKED)`, `notRun === count(NOT_RUN)`.
- Enforces aggregate status consistency: aggregate `PASS` requires zero blocked tools, zero not-run tools, and every tool status to be `PASS`.

Furthermore, `securityReleaseReady` in `src/security-runner.ts:699-780`:
- Requires current Git HEAD to be non-empty and at least 7 characters; rejects empty HEAD with `BLOCKED`.
- Requires exact match between manifest HEAD and current HEAD.
- Requires exact match between manifest policy and configured policy.
- Restricts valid release modes to `full` or `diff` (rejects `codeql` standalone mode as release-ready).
- Confirms all configured tools have individual `PASS` statuses in the manifest.

Tests at `tests/security-runner.test.ts:71-197` verify malformed JSON, missing fields, arithmetic mismatch, duplicate tools, inverted timestamps, policy mismatch, and empty HEAD.

### 3. High — CodeQL legal gate recognizes non-OSI and ambiguous licenses

**Status: RESOLVED**

`src/security-runner.ts:90-176` hardens the OSI license allowlist and detection:
- Removed non-OSI licenses `CC0-1.0` and `WTFPL` from `OSI_APPROVED_LIST`.
- `OSI_APPROVED_SPDX_LICENSES` is frozen via `Object.freeze(new Set<string>(...))` as an immutable `ReadonlySet<string>`.
- In `detectProjectLicense`, `package.json.license` matching uses exact case-sensitive lookup against `OSI_APPROVED_SPDX_LICENSES`.
- Root `LICENSE` / `COPYING` file detection checks for negative phrases (`/NOT (?:LICENSED|DISTRIBUTED) UNDER/i`, `/(?:not|never|neither) ... licensed under/i`) and ungranted proprietary notices, skipping matches when present.
- Root license matching uses conservative, anchored standard grant text patterns for approved licenses (MIT, Apache-2.0, BSD-3-Clause, BSD-2-Clause, ISC, MPL-2.0, GPL, LGPL, AGPL, BSL-1.0, 0BSD, Unlicense).

Tests at `tests/security-runner.test.ts:199-251` verify allowlist immutability, CC0/WTFPL exclusion, negated MIT license rejection, proprietary notice rejection, and canonical MIT license detection.

### 4. High — CodeQL is planned when configured database and suite do not exist or are unsafe

**Status: RESOLVED**

`planSecurityTools` in `src/security-runner.ts:468-522` validates CodeQL prerequisites prior to planning:
- Resolves `config.codeql.database` and `config.codeql.suite` using `safeRepoPath` to prevent directory traversal or out-of-repo targets.
- Uses `lstatSync` to verify that `config.codeql.database` is an existing, non-symlink directory.
- Uses `lstatSync` to verify that `config.codeql.suite` is an existing, non-symlink regular file.
- If any check fails, the tool status is set to `BLOCKED` with a descriptive reason before returning the plan, avoiding any execution attempt.

Tests at `tests/security-runner.test.ts:253-332` verify nonexistent database, file database (instead of directory), directory suite (instead of file), traversal path, and valid artifact planning.

### 5. High — Caller-controlled run paths can escape governed tree or produce non-absolute scanner outputs

**Status: RESOLVED**

`resolveSafeRunDir` in `src/security-runner.ts:371-387` and `planSecurityTools`:
- Validates `runId` against strict grammar `/^[a-zA-Z0-9_-]{1,64}$/`. Any traversal sequence (`../`), control character, or invalid symbol fails validation and returns `BLOCKED`.
- Production `runDir` defaults strictly to `resolve(cwd, ".omp", "security", "runs", effectiveId)`.
- Injected `runDir` must be an absolute path (`isAbsolute(runDir)`).
- Every planned step output path is formed under `effectiveRunDir` (`join(effectiveRunDir, `${tool}.sarif`)`), ensuring all generated SARIF paths are absolute and contained.

Tests at `tests/security-runner.test.ts:334-355` verify runId path traversal rejection and output path absolute containment.

### 6. High — Trusted-executable handoff is neither status-aware nor executable on Windows

**Status: RESOLVED**

`src/security-runner.ts:390-539` integrates `trustedExecutable` and safe execution handoff:
- Preflights binary availability using `trustedExecutable(cwd, tool)` (or injected `resolveExecutable`).
- Missing executables produce `NOT_RUN` when policy is `optional` and `BLOCKED` when policy is `required` (or `mode === "codeql"`).
- Planned `VerifyStep` definitions omit `step.cwd` (or set `"."`), which allows Windows repository paths with drive letters (`C:\...`) to execute cleanly without triggering colon component validation in `safeRepoPath`.

Tests at `tests/security-runner.test.ts:357-389` verify omission of absolute cwd on planned steps, `NOT_RUN` status under optional policy, and `BLOCKED` status under required policy.

### 7. High — Parsing and planning do not form a strict, bounded, closed validation boundary

**Status: RESOLVED**

`parseSecurityConfig` and `planSecurityTools` enforce strict fail-closed boundaries:
- Top-level `security:` must start at column 0 (`/^security:\s*(?:#.*)?$/`), preventing nested blocks from being parsed as top-level configuration.
- Security-block-specific scanning for forbidden keys (`executable`, `command`, `exec`, `sh`, `bash`, `cmd`, `script`) and control/shell characters, preventing false positives from unrelated top-level blocks.
- Duplicate key detection at top-level `security:` and sub-blocks (`semgrep`, `codeql`).
- Strict list parsing via `parseListValues`: rejects scalar values where lists are expected, rejects trailing tokens after inline lists, and bounds list counts (<=16 tools, <=32 configs) and item lengths (<=64 for tool, <=256 for config/db/suite).
- Unknown key rejection at all levels.
- Planner revalidation: `planSecurityTools` independently blocks tools if `config.error` is present or if `semgrep.configs` contains `auto`/`p/auto`.
- Exported registries (`ALL_SECURITY_TOOLS`, `DEFAULT_SECURITY_TOOLS`, `VALID_POLICIES`, `OSI_APPROVED_SPDX_LICENSES`) are immutable and frozen.

Tests at `tests/security-runner.test.ts:391-469` verify unknown nested keys, scalar-where-list-expected, trailing tokens, duplicate keys, list bounds, unrelated blocks, nested security blocks, parse error propagation, and direct `auto` config rejection.

### 8. Medium — Gitleaks diff accepts an arbitrary, unbounded `--log-opts` program

**Status: RESOLVED**

`validateGitRange` in `src/security-runner.ts:337-369`:
- Rejects revision strings longer than 64 characters.
- Rejects revisions starting with option syntax (`-`), whitespace, control characters, or shell characters.
- In Git repositories, safely verifies revision existence via `git rev-parse --verify --end-of-options` using governed `gitCall`.
- Checks revision ancestry and commit count via `git rev-list --count --end-of-options ${base}...${head}`, enforcing a 10,000 commit limit.
- Emits a single canonical range argument `"${base}...${head}"` passed to `--log-opts`.

Tests at `tests/security-runner.test.ts:471-507` verify option injection rejection (`--all`), control/whitespace character rejection, and canonical range emission.

## New-breakage check

No new quality, security, or interface breakage was identified. The changes are strictly confined to `src/security-runner.ts` and `tests/security-runner.test.ts`. All exported types, function signatures, and constants conform to the Task 2 specification.

## Final scoped verdict

FOUNDRY_REVIEW SECURITY-2-FIX APPROVE

All eight security review findings from Task 2 are RESOLVED with comprehensive fail-closed validation, immutable registries, strict containment, safe Windows execution handoff, and thorough test defenses.
