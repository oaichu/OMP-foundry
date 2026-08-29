# Security Tooling Integration Design

**Status:** Approved for implementation by the human request to assess and attach the security stack.
**Base:** `feat/frontend-skill-stack` after the frontend adapter work.
**Related source:** `docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md`.

## Problem

OMP Foundry already ships native `security` and `security-review` guidance, but it does not provide a deterministic scanner command, tool availability policy, normalized scan evidence, or a finding-verification/triage handoff. The requested Trail of Bits, code-review-skills, and claude-security-skills repositories provide useful workflows, but they are separate Claude/Codex skill marketplaces with different licenses, tool contracts, and execution assumptions.

The integration must improve security coverage without copying incompatible prompt trees, granting shell mutation to governed workers, treating a public repository as CodeQL-eligible, or presenting a partial scan as a clean result.

## Evidence and corrections

| Input | Verified fact | Integration decision |
|---|---|---|
| `trailofbits/skills` | Marketplace repository; GitHub metadata reports CC-BY-SA-4.0. It contains separate plugins for audit context, differential review, static analysis, FP checking, insecure defaults, supply-chain review, and vulnerability triage. | Use as research and optional sidecar marketplace. Do not vendor into the MIT Foundry package. |
| `JeremyMorgan/code-review-skills` | 22 focused review skills; repository metadata and README report CC0-1.0. It is prompt-based, not a scanner. | Use as optional sidecar for deep auth/authz/injection/business-logic reviews. Distill only stable concepts into native guidance. |
| `sabakan0123/claude-security-skills` | README claims MIT, while GitHub API exposes no recognized repository license. `security-review`, `full-scan`, and `security-scan` have different diff/full/runtime scopes. | Do not vendor or auto-install until licensing is independently clarified. Document as excluded/optional research. |
| Semgrep | OSS CLI is local and useful for pattern scans; cross-file/interprocedural security analysis is a Pro/AppSec capability. Registry configs can emit telemetry unless disabled. | Fixed argv always includes `--metrics=off`; never use `--config auto`; report OSS limitations. |
| Gitleaks | Detects secrets in Git history/files; upstream currently describes the project as feature complete with security patches only. | Keep as a required-by-policy optional binary with redaction and baseline support; document maintenance limitation. |
| Trivy | Apache-2.0 scanner for filesystem, dependencies/SBOM, vulnerabilities, misconfiguration, secrets, and licenses. | Run filesystem `vuln,misconfig,secret` scan; keep output SARIF and explicit status. |
| CodeQL CLI | Official CLI terms restrict use to OSI-approved open-source codebases or academic research and prohibit automated CI/CD use absent the applicable commercial terms. Public GitHub visibility alone is insufficient. | Opt-in only; require a recognized OSI-approved project license plus configured database/suite and installed CLI. Otherwise `BLOCKED` or `NOT_APPLICABLE`, never automatic execution. |

## Goals

1. Keep Foundry native security guidance as the runtime authority and preserve the existing `security-review` owner for differential, insecure-default, and static-pattern review.
2. Add a native finding-verification skill covering threat model, data-flow proof, false-positive checking, and brocard triage.
3. Add a native supply-chain skill covering direct/transitive advisories, maintainer/install-script evidence, and explicit unassessable states.
4. Add a fixed-argv security runner for Semgrep, Gitleaks, Trivy, and opt-in CodeQL.
5. Support `status`, `diff`, `full`, and `codeql` user commands with bounded output, sanitized execution environment, tool versions, coverage, and explicit `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN` statuses.
6. Persist ignored run manifests under `.omp/security/` and make `release-required`/`required` policies gate `/release-check` on a fresh run for the current Git HEAD.
7. Keep external Trail of Bits and code-review-skills packages as documented sidecars; do not auto-install or vendor them.
8. Add deterministic unit/contract tests using injected process executors; CI must not depend on security binaries, network, or live rule registries.

## Non-goals

- No OS sandbox implementation. Existing `FOUNDRY_VERIFY_REQUIRE_SANDBOX=1` remains the explicit external sandbox path.
- No automatic installation, update, or trust of scanner binaries or third-party rulesets.
- No arbitrary command strings, shell interpolation, worker shell access, or scanner auto-fix.
- No full CodeQL database builder in this release; CodeQL runs only against an explicitly configured existing database and suite.
- No claim that this stack equals Codex Security's sandbox, coverage, or independent service.
- No automatic merge of scanner findings into AATP tickets; human/reviewer finding adjudication remains authoritative.
- No release gate based on a stale report, missing coverage, unknown license, or tool self-report alone.

## Native capability ownership

| Capability | Owner | Phase/role |
|---|---|---|
| Trust boundaries, auth/authz, injection, secrets, insecure defaults, differential review | Existing `security-review` | Planning/review; planner/reviewer |
| Finding proof, FP check, threat model, ACCEPT/DISMISS/NEEDS-MORE-INFO triage | New `security-finding-verification` | Review/QA; reviewer/QA |
| Dependency/advisory/install-script risk and unassessable coverage | New `security-supply-chain` | Planning/review/QA; planner/reviewer/QA |
| Tool selection, fixed commands, SARIF/coverage/status evidence | New `security-scanners` | Review/QA; reviewer/QA |
| Release freshness gate | `security-runner` + release helper | Parent extension only |

The existing `core/security`, `core/verification`, `security-review`, and risk-based `security-reviewer` routing remain. New skills do not replace React/web/design skills or Foundry governance.

## Security configuration

