# Security Task 1 Fix Round 2 — Scoped Re-review

FOUNDRY_REVIEW SECURITY-1-FIX2 APPROVE

## Scope and evidence

This re-review is limited to the two findings left open by `docs/reports/REVIEW-SECURITY-1-FIX.md` and regressions introduced by Fix Round 2. Evidence reviewed:

- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-brief.md`
- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-report.md`
- `.superpowers/sdd/2026-08-29-security-tooling-integration/task-1-fix2-review.diff`
- Current `skills/security/finding-verification/SKILL.md`
- Current `skills/security/scanners/SKILL.md`
- Current `tests/security-skills.test.ts`
- GitHub's current official “CodeQL code scanning for compiled languages” documentation and CodeQL CLI `database analyze` reference

Per the scoped assignment, no tests, formatters, linters, or project-wide commands were rerun. The implementer report records the focused test as 6 passing tests and 0 failures; this review instead checked the current control-plane text and every added assertion directly against the scoped diff.

## Finding status

### 2. Medium — Proof-gated finding classification and dispositions

**Status: RESOLVED**

`skills/security/finding-verification/SKILL.md:24-45` now has one consistent proof and disposition path:

- `TRUE_POSITIVE` requires demonstrated reachability or control bypass, realistic attack preconditions, and measurable impact, and maps only to `ACCEPT`.
- `FALSE_POSITIVE` requires conclusive counter-proof and maps only to `DISMISS`.
- Evidence that proves neither classification emits `NEEDS-MORE-INFO` with the missing evidence or runtime context.

The former “documented acceptable risk” and “policy-approved exceptions” dismissal branches are gone. The residual-risk sentence preserves a proven finding as `TRUE_POSITIVE`, while the operational rule expressly says risk acceptance cannot turn a true positive or unresolved candidate into `DISMISS`. Read together with the exact mapping rule and the prohibition on prematurely accepting unresolved candidates, no governance exception overrides any of the three dispositions.

The focused assertions at `tests/security-skills.test.ts:95-112` now require all three exact mappings and the risk-acceptance separation. They also reject both phrases that created the previous contradictory dismissal path. The current registry body satisfies the required strings and contains neither forbidden phrase.

### 3. Medium — CodeQL extraction and build-mode limitations

**Status: RESOLVED**

`skills/security/scanners/SKILL.md:34-39` retains the compatible, successfully extracted database and configured query-suite prerequisite. Its coverage/build statement now depends on every required dimension: target language, extractor, repository setup, selected build mode (`none`, `autobuild`, or manual), and desired analysis coverage. It no longer says that all compiled languages require extraction during compilation.

That wording matches GitHub's current documented model: `none` is supported for compiled languages including C/C++, C#, Java, and Rust; `autobuild` is used where appropriate; manual mode gives user-controlled coverage; and repository composition such as Java plus Kotlin changes the applicable mode and coverage. The CodeQL CLI reference likewise analyzes a CodeQL database with queries, a suite, or the applicable default suite.

The focused assertions at `tests/security-skills.test.ts:114-133` require the extracted-database language, the multi-factor coverage/build clause, and a selected build mode, while expressly rejecting the former universal “compiled languages require extraction during build” clause. Direct comparison with the current skill body confirms the positive assertions match and the forbidden clause is absent.

## New-breakage check

No new scoped breakage was found. Fix Round 2 changes only the two control-plane paragraphs and their registry-body assertions; manifest metadata, routing, reviewer/QA ownership boundaries, scanner non-pass states, and the remaining tool limitations are unchanged. The new assertions are syntactically consistent with the surrounding Bun test style and target the real registry-loaded bodies rather than duplicate fixtures.

## Final scoped verdict

**APPROVE.** Findings 2 and 3 are resolved, the focused regression assertions cover the prior contradictory clauses, and no new breakage was identified in the three-file Fix Round 2 diff.
