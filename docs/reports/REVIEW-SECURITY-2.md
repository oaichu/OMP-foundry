# Security Review: Task 2 — Config and Fixed Tool Planning

FOUNDRY_REVIEW SECURITY-2 REQUEST_CHANGES

## Verdicts

- **Spec compliance:** REQUEST_CHANGES
- **Quality/security:** REQUEST_CHANGES
- **Actionable finding count:** 8

## Evidence reviewed

- Requirements brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-report.md`
- Complete review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-2-review.diff`
- Approved design and implementation plan: `docs/superpowers/specs/2026-08-29-security-tooling-design.md:69-138` and `docs/superpowers/plans/2026-08-29-security-tooling-integration.md:167-239`
- Resulting Task 2 artifacts: `src/security-runner.ts` and `tests/security-runner.test.ts`
- Trusted execution and path contracts: `src/verify-runner.ts:12-39,93-128`, `src/paths.ts:37-64`, and `src/skills/detector.ts:125-134`
- Git-HEAD behavior: `src/release.ts:24-27`
- Current SPDX license-list metadata for the disputed allowlist entries: `CC0-1.0` and `WTFPL` are both explicitly marked `isOsiApproved: false` in `https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json`.

Per the assignment, no formatter, linter, project-wide test, scanner, or source-changing command was run. The implementer report records the required red failure (missing `src/security-runner.ts`) followed by 27 passing focused tests and 77 expectations; those results are implementer-reported rather than independently rerun here. The full diff and resulting source/test artifacts were inspected directly.

## Executive assessment

The change gets several important fundamentals right: the required public union types and manifest/result field shapes match the approved contract; scanner executables are fixed IDs; planned execution arguments are arrays rather than shell programs; Semgrep includes `--metrics=off`, explicit `--config`, SARIF, and output flags; Gitleaks includes redaction and SARIF flags; Trivy uses the required exact scanner set; CodeQL does not infer eligibility from repository visibility; and the Task 2 diff contains no process execution, SARIF parsing/merging, or run-manifest persistence. The two-file scope also matches the brief.

