# Foundry 3-Mode Architecture — Fast / Lite / Full

**Status:** Proposed — approved in review session 2026-08-26 · **Base:** omp-foundry v0.8.22 (`c32af02`)
**Preceded by:** full re-audit of v0.8.22 (kernel, governance, tests, docs) plus red-team of two prior architecture proposals. The surviving decisions are recorded here; rejected alternatives are listed under Non-goals.

## Problem

Foundry today is an always-on 8-phase pipeline. Every request — including a one-file tweak — pays for Plan3 (3 slow agents), AATP compilation, and independent review before any code is written. For small tasks this is *more* expensive than calling the frontier model directly, which inverts the stated goal (cheap-first vibe coding). Meanwhile the quality claim ("~90–95% of frontier") is unmeasured, and v0.8.22 ships operational blockers (`/ok` wipes a completed plan cycle at `awaiting_lock`; `bash` bypasses every write gate; version triple-drift).

## Goals

1. Route work by task size so small tasks skip governance overhead entirely (break-even fix).
2. Keep quality on bounded tasks: declared verification IDs are the floor; review escalates on failure, not by default.
3. Make cost/quality measurable with a minimal ledger — numbers from real usage, not a benchmark suite.
4. Cheap-first, never cheap-only: deterministic escalation to stronger models on retry/review failure.
5. One version source; state that survives restarts.

## Non-goals (explicitly rejected in review)

- Benchmark suite of 20–40 synthetic tasks; composite quality score `Q = αC+βR+γA+δV`.
- Custom updater (canary/rollback/checksum) — the update channel is public npm: `omp plugin install omp-foundry` re-installs latest; `omp update --plugins` upgrades marketplace plugins only and is not this plugin's path.
- Expanding the skill catalog (36 → more). Packs remain a data directory of 3–5 superpower procedures.
- OS-sandbox-by-default on Windows (block `.git` writes first; hard sandbox stays opt-in).
- Natural-language approval parser ("duyệt"/"ok" regex over user text).
- Hard-reject patches solely because a unified diff exceeds 80 lines (upgrade mode instead). `allowed_files` stay directory prefixes; file-count and **file-weight** live in the router table.

## Architecture

A deterministic router (lookup table, no ML) classifies each request at `/foundry` entry, gated behind `foundry.modes: true` in `.omp/config.yml` until P3 flips the default. **Fail-closed:** if any predicate is unknown (no git baseline, unreadable file, ambiguous path set), the mode is **Full**. Downgrades never happen automatically.

**Measured weight** (on disk / HEAD, before the worker runs — never “guess light”):

| Symbol | Value | Measures |
|---|---|---|
| `W_LOC` | 400 | lines in a touched **existing** file |
| `W_BYTES` | 32 KiB | file size |
| `FAST_DIFF` | 120 | `git diff --numstat` added+deleted after the worker (upgrade trigger) |
| `LITE_FILES` | 2–5 | distinct repo-relative paths |
| `LITE_SUM_LOC` | 2000 | sum of `W_LOC` over touched existing files |
| `LITE_DIFF` | 400 | added+deleted after the worker (upgrade trigger) |

Vendor / generated / minified / lockfiles (`*.min.js`, `dist/`, `node_modules/`, `package-lock.json`, etc.) never count as Fast/Lite targets — Full or refuse.

### Fast (P1)

**All** of the following, else not Fast:

1. Repo has a git baseline (not greenfield / empty tree).
2. Touches **exactly one** path that **already exists in HEAD** (no create, no rename, no delete).
3. That file: `LOC ≤ 400` **or** `size ≤ 32 KiB` (both measured; fail if either exceeds).
4. A verify id already exists in project detection / package scripts.
5. Does not write locked Foundry artifacts (`PRODUCT.md`, `MASTER_PLAN.md`, `DESIGN.md`, `docs/AATP/*`, `.omp/foundry-state.yml`).
6. Introduces no new `REQ-*` / `ARCH-*` / `SEC-*` / `DES-*` / `OPS-*` concern IDs.

Pipeline: one `smol-implementer` (or `@foundry_smol` / `@task`) + `/verify`. No Plan3, no AATP compiler.  
**Mid-task upgrade → Lite** if the resulting diff touches another path, creates/renames, or `added+deleted > 120`.

### Lite (P2)

**All** of the following, else Full:

1. Existing governed repo (product at least present; not a new-project bootstrap).
2. Touches **2–5** paths. At most **one** of them may be a **new** file; the rest exist in HEAD. No directory-wide `allowed_files` that expand to >5 files.
3. Every existing touched file: `LOC ≤ 400` **or** `size ≤ 32 KiB`. Sum of existing-file LOC `≤ 2000`.
4. No architecture change: no new `ARCH-*` / `SEC-*` concerns; no public API / schema / auth surface declared in the locked plan as such.
5. Does not revise a **locked** artifact (plan/design/product). Unlocked planning files are not Lite work — that is `/plan` (Full).
6. Not cross-cutting: one cohesive ticket (one subsystem). Split otherwise → Full DAG.

