# Security Tooling Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add governed, fixed-argv security scanning and finding adjudication to OMP Foundry while keeping external security skill repositories as optional sidecars.

**Architecture:** Extend the existing native `security-review` control plane, add compact native finding-verification, supply-chain, and scanner skills, and implement a pure-planning `security-runner` that executes only a closed registry of Semgrep, Gitleaks, Trivy, and opt-in CodeQL commands through Foundry's trusted sanitized verifier. Persist bounded run manifests under ignored `.omp/security/`, expose `/security status|diff|full|codeql`, and gate `/release-check` only for explicitly configured policies.

**Tech Stack:** TypeScript, Bun test, OMP extension API, direct child-process execution through `executeVerifyStep`, SARIF 2.1.0, bounded YAML-like project config, Git.

**Spec:** `docs/superpowers/specs/2026-08-29-security-tooling-design.md`

## Global Constraints

- Base is the current `feat/frontend-skill-stack` branch after frontend tasks; preserve package version `0.8.23` and existing AATP/plan/design/worker gates.
- External Trail of Bits content is CC-BY-SA-4.0 research/sidecar only; do not vendor it into the MIT package. Do not vendor `claude-security-skills` while its license remains unclear.
- Keep governed workers shell-free/read-only; scanner execution is parent-extension-owned and fixed-argv only.
- Never use Semgrep `--config auto`; every Semgrep invocation includes `--metrics=off`.
- CodeQL requires a recognized OSI-approved license plus configured database and suite; GitHub public visibility alone never qualifies.
- Missing tools, malformed output, timeout, stale HEAD, partial coverage, and unknown license are explicit non-pass states.
- No network, scanner binary, or live rule registry is required by CI tests; use injected executors and hermetic fixtures.
- No automatic scanner fixes, AATP ticket mutation, or direct default-branch push.

---

## File Map

- Modify `skills/security-review/SKILL.md`: absorb audit-context, risk-first differential, auth/authz/injection/API/secrets/business-logic, insecure-default, and static-analysis handoff rules without external pointers.
- Create `skills/security/finding-verification/SKILL.md`: native FP-check and brocard triage control plane.
- Create `skills/security/supply-chain/SKILL.md`: dependency/advisory/install-script and unassessable-evidence control plane.
- Create `skills/security/scanners/SKILL.md`: fixed-argv tool semantics, SARIF/coverage/status and tool limitation guidance.
- Modify `skills/SOURCES.md`: record verified security research sources, licenses, and no-vendoring policy.
- Create `src/security-runner.ts`: config parsing, tool planning, fixed argv, execution result normalization, SARIF merge, run manifest persistence, and release freshness check.
- Modify `src/omp-runtime.ts`: ignore `.omp/security/` output in project Git configuration.
- Modify `src/index.ts`: register the user-opt-in `/security` command and include security readiness in `/release-check` without changing AATP state transitions.
- Create `tests/security-runner.test.ts`: pure runner/config/SARIF/policy tests using injected process results.
- Create `tests/security-skills.test.ts`: native security manifest and provenance contract tests.
- Modify `tests/index-integration.test.ts`: assert `/security` command registration and no mutation of governance tools.
- Modify `README.md`: document the security flow, policy values, sidecar boundaries, tool limitations, and exact install/scan semantics.

---

### Task 1: Add Native Security Control-Plane Skills

**Files:**
- Modify: `skills/security-review/SKILL.md`
- Create: `skills/security/finding-verification/SKILL.md`
- Create: `skills/security/supply-chain/SKILL.md`
- Create: `skills/security/scanners/SKILL.md`
- Modify: `skills/SOURCES.md`
- Create: `tests/security-skills.test.ts`

**Interfaces:**
- Consumes: existing `SkillManifest` registry and security-reviewer role routing.
- Produces: compact native skills selected by existing phase/role routing and loaded on demand through `foundry_skill_read`.

- [ ] **Step 1: Write failing registry/provenance assertions**

Create a real-registry test that asserts:

