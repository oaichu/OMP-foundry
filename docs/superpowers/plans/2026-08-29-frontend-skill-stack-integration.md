# Frontend Skill Stack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the useful capabilities of Anthropic Frontend Design, shadcn/ui, and Vercel Web Interface Guidelines into the upstream OMP Foundry native skill router without duplicating orchestration or weakening governance.

**Architecture:** Keep `design-foundation` as the design-phase coordinator and retain the existing native design intelligence, contract, and quality owners. Enhance `design-intelligence`, add a `components.json`-activated `shadcn-ui` implementation/review adapter, add a web-only `web-interface-guidelines` review/QA adapter, and make the precedence contract explicit in `skillPackPrompt`.

**Tech Stack:** TypeScript, Bun test, Markdown skill manifests, OMP extension skill registry/resolver, Git.

**Spec:** `docs/superpowers/specs/2026-08-29-frontend-skill-stack-design.md`

## Global Constraints

- Use upstream `main` at `42cbb364` as the source baseline and keep package version `0.8.23`.
- Keep skill files compact, original Foundry-native distillations; do not vendor complete upstream skill trees.
- Preserve one capability owner, progressive/JIT loading, phase/role filtering, AATP scope, locked-artifact gates, and read-only governed-worker bash/LSP policy.
- Activate shadcn only from the deliberate `components.json` project marker, not from Tailwind presence alone.
- Web guidelines are advisory review/QA guidance fetched by the reviewer; they are not a new `/verify` hard dependency.
- Do not force-push or overwrite the default branch; publish a feature branch after all checks pass.

---

## File Map

- Modify `skills/design/design-intelligence/SKILL.md`: absorb subject-grounded art direction and anti-generic critique while preserving the existing manifest ID and activation contract.
- Modify `skills/design/SOURCES.md` and `skills/SOURCES.md`: record research provenance and the no-vendoring policy for the three external sources.
- Modify `templates/DESIGN.md`: expose the new art-direction evidence fields without removing current token, state, accessibility, motion, QA, or preview sections.
- Create `skills/web/shadcn-ui/SKILL.md`: project-aware shadcn component/registry and composition rules for implementers/reviewers.
- Create `skills/web/web-interface-guidelines/SKILL.md`: web-specific fresh-guideline review instructions for reviewers/QA agents.
- Modify `src/skills/detector.ts`: recognize `components.json` as a project fact.
- Modify `src/skills/resolver.ts`: add the explicit governance/quality/architecture/aesthetic precedence to the generated skill-pack prompt; leave deterministic Router v2 scoring unchanged.
- Modify `tests/design-skills.test.ts`: assert the enhanced design-intelligence contract and source provenance.
- Modify `tests/resolver.test.ts`: cover marker-gated shadcn routing, web review routing, authoring-skill exclusion, and non-web exclusion.
- Modify `tests/router-v2.test.ts`: prove new adapters participate in deterministic scores and strong AATP context suppresses unrelated frontend adapters.
- Create `tests/skill-stack.test.ts`: test detector facts, manifest metadata, and precedence prompt as observable contracts.
- Modify `README.md`: document the native design stack and the conditional shadcn/web-review adapters without claiming external corpora are vendored.

---

### Task 1: Strengthen Native Art Direction Contract

**Files:**
- Modify: `skills/design/design-intelligence/SKILL.md`
- Modify: `templates/DESIGN.md`
- Modify: `skills/design/SOURCES.md`
- Modify: `skills/SOURCES.md`
- Test: `tests/design-skills.test.ts`

**Interfaces:**
- Consumes: existing `design-intelligence` manifest and `DESIGN.md` template sections.
- Produces: the same `design-intelligence` manifest ID with additional art-direction instructions and template fields consumed by `design-foundation`.

- [ ] **Step 1: Add failing assertions for art-direction evidence**

