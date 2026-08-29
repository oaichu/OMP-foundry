# Security Review: Task 3 — Execution, SARIF, and Run Manifests

FOUNDRY_REVIEW SECURITY-3 APPROVE

## Verdicts

- **Spec compliance:** APPROVE
- **Quality/security:** APPROVE
- **Actionable finding count:** 0

## Evidence reviewed

- Task 3 requirements brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-3-brief.md`
- Task 3 implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-3-report.md`
- Task 3 review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-3-review.diff`
- Resulting source artifact: `src/security-runner.ts`
- Resulting test artifact: `tests/security-runner.test.ts`
- Trusted execution runner: `src/verify-runner.ts`
- Safe repository path helper: `src/paths.ts`
- Task 2 review findings and hardening baseline: `docs/reports/REVIEW-SECURITY-2.md` and `tests/security-runner.test.ts:1-550`

Per the assignment, no formatter, linter, project-wide test, external scanner, or source-changing command was run. The implementer report records the required red failure (`Export named 'readSecurityRunManifest' not found`) followed by 72 passing focused tests (including 39 Task 2 hardening tests and 33 Task 3 tests) with 175 expectations. Source and test artifacts were verified directly via read-only inspection.

## Executive assessment

Task 3 implementation delivers a robust, secure, and deterministic execution layer for the security runner.

Key strengths:
1. **Outcome Normalization (`normalizeToolResult`)**: Accurately maps clean exit code 0 with 0 findings to `PASS`, exit codes 0 or 1 with findings to `FAIL`, and empty/malformed SARIF, fatal exit codes (e.g. exit code 2), timeouts, or execution errors to `BLOCKED`. Reason strings are sanitized by stripping control characters/excess whitespace, redacting high-entropy secrets/tokens (≥32 chars alphanumerics/dashes/underscores), and enforcing a strict 500-character upper bound.
2. **Deterministic SARIF Merging (`mergeSarifResults`)**: Produces standard SARIF 2.1.0 output with `$schema` and `version: "2.1.0"`. Runs are sorted deterministically by tool driver name and version. Findings within each run are sorted deterministically across rule ID, file URI, start line, start column, message text, and JSON structure tie-breakers. Non-object, malformed, or missing runs are safely ignored without throwing.
3. **Atomic Manifest Persistence & Safe Readers (`writeSecurityRunManifest`, `readSecurityRunManifest`, `readLatestSecurityManifest`)**: Manifest writes validate data against `validateSecurityRunManifest`, strictly check `runId` regex (`^[a-zA-Z0-9_-]{1,64}$`), verify path containment via `safeRepoPath`, reject symlink directories/files via `lstatSync`, check byte size limits (≤512 KiB), and perform atomic writes via temp files in the destination directory followed by `renameSync` to `.omp/security/runs/<runId>/manifest.json` and `.omp/security/latest.json`. Readers enforce identical path containment, symlink rejection, file size bounds, and runtime schema validation.
4. **End-to-End Orchestration (`runSecurityScan`)**: Plans security tools via `planSecurityTools`, executes steps without shell interpolation via `executeVerifyStep` (or injected step executor), captures raw SARIF artifacts with size and symlink checks (≤10 MiB), merges SARIF to `merged.sarif`, computes exact coverage arithmetic (`requested = completed + blocked + notRun`), determines aggregate status with fail-closed semantics under required policies, and atomically records run manifests.
5. **Hermetic Test Suite**: The test suite covers nominal and adversarial scenarios including missing tools, timeouts, secrets redaction, invalid/oversized/symlinked manifests, malformed SARIF, and diff mode git range propagation.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| `normalizeToolResult` mapping & sanitization | PASS | `src/security-runner.ts:1057-1229`: Maps exit 0 (0 findings) -> PASS, exit 0/1 (>0 findings) -> FAIL, exit 1 (0 findings / empty SARIF) -> BLOCKED, exit 2+ -> BLOCKED, errors/timeouts -> BLOCKED. Sanitizes reasons and redacts secrets. |
| Deterministic `mergeSarifResults` (SARIF 2.1.0) | PASS | `src/security-runner.ts:1267-1351`: Produces standard SARIF 2.1.0 schema, sorts runs by tool name and version, sorts findings by ruleId/URI/line/column/message text, safely skips malformed inputs. |
| Atomic `writeSecurityRunManifest` | PASS | `src/security-runner.ts:1354-1416`: Validates manifest schema, validates `runId`, checks `safeRepoPath`, guards symlinks/dirs with `lstatSync`, enforces ≤512 KiB, writes atomically using tmp files and `renameSync`. |
| Safe `readSecurityRunManifest` & `readLatestSecurityManifest` | PASS | `src/security-runner.ts:1419-1497`: Enforces `runId` validation, path containment with `safeRepoPath`, symlink rejection, ≤512 KiB file size bound, and runtime schema validation. |
| `runSecurityScan` orchestration | PASS | `src/security-runner.ts:1520-1709`: Safely orchestrates tool planning, executes steps without shell using `executeVerifyStep`, collects SARIF artifacts (≤10 MiB), merges SARIF, computes coverage arithmetic, derives aggregate status, and updates latest manifest. |
| Hermetic test defense | PASS | `tests/security-runner.test.ts:550-1151`: Thorough test coverage for outcome normalization, deterministic merging, manifest persistence/reading (symlink, traversal, oversize), and end-to-end scan execution. |

## Quality/security review

The implementation demonstrates high code quality, security discipline, and clean separation of concerns:
- **Fail-closed posture**: Malformed outputs, fatal tool failures, and missing mandatory tools under required policies cleanly result in `BLOCKED` status.
- **No shell execution**: Tool invocations use arrays of arguments with `executeVerifyStep` and `spawnSync(..., { shell: false })`.
- **Atomic filesystem operations**: Manifest writes and latest manifest updates use atomic `writeFileSync` + `renameSync` within the target directory, preventing partially written state or race conditions.
- **Strict path & symlink containment**: Path resolution uses `safeRepoPath` and `lstatSync` at all boundaries to prevent directory traversal and symlink hijacking.
- **Information disclosure protection**: Sensitive tokens in reason strings and tool outputs are redacted before persisting to disk.

## Actionable findings

None. Implementation is clean, robust, and meets all security and specification criteria.
