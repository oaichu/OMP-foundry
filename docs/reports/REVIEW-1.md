# Review 1: Task 1 — Strengthen Native Art Direction Contract

FOUNDRY_REVIEW 1 REQUEST_CHANGES

## Verdicts

- **Spec compliance:** REQUEST_CHANGES
- **Task quality:** REQUEST_CHANGES
- **Actionable finding count:** 1

## Evidence reviewed

- Requirements brief: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-1-brief.md`
- Implementer report: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-1-report.md`
- Complete review diff: `.superpowers/sdd/2026-08-29-frontend-skill-stack-integration/task-1-review.diff`
- Complete touched source and test artifacts, the existing `design-foundation` consumer, and the cited upstream repository metadata/source.

Per the assignment, the focused test was not rerun. Its green result is implementer-reported: 6 passing tests, 0 failures, and 42 expectations. The pre-change side of the supplied diff lacks the newly asserted evidence, so the required red condition is statically supported, but whether the implementer actually ran that red step is not independently observable from the package.

## Requirement review

| Requirement | Result | Evidence |
| --- | --- | --- |
| Touch only the five Task 1 files | PASS | The package changes exactly `skills/design/design-intelligence/SKILL.md`, `templates/DESIGN.md`, `skills/design/SOURCES.md`, `skills/SOURCES.md`, and `tests/design-skills.test.ts`. |
| Preserve the native design manifest frontmatter | PASS | The diff starts below the closing frontmatter delimiter; ID, version, layer, domain, phases, roles, priority, activation, and description are unchanged. |
| Require subject, audience, single job, 4–6 colors, type roles, layout concept, signature, semantic structure/effects, genericity critique, complexity fit, responsiveness, keyboard focus, and reduced motion | PASS | The compact additions to `design-intelligence` cover every named contract and every exact test term. |
| Preserve the one-primary-style rule and cross-platform taxonomy | PASS | The existing selection rule, complete style grammar, Liquid Glass/Glassmorphism distinction, Spatial UI distinction, and Bento supporting-grammar rule remain intact. |
| Add the requested evidence under the existing template sections without removing existing sections or checklist contracts | PASS | `Design intent` gains Concrete subject, Single job, and Hero thesis; `Visual language` gains Layout concept, Signature element, Compact palette, Typography roles, and Genericity critique. Existing section and checklist content remains intact. Because `design-foundation` owns and locks this document before production implementation, the Genericity critique field is pre-build evidence. |
| Record all three research sources in both provenance files, preserve no-vendoring/runtime-independence policy, and require fresh official documentation when needed | REQUEST_CHANGES | Both files name all three repositories and contain the required original-distillation, no-vendoring, and freshness policy, but both also make an unsupported Apache-2.0 claim for `vercel-labs/agent-skills`; see Finding 1. |
| Add the specified focused assertions with registry-parse coverage | PASS | Tests assert all eight body terms, all three template labels, and every source in both provenance files. Loading the registry at module initialization continues to expose parse failures. The substring assertions match the explicit Task 1 test contract and are proportionate for Markdown control-plane text. |
| Preserve compatibility with `design-foundation` | PASS | The consumer still requires `design-intelligence`; its ID and activation contract are unchanged, and the template additions remain within the sections the foundation already owns. No runtime external skill dependency was introduced. |
| Produce the requested focused green run and commit | PASS (reported/package evidence) | The implementer report records 6/6 focused tests passing with no registry error, and the package identifies commit `ee9ca3a0f3095137922055103ce053160b420493`. |
| Avoid vendoring or copying complete upstream files | PASS | The diff adds six compact native instruction lines and provenance entries only; it adds no upstream corpus, clone, bundle, remote resolver, or full upstream file. Comparison with the cited Frontend Design source shows a compact task-directed distillation rather than a vendored file. |

## Actionable findings

### 1. Medium — Correct the unsupported Vercel license attribution

**Locations:** `skills/SOURCES.md:18`; `skills/design/SOURCES.md:15`

Both entries label `vercel-labs/agent-skills` as `Apache-2.0`. The cited repository exposes no root license metadata/file, and its `skills/web-design-guidelines/SKILL.md` exposes no skill-level license. The skill links to the separate `vercel-labs/web-interface-guidelines` repository, which is MIT-licensed, but that does not establish an Apache-2.0 license for `vercel-labs/agent-skills`. This makes the newly added provenance fact source-inaccurate and could mislead downstream license review.

**Required correction:** remove the unsupported license label or replace it with attribution grounded in the actual cited source and its verified license. If the linked MIT-licensed guidelines repository is added as the content source, retain the brief-required `vercel-labs/agent-skills` mention while distinguishing the two repositories.

No additional actionable findings exist.