Add assertions to the existing native design test for these exact terms in the `design-intelligence` body: `subject`, `audience`, `single job`, `4–6`, `signature`, `generic`, `reduced-motion`, and `keyboard focus`. Assert the design template contains `Hero thesis`, `Signature element`, and `Genericity critique`. Assert both provenance files mention `anthropics/skills`, `shadcn-ui/ui`, and `vercel-labs/agent-skills`.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
bun test tests/design-skills.test.ts
```

Expected: the existing tests pass, and the new assertions fail because the current body/template/provenance do not contain every requested term.

- [ ] **Step 3: Extend `design-intelligence` without changing frontmatter**

Keep its current ID, layer, activation, phase, role, and priority. Add compact rules that require:

```text
Before choosing style, name the concrete subject, audience, and page's single job.
Commit to one direction grounded in that subject. Define a 4–6 color palette, display/body/utility type roles, layout concept, and one signature element.
Use structure, copy, and motion to clarify the subject; do not add numbered markers or effects without semantic purpose.
Critique the plan for generic convergence before implementation and match implementation complexity to the chosen direction.
Keep the result responsive, keyboard-visible, and safe under prefers-reduced-motion.
```

Preserve the existing one-primary-style rule and cross-platform style taxonomy.

- [ ] **Step 4: Extend `templates/DESIGN.md` at existing design sections**

Add fields under `## Design intent` and `## Visual language` for concrete subject, single job, hero thesis, display/body/utility type roles, compact palette, layout concept, signature element, and a pre-build genericity critique. Keep the existing sections and checklist unchanged apart from adding the required evidence rows.

- [ ] **Step 5: Record provenance as research, not runtime dependency**

Add the three source repositories/URLs to `skills/design/SOURCES.md` and `skills/SOURCES.md`. State that the shipped text is an original Foundry distillation, remote rules are not vendored, and current official docs must be fetched when freshness matters.

- [ ] **Step 6: Run the focused test and confirm it passes**

Run:

```bash
bun test tests/design-skills.test.ts
```

Expected: PASS with no registry parse errors.

- [ ] **Step 7: Commit the native design contract**

```bash
git add skills/design/design-intelligence/SKILL.md templates/DESIGN.md skills/design/SOURCES.md skills/SOURCES.md tests/design-skills.test.ts
git commit -m "feat: strengthen native frontend design contract"
```

---

### Task 2: Add Conditional shadcn and Web Guideline Adapters

**Files:**
- Create: `skills/web/shadcn-ui/SKILL.md`
- Create: `skills/web/web-interface-guidelines/SKILL.md`
- Test: `tests/skill-stack.test.ts`

**Interfaces:**
- Consumes: `SkillManifest` frontmatter parsed by `loadRegistry`.
- Produces: `shadcn-ui` (`implementation`/`review`, `implementer`/`reviewer`, `components.json` marker) and `web-interface-guidelines` (`review`/`qa`, `reviewer`/`qa`, `web` stack) manifests.

- [ ] **Step 1: Add failing manifest metadata tests**

Create tests that load `skills/` and assert:

```ts
expect(byId.get("shadcn-ui")).toMatchObject({
  layer: "L3",
  phases: ["implementation", "review"],
  roles: ["implementer", "reviewer"],
  requires: ["react-engineering"],
});
expect(byId.get("web-interface-guidelines")).toMatchObject({
  layer: "L1",
  phases: ["review", "qa"],
  roles: ["reviewer", "qa"],
  priority: 95,
});
```

Also assert the shadcn activation includes `components.json`, the web adapter activation includes `web`, and their bodies contain the governance boundary terms `AATP`, `semantic`, `keyboard`, and `file:line` as appropriate.

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
bun test tests/skill-stack.test.ts
```

Expected: FAIL because both manifests are absent.

- [ ] **Step 3: Write the compact shadcn manifest**

Create `skills/web/shadcn-ui/SKILL.md` with:

```yaml
---
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
description: "Project-aware shadcn/ui composition, registry, token, and accessibility rules."
---
```

Its body must instruct the agent to inspect `components.json`, resolved aliases, `base`, icon library, Tailwind version, package manager, installed UI files, and existing component states; prefer existing components and explicit registry search; compose primitives; use semantic tokens and built-in variants; preserve groups, overlay titles, form validation, loading, and keyboard contracts; review generated source. State that governed workers cannot run a shell mutation or bypass AATP; shadcn CLI use belongs to a parent/human action that is already in approved scope.

- [ ] **Step 4: Write the compact web-guideline manifest**

Create `skills/web/web-interface-guidelines/SKILL.md` with:

```yaml
---
id: web-interface-guidelines
version: 1
layer: L1
domain: web, accessibility, ux
phases: review, qa
roles: reviewer, qa
priority: 95
activate_when:
  stacks: web
