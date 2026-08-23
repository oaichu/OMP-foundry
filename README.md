<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="OMP Foundry mark"/>
</p>

<h1 align="center">OMP Foundry</h1>

<p align="center">
  <strong>Lock the plan. Then pour the code.</strong><br/>
  A governed AI software foundry for <a href="https://github.com/can1357/oh-my-pi">Oh My Pi</a> —<br/>
  <sub>where the architecture is <b>locked</b>, not merely remembered.</sub>
</p>

<p align="center">
  <a href="https://github.com/can1357/oh-my-pi"><img alt="Oh My Pi 18+" src="https://img.shields.io/badge/Oh%20My%20Pi-18%2B-E4572E?style=for-the-badge"/></a>
  <a href="https://ko-fi.com/oaichu"><img alt="Buy Me A Coffee" src="https://img.shields.io/badge/Support-Buy%20Me%20A%20Coffee-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white"/></a>
  <a href="https://github.com/oaichu/omp-foundry/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/oaichu/omp-foundry?style=for-the-badge&label=release&color=FFB020"/></a>
  <a href="https://github.com/oaichu/omp-foundry/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/oaichu/omp-foundry/ci.yml?branch=main&style=for-the-badge&label=CI&color=2F9E6E"/></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-14110E?style=for-the-badge"/></a>
</p>

<p align="center">
  <a href="https://github.com/oaichu/omp-foundry/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/oaichu/omp-foundry?style=for-the-badge&label=star%20the%20foundry&logo=github&color=FF9F1C"/></a>
  <img alt="install" src="https://img.shields.io/badge/install-omp%20plugin-14110E?style=for-the-badge"/>
</p>

<p align="center">
  <img src="docs/assets/hero.svg" width="100%" alt="Crucible pouring into a locked gate — OMP Foundry"/>
</p>

---

## Your agent “remembers” the architecture — until it doesn’t

Every AI coding “company” is a long system prompt. The model *remembers* not to rewrite the plan, not to touch the locked design, not to push before QA. Then, at 2 a.m., on a 40-file refactor, it doesn’t — and it *helpfully* rewrites your architecture.

Foundry moves that risk out of the prompt and into a `tool_call` deny enforced at the OMP extension boundary, backed by a state machine and patch gate the model cannot edit:

<p align="center">
  <img src="docs/assets/terminal.svg" width="100%" alt="Foundry refusing agent overreach in real time"/>
</p>

After an AATP work order is sealed, **the model no longer owns governance transitions. Foundry does.** Workers run isolated with `apply=false`, return a patch artifact, and Foundry validates every canonical path against the exact ticket **before** anything touches your repository.

## What Foundry enforces

```text
PRODUCT            ─ human approve ─┐
PLAN3               ─ human lock ────┤
  draft → redteam → synth             │
DESIGN (if UI)     ─ human lock/skip ┤
AATP DAG sealed manifest            ▼
isolated worker (apply=false) → patch artifact
Foundry validates exact paths → Foundry applies + commits
independent review + hashed evidence
deterministic QA on clean committed HEAD
derived release gate → you ship from a human shell
```

### Hard boundaries — every row is a real deny

| The “helpful” agent tries… | Foundry answers |
| --- | --- |
| Rewrite approved PRODUCT / locked PLAN / DESIGN | `BLOCKED: PLAN_CONFLICT. MASTER_PLAN is locked.` |
| Edit a sealed `docs/AATP/*` work order | `AATP_SPEC_GATE: specs are sealed for this plan.` |
| Patch a file outside its exact `allowed_files` | rejected **before apply** — your tree never sees it |
| Escape the repo via `..` or a symlinked folder | `PATH_GATE: path escapes the repository: …` |
| Hide a mutation in shell (`echo >`, heredoc, `sed -i`) | `BASH_GATE: arbitrary shell is denied in Foundry.` |
| Run `eval` / `node -e` / `python -c` | `EVAL_GATE: … denied for the entire Foundry session.` |
| Mutate code through LSP (`rename`, `code_actions`) | `LSP_GATE: mutating LSP action … is denied.` |
| Transition its own ticket lifecycle | `LIFECYCLE_GATE: AATP lifecycle is parent-extension-owned.` |
| Self-approve its work | review requires a completed ticket, an **independent** reviewer identity, and matching hashed evidence |
| `git push` / `npm publish` / deploy / Docker push / `gh release` | `RELEASE_GATE: agent push/publish/deploy is always denied.` |
| Use a symlink, URI, Windows alias, or unknown LSP action to cross the repo boundary | fail-closed `PATH_GATE` / `LSP_GATE` |
| Add a helper/unknown agent to a governed task batch | `TASK_GATE`: only declared Foundry agents and exact AATP bindings are accepted |

