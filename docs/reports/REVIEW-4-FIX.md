# Re-review 4: Task 4 Fix Round 1

FOUNDRY_REVIEW 4 REQUEST_CHANGES

## Scope

Reviewed the original Task 4 brief, implementer report, original review findings, supplied Fix Round 1 diff, the accepted contract-ruling edits, and the resulting routing tests, manifests, resolver/filter behavior, and README wording. Review was limited to the two open findings and breakage introduced by the supplied diff. Per the assignment, no tests, formatters, linters, or project-wide commands were rerun; the reported 14 passing focused tests are implementer evidence rather than reviewer-executed verification.

## Finding 1 — ADDRESSED

The accepted contract now explicitly distinguishes lifecycle eligibility from contextual suppression (`docs/superpowers/plans/2026-08-29-frontend-skill-stack-integration.md:308`). The implementation route tests contextual suppression of the implementation-eligible `shadcn-ui` adapter and no longer treats `web-interface-guidelines` absence as context-suppression evidence (`tests/router-v2.test.ts:29-50`).

The production metadata and routing order support that distinction: `web-interface-guidelines` is L1, limited to review/QA and reviewer/QA, and activated for the web stack (`skills/web/web-interface-guidelines/SKILL.md:4-10`); phase/role filtering occurs before scoring (`src/skills/phase-filter.ts:21-22`; `src/skills/resolver.ts:144-145`); and eligible L1 candidates are retained before the strong-context suppression rule for non-core skills (`src/skills/resolver.ts:157-164`).

The new phase-eligible control uses one web fixture, proves `web-interface-guidelines` and `design-quality` are selected in the baseline review, repeats routing with strong Supabase/Postgres backend context, and proves both remain selected (`tests/router-v2.test.ts:54-74`). The README now accurately describes `shadcn-ui` as contextually suppressible and WIG as implementation-ineligible but available in eligible web reviews (`README.md:263-264`). This resolves the original false suppression claim without changing Router v2 production behavior.

## Finding 2 — ADDRESSED

The former single, ineligible scenario is replaced by separate lifecycle-eligible repetitions:

- Implementation with one reused `components.json` fixture compares the complete selected-skill ID arrays and complete `SkillRoutingScore[]` arrays, then establishes that the `shadcn-ui` row exists and is selected (`tests/router-v2.test.ts:84-99`).
- Web review with one reused fixture performs the same complete array comparisons, then establishes that the `web-interface-guidelines` and `design-quality` rows exist and are selected (`tests/router-v2.test.ts:101-119`).

`expect(first.scores).toEqual(second.scores)` covers every current row field—including repository evidence, context evidence, context cost, selection, and ordered reasons—rather than projecting to three fields. Array equality also preserves score-row order, while the retained selected-ID array equality directly guards stable selected-skill ordering across repeated calls. Both relevant new adapters now participate in their eligible deterministic scenarios.

## New breakage in the fix diff

One documentation-structure regression was introduced in the accepted design-spec edit. At `docs/superpowers/specs/2026-08-29-frontend-skill-stack-design.md:136`, the updated web review/QA acceptance item lost the two-space indentation used by the surrounding children of “Resolver tests prove.” It now renders as a new top-level item, while the following non-web criterion at line 137 remains indented and therefore becomes its child. This breaks the acceptance-list hierarchy and misleadingly detaches the web criterion from the resolver-test group.

Restore the two leading spaces before the line-136 bullet so it is a peer of the resolver criteria at lines 134, 135, and 137. No other new breakage was observed in the supplied diff.

## Final scoped verdict

**REQUEST_CHANGES.** Both original findings are addressed. Approval is withheld solely for the new malformed acceptance-list hierarchy in the contract-ruling diff.