```ts
expect(byId.get("security-review")?.body).toContain("context");
expect(byId.get("security-review")?.body).toContain("differential");
expect(byId.get("security-review")?.body).toContain("insecure-default");
expect(byId.get("security-review")?.body).toContain("static-pattern");
expect(byId.get("security-review")?.body).toContain("auth");
expect(byId.get("security-review")?.body).toContain("business logic");
expect(byId.get("security-finding-verification")).toMatchObject({ phases: ["review", "qa"], roles: ["reviewer", "qa"] });
expect(byId.get("security-supply-chain")).toMatchObject({ phases: ["planning", "review", "qa"], roles: ["planner", "reviewer", "qa"] });
expect(byId.get("security-scanners")).toMatchObject({ phases: ["review", "qa"], roles: ["reviewer", "qa"] });
```

Assert the source file mentions `trailofbits/skills`, `JeremyMorgan/code-review-skills`, and `sabakan0123/claude-security-skills`, and states no-vendoring plus the unresolved-license limitation.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
bun test tests/security-skills.test.ts
```

Expected: FAIL because the three new manifests are absent and the existing security-review body lacks all required handoff terms.

- [ ] **Step 3: Strengthen `security-review`**

Preserve its existing manifest frontmatter and `Do not implement fixes`/verdict contract. Add compact instructions for context-first orientation, risk-first diff/history/blast-radius review, auth/authz/API/injection/secrets/business-logic coverage, insecure-default checks, static tools as leads rather than proof, explicit coverage limits, and handoff to finding verification and triage. Keep the instruction native; remove no existing pass.

- [ ] **Step 4: Add finding-verification, supply-chain, and scanners manifests**

Create manifests with these contracts:

```yaml
# finding-verification
id: security-finding-verification
version: 1
layer: L2
domain: security, triage
phases: review, qa
roles: reviewer, qa
priority: 90
activate_when:
  stacks: web, backend, android, windows, cloud, systems, mobile

description: "Verify security findings with threat-model, data-flow, false-positive, and triage gates."
```

```yaml
# supply-chain
id: security-supply-chain
version: 1
layer: L2
domain: security, supply-chain
phases: planning, review, qa
roles: planner, reviewer, qa
priority: 89
activate_when:
  files: package.json, package-lock.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml

