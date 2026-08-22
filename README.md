# omp-company-workflow

Oh My Pi plugin: a governed “AI software company” for any repo.

You assign **models to roles**. The plugin runs the rest.

```text
/company
```

That is the only command a non-coder needs. It reads `.omp/company-state.yml` and does the next legal step.

## Install

Requires [Oh My Pi](https://github.com/can1357/oh-my-pi) 18+.

```bash
git clone https://github.com/<you>/omp-company-workflow
omp plugin link ./omp-company-workflow
```

Restart OMP. Check:

```bash
omp plugin list
```

You should see `omp-company-workflow`.

To remove:

```bash
omp plugin uninstall omp-company-workflow
```

## One-time: assign your models

In OMP open **`/models` → Roles**. Map whatever providers you pay for:

| Role | Job in this plugin | Example |
| --- | --- | --- |
| `default` | Coordinator, product, critic, review | Grok / Opus / whatever you trust as lead |
| `plan` | Architecture draft | GLM / o-series / your planner |
| `advisor` | Lock the plan + security review | Your strongest principal |
| `slow` | Hard implementation only | Same as advisor or one notch cheaper |
| `task` | Normal implementation | Fast coding model |
| `designer` | UI foundation | A vision-capable model |
| `smol` | Tiny / trivial AATP | Cheapest model |

You never edit plugin files to change models. Roles are yours.

This user’s current example (optional, not required):

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  default: xai-oauth/grok-4.6:high
  plan: zai/glm-5.3:max
  advisor: openai-codex/gpt-5.6-sol:xhigh
  slow: openai-codex/gpt-5.6-sol:max
  task: google-antigravity/gemini-3.7-flash:high
  designer: google-antigravity/gemini-3.7-flash:high
  smol: openrouter/deepseek/deepseek-v4-flash:free:auto
```

## Everyday use

Say what you want, then:

```text
/company I want a personal finance SaaS on Web + Android
```

Keep pressing **`/company`** (or just “continue”) after each pause. The plugin will:

1. Write `docs/PRODUCT.md` (`@default`)
2. Draft → critique → lock `docs/MASTER_PLAN.md` (`@plan` → `@default` → `@advisor`)
3. If the stack has UI: design + preview (`@designer`). You type `/design approve` or `/design skip`
4. Split locked plan into `docs/AATP/*`
5. Implement ready tasks (`@task`, hard ones `@slow`)
6. Independent review (`@default`, security `@advisor`)
7. Real test/build commands (`/verify`)
8. `/release-check` — publish/deploy stays blocked until this is green

You only decide at **product**, **plan lock**, **design approve**, and **release**.

## Optional commands

| Command | When |
| --- | --- |
| `/company` | Next step (default) |
| `/company-init` | Force scaffold |
| `/plan3` | Force three-model plan |
| `/design` `/design approve` `/design skip` | UI gate |
| `/aatp` | Force task split |
| `/build` | Next independent AATP layer |
| `/review` | Review a finished AATP |
| `/verify` | Deterministic QA |
| `/release-check` | Final gate |

Built-in OMP Plan (Shift+Tab) is unchanged: one `@plan` model. `/plan3` is the three-step lock.

## What the plugin blocks

Hard `tool_call` gates (not just a prompt):

- Implementation before the master plan is locked
- UI source before design is locked (when UI is required)
- Edits to locked `docs/MASTER_PLAN.md`, approved `docs/PRODUCT.md`, locked `docs/DESIGN.md`
- `git push` / `npm publish` / `wrangler deploy` / production migrate until `release.ready`

Workers that disagree with the plan must call `report_conflict`. They cannot “just refactor the architecture”.

## Layout the plugin creates

```text
docs/PRODUCT.md
docs/MASTER_PLAN.md
docs/DESIGN.md
docs/planning/MASTER_PLAN_DRAFT.md
docs/planning/PLAN_REVIEW.md
docs/AATP/
docs/reports/
.omp/company-state.yml
```

## Uninstall / upgrade

The plugin is not an OMP fork. OMP updates independently.

```bash
cd omp-company-workflow && git pull
# already linked — restart OMP
```