Approval is nevertheless unsafe. Existing invalid security configuration can silently downgrade a required release policy to optional; the release helper accepts structurally incomplete and internally inconsistent manifests; the CodeQL legal gate admits licenses that are not OSI-approved and uses false-positive-prone text markers; configured CodeQL database/suite presence is not checked; planned output paths can escape the governed run tree; the trusted executor handoff is not preflighted and is path-gated on Windows; strict config/list/closed-registry bounds are missing; and the Gitleaks diff range is not actually bounded. The focused tests mostly cover nominal examples and therefore remain green across these plausible security regressions.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| Exact required exported types/interfaces | PASS | `src/security-runner.ts:7-77` exports the four exact unions and the specified `SecurityToolResult`/`SecurityRunManifest` field shapes. `SecurityConfig`, parsing, planning, and release-result surfaces are also exported. |
| Bounded, strict parsing of only the top-level `security:` block | REQUEST_CHANGES | The 512 KiB and timeout bounds exist (`src/security-runner.ts:21-23,181-183,269-275`), but nested unknown keys and malformed list forms can be ignored/defaulted, no list/scalar count bounds exist, one-space-indented `security:` is accepted as top-level, and forbidden-key/metacharacter scans run over unrelated configuration (`src/security-runner.ts:161-174,195-225,255-325`). See Finding 7. |
| Closed fixed executable IDs and no shell | PARTIAL | Semgrep, Gitleaks, Trivy, and CodeQL executable IDs are literals and args are arrays (`src/security-runner.ts:411-510`); the existing executor uses `spawnSync(..., shell: false)` (`src/verify-runner.ts:93-128`). However, the planner trusts mutable/runtime config values, converts parse errors to default plans, and never consumes `trustedExecutable`. See Findings 6 and 7. |
| Trusted execution handoff and explicit plan statuses | REQUEST_CHANGES | Steps use `VerifyStep`, but unavailable/untrusted executables are still labelled `PLANNED`, and absolute `step.cwd` is rejected by the Windows repository path gate. See Finding 6. |
| Safe absolute run/output paths | REQUEST_CHANGES | Default paths are absolute, but injected `runDir`/`runId` and symlink components are not validated, so returned output paths need not be absolute or remain under `.omp/security/runs`. See Finding 5. |
| Semgrep telemetry and config invariants | PARTIAL | Nominal parsed plans contain `scan`, `--metrics=off`, explicit `--config`, `--sarif`, and `--output`, and the parser rejects `auto`/`p/auto` (`src/security-runner.ts:288-295,412-416`). A directly supplied `SecurityConfig`, a parse-error result, malformed list syntax, or unbounded/unapproved config labels bypasses that validation. See Finding 7. |
| Gitleaks and Trivy argv | PARTIAL | Redaction/SARIF flags and Trivy's exact `fs --scanners vuln,misconfig,secret --format sarif` sequence are present (`src/security-runner.ts:430-466`). The Gitleaks `--log-opts` value is arbitrary caller text, not a validated bounded Git range. See Finding 8. |
| CodeQL OSI license, database, and suite gate | REQUEST_CHANGES | Visibility is correctly ignored and missing strings produce `BLOCKED`, but the allowlist includes non-OSI licenses, root markers are substring matches, and nonexistent/unsafe database and suite paths are planned. See Findings 3 and 4. |
| Release freshness, completeness, coverage, and PASS-only semantics | REQUEST_CHANGES | Nominal HEAD equality, aggregate status, blocked/not-run counts, and configured-tool PASS checks exist (`src/security-runner.ts:562-656`), but invalid config loading fails open and manifest data is type-asserted rather than validated. Policy/mode, required fields, coverage consistency, and a nonempty current HEAD are not enforced. See Findings 1 and 2. |
| Tests/TDD defend plausible security regressions | REQUEST_CHANGES | The reported red/green sequence is consistent with TDD and nominal acceptance examples are covered. The suite has no adversarial cases for existing invalid config files, nested/malformed syntax, list bounds, planner revalidation, executable trust/handoff, path traversal/symlinks, non-OSI allowlist entries, negative license text, real CodeQL database/suite presence, unbounded refs, empty Git HEAD, or incomplete/inconsistent manifests. Several unsafe behaviors are positively encoded, notably planning CodeQL without creating the database or suite (`tests/security-runner.test.ts:253-274`). |
| No premature execution or SARIF persistence; scope discipline | PASS | The package changes only `src/security-runner.ts` and `tests/security-runner.test.ts`. Production code imports read-only filesystem operations and creates plans/readiness decisions; it does not spawn scanners, write run files, parse/merge SARIF, update `latest.json`, install binaries, or mutate governance state. Reading the latest manifest for the required release helper is within Task 2 scope. |

## Quality/security review

The implementation is readable and the nominal argv construction is easy to audit. It also reuses the existing `VerifyStep`, `safeRepoPath`, and Git HEAD concepts rather than introducing a shell executor. Those strengths are outweighed by fail-open authority-boundary behavior. The hand-written YAML-like parser is permissive exactly where the design requires strict errors, public mutable registries weaken the claimed closed sets, filesystem evidence is accepted via unchecked type assertions and substring license heuristics, and path/executable checks are deferred or bypassed. The tests mirror happy paths instead of trying the malformed and adversarial inputs most likely to regress a security/release gate.

## Actionable findings

### 1. High — An existing invalid security config silently downgrades a required release gate to optional

**Locations:** `src/security-runner.ts:526-550`; `tests/security-runner.test.ts:281-299`

`securityReleaseReady` distinguishes neither a missing config (the one case where the optional default is documented) from an existing config that is oversized, a symlink, a directory, unreadable, or otherwise rejected by the path/stat/read checks. Any such condition leaves `config` unset; the broad catch and lines 540-541 then call `parseSecurityConfig("")`. The helper consequently returns `ready: true`/`NOT_REQUIRED` at lines 554-559. For example, making a previously `release-required` `.omp/config.yml` exceed 512 KiB bypasses the release policy instead of yielding `BLOCKED`. This also prevents the parser's own oversize error from ever being used on the file-loading path.