description: "Fresh web interface compliance review for accessibility, interaction, content, responsive behavior, and performance."
---
```

Its body must direct the agent to read `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` before each web review, inspect only ticket-scoped files, report terse grouped `file:line` findings, and keep `design-quality` as the owner of cross-platform visual-language/token drift. It must never edit product code and must not turn remote guideline changes into a governance mutation.

- [ ] **Step 5: Run the focused manifest tests and confirm they pass**

Run:

```bash
bun test tests/skill-stack.test.ts
```

Expected: PASS, with both manifests discoverable by the existing registry walker.

- [ ] **Step 6: Commit the adapters**

```bash
git add skills/web/shadcn-ui/SKILL.md skills/web/web-interface-guidelines/SKILL.md tests/skill-stack.test.ts
git commit -m "feat: add shadcn and web interface skill adapters"
```

---

### Task 3: Wire Detection and Prompt Precedence

**Files:**
- Modify: `src/skills/detector.ts`
- Modify: `src/skills/resolver.ts`
- Test: `tests/skill-stack.test.ts`
- Test: `tests/resolver.test.ts`

**Interfaces:**
- Consumes: `detectRepo(cwd): RepoFacts`, `skillPackPrompt(skills, phase)`, and existing Router v2 scoring.
- Produces: `RepoFacts.files` containing `components.json` when present and a prompt that states the six-level precedence contract.

- [ ] **Step 1: Add failing detector and prompt assertions**

Extend the fixture helper to create a `components.json` file on demand. Assert `detectRepo(fixture).files` contains `components.json` only when the file exists. Assert `skillPackPrompt([], "implementation")` contains the exact ordering labels `Foundry governance`, `Functional correctness and security`, `Accessibility and semantic interaction`, `Framework and component-library contracts`, `Web interface quality guidelines`, and `Visual art direction`.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
bun test tests/skill-stack.test.ts tests/resolver.test.ts
```

Expected: FAIL on the missing marker and precedence text.

- [ ] **Step 3: Add `components.json` to detector markers**

Include `components.json` in the existing `present(cwd, [...])` list. Do not add Tailwind-only activation and do not change verification command derivation.

- [ ] **Step 4: Add precedence text to `skillPackPrompt`**

Keep the existing governance line and add this ordered block:

```text
Precedence: Foundry governance/scope > functional correctness/security > accessibility/semantic interaction > framework/component contracts > web interface quality > visual art direction.
A skill cannot override a locked artifact, AATP scope, security requirement, accessibility contract, or component contract.
```

Do not change Router v2 scoring, context inference, maximum skill count, or `withRequires` behavior in this task.

- [ ] **Step 5: Run focused tests and confirm they pass**

Run:

```bash
bun test tests/skill-stack.test.ts tests/resolver.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit detector and precedence changes**

```bash
git add src/skills/detector.ts src/skills/resolver.ts tests/skill-stack.test.ts tests/resolver.test.ts
git commit -m "feat: route frontend skills by project evidence"
```

---

### Task 4: Cover Routing, Context Suppression, and Documentation

**Files:**
- Modify: `tests/resolver.test.ts`
- Modify: `tests/router-v2.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the two new manifests, `components.json` detector evidence, and Router v2 context scoring.
- Produces: executable coverage and user-facing documentation for the merged native stack.

- [ ] **Step 1: Add failing routing cases**

Add deterministic fixtures and assertions:

