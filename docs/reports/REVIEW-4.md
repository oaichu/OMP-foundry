# Review 4: Task 4 — Routing, Context Suppression, and Documentation

FOUNDRY_REVIEW 4 BLOCK

## Verdicts

- **Spec compliance:** BLOCK
- **Task quality:** REQUEST_CHANGES
- **Actionable finding count:** 2

## Evidence reviewed

- Requirements brief: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-4-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-4-report.md`
- Complete review package: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-4-review.diff`
- Resulting Task 4 artifacts: `tests/resolver.test.ts`, `tests/router-v2.test.ts`, and `README.md`
- Routing contracts used to assess whether the assertions exercise production behavior: `src/skills/resolver.ts`, `src/skills/phase-filter.ts`, `skills/web/shadcn-ui/SKILL.md`, and `skills/web/web-interface-guidelines/SKILL.md`
- Documentation truth sources: `skills/SOURCES.md`, `skills/design/SOURCES.md`, `skills/design-foundation/SKILL.md`, and `skills/design/design-quality/SKILL.md`

Per the assignment, the focused tests were not rerun. Their green result is implementer-reported: 12 passing tests, 0 failures, and 50 expectations across the two prescribed files. The supplied complete diff and resulting source/test artifacts were inspected directly.

## Spec-compliance review

| Requirement | Result | Evidence |
| --- | --- | --- |
| Limit Task 4 to routing coverage and README documentation without changing Router v2, security gates, dependencies, or vendoring policy | PASS | The complete package changes only `tests/resolver.test.ts`, `tests/router-v2.test.ts`, and `README.md` (57 additions and 5 deletions). It contains no production source, permission, AATP, package manifest, lockfile, or shipped skill-body change. |
| Normal React/Next implementation without `components.json` excludes `shadcn-ui` | PASS | `nextApp()` creates React, Next, and TypeScript evidence and creates `components.json` only on request (`tests/resolver.test.ts:9-23`). The negative route uses the default fixture and asserts exclusion (`tests/resolver.test.ts:54-57`). |
| The same app with `components.json` includes `shadcn-ui` and its React companion | PASS | The positive route enables the marker and asserts both `shadcn-ui` and `react-engineering` (`tests/resolver.test.ts:59-61`). This matches the manifest's marker and required companion (`skills/web/shadcn-ui/SKILL.md:4-11`). |
| Web review includes `web-interface-guidelines` and `design-quality` while excluding design authoring | PASS | The review fixture asserts both review skills and excludes `design-intelligence`, `design-system-contract`, and `design-foundation` (`tests/resolver.test.ts:77-85`). |
| Non-web routing excludes both adapters | PASS | The minimal FastAPI/Python fixture is isolated under the system temp directory (`tests/resolver.test.ts:25-35`) and both implementation and review routes assert exclusion of both adapter IDs (`tests/resolver.test.ts:88-97`). |
| Strong backend/database AATP context suppresses both new adapters | BLOCK | The test proves context suppression for the implementation-eligible `shadcn-ui`, but its `web-interface-guidelines` assertion is lifecycle-ineligible and therefore cannot exercise context suppression. In an eligible review route, current production logic retains this L1 web adapter despite strong backend context. See Finding 1. |
| Repeated routing has deterministic skill IDs and identical score rows | REQUEST_CHANGES | Reusing one fixture correctly removes filesystem-input variation, and the selected skill-ID arrays are compared. However, only three fields from each score row are compared, and the chosen scenario does not retain either new adapter in the score rows. See Finding 2. |
| README accurately documents the native design stack and adapter activation | PASS | The design stack, marker-gated shadcn adapter, web-only review adapter, and precedence are documented at `README.md:262-268`. These claims match the coordinator/quality manifests, the two adapter manifests, and the generated precedence contract at `src/skills/resolver.ts:209-212`. |
| README preserves source attribution/no-vendoring policy without falsely making upstream corpora a runtime package dependency | PASS | `README.md:265` identifies the reviewed sources, says upstream repositories and prompt corpora are not vendored, auto-synced, or runtime dependencies, and separately describes on-demand fresh official documentation. This matches `skills/SOURCES.md` and `skills/design/SOURCES.md`; the web-review skill treats current official rules as advisory review-time input. The Task 4 package adds no external corpus, package dependency, resolver fetch, or verification hook. |
| Produce the prescribed focused green run and scoped commit | PASS (reported/package evidence) | The implementer report records the exact focused command with 12/12 tests passing and identifies commit `60c0262be767a7a01eb9a71152cbdd9b02878fe7`; the review package identifies the same single commit and three-file scope. |