The tests cover a missing manifest under a valid required config and directly parsing an oversized string, but not an existing invalid config passed through the release helper.

**Required correction:** default to optional only on a proven `ENOENT` for the canonical config path. Treat unsafe path resolution, symlinks, non-files, oversize files, read failures, and parse errors as a structured `BLOCKED` release result. Add release-helper tests for oversized, symlinked/non-regular, unreadable/malformed, and genuinely absent config cases.

### 2. High — Unvalidated manifest JSON can satisfy the release gate without being a complete or policy-compatible run

**Locations:** `src/security-runner.ts:562-656`; `src/release.ts:24-27`; `tests/security-runner.test.ts:302-412`

Disk JSON is cast directly to `SecurityRunManifest` at line 571. The helper never validates required fields (`runId`, `mode`, `policy`, timestamps, argv, all four coverage counters), enums, timestamp ordering, unique tools, coverage arithmetic, aggregate/tool-status consistency, manifest policy equality, or whether the mode is release-policy-compatible. A minimal object containing only a matching `head`, aggregate `PASS`, `{ blocked: 0, notRun: 0 }`, and one apparent `PASS` entry per configured tool reaches `ready: true` despite not being a complete manifest. Negative/missing counters can also bypass the `> 0` check. Conversely, missing `coverage` or a non-array `tools` throws instead of returning fail-closed `BLOCKED`.

Freshness also becomes fail-open when `gitHead(cwd)` returns `""`: line 588 guards equality with `expectedHead &&`, so any nonempty manifest head is accepted when current HEAD cannot be established. The tests construct fully typed, internally consistent fixtures and never vary policy/mode or corrupt completeness/coverage; the test titled “matches HEAD, policy” does not include a policy-mismatch assertion.

**Required correction:** parse disk evidence through a bounded runtime schema validator and reject every missing, extra-invalid, non-finite/negative, duplicate, or inconsistent field. Require a nonempty current Git HEAD and exact equality; require manifest policy and a release-compatible mode; require requested/completed/blocked/not-run counts to agree with unique tool records and aggregate status; and require exactly one PASS record for each configured tool with no BLOCKED/NOT_RUN record. Add malformed, partial, inconsistent, policy/mode-mismatch, duplicate-tool, and empty-HEAD tests.

### 3. High — The CodeQL legal gate recognizes non-OSI and ambiguous licenses

**Locations:** `src/security-runner.ts:80-159,340-394`; `tests/security-runner.test.ts:120-158`

The alleged OSI allowlist contains `CC0-1.0` (line 111) and `WTFPL` (line 157), while the current SPDX license-list data explicitly marks both entries `isOsiApproved: false`. Package license matching is also case-insensitive rather than recognizing exact allowlisted SPDX identifiers. For root files, generic substring tests such as `/MIT License/i`, `/released into the public domain/i`, and `/Public Domain Dedication/i` can classify text like “this project is not distributed under the MIT License,” a multi-license notice, or an unrelated dedication as project-wide CodeQL eligibility. The exported `Set` is mutable at runtime, so another in-process consumer can add an arbitrary license and change this legal decision globally.

The positive MIT/Apache tests and `UNLICENSED` negative test do not exercise a non-OSI SPDX ID, a negated/ambiguous root marker, mixed license text, casing, or registry mutation. Public repository visibility is not consulted, which is correct but does not repair these false positives.

**Required correction:** derive and review an internal immutable exact-ID allowlist from authoritative OSI/SPDX metadata, remove every `isOsiApproved: false` entry, and do not expose a mutable decision registry. Match `package.json.license` as an exact supported SPDX ID/expression policy. Replace loose root substrings with conservative, anchored/canonical bounded markers that cannot be satisfied by negation or incidental notices. Add explicit CC0/WTFPL, negated-MIT, mixed/proprietary, malformed/oversized package, and canonical-license tests.