Read the bounded project overlay from `.omp/config.yml`:

```yaml
security:
  policy: optional              # optional | release-required | required
  tools: [semgrep, gitleaks, trivy]
  timeout_ms: 300000
  semgrep:
    configs: [p/security-audit]
  codeql:
    database: .omp/security/codeql.db
    suite: .omp/security/security.qls
```

Rules:

- Missing `security:` means `policy: optional` and the default explicit tools `semgrep`, `gitleaks`, and `trivy` when a user invokes `/security`; it never runs automatically.
- Unknown policy/tool/config syntax yields `BLOCKED`, not a guessed default.
- `optional` reports scan results but does not affect `/release-check`.
- `release-required` requires a fresh `full` or explicitly requested policy-compatible run at the current HEAD before `/release-check` can be ready.
- `required` additionally requires every configured tool to be present and runnable in the invoked run; missing tools or incomplete coverage block release.
- Tool IDs and scanner arguments are selected from a closed registry. Project config selects known IDs/config labels only; it never supplies an executable or shell command.

## Runner contract

`src/security-runner.ts` exposes pure planning/parsing plus an injected executor for tests:

```ts
export type SecurityToolId = "semgrep" | "gitleaks" | "trivy" | "codeql";
export type SecurityMode = "status" | "diff" | "full" | "codeql";
export type SecurityResultStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export type SecurityPolicy = "optional" | "release-required" | "required";

export interface SecurityToolResult {
  tool: SecurityToolId;
  status: SecurityResultStatus;
  exitCode?: number;
  version?: string;
  argv: string[];
  outputPath?: string;
  findings?: number;
  reason?: string;
}

export interface SecurityRunManifest {
  runId: string;
  mode: Exclude<SecurityMode, "status">;
  policy: SecurityPolicy;
  head: string;
  startedAt: string;
  completedAt: string;
  tools: SecurityToolResult[];
  coverage: { requested: number; completed: number; blocked: number; notRun: number };
  status: SecurityResultStatus;
  mergedSarifPath?: string;
}
```

Execution invariants:

- Resolve a unique output directory under `.omp/security/`; reject symlink/path escapes.
- Use `executeVerifyStep`/the existing trusted executable and sanitized environment; never invoke a shell.
- Keep all output files in the run directory, redact Gitleaks output, cap process time/output, and retain only bounded summaries in the manifest.
- `PASS` requires exit 0 plus valid SARIF when the tool declares SARIF output.
- Exit 1 with valid findings is `FAIL`; non-zero without valid output, missing executable, timeout, malformed SARIF, or unsafe paths is `BLOCKED`.
- A skipped/inapplicable tool is `NOT_RUN` and appears in coverage; it is never silently treated as pass.
- Merge valid SARIF runs deterministically by tool then rule/location; preserve raw per-tool artifacts.
- `semgrep` argv always contains `--metrics=off` and an explicit configured `--config`; `--config auto` is rejected.
- `gitleaks` argv uses `--redact` and SARIF output; `diff` uses a bounded Git range, while `full` scans history/files according to the selected mode.
- `trivy` argv uses `fs --scanners vuln,misconfig,secret --format sarif`.
- `codeql` first checks project license against an explicit OSI-approved SPDX allowlist and requires configured database/suite; unknown/private/unlicensed projects are blocked before process execution.

## Commands and release integration

Register `/security [status|diff|full|codeql]` as a user-opt-in command. `status` never scans; it reports config, tool availability, and last manifest. Scan modes show the fixed plan in the command result and then execute only the closed tool set. The command never changes product files or AATP state.

`/release-check` calls a pure `securityReleaseReady(cwd)` helper. It checks policy, current HEAD, manifest freshness, requested tool coverage, and aggregate status. It does not accept stale, partial, blocked, or unassessable results as a clean release. `optional` returns a non-blocking informational result.

`narrowFoundryGitignore` adds `.omp/security/` so raw reports do not dirty governed worktrees. Security manifests are extension evidence, not user-editable governance artifacts.

## Sidecar installation policy

Document, but do not auto-install:

```text
omp plugin marketplace add trailofbits/skills
```

Trail of Bits sidecars remain under their upstream license and namespace. `code-review-skills` remains an independent CC0 sidecar. `claude-security-skills` remains excluded until its repository license is clarified. Sidecar prompts cannot mutate Foundry state or bypass AATP gates.

## Verification acceptance

- Native security skill registry parses all added manifests and preserves existing phase/role routing.
- Config parser rejects unknown policies, tools, executable overrides, shell metacharacters, malformed lists, and oversized config.
- Tool planning emits fixed argv with no shell string; Semgrep always has `--metrics=off`; Gitleaks always has redaction; Trivy has the declared scanner set.
- Missing executable, timeout, malformed SARIF, exit-1 findings, clean exit, unsafe output path, and incomplete coverage map to the declared statuses.
- CodeQL is not executed for missing/unknown/non-OSI license or missing database/suite; an eligible configured fixture reaches the fixed analyzer plan.
- Fresh HEAD and policy checks gate release; stale/partial/blocked/not-run manifests do not.
- `/security status` and `/security full` register without changing AATP or locked artifacts.
- Existing frontend routing tests remain green.
- Run `bun test`, `bun run typecheck`, `bun run check:omp-contract`, and `npm pack --dry-run`.
- Run the native security review of the final diff and report unavailable external binaries explicitly; no clean-scan claim is valid when Semgrep/Gitleaks/Trivy/CodeQL are absent.