description: "Assess dependency advisories, lockfile coverage, publisher/install risk, and unassessable evidence."
```

```yaml
# scanners
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
```

The bodies must be original compact guidance. `security-finding-verification` applies threat model/data flow, `TRUE_POSITIVE`/`FALSE_POSITIVE`, and `ACCEPT`/`DISMISS`/`NEEDS-MORE-INFO`; it never invents exploitability. `security-supply-chain` quotes measured data, preserves unassessable rows, and never installs/builds dependencies. `security-scanners` requires fixed argv, redaction, SARIF, exit-state interpretation, no shell, and explicit Semgrep/CodeQL limitations.

- [ ] **Step 5: Record security research provenance**

Add a reviewed-security section to `skills/SOURCES.md` with exact repository URLs, Trail license CC-BY-SA-4.0, code-review-skills CC0-1.0, the unresolved license status of claude-security-skills, and the official Semgrep/Gitleaks/Trivy/CodeQL source links. State that these are research/sidecar inputs, not runtime dependencies or vendored corpora.

- [ ] **Step 6: Run the focused skill test and confirm it passes**

Run:

```bash
bun test tests/security-skills.test.ts
```

Expected: PASS with all new manifests parsed by the real registry.

- [ ] **Step 7: Commit the native security skills**

```bash
git add skills/security-review/SKILL.md skills/security/finding-verification/SKILL.md skills/security/supply-chain/SKILL.md skills/security/scanners/SKILL.md skills/SOURCES.md tests/security-skills.test.ts
git commit -m "feat: add native security control-plane skills"
```

---

### Task 2: Implement Config and Fixed Tool Planning

**Files:**
- Create: `src/security-runner.ts`
- Create: `tests/security-runner.test.ts`

**Interfaces:**
- Consumes: bounded `.omp/config.yml` text, `trustedExecutable`, `VerifyStep`, and Git HEAD.
- Produces: exported `SecurityToolId`, `SecurityMode`, `SecurityResultStatus`, `SecurityPolicy`, `SecurityConfig`, `SecurityToolResult`, `SecurityRunManifest`, `parseSecurityConfig`, `planSecurityTools`, and `securityReleaseReady` signatures from the spec.

- [ ] **Step 1: Write failing config/planning tests**

Add tests for:

```ts
expect(parseSecurityConfig("" )).toMatchObject({ policy: "optional", tools: ["semgrep", "gitleaks", "trivy"] });
expect(parseSecurityConfig("security:\n  policy: release-required\n  tools: [semgrep, gitleaks]\n")).toMatchObject({ policy: "release-required", tools: ["semgrep", "gitleaks"] });
expect(parseSecurityConfig("security:\n  tools: [evil]\n").error).toContain("unknown tool");
expect(parseSecurityConfig("security:\n  policy: maybe\n").error).toContain("unknown policy");
expect(parseSecurityConfig("security:\n  executable: sh -c evil\n").error).toContain("executable");
```

Add planning assertions that Semgrep args include `--metrics=off` and explicit `--config`, reject `p/auto`/`auto` configs, Gitleaks args include `--redact` and SARIF output, Trivy args include exactly `fs --scanners vuln,misconfig,secret --format sarif`, and CodeQL plans are blocked without OSI license/database/suite.

- [ ] **Step 2: Run the focused test and verify it fails correctly**

Run:

```bash
bun test tests/security-runner.test.ts
```

Expected: FAIL because `src/security-runner.ts` and its exports do not exist.

- [ ] **Step 3: Implement bounded config parsing**

Parse only the top-level `security:` block and known nested keys. Enforce the existing 512 KiB config limit, accepted policy/tool enums, bounded timeout, list size, no executable override, and no shell-control characters in labels/paths. Return a structured parse error instead of silently defaulting malformed input. Missing block returns the documented optional default.

- [ ] **Step 4: Implement closed tool planning**

Build `VerifyStep` values with fixed executable IDs and args. Use safe absolute output paths under the run directory. Never accept an executable or command from project config. Define exact planning rules:

```text
semgrep scan --metrics=off --config <approved-config> --sarif --output <raw.sarif> <target>
gitleaks git --redact --report-format sarif --report-path <raw.sarif> --log-opts <bounded-range> <target>
trivy fs --scanners vuln,misconfig,secret --format sarif --output <raw.sarif> <target>
codeql database analyze <configured-db> --format sarifv2.1.0 --output <raw.sarif> <configured-suite>
```

Use no shell syntax. `diff` must use a bounded Git range; `full` uses the full target/history semantics documented by the tool. CodeQL plan creation must stop before process execution when project license is absent/unrecognized/non-OSI or database/suite is absent.

- [ ] **Step 5: Implement license and release policy helpers**

Recognize only an explicit SPDX allowlist of OSI-approved licenses from `package.json.license` or a bounded root LICENSE marker. Do not infer eligibility from GitHub visibility. `securityReleaseReady(cwd)` must require policy `release-required`/`required`, current HEAD equality, a complete manifest, every configured tool `PASS`, and no `BLOCKED`/`NOT_RUN`; optional policy is informational.

- [ ] **Step 6: Run the focused tests and confirm they pass**

Run:

```bash
bun test tests/security-runner.test.ts
```

Expected: PASS for config, argv, CodeQL gate, policy, and planning cases.

- [ ] **Step 7: Commit planning/config code**

```bash
git add src/security-runner.ts tests/security-runner.test.ts
git commit -m "feat: add governed security tool planning"
```

---

### Task 3: Implement Execution, SARIF, and Run Manifests

**Files:**
- Modify: `src/security-runner.ts`
- Modify: `tests/security-runner.test.ts`

**Interfaces:**
- Consumes: Task 2 planners and `executeVerifyStep`-compatible executor.
- Produces: `runSecurityScan(cwd, mode, options?)`, deterministic SARIF merger, bounded run manifest writer/reader, and explicit tool outcome normalization.

- [ ] **Step 1: Add failing execution/result tests**

Inject process outcomes and assert:

```ts
expect(normalizeToolResult({ exitCode: 0, sarif: validSarif })).toMatchObject({ status: "PASS" });
expect(normalizeToolResult({ exitCode: 1, sarif: sarifWithFindings })).toMatchObject({ status: "FAIL", findings: 1 });
expect(normalizeToolResult({ exitCode: 1, sarif: "" }).status).toBe("BLOCKED");
expect(normalizeToolResult({ error: "ENOENT" }).status).toBe("BLOCKED");
expect(normalizeToolResult({ timedOut: true }).status).toBe("BLOCKED");
expect(normalizeToolResult({ exitCode: 0, sarif: "not-json" }).status).toBe("BLOCKED");
```

Assert merged SARIF ordering is deterministic by tool/rule/location, raw outputs remain per-tool, manifest coverage counts requested/completed/blocked/notRun, and unknown paths are rejected.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
bun test tests/security-runner.test.ts
```

