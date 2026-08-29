# Security Task 1 Fix Round 1 — Scoped Re-review

FOUNDRY_REVIEW SECURITY-1-FIX REQUEST_CHANGES

## Scope and evidence

This re-review is limited to the three findings from `docs/reports/REVIEW-SECURITY-1.md` and breakage introduced by Fix Round 1. Evidence reviewed:

- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-brief.md`
- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-report.md`
- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-fix-review.diff`
- Current `skills/security/scanners/SKILL.md`
- Current `skills/security/finding-verification/SKILL.md`
- Current `tests/security-skills.test.ts`
- The parent-runner ownership, status, coverage, and artifact contracts in `docs/superpowers/specs/2026-08-29-security-tooling-design.md`
- GitHub's current official “CodeQL code scanning for compiled languages” documentation, including its `none`, `autobuild`, and `manual` build-mode guidance

Per the scoped assignment, no tests, formatters, linters, or project-wide commands were rerun. The implementer report records the focused test as 6 passing tests and 0 failures; this review directly inspected the changed prose control planes and their assertions.

## Finding status

### 1. High — Scanner execution and artifact ownership

**Status: RESOLVED**

`skills/security/scanners/SKILL.md:16-26` now makes the routed reviewer/QA workers shell-free and read-only. It limits them to planning scanner evaluation, requesting parent-owned `/security` evidence, verifying the fixed-argv/no-shell execution properties, and adjudicating returned evidence. It expressly prohibits reviewers and QA from launching scanners, spawning shell commands, writing SARIF, persisting execution artifacts, or bypassing AATP work orders.

The same section treats all required absence and failure cases as non-pass conditions:

- missing parent execution or artifacts becomes `UNASSESSED`;
- incomplete runs or unanalyzed changed files become `PARTIAL_COVERAGE`;
- crashes, configuration failures, or missing rules become `TOOL_ERROR`.

That guidance is consistent with the design's parent-owned runner and its rule that missing, partial, blocked, malformed, or not-run evidence is never a clean pass. No new execution-owner or artifact-owner conflict was found.

### 2. Medium — Proof-gated finding classification and dispositions

**Status: PARTIALLY RESOLVED — REQUEST_CHANGES**

The classification defect itself is corrected. `skills/security/finding-verification/SKILL.md:24-30` permits `TRUE_POSITIVE` only after demonstrated reachability/control bypass, realistic preconditions, and measurable impact; it permits `FALSE_POSITIVE` only after conclusive counter-proof. When neither threshold is met, it requires `NEEDS-MORE-INFO` with the exact missing evidence instead of forcing a classification.

The disposition contract remains internally contradictory, however. `skills/security/finding-verification/SKILL.md:34-37` says a disposition must strictly match its classification, but the `DISMISS` rule allows a “documented acceptable risk” and “policy-approved exceptions” in addition to a proven `FALSE_POSITIVE`. That exception can admit a proven true positive—or an evidence-insufficient candidate—into `DISMISS`, while `skills/security/finding-verification/SKILL.md:43` simultaneously requires the strict mappings `TRUE_POSITIVE -> ACCEPT`, `FALSE_POSITIVE -> DISMISS`, and insufficient proof -> `NEEDS-MORE-INFO`.

Because this is a prose control plane, the conflicting permission is operationally significant: either branch can be followed. The correction must make the three mappings unambiguous. Risk acceptance, if represented at all, must not override the finding classification/disposition mapping or turn unresolved evidence into dismissal.

The added test does not protect this contract: it checks for isolated substrings such as `proof threshold`, `False positives must never be accepted`, and `never be silently dismissed`, so it passes even while the contradictory `policy-approved exceptions` branch remains.

### 3. Medium — CodeQL extraction and build-mode limitations

**Status: PARTIALLY RESOLVED — REQUEST_CHANGES**

`skills/security/scanners/SKILL.md:32` correctly adds the compatible, successfully extracted database and configured query-suite requirements, and it correctly says coverage depends on language, extractor, and build mode.

The next parenthetical reintroduces the universal-compilation error for an entire language class: “supported no-build analysis exists for some languages, while compiled languages require extraction during build.” Official GitHub documentation explicitly supports `none` build mode for compiled languages, currently including C/C++, C#, Java, and Rust, with coverage and accuracy tradeoffs. A compiled language therefore does not universally require extraction during a build. Whether a build is required depends on the particular language, extractor, selected mode, repository composition, and desired coverage.

This wording can still cause valid no-build databases for compiled languages to be rejected or their coverage to be adjudicated incorrectly. The statement must retain the database/query-suite requirement but describe build requirements per language and build mode, without contrasting “some languages” against all “compiled languages.”

The added test only requires the body to contain `extracted database` and `no-build`; it therefore passes despite the inaccurate universal clause and does not defend the corrected behavioral contract.

## New-breakage check

No additional scoped behavioral breakage was found in the three-file fix. The unresolved disposition ambiguity and CodeQL overgeneralization are both within the original findings rather than unrelated regressions. The new substring assertions fail to catch both semantic contradictions, so the reported green focused test does not resolve them.

## Final scoped verdict

**REQUEST_CHANGES.** Finding 1 is resolved. Findings 2 and 3 are only partially resolved and still require precise, internally consistent control-plane wording before approval.