Invalid worker patches are never applied; rollback is patch-specific — Foundry never uses `git reset --hard` or `git clean -fd` on your tree.

<p align="center">
  <img src="docs/assets/gates.svg" width="100%" alt="Plan, design, and release writes are refused — not requested"/>
</p>

## Install

For development from a checkout:

```bash
git clone https://github.com/oaichu/omp-foundry
cd omp-foundry
omp plugin link .
```

For normal use, install a published Foundry release with OMP's plugin installer rather than linking a mutable working tree.

Restart OMP. In each repository you want governed, the normal entrypoint is simply:

```text
/foundry <your product idea>
```

The first `/foundry` opts that repository in automatically: it scaffolds the governance docs/state, detects the stack, and creates project-local OMP policy. `/foundry-init` remains only as an advanced/manual bootstrap command.

For a newly created `.omp/config.yml`, Foundry sets the worker isolation contract:

```yaml
task:
  isolation:
    mode: auto
    apply: false
modelRoleStorage: project
```

If a project already has `.omp/config.yml`, Foundry preserves its existing settings and adds the project role-storage policy; `/foundry-doctor` checks the **effective** isolation contract and fails governed workers closed if isolation is missing or `apply=true`.

## Everyday

One command, always:

```text
/foundry
```

It resumes the exact persisted workflow stage. You intervene at the human gates — **product · plan lock · design (when required) · release**.

| Command | Purpose |
| --- | --- |
| `/foundry` | Auto-bootstrap if needed, then resume the next legal step |
| `/foundry-init` | Advanced/manual project bootstrap |
| `/foundry-doctor` | Diagnose isolation + Foundry model-role availability |
| `/foundry-approve product\|plan` | Human gates |
| `/plan3` · `/plan-revise` | Draft → red-team → synthesis · human-only reopen (invalidates design, downstream AATP/review/QA, and stale worker capabilities) |
| `/design` · `/design approve\|skip` | Design foundation + preview · human gate |
| `/aatp` · `/build` | Route the locked project to `aatp-compiler` (`@foundry_synth`), validate/seal the DAG, then run the ready layer |
| `/review AATP-xxx` | Independent review |
| `/verify` | Deterministic project verification |
| `/release-check` | Derive release readiness from current evidence |
| `/foundry-version` | Installed + OMP + latest stable release |

## How a work order runs

After the human locks the plan (and explicitly approves or skips design), Foundry automatically routes one blocking `aatp-compiler` agent through the existing `@foundry_synth` capability. It decomposes the **whole locked project** into AATP work orders; it does not implement code and cannot rewrite the locked plan/design. A recompile archives the previous generated DAG under `docs/AATP/archive/`, then Foundry validates and seals the new manifest before any worker can start. Each active `docs/AATP/AATP-*.md` is immutable once sealed — explicit `allowed_files`, forbidden governance paths, acceptance evidence, executable verification IDs, concern coverage, valid dependencies, a risk class, and an orthogonal `security_sensitive` flag. Dependencies unlock only after the upstream ticket is independently approved with provenance. Dependency references must exist and the graph must be acyclic. **Risk is the implementation routing authority**: low/trivial → `smol-implementer`, normal → `implementer`, hard/difficult/critical → `hard-implementer`; security-sensitive work also routes to `security-reviewer`. There is no separate AATP model role and no model-written `recommended_agent` override.

For every ready item:

1. Parent validates the exact `AATP-*` binding (missing/ambiguous/duplicate → fail closed).
2. State transitions `ready → active` — by Foundry, not the worker.
3. One **blocking, isolated** worker runs with `apply=false`.
4. OMP returns the worker’s patch artifact.
5. Foundry canonicalizes every touched path and checks it against **that ticket only**.
6. Valid → Foundry applies and commits. Invalid → never applied, tree untouched.
7. An implementation patch runs its declared deterministic verification before it can be committed or reviewed. Independent review then writes exactly `docs/reports/REVIEW-<id>.md` (or the security variant) and must echo the matching `FOUNDRY_REVIEW <id> ...` verdict.
8. Implementation, verification, review, dependency, manifest, and scope digests are recorded; release derivation recomputes them rather than trusting a non-empty evidence field.