Expected: FAIL on missing execution normalization/merge/persistence behavior.

- [ ] **Step 3: Reuse trusted execution**

Default production execution must call the existing `executeVerifyStep`, which resolves trusted executables, uses direct `spawnSync(shell:false)`, bounded timeout/output, disposable HOME/TMP, and optional external sandbox. The injectable executor is test-only dependency injection; no shell command string is ever executed.

- [ ] **Step 4: Normalize outcomes and SARIF**

Create the run directory safely, execute planned steps, validate each declared SARIF file, count `runs[].results`, map exit/error states exactly, redact Gitleaks summaries, and retain bounded reason strings. Merge only valid SARIF runs into a new SARIF 2.1.0 document sorted by tool then stable rule/location key. Preserve failed/skipped tool records in the manifest.

- [ ] **Step 5: Persist and read manifests**

Write atomically to `.omp/security/runs/<runId>/manifest.json` and update `.omp/security/latest.json` only after all planned tool records and merged SARIF are complete. Store current HEAD, policy, mode, timestamps, coverage, statuses, and relative output paths. Refuse symlink targets and oversized/malformed manifest data.

- [ ] **Step 6: Run the focused tests and confirm they pass**

Run:

```bash
bun test tests/security-runner.test.ts
```

Expected: PASS for execution outcomes, SARIF merge, manifest persistence, cleanup/path safety, and coverage.

- [ ] **Step 7: Commit execution and evidence code**

```bash
git add src/security-runner.ts tests/security-runner.test.ts
git commit -m "feat: record governed security scan evidence"
```

---

### Task 4: Register `/security` and Gate Release Freshness

**Files:**
- Modify: `src/omp-runtime.ts`
- Modify: `src/index.ts`
- Modify: `tests/index-integration.test.ts`
- Modify: `tests/security-runner.test.ts`

**Interfaces:**
- Consumes: `parseSecurityConfig`, `runSecurityScan`, `securityStatus`, and `securityReleaseReady` from `src/security-runner.ts`.
- Produces: user-opt-in `/security status|diff|full|codeql`, ignored `.omp/security/` output, and release-check security evidence.

- [ ] **Step 1: Add failing command/release tests**