Pipeline: one AATP ticket + `implementer` (`@foundry_impl` / `@task`). Independent review **only** when `risk >= normal` **or** `security_sensitive`; otherwise verify is the floor.  
**Mid-task upgrade → Full** if files >5, any file exceeds weight, `added+deleted > 400`, new ARCH/SEC, or `FOUNDRY_CONFLICT SCOPE_*`.

### Full (P3 default / fail-closed)

Any of:

- Greenfield, no baseline, `/foundry` bootstrap, or classifier uncertainty
- >5 files, or directory prefix that cannot be bounded to ≤5 exact paths
- Any touched existing file exceeds `W_LOC` **and** `W_BYTES` (heavy file — do not smol it)
- New or revised `ARCH-*` / `SEC-*`, or `security_sensitive: true` at DAG scope
- Revises a locked product/plan/design artifact (`/plan-revise`, design reopen)
- Cross-cutting refactor, rename/move sets, generated/vendor targets
- Fast/Lite predicates failed

Pipeline: current kernel — Plan3 → AATP DAG → isolated workers (`routeAgent`) → review → verify. Models: `@foundry_plan` / `_redteam` / `_synth` then impl/review per ticket risk.

- **Mid-task upgrade** Fast→Lite→Full only. Caps in the tables above; worker conflict or post-diff overflow re-classifies and continues. Ledger `escalated: true`.
- **Escalation (deterministic, inside a mode):** retry ≥1 → `hard-implementer`; retry ≥2 or two `REQUEST_CHANGES` → slow-model agent (`@foundry_hard` / `@slow`). Recorded in the ledger.
- **Full mode** is the current pipeline, unchanged, minus Phase 0 blockers. Fast/Lite are new paths that reuse patch gate, verify runner, and provenance.

## Ledger (minimal)

`.omp/foundry-ledger.jsonl` — one append-only line per governed agent run:

```json
{"ts":0,"mode":"lite","ticket":"AATP-7","agent":"implementer","role":"@task","model":"...","tokens_in":0,"tokens_out":0,"retries":0,"verify_exit":0,"review":"APPROVE","escalated":false}
```

Gitignored (never committed). `/foundry-stats` renders per-mode totals and cost share.

**Success metric (measurable, from real usage):** over a rolling 2-week window of the maintainer's actual tasks — relative acceptance ≥ 0.9 vs `@slow`-direct on the same tasks, at ≤ 0.4 cost. If missed: tune escalation thresholds only. Do not add architectural planes.

## Distribution & updates (npm)

The plugin publishes to public npm as `omp-foundry` (repo is already public MIT; zero runtime dependencies, so the tarball is small). CI publishes on `v*` tag push (`npm publish --provenance`, `NPM_TOKEN` secret). Update check switches from parsing the GitHub release redirect to `https://registry.npmjs.org/omp-foundry/latest` (clean JSON, no HTML regex, no GitHub rate limits), and the notify text instructs `omp plugin install omp-foundry` instead of `git fetch --tags && git checkout`. Git-tag installs keep working but are the slow path.

## Phase 0 — kernel hotfixes (prerequisite, from the audit; ships before any router)

1. `FOUNDRY_VERSION` derived from `package.json` (single source; CHANGELOG + badge sync); update-check reads the npm registry and notifies with `omp plugin install omp-foundry`.
2. `/ok` `/run` `/go` at `awaiting_lock` lock the plan; `enterPlan` no longer resets `awaiting_lock`.
3. `denyToolCall` fail-closed for `bash`/`lsp` write paths in governed projects (allowlist: `git diff|status|log|show`).
4. Serialize `ticket.attempts`; route `trivial|low` → `smol-implementer` (decision: route, not delete — Fast mode needs it).
5. `/plan-revise`, `/verify`, `/release-check` refuse to persist when state is missing.
6. Deduplicate `approveProduct`/`approvePlan` (one function behind tool + slash command).

## Phasing

- **P0** hotfixes above (each independently shippable; tests first).
- **P1** router table + Fast mode + ledger append + `/foundry-stats` (flagged off by default).
- **P2** Lite mode + escalation transitions.
- **P3** Full-mode re-wiring onto the router + split `adapter/omp` out of `index.ts` (split last, after hotfix pressure subsides) + default the flag on.

## UI note

No UI surface in this design — Foundry is a TUI plugin; observability is `/foundry-stats` text output. Design-preview gates for UI repositories are deferred to a separate spec, per the repo rule that UI work ships a visible demo first.

## Acceptance criteria

- `bun test` green including new tests: router classification table (Fast/Lite/Full fixtures: existing light file, existing 10k-LOC file, greenfield, 2–5 light files, heavy file → Full), `/ok` at `awaiting_lock` locks (no reset), bash write denied on governed projects, `attempts` roundtrip through save/load, ledger append on every governed run.
- Fast-mode fixed overhead ≤ 1 orchestrate turn (no plan stage, no compiler).
- Ledger totals match `/foundry-stats` output; file is gitignored.
- Router is inert unless `foundry.modes: true` is set in `.omp/config.yml`; P3 flips the default.
