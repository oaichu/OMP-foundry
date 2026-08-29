# Frontend Skill Stack Integration Design

**Status:** Approved for implementation by the human request to inspect, merge, and publish the complete source.
**Base:** `omp-foundry` upstream `main` at `42cbb364` (package version `0.8.23`).
**Related source:** `docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md`.

## Problem

The installed plugin is `omp-foundry@0.8.22`, while upstream already contains the stable `v0.8.23` baseline plus native design intelligence and Skill Router v2 changes. The current native catalog covers visual-language selection, design-system contracts, and cross-platform design quality, but it does not explicitly encode the strongest parts of the requested UI skill set:

- Anthropic Frontend Design's subject-grounded art direction, deliberate typography/layout/signature choices, two-pass critique, and restrained motion.
- shadcn/ui's project-aware component/registry workflow, composition rules, semantic tokens, and component accessibility contracts.
- Vercel Web Interface Guidelines' web-specific file/line review format and fresh-guideline retrieval.

Vendoring three full upstream skill trees would duplicate Foundry's existing design stack, inflate context, create update/licensing drift, and bypass the existing phase/role router.

## Goals

1. Use upstream `main` as the complete source baseline and retain the released package version `0.8.23`.
2. Keep Foundry's native, compact, progressive skill catalog as the runtime authority.
3. Preserve one owner per capability and route by lifecycle phase and agent role.
4. Strengthen the existing design stack with the useful, source-grounded Frontend Design practices.
5. Add a shadcn-specific implementation/review adapter activated by `components.json`.
6. Add a web-only interface-guidelines review/QA adapter that retrieves current rules during review rather than freezing a remote corpus into the package.
7. Make precedence explicit: governance and functional correctness always outrank style preferences.
8. Add deterministic tests for activation, routing, exclusion, and provenance metadata.
9. Publish the complete source to a non-destructive Git branch; never force-push or overwrite a protected default branch.

## Non-goals

- Do not copy the complete Anthropic, shadcn/ui, or Vercel skill files into the package.
- Do not add a second meta/orchestrator skill; `design-foundation` plus the existing phase/role resolver already owns orchestration.
- Do not make remote guideline retrieval an extension runtime dependency or a hard `/verify` requirement.
- Do not add shell access to governed workers or weaken the read-only bash/LSP gates to run shadcn CLI commands.
- Do not change AATP, plan-lock, artifact ownership, or worker isolation semantics.
- Do not alter the unrelated Fast/Lite/Full router design.

## Capability ownership

| Capability | Existing/new owner | Scope |
|---|---|---|
| Lifecycle design gate | `design-foundation` | Design phase; writes only `docs/DESIGN.md`; human approval remains authoritative. |
| Art direction | `design-intelligence` (existing, enhanced) | Design phase; subject, audience, tone, typography, palette, layout, signature, critique. |
| Durable tokens and component contract | `design-system-contract` (existing) | Design phase; Primitive -> Semantic -> Component tokens, states, responsive/platform rules. |
| Cross-platform visual QA | `design-quality` (existing) | Design/review/QA; hierarchy, contrast, focus, motion, density, effect budget, token drift. |
| shadcn/ui implementation conventions | `shadcn-ui` (new) | Web implementation/review only when `components.json` is present. |
| Web interface compliance | `web-interface-guidelines` (new) | Web review/QA; fresh rules, file:line findings, accessibility, interaction, content, responsive and performance checks. |

The existing React, Next.js, TypeScript, and web-engineering skills remain active companions. No existing skill is removed.

## Routing and manifest contracts

### Enhanced `design-intelligence`

Keep its current manifest ID and activation surface. Extend its body with a compact native distillation of:

- Name the concrete subject, audience, and single job before choosing a visual direction.
- Commit to one intentional aesthetic; do not use generic defaults merely because they are familiar.
- Define a 4–6 color token palette, display/body/utility type roles, layout concept, and one memorable signature element.
- Use content and structural devices only when they clarify the subject.
- Critique the plan for generic convergence before implementation; match code complexity to the chosen direction.
- Require responsive behavior, visible keyboard focus, and reduced-motion behavior.

