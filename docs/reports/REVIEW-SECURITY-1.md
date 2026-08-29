# Security Review: Task 1 — Native Security Control-Plane Skills

FOUNDRY_REVIEW SECURITY-1 REQUEST_CHANGES

## Verdicts

- **Spec compliance:** REQUEST_CHANGES
- **Task quality:** REQUEST_CHANGES
- **Actionable finding count:** 3

## Evidence reviewed

- Requirements brief: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-report.md`
- Complete review package: `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-review.diff`
- Resulting Task 1 artifacts: `skills/security-review/SKILL.md`, `skills/security/finding-verification/SKILL.md`, `skills/security/supply-chain/SKILL.md`, `skills/security/scanners/SKILL.md`, `skills/SOURCES.md`, and `tests/security-skills.test.ts`
- Registry and routing contracts: `src/skills/manifest-schema.ts`, `src/skills/registry.ts`, `src/skills/phase-filter.ts`, and `src/skills/resolver.ts`
- Governance boundaries: `src/permissions.ts` and the approved security tooling design/implementation plan
- Current upstream repository/license evidence for `trailofbits/skills`, `JeremyMorgan/code-review-skills`, `sabakan0123/claude-security-skills`, Semgrep, Gitleaks, Trivy, and CodeQL; current official CodeQL database-creation documentation was also checked for analyzer-limit accuracy

Per the assignment, the focused test was not rerun. Its green result is implementer-reported: 4 passing tests, 0 failures, and 33 expectations. The supplied package and resulting source/test artifacts were inspected directly.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| Keep Task 1 scoped to native skills, provenance, and the focused registry test | PASS | The package changes exactly the six brief-owned files and contains no package manifest, lockfile, runner, command, permission, state, or lifecycle implementation change. |
| Strengthen `security-review` without replacing its manifest or verdict-only contract | PASS | `skills/security-review/SKILL.md:2-10` retains the existing manifest. Lines 15-23 preserve native/no-fix/verdict behavior and add context-first orientation, diff/history/blast-radius prioritization, scanner-as-lead treatment, explicit coverage limits, and a verification/triage handoff. Lines 27-29 retain all three passes and cover auth/authz, APIs, injection, secrets, business logic, insecure defaults, and static patterns. |
| Implement the finding-verification contract | REQUEST_CHANGES | The exact manifest and required threat-model/data-flow, classification, disposition, and no-fabrication vocabulary are present (`skills/security/finding-verification/SKILL.md:2-11,16-41`), but the unconditional two-way classification conflicts with the required `NEEDS-MORE-INFO` path and can force an unsupported exploitability verdict. See Finding 2. |
| Implement the supply-chain contract | PASS | `skills/security/supply-chain/SKILL.md:16-29` requires advisory/version evidence, lockfile coverage and integrity, install/publisher risk, explicit `UNASSESSABLE` rows, measured rather than speculative claims, and static inspection without dependency installation, builds, package managers, or package scripts. |
| Implement the scanner guidance contract | REQUEST_CHANGES | Fixed argv, no shell intermediary, redaction, SARIF evidence, exit-state interpretation, and explicit Semgrep/CodeQL limitations appear at `skills/security/scanners/SKILL.md:16-30`. However, the body assigns execution and artifact preservation to a reviewer/QA-routed skill even though scanner execution is parent-extension-owned, and its CodeQL limitation is factually overbroad. See Findings 1 and 3. |
| Exact metadata for all three new manifests | PASS | `skills/security/finding-verification/SKILL.md:2-11`, `skills/security/supply-chain/SKILL.md:2-11`, and `skills/security/scanners/SKILL.md:2-11` exactly match the specified IDs, version 1, L2 layers, domains, phases, roles, priorities, activation lists, and descriptions. |
| Parse through the real registry and retain existing phase/role/JIT routing | PASS | `src/skills/registry.ts:5-11,13-31,52-80` parses comma-separated fields and nested activation keys, validates lifecycle values, and recursively materializes `SKILL.md` entries. `tests/security-skills.test.ts:4-8` loads the production registry, and lines 22-76 assert parsed routing/activation values. `src/skills/phase-filter.ts:12-22` maps `security-reviewer` to `reviewer` and filters by the declared contracts; `src/skills/resolver.ts:145-188,199-215` retains the existing ranked, bounded, on-demand resolver rather than adding a second or eager loader. |
| Preserve one capability owner and fail-closed worker boundaries | REQUEST_CHANGES | Discovery, proof/triage, supply-chain assessment, and scan planning remain separated by skill ID and metadata, and no governance source was changed. The scanner body nevertheless tells the reviewer/QA skill to execute scanners and persist evidence. That crosses the approved parent-extension execution boundary despite the existing precedence and permission gates. See Finding 1. |
| Record exact research/tool URLs and accurate license status | PASS | `skills/SOURCES.md:20-33` contains the exact Trail of Bits, Jeremy Morgan, sabakan0123, Semgrep, Gitleaks, Trivy, and CodeQL repository URLs. Current upstream evidence confirms Trail of Bits CC-BY-SA-4.0, Jeremy Morgan CC0-1.0, Semgrep LGPL-2.1, Gitleaks MIT, Trivy Apache-2.0, and the `github/codeql` query repository MIT license with a separately qualified proprietary engine. The sabakan repository still exposes no recognized repository license file/API result despite its README claim, so `unresolved license` is the accurate conservative statement. |
| Enforce Trail sidecar-only/no-vendoring policy and exclude unresolved-license content | PASS | `skills/SOURCES.md:22` labels Trail content CC-BY-SA-4.0 research/sidecar input only and says no text or rules are vendored. Line 24 confines the unresolved sabakan repository to external research and forbids copying its code, text, or rules. Line 33 applies the no-runtime-dependency/no-vendored-corpus policy across all security inputs. |
| Avoid copied full corpora and external runtime dependencies | PASS | The new bodies are compact 29-41-line native control planes rather than copied upstream trees. Comparison with the relevant Trail false-positive and brocard workflows shows a short task-directed distillation, not a reproduced corpus. The package adds no clone, bundle, package dependency, remote resolver, scanner binary, or runtime import; the focused test uses only Bun/Node facilities and the existing registry. |
| Produce the requested focused green run and scoped commit | PASS (reported/package evidence) | The implementer report records the prescribed focused command with 4/4 passing tests and commit `b847daf68c6d9701bd4218193097b3b850a1f87b`; the review package identifies the same single commit and six-file scope. |

## Task-quality review

The change is compact, readable, and structurally consistent with the existing catalog. The manifests use the established parser surface, lifecycle routing remains JIT and deterministic, capability topics are mostly separated cleanly, provenance is conservative about incompatible or unresolved licenses, and the diff introduces no runtime weight. The focused tests load the real registry rather than duplicating frontmatter parsing.

Three load-bearing guidance defects prevent approval. The scanner skill crosses a hard ownership boundary by instructing reviewer/QA workers to execute scanners and preserve artifacts. The finding-verification flow forces every item into `TRUE_POSITIVE` or `FALSE_POSITIVE` before allowing an insufficient-evidence disposition, undermining its own no-invention rule. Finally, the CodeQL limitation incorrectly makes successful compilation universal even though current CodeQL supports no-build extraction for several languages. These are operational and security-adjudication errors, not wording preferences; the passing substring/metadata tests do not demonstrate that the prose control planes are safe or internally consistent.

## Actionable findings

### 1. High — Keep scanner execution parent-extension-owned instead of assigning it to reviewer/QA workers

**Locations:** `skills/security/scanners/SKILL.md:6-10,16,20-23`; `src/skills/phase-filter.ts:12-22`; `src/permissions.ts:27-28,97-116,153-156`

The manifest routes this skill to `reviewer` and `qa`, but line 16 says to “Plan and execute” scans, line 20 tells the skill how to launch scanner processes directly, and lines 21-23 tell it to sanitize and persist scanner artifacts. The approved architecture keeps governed workers shell-free/read-only and makes scanner execution and run-manifest persistence parent-extension responsibilities. Avoiding `sh -c` or `cmd.exe` does not make direct child-process execution worker-owned. Existing precedence and permission gates remain fail-closed, so following this skill either attempts a prohibited action or creates a second execution owner beside the later `security-runner`.

**Required correction:** make this a planning/evidence-adjudication skill only. Explicitly state that governed reviewers/QA never launch scanners, write SARIF/run artifacts, or bypass AATP/worker gates; they provide a fixed-argv plan or request the parent-owned `/security` runner and interpret the returned redacted evidence. Treat unavailable parent execution, missing artifacts, partial coverage, and tool errors as explicit non-pass/unassessed states rather than inviting direct execution.

### 2. Medium — Do not force an evidence-insufficient finding into `TRUE_POSITIVE` or `FALSE_POSITIVE`

**Locations:** `skills/security/finding-verification/SKILL.md:16,26-35,39-40`

Line 26 requires every analyzed item to receive exactly one of two classifications, while line 35 correctly reserves `NEEDS-MORE-INFO` for missing architecture or runtime evidence. When that evidence is absent, neither the line 27 true-positive proof standard nor the line 28 false-positive proof standard has been met. The unconditional classification therefore contradicts both the missing-information gate and lines 16/40, which forbid invented exploitability and theoretical claims. It can turn uncertainty into a false dismissal or unsupported vulnerability claim.

**Required correction:** require `TRUE_POSITIVE` or `FALSE_POSITIVE` only after the corresponding proof threshold is met. If evidence is insufficient, assign neither classification and emit `NEEDS-MORE-INFO` with the exact missing evidence. State valid classification/disposition relationships so a false positive cannot be accepted and an unresolved candidate cannot be silently dismissed.

### 3. Medium — Correct the universal CodeQL compilation claim

**Location:** `skills/security/scanners/SKILL.md:28`

The body says deep CodeQL analysis “requires successful code compilation” and cannot analyze “uncompiled source states.” Current official CodeQL CLI documentation supports `--build-mode=none` for C#, Java, JavaScript/TypeScript, Python, and Ruby, while other languages/build modes may require an instrumented build. Extractor/database completeness is the real boundary; successful compilation is not universal. The present statement can incorrectly mark valid existing databases or supported no-build analyses as unavailable and distort reported coverage.

**Required correction:** describe CodeQL as requiring a compatible, successfully extracted database and configured query suite, with coverage dependent on the language, extractor, and selected build mode. Retain the valid limitation that generated runtime behavior absent from the database is not analyzed, but do not claim all CodeQL analysis requires compilation.

No additional actionable findings exist.