## Task-quality review

The resolver fixtures are compact, readable, and use real filesystem evidence through the production detector and resolver. The marker's negative and positive cases, web-review lifecycle contract, design-authoring exclusions, and non-web exclusions defend observable behavior rather than source text. Reusing a single directory for both deterministic calls is a material improvement over comparing independently created fixtures. The README addition is organized around existing capability owners and accurately distinguishes shipped native guidance from advisory, current official documentation.

Two load-bearing gaps prevent approval. First, the backend-context test labels a phase-filtered adapter as context-suppressed and therefore hides an actual mismatch between the requested behavior and Router v2's L1 policy. Second, the determinism assertion narrows a seven-field score-row contract to three fields and runs after both new adapters have been removed from candidate scores. These are not cosmetic test-style concerns: plausible regressions in adapter context routing, evidence explanations, context cost, and reason ordering would remain green.

## Actionable findings

### 1. High — The backend-context case does not test, and production does not provide, suppression of `web-interface-guidelines`

**Locations:** `tests/router-v2.test.ts:29-48`; `skills/web/web-interface-guidelines/SKILL.md:4-10`; `src/skills/phase-filter.ts:21-22`; `src/skills/resolver.ts:145-164`

The test fixes the state to `implementation` and the role to `implementer` (`tests/router-v2.test.ts:30-33`). The guideline adapter is authorized only for `review`/`qa` and `reviewer`/`qa`, so `filterPhaseRole` removes it before any repository or task-context score is computed. Consequently, the assertion at line 48 would pass with no context at all and cannot show that strong backend AATP evidence suppressed the adapter.

The source contract exposes a deeper mismatch. When the adapter is lifecycle-eligible during review, it is L1 and has positive `web` repository evidence. The L1 return at `src/skills/resolver.ts:158` occurs before the strong-context suppression branch at line 163, so a backend/database review in a detected web repository retains `web-interface-guidelines`. That contradicts the required claim that strong backend context suppresses both new adapters and makes the implementer report's context-suppression claim inaccurate.

**Required resolution:** parent Foundry must reconcile this acceptance criterion with Task 4's prohibition on Router v2 production changes. Either revise the accepted contract to describe lifecycle exclusion rather than context suppression, or authorize the appropriate source/manifest owner to make the adapter suppressible under strong unrelated task context. Then add phase-eligible baseline/control routes demonstrating that each adapter is selected without the backend context and deselected with it. Do not satisfy the requirement with an assertion on an adapter excluded before scoring.

### 2. Medium — Determinism coverage compares partial rows and excludes both new adapters from the scored scenario

**Locations:** `tests/router-v2.test.ts:63-70`; `src/skills/resolver.ts:34-41,145-164,184-186`

The score assertion projects each row to `{ id, score, selected }`. A production `SkillRoutingScore` also includes `repoEvidence`, `contextEvidence`, `contextCost`, and `reasons`; none of those fields is covered by the equality check, despite the brief requiring identical score rows. Stable numeric totals can therefore mask nondeterministic evidence or explanation ordering.

The scenario also uses an implementation-phase strong Postgres/Supabase context. `web-interface-guidelines` is removed by phase/role filtering, while the unrelated L3 `shadcn-ui` candidate is removed by strong-context filtering before `scores` is built. The repeated comparison therefore does not prove that either new adapter participates deterministically in routing scores.

**Required correction:** retain the same fixture directory, but compare the complete score arrays (`first.scores` and `second.scores`) and explicitly establish that the relevant new adapter score row is present in each lifecycle-eligible deterministic scenario. Because the adapters have different lifecycle contracts, separate implementation and review repetitions are appropriate. Assert full row equality and stable adapter ordering rather than projecting away observable score evidence.

No additional actionable findings exist.