### 4. High — CodeQL is planned when the configured database and suite do not exist or are unsafe

**Locations:** `src/security-runner.ts:313-320,470-500`; `tests/security-runner.test.ts:240-274`

The gate at lines 482-483 checks only that the two strings are nonempty. It does not require an existing CodeQL database, an existing suite file/approved suite label, repository containment, correct file/directory type, or freedom from symlink traversal. Planning then forwards both raw strings directly to CodeQL. The positive test creates only `package.json`; it never creates `.omp/security/codeql.db` or `.omp/security/security.qls`, yet it requires a `PLANNED` result. That test therefore codifies the opposite of the approved design's “explicitly configured existing database and suite” pre-execution gate.

Shell metacharacter rejection does not make a path safe: absolute paths, `..` traversal, symlink components, and nonexistent leaves contain no shell syntax. A missing/unsafe database or suite would be discovered only after the proprietary CLI is launched, contrary to the requirement to stop before process execution.

**Required correction:** resolve database and suite through a dedicated safe-path/approved-label gate before producing a CodeQL step. Require the expected existing non-symlink database directory and suite regular file (or an explicitly documented closed suite-label form), reject traversal/out-of-repo paths and type mismatches, and return a `BLOCKED` plan with a bounded reason. Update the positive test to create valid artifacts and add missing, symlink, traversal, absolute-outside, and wrong-type cases.

### 5. High — Caller-controlled run paths can escape the governed tree or produce non-absolute scanner outputs

**Locations:** `src/security-runner.ts:397-416,430-471,513-519`; `src/paths.ts:37-64`; `tests/security-runner.test.ts:166-274`

`runId` and `runDir` are accepted verbatim. `resolve(cwd, ".omp/security/runs", runId)` allows a run ID containing parent traversal or an absolute segment to leave the intended tree, while a supplied `runDir` can be relative, outside the repository, a file, or below a symlink. The four output paths are then formed with `join` and returned without canonical containment or absolute-path checks. Once Task 3 executes these plans, scanner `--output`/`--report-path` flags can write or overwrite files outside `.omp/security/runs`.

The tests only inspect flag presence and reuse `step.outputPath`; none asserts that the run directory/output is absolute, canonical, symlink-free, unique, and beneath the governed prefix.

**Required correction:** validate a bounded run-ID grammar, derive the production run directory exclusively beneath a canonical `.omp/security/runs` root, and authorize every output path with the repository/symlink gate plus an explicit under-prefix check. If test injection of a run directory remains necessary, validate it under a clearly scoped safe root and always normalize it to an absolute path. Block unsafe plans before any `VerifyStep` is returned, and add traversal, absolute-outside, relative, symlink-component, and containment tests for every scanner output.

### 6. High — The trusted-executable handoff is neither status-aware nor executable on Windows

**Locations:** `src/security-runner.ts:397-500`; `src/verify-runner.ts:12-39,93-97`; `src/paths.ts:37-60`; `tests/security-runner.test.ts:166-274`

The brief names `trustedExecutable` as a consumed interface, but `security-runner.ts` never imports or calls it. Every non-CodeQL-gated scanner is labelled `PLANNED` regardless of whether its fixed ID resolves to a trusted executable; `NOT_RUN` is declared but never produced. This makes plan status misleading and defers a required availability/trust decision.

The eventual executor handoff is also broken on the assigned Windows platform. Every planned step sets `cwd` to the caller's normally absolute repository path (lines 422, 446, 462, and 500). `executeVerifyStep` passes that value to `safeRepoPath`; on Windows, the drive component such as `C:` matches the forbidden-colon component check at `src/paths.ts:51-53`, so execution returns `PATH_GATE` before checking the executable. Existing verification steps omit root `cwd` or use repository-relative paths, which is the compatible convention. The tests assert only the constructed object and never hand a planned step through the trusted path/executor gate.