### New `shadcn-ui`

```yaml
id: shadcn-ui
version: 1
layer: L3
domain: web, design-system
phases: implementation, review
roles: implementer, reviewer
priority: 89
activate_when:
  files: components.json
requires: react-engineering
```

The body must require project-aware inspection of `components.json`, existing UI source, aliases, base primitive, icon library, Tailwind version, and package manager. It must prefer existing components and registry search, compose primitives, use semantic tokens and built-in variants, preserve correct groups/overlay titles/form states, and review generated source before it is accepted. It must explicitly state that governed workers cannot bypass AATP or shell gates; a parent or human may run the project's package-manager-specific shadcn CLI outside a worker only when that action is within the approved scope.

### New `web-interface-guidelines`

```yaml
id: web-interface-guidelines
version: 1
layer: L1
domain: web, accessibility, ux
phases: review, qa
roles: reviewer, qa
priority: 95
activate_when:
  stacks: web
```

The body must direct the reviewer to retrieve the current official rules from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` before each web review, inspect only the requested/ticket-scoped files, and report terse `file:line` findings grouped by file. It must distinguish its web interaction/accessibility responsibility from `design-quality`'s cross-platform visual-language and token-drift responsibility. It may report findings but never modify product code or convert remote guideline changes into an automatic governance mutation.

## Precedence

`skillPackPrompt` must state the following order without implying that skills can override gates:

1. Foundry governance, locked artifacts, and exact AATP scope.
2. Functional correctness and security.
3. Accessibility and semantic interaction.
4. Framework and component-library contracts, including shadcn/base primitive rules.
5. Web interface quality guidelines.
6. Visual art direction and aesthetic novelty.

A visual choice may be bold only when it remains usable, accessible, and within the locked plan and ticket scope.

## Detection

Add `components.json` to the root project markers returned by `detectRepo`. Do not activate shadcn merely because a project uses Tailwind CSS; the marker is the deliberate project-level evidence. Existing stack detection and verification command derivation remain unchanged.

## Provenance

Keep the package's policy that external skill corpora are research inputs, not runtime dependencies. Add source attribution and review notes to `skills/design/SOURCES.md` and `skills/SOURCES.md` for:

- `anthropics/skills` Frontend Design (Apache-2.0 source repository).
- `shadcn-ui/ui` official shadcn skill and documentation.
- `vercel-labs/agent-skills` and its Web Interface Guidelines source command.

The shipped files are original Foundry-native distillations. They must not claim that upstream files are vendored or that remote guidance is cryptographically frozen.

## Design artifact template

Extend `templates/DESIGN.md` only where needed to make the art-direction contract explicit: concrete subject/audience/single job, hero thesis, deliberate type roles, compact palette, layout concept, signature element, and the pre-build genericity critique. Keep existing token, responsive, state, accessibility, motion, QA, and preview sections intact.

## Verification and release acceptance

- Existing baseline remains green before modification: `174 pass`, `0 fail`.
- Registry tests prove both new manifests parse with the declared phase/role/layer/activation values and provenance files mention all three sources.
- Detector tests prove `components.json` appears in web project facts.
- Resolver tests prove:
  - a normal React/Next web implementation does not receive `shadcn-ui` without `components.json`;
  - a shadcn project receives `shadcn-ui` and its React companion;
  - web review/QA receives `web-interface-guidelines` and `design-quality` while design-authoring skills remain excluded; a strong backend implementation context suppresses `shadcn-ui` through contextual routing, while WIG is absent from implementation because its lifecycle contract is review/QA-only and remains available to every eligible web review.
  - non-web projects do not receive web-only adapters.
- Prompt tests prove the precedence text is present and deterministic routing remains stable.
- Run `bun test`, `bun run typecheck`, `bun run check:omp-contract`, and `npm pack --dry-run`.
- Install/link the completed package locally, restart OMP, run `omp plugin doctor`, and confirm the plugin reports healthy.
- Commit the complete change and push a feature branch to the configured remote without force-pushing.
