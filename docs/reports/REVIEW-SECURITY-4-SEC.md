# Security Review: Task 4 — Register `/security` and Gate Release Freshness

FOUNDRY_REVIEW SECURITY-4 APPROVE

## Verdicts

- **Spec compliance:** APPROVE
- **Quality/security:** APPROVE
- **Actionable finding count:** 0

## Evidence reviewed

- Task 4 requirements brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-4-brief.md`
- Task 4 implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-4-report.md`
- Task 4 review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-4-review.diff`
- Resulting source artifacts:
  - `src/omp-runtime.ts` (`narrowFoundryGitignore`)
  - `src/security-runner.ts` (`securityStatus`, `SecurityToolStatus`, `SecurityStatusResult`)
  - `src/index.ts` (`/security` command registration, `/release-check` gate integration)
- Resulting test artifacts:
  - `tests/index-integration.test.ts` (gitignore narrowing, command registration & dispatching, release-check gate)
  - `tests/security-runner.test.ts` (`securityStatus` inspection, `securityReleaseReady` freshness & coverage suite)
- Foundry governance state: `.omp/foundry-state.yml` (checked for zero unauthorized mutations)

Per review instructions, no formatters, linters, project-wide tests, or external scanners were executed. Test evidence reported by the implementer demonstrates a clean Red phase (missing exports & commands) followed by 106 passing tests across `tests/index-integration.test.ts` and `tests/security-runner.test.ts` (373 expectations). All source and test artifacts were verified via read-only inspection.

## Executive assessment

Task 4 successfully integrates the deterministic security engine into Foundry's user-facing CLI and automated release gating without expanding the security attack surface or compromising governance invariants.

Key strengths:
1. **Narrowed Gitignore Behavior (`src/omp-runtime.ts:narrowFoundryGitignore`)**:
   - Accurately appends `.omp/security/` to the required ignore list.
   - Preserves existing state files (`.omp/foundry-state.yml`, `.omp/company-state.yml`, etc.) and user-defined ignore rules (`node_modules/`, `dist/`).
   - Specifically strips bare `.omp/` or `.omp` entries to avoid blanket ignoring the governance directory.
   - Enforces atomic write semantics via `atomicConfigWrite` and path traversal safety via `safeRepoPath`.

2. **Safe `securityStatus` Inspection (`src/security-runner.ts:securityStatus`)**:
   - Reads configuration safely using `safeRepoPath`, `lstatSync`, symlink rejection, and `MAX_CONFIG_BYTES` boundary checks.
   - Evaluates tool availability using `trustedExecutable` / injected resolver, strictly inspecting PATH and safe binary locations without executing scanner processes.
   - Reads `.omp/security/latest.json` safely via `readLatestSecurityManifest`.
   - Purely observational with zero filesystem mutation or subprocess invocation.

3. **Strictly Sandboxed `/security` Command (`src/index.ts:registerFoundryExtension`)**:
   - Parses input strictly with `.trim().toLowerCase()`.
   - Only accepts four fixed subcommands: `status` (or empty default), `diff`, `full`, `codeql`.
   - Unknown or malicious arguments are rejected with a clear usage warning.
   - Scan modes delegate to `runSecurityScan(ctx.cwd, sub)` with no arbitrary command, flag, or file path injection paths.
   - Output is cleanly formatted and displayed via `orchestrate(pi, ...)`.

4. **Robust Release Gate Integration (`src/index.ts:/release-check`)**:
   - Evaluates `securityReleaseReady(ctx.cwd)` and conjunctions `ready = deriveRelease(ctx.cwd, state) && secCheck.ready`.
   - Correctly renders informational `ℹ SECURITY NOT_REQUIRED (policy: optional)` under optional policy without blocking release.
   - Under required/release-required policies, displays `✓/✗ SECURITY <status> (<reason>)` and blocks release if security checks are stale, unrun, or failing.
   - Leaves AATP tickets, manifest hashes, locked plan/design hashes, and governance state machine transitions untouched.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| `narrowFoundryGitignore` includes `.omp/security/` | PASS | `src/omp-runtime.ts:289-294`: Adds `.omp/security/` to `required` array, preserves other required patterns, removes bare `.omp/`, and uses `atomicConfigWrite`. |
| `securityStatus` safe reader | PASS | `src/security-runner.ts:1513-1571`: Reads config and latest manifest safely with symlink/size bounds; resolves tool availability without subprocess execution. |
| `/security` command registration & strict validation | PASS | `src/index.ts:1044-1110`: Registers `/security` strictly handling `status`, `diff`, `full`, `codeql`; rejects any other input with usage notification. |
| `/release-check` security line & gating | PASS | `src/index.ts:1111-1126`: Calls `securityReleaseReady(ctx.cwd)`, gates `ready`, renders informational line for optional policy and pass/blocked for required policy. |
| Non-mutating governance posture | PASS | Inspection confirms no mutations to AATP tickets, locked artifact hashes, or governance transitions during `/security` or `/release-check`. |
| Hermetic test defense | PASS | `tests/index-integration.test.ts:558-670` & `tests/security-runner.test.ts:1152-1397`: Complete test defense for gitignore narrowing, command dispatch, and release gating (fresh, stale, partial, blocked, missing tool). |

## Quality/security review

The implementation adheres to strict security principles:
- **No Command/Shell Injection**: Argument parsing is bounded to an explicit whitelist of mode literals (`status`, `diff`, `full`, `codeql`). No user input is passed to shell or executable spawning routines.
- **Fail-Closed Release Gate**: Under required policies, releases cannot proceed unless a valid, fresh manifest for the current HEAD commit with all passing tools exists.
- **Symlink & Traversal Protections**: All path lookups use `safeRepoPath` and `lstatSync` checks.
- **Data Isolation**: Security scan outputs and SARIF reports remain isolated under `.omp/security/`, which is ignored from git.

## Actionable findings

None. Implementation is clean, secure, and fully compliant with specification requirements.