Before the first implementation layer, the source tree must be clean (governance-only setup may be committed as the implementation baseline).

### Capability writers and cheap-first execution

`foundry_synth` is the single reasoning capability used by Plan3 synthesis and the post-lock `aatp-compiler`; there is **no separate AATP model role**. The compiler and Plan3 stage agents receive short-lived in-memory capabilities and write through `foundry_aatp_write` / `foundry_plan_write`. Native writes to unsealed governance artifacts are denied, so another task cannot impersonate the compiler by merely knowing its agent name.

Normal implementation remains cheap-first: risk routes work to `smol-implementer`, `implementer`, or `hard-implementer`; declared deterministic checks run before review; `security_sensitive` or critical tickets route to the security reviewer. Model names stay in OMP `modelRoles`, not in Foundry's policy.

## Release integrity

`/release-check` is **derived, never sticky** — recomputed against the current repository state: artifact hashes unchanged, manifest sealed, all tickets completed, all reviews independently APPROVE with fresh evidence, the baseline/commit ledger exactly matches Git history, QA PASS at the current HEAD, and a clean tree.

Even green, agent release commands stay denied. **You ship from a human shell** — no single agent shell line can mutate code after the check and push it.

## Under the hood

- **State** — `.omp/foundry-state.yml`, schema-versioned and fail-closed. Current schema **v6**; older states migrate forward with a one-time backup. Legacy completed/approved tickets without provenance are reopened instead of being trusted. Planning/AATP epochs reject stale worker capabilities; the AATP baseline plus bounded governed-commit ledger rejects clean external commits at release; newer unsupported schemas are rejected, never guessed.
- **Plan3** — persisted runtime authority: `draft → redteam → synth → awaiting_lock`, with SHA-256 evidence for every stage artifact. Human plan approval fails if any accepted planning artifact drifted.
- **Model roles** — ten global `foundry_*` defaults are registered additively in `~/.omp/agent/config.yml`; project configs inherit them unless you intentionally add a project-level `foundry_*` override.
- **Updates** — checks the latest **GitHub Release** (not `main`) with a user-level cache; network failures are fail-open and never block coding. Foundry never self-updates while loaded.
- **Repo intelligence** — one `RepoFacts` detector drives skill routing, QA and design classification (no detector drift): Web, SaaS, Android, .NET, Cloudflare, Python, Go, Rust… Nested workspace layouts are bounded-scanned; uncertain UI detection never silently skips the human design decision. Skills are filtered by phase **and role**; only metadata is injected, bodies load on demand via `foundry_skill_read`.
- **Dead-code guard** — CI runs TypeScript with `noUnusedLocals` and `noUnusedParameters`, in addition to runtime tests and syntax smoke.
- **OMP compatibility** — CI checks the current `can1357/oh-my-pi` isolation/patch/LSP contracts; upstream contract drift fails CI instead of shipping against an imagined API.
- **Verification safety** — detected checks are structured argv (`shell=false`), bounded by step/total time and output limits, use `npx --no-install`, resolve executables outside the repository, and run with a sanitized environment plus disposable HOME/TMP. Per-ticket declarations run before review; design previews must leave the visible worktree unchanged. Set `FOUNDRY_VERIFY_REQUIRE_SANDBOX=1` with a trusted OS wrapper for hostile repositories; without that explicit mode, verification is a constrained trusted-host operation, not a host security sandbox. Foundry records the HEAD before and after verification and refuses QA when it moves.
- **Filesystem and patch safety** — repository paths reject traversal, URI schemes, symlink components, Windows reserved/short-name aliases, and POSIX backslash ambiguity. Patch bytes are compared before apply, rolled back exactly on rejection, and hashed again before staging/commit.
- **Resource bounds** — state/config/skills/locked-plan/AATP readers cap bytes, entries, dependency depth, and verification steps; malformed inline lists, mismatched AATP filenames, unknown risk classes, missing concern coverage, unresolved verification declarations, oversized task results, and oversized patch artifacts fail closed before expensive work. The only helper exception is `scout`, and it is limited to draft-stage evidence gathering.

### What Foundry writes

```text
docs/PRODUCT.md                 the product contract
docs/MASTER_PLAN.md             the locked synthesis
docs/DESIGN.md                  the locked design
docs/planning/*                 plan draft + red-team review
docs/AATP/AATP-*.md · INDEX.md  sealed work orders
docs/reports/REVIEW-*.md        independent review evidence
docs/reports/QA.md              deterministic command output
.omp/foundry-state.yml          the state machine
.omp/config.yml                 project isolation/storage policy
```