Extend the extension API test harness to assert a `security` command is registered. Add release helper tests for optional, fresh complete, stale, partial, blocked, and missing-tool manifests. Assert `narrowFoundryGitignore` writes `.omp/security/` while retaining all existing state ignore entries.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
bun test tests/index-integration.test.ts tests/security-runner.test.ts
```

Expected: FAIL because the command, ignore entry, and release security check are not registered.

- [ ] **Step 3: Register `/security` safely**

Add a command handler with only the four accepted modes. `status` reads config/tool availability/latest manifest and never scans. Scan modes call `runSecurityScan` with no arbitrary target/executable/command input, report plan and final statuses, and never edit product files, AATP specs, locked artifacts, or state transitions. Unknown modes return a usage warning.

- [ ] **Step 4: Add ignored output and release gate**

Update `narrowFoundryGitignore` to add `.omp/security/`. Include a security line in `/release-check` derived from `securityReleaseReady`; for optional policy show informational `NOT_REQUIRED`, for required policies show `PASS`/`BLOCKED` without mutating AATP or changing artifact hashes. Keep existing release criteria intact.

- [ ] **Step 5: Run focused integration tests and confirm pass**

Run:

```bash
bun test tests/index-integration.test.ts tests/security-runner.test.ts
```

Expected: PASS with command registration, ignore behavior, and freshness gate cases.

- [ ] **Step 6: Commit extension integration**

```bash
git add src/omp-runtime.ts src/index.ts tests/index-integration.test.ts tests/security-runner.test.ts
git commit -m "feat: add governed security command and release gate"
```

---

### Task 5: Document Sidecars and Validate the Complete Stack

**Files:**
- Modify: `README.md`
- Modify: `skills/SOURCES.md` if provenance corrections are found.

**Interfaces:**
- Consumes: the complete native runner and sidecar policy.
- Produces: accurate user-facing setup and verification instructions.

- [ ] **Step 1: Update README security section**

Document:

- `context → scan → review → finding verification → triage → release gate` flow;
- `/security status|diff|full|codeql` semantics;
- policy values and freshness behavior;
- fixed-argv/no-autofix/no-shell guarantees;
- Semgrep OSS/Pro distinction and `--metrics=off`;
- Gitleaks feature-complete maintenance caveat;
- Trivy coverage;
- CodeQL OSI-license/database/suite gate and public-is-not-enough rule;
- sidecar commands/namespaces and no-vendoring/license boundary;
- unavailable-tool and partial-scan reporting.

Do not claim Codex Security equivalence or a clean scan when tools are unavailable.

- [ ] **Step 2: Run documentation/registry checks**

Run:

```bash
bun test tests/security-skills.test.ts
```

Expected: PASS and documentation contains no stale claim that external packs are runtime dependencies.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md skills/SOURCES.md
git commit -m "docs: document governed security tooling"
```

- [ ] **Step 4: Run complete project verification**

Run each command with real exit status:

```bash
bun test
bun run typecheck
bun run check:omp-contract
npm pack --dry-run
```

Expected: zero exit codes; tests exceed the 174-test baseline; package dry-run includes `src/security-runner.ts`, native security skills, agents, rules, templates, types, and no `.superpowers`/node_modules.

- [ ] **Step 5: Inspect diff and security posture**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Inspect that no shell interpolation, arbitrary executable/config override, raw secret output, state/AATP mutation, or untracked generated scan output is present.

- [ ] **Step 6: Run available external tool checks honestly**

Check availability without installing silently:

```bash
semgrep --version
gitleaks --version
trivy --version
codeql --version
```

If a binary is missing, record `BLOCKED/NOT_RUN`; do not claim a clean external scan. If tools are installed, run only the explicit configured scan profile with output under a disposable run directory and record all statuses.

- [ ] **Step 7: Run native security review of the final diff**

Use the native `security-review` skill over the final branch. Check command injection, path/symlink escapes, config parser fail-open behavior, CodeQL license gate, secret redaction, stale-manifest release bypass, and output/timeout limits. Resolve every finding before completion or record an explicit ruling.

- [ ] **Step 8: Commit any focused correction and rerun verification**

If a real finding appears, make one focused commit, rerun the covering tests and complete suite, and repeat the native security review on the correction diff. Do not weaken a test to make a scan pass.

- [ ] **Step 9: Push the complete branch without force**

```bash
git push -u origin feat/frontend-skill-stack
```

Expected: remote branch accepted. The maintainer can merge it into the protected default branch after review.