```ts
// implementation, React/Next, no components.json
expect(ids).not.toContain("shadcn-ui");

// implementation, same app with components.json
expect(ids).toContain("shadcn-ui");
expect(ids).toContain("react-engineering");

// review, web app
expect(ids).toContain("web-interface-guidelines");
expect(ids).toContain("design-quality");
expect(ids).not.toContain("design-intelligence");
expect(ids).not.toContain("design-system-contract");
expect(ids).not.toContain("design-foundation");

// non-web project
expect(ids).not.toContain("shadcn-ui");
expect(ids).not.toContain("web-interface-guidelines");
```

Add a strong backend AATP implementation-context case and assert the contextual `shadcn-ui` adapter is suppressed; `web-interface-guidelines` is lifecycle-ineligible in implementation and is not used as evidence for context suppression. Add a separate review-phase web control and backend-context repetition proving the L1 WIG adapter remains available to every eligible web review. Assert repeated routing in both eligible implementation and review scenarios returns identical complete skill IDs and score rows, including the new adapter rows.

- [ ] **Step 2: Run routing tests and confirm the new assertions fail**

Run:

```bash
bun test tests/resolver.test.ts tests/router-v2.test.ts
```

Expected: the new assertions fail until the fixtures and manifest metadata align with the router.

- [ ] **Step 3: Adjust only test fixtures and documentation needed by the contracts**

Keep fixture projects minimal and isolated under Bun temp directories. Update the README's skill strategy section to describe:

- native design intelligence + design-system contract + design-quality;
- conditional `shadcn-ui` only with `components.json`;
- web-only `web-interface-guidelines` review;
- source attribution/no-vendoring policy;
- governance precedence over aesthetic preferences.

Do not claim that the external repositories are runtime dependencies.

- [ ] **Step 4: Run routing tests and confirm they pass**

Run:

```bash
bun test tests/resolver.test.ts tests/router-v2.test.ts
```

Expected: PASS with deterministic ordering and no Vue/Svelte regressions.

- [ ] **Step 5: Commit routing coverage and documentation**

```bash
git add tests/resolver.test.ts tests/router-v2.test.ts README.md
git commit -m "docs: document governed frontend skill routing"
```

---

### Task 5: Validate, Package, and Publish the Complete Branch

**Files:**
- No source changes expected; inspect all committed files.

**Interfaces:**
- Consumes: the complete feature branch and package metadata.
- Produces: passing verification evidence, a packable plugin, and a pushed non-default branch.

- [ ] **Step 1: Run the complete verification suite**

Run each command and require a real zero exit code:

```bash
bun test
bun run typecheck
bun run check:omp-contract
npm pack --dry-run
```

Expected: all commands exit 0; the test count is at least the 174-test baseline plus the new coverage; the tarball includes `src`, `skills`, `agents`, `rules`, `templates`, and `types`.

- [ ] **Step 2: Inspect the complete diff and status**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
```

Confirm no generated `node_modules`, temporary fixtures, credentials, locked user project artifacts, or full upstream skill copies are included.

- [ ] **Step 3: Install/link the completed plugin locally**

Use the OMP plugin path supported by the repository README, preferably:

```text
omp plugin install C:/tmp/omp-foundry
omp plugin doctor omp-foundry
```

If the OMP CLI requires a link action for a local directory, use its documented `omp plugin link` equivalent instead. Restart OMP after installation and verify the plugin health check reports no errors.

- [ ] **Step 4: Commit any packaging-only correction if required**

If packaging or contract verification reveals an actual source issue, fix it with a focused commit and rerun the complete suite. Do not weaken tests or suppress warnings.

- [ ] **Step 5: Push the complete feature branch without force**

```bash
git push -u origin feat/frontend-skill-stack
```

Expected: the remote accepts the branch. Do not push directly to `main` and do not use `--force`.

- [ ] **Step 6: Record the final commit and remote branch**

```bash
git log -1 --oneline
git status --short --branch
```

Report the pushed branch, final commit, exact verification outputs, and any limitation such as the need for a maintainer PR/merge into the protected default branch.