### Uninstall — everything it touched, in order

```bash
# 1. the plugin itself
omp plugin uninstall omp-foundry
rm -f ~/.omp/plugins/node_modules/omp-foundry      # junction/symlink leftover (Windows)
```

If you linked a checkout with `omp plugin link .`, delete the checkout too. If you added the path under `extensions:` in `~/.omp/agent/config.yml`, remove that entry and restart OMP.

```bash
# 2. the global model roles (the plugin's only user-level write)
sed -i '/^  foundry_/d' ~/.omp/agent/config.yml     # or delete the ten foundry_* lines by hand
```

For a governed project, remove only the Foundry artifacts/policy you no longer want; do not blindly delete `.omp/` if other OMP project configuration lives there.

### Roles — bring your own models

When the plugin first runs, it registers its **ten `foundry_*` model roles** in `~/.omp/agent/config.yml` — the plugin's only user-level write. Missing roles are cross-role aliases such as `foundry_redteam: "@slow"`, so they keep following the OMP roles you already maintain. Pin any Foundry stage by assigning a concrete model. Existing values are never overwritten.

OMP's `/models → Roles` view lists its built-in roles, so custom `foundry_*` values are assigned in config. New governed projects **do not generate duplicate Foundry role values**, which means a model you choose once globally applies across projects. Add a `foundry_*` key to a project's `.omp/config.yml` only when you intentionally want that repository to override the global choice.

A non-default OMP `--profile` has its own configuration context; configure the Foundry roles for that profile if you want the same model diversity there.

| Foundry role | Default alias intent |
| --- | --- |
| `foundry_product` | `@default` / product analysis |
| `foundry_plan` | `@plan` / architecture draft |
| `foundry_redteam` | `@slow` / adversarial plan attack |
| `foundry_synth` | `@slow`/`@advisor` / Plan3 adjudication + project-wide AATP compilation |
| `foundry_design` | `@designer` / design foundation |
| `foundry_impl` | `@task` / normal implementation |
| `foundry_hard` | `@slow` / difficult implementation |
| `foundry_smol` | `@smol` / trivial implementation |
| `foundry_review` | `@review`/`@default` / independent review |
| `foundry_security` | `@slow`/`@advisor` / security review |

### Security boundary — honest scoping

Foundry reduces agent authority at the **OMP tool, capability-writer, and patch-application boundaries**. It sanitizes ambient Git redirectors for its own operations, but it does not defend against a hostile OS, a compromised OMP runtime, or already-malicious build/test scripts/dependencies. Verification intentionally executes project-defined checks; use an OS/container/VM sandbox and normal supply-chain controls for untrusted repositories.

## Final local checks

Run these before publishing a change:

```bash
bun run typecheck
bun test
bun -e "new Bun.Transpiler({loader:'ts'}).transformSync(await Bun.file('src/index.ts').text())"
git diff --check
bun run check:omp-contract -- <path-to-oh-my-pi-checkout>
```

The contract smoke test needs a checkout of the matching Oh My Pi source tree; it is expected to report a missing-path error when that checkout is not present.

---

<p align="center">
  <img src="docs/assets/flow.svg" width="100%" alt="Product → Plan3 → Design → AATP → Pour → Release"/>
</p>

<p align="center">
  <strong>Your models don’t need permission to rewrite the mold.</strong><br/>
  <sub>Plan lock → exact work order → isolated patch → verify → pour.</sub>
</p>

<p align="center">
  If Foundry ever saves you from a 2 a.m. “helpful” architecture rewrite —<br/>
  <a href="https://github.com/oaichu/omp-foundry/stargazers"><img alt="Star it" src="https://img.shields.io/badge/star_the_foundry-FFB020?style=for-the-badge&logo=github"/></a>
</p>

---

## 💖 Support the Foundry & Buy Me a Coffee

If OMP Foundry saves you from architecture rewrites and powers your disciplined AI workflows, please consider supporting ongoing maintenance:

<div align="center">
  <a href="https://ko-fi.com/oaichu" target="_blank" rel="noopener noreferrer">
    <img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" alt="Buy Me A Coffee at ko-fi.com" height="46" style="border: 0px; height: 46px; border-radius: 8px; box-shadow: 0 4px 14px rgba(255, 94, 91, 0.35);" />
  </a>
  <br/><br/>
  <i>Every cup of coffee fuels continuous development, new workers, and governed AI tooling. Thank you! ☕✨</i>
</div>