**Required correction:** keep executable IDs closed, preflight them with the existing trusted resolver so availability is reflected as `PLANNED` versus `BLOCKED`/`NOT_RUN` according to policy, and still re-resolve at execution to avoid trusting stale paths. Omit `step.cwd` for repository root or use `"."`, never the absolute root. Add focused tests for missing/untrusted binaries, policy status, repository-local executable rejection, and an actual planned-step path handoff on Windows-compatible path semantics.

### 7. High — Parsing and planning do not form a strict, bounded, closed validation boundary

**Locations:** `src/security-runner.ts:12-18,161-174,181-338,407-416`; `tests/security-runner.test.ts:19-115,166-186`

Several malformed inputs that the design requires to become `BLOCKED` are accepted or silently defaulted:

- unknown nested keys under `semgrep` and `codeql` are skipped at lines 297-299 and 319-321;
- `tools: semgrep` or `configs: p/security-audit` is treated as an empty list rather than invalid syntax, and trailing garbage after an inline `]` is ignored;
- there is no maximum item count or per-label/path length despite the explicit list-bound requirement;
- the parser scans forbidden keys/metacharacters across the entire project config before locating `security:`, so unrelated blocks can spuriously fail despite the “parse only the top-level security block” rule;
- the top-level detector permits one leading whitespace character, so it can select a nested/non-top-level block;
- `planSecurityTools` does not reject `config.error`; because an error result has `tools: []`, line 407 silently plans the default tools;
- a directly constructed config with `semgrep.configs: ["auto"]` bypasses the parser and emits `--config auto`, and runtime unknown/duplicate tool values are silently omitted or duplicated rather than blocked;
- the exported tool/policy arrays/record are mutable, so the claimed closed registry can be changed in process.

These are not merely YAML feature gaps: a typo in a security-only nested key can produce a clean result from the wrong/default rule set, and a later caller that forgets a separate `config.error` check receives a valid-looking plan for invalid config. Current tests cover only the prescribed nominal syntax and a few direct errors.

**Required correction:** make parsing strict and block-local, with exact indentation/key grammar, duplicate/unknown-key rejection at every level, required list syntax, bounded list counts and scalar lengths, and validated config-label/path forms. Make the planner independently enforce the parsed-result/error and all fixed invariants, including Semgrep's no-auto rule and runtime enum/duplicate checks. Keep closed registries internal and immutable. Add malformed nested key, scalar-list, trailing-token, duplicate-key, oversized-list/label, unrelated-block, nested-security, parse-error-to-plan, direct-auto, unknown-runtime-tool, and duplicate-tool tests.

### 8. Medium — Gitleaks `diff` accepts an arbitrary, unbounded `--log-opts` program

**Locations:** `src/security-runner.ts:402,430-439`; `tests/security-runner.test.ts:188-208`

Diff planning concatenates arbitrary `baseRef` and `headRef` strings into `${baseRef}...${headRef}` without length, grammar, revision-resolution, ancestry, or commit-count checks. `shell: false` prevents shell injection, but it does not make `--log-opts` inert: Gitleaks interprets this value as Git-log options. Caller-controlled flags/whitespace or a very large history selection can therefore change scan semantics or defeat the required bounded range. The only test supplies the already-benign `HEAD~1` and `HEAD` values and asserts containment, not an exact validated range or rejection behavior.

**Required correction:** accept only bounded validated revision inputs (or derive them internally), reject control/option syntax and overlong refs, resolve both commits safely through fixed Git argv, enforce the intended ancestry/maximum range, and emit one canonical range argument. Add invalid-option, whitespace/control, nonexistent-ref, unrelated-history, excessive-range, initial-commit, and exact-argv tests.

No additional actionable findings were identified within the Task 2 diff. In particular, fixed executable IDs and direct argv construction avoid shell interpolation in the reviewed code, the required nominal Semgrep/Gitleaks/Trivy flags are present, repository visibility is not used as a CodeQL license proxy, and execution/SARIF persistence remain correctly deferred to later tasks.
