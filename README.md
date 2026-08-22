<p align="center">
  <img src="docs/assets/logo.svg" width="96" height="96" alt="OMP Foundry mark"/>
</p>

<h1 align="center">OMP Foundry</h1>

<p align="center">
  <strong>Lock the plan. Then pour the code.</strong><br/>
  A governed AI software foundry for <a href="https://github.com/can1357/oh-my-pi">Oh My Pi</a>.
</p>

<p align="center">
  <a href="https://github.com/oaichu/omp-foundry/releases/latest"><img alt="release" src="https://img.shields.io/github/v/release/oaichu/omp-foundry?style=for-the-badge&label=release&color=FFB020"/></a>
  <a href="https://github.com/oaichu/omp-foundry/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/oaichu/omp-foundry/ci.yml?branch=main&style=for-the-badge&label=CI&color=2F9E6E"/></a>
  <a href="./LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-14110E?style=for-the-badge"/></a>
</p>

---

## What Foundry enforces

Foundry is an **OMP tool-execution governance layer**, not an OS/container sandbox. Its purpose is to make the software workflow deterministic at the extension boundary:

```text
PRODUCT
  ↓ human approve
3-stage PLAN
  ↓ human lock
DESIGN (when UI exists)
  ↓ human lock/skip
AATP DAG + sealed work-order manifest
  ↓
isolated worker, apply=false
  ↓
Foundry validates exact patch paths
  ↓
Foundry applies + commits valid patch
  ↓
independent review + evidence
  ↓
deterministic QA on clean committed HEAD
  ↓
derived release gate
```

The model does **not** own governance state transitions after the AATP is sealed. Foundry does.

### Hard boundaries

| Attempt | Result |
| --- | --- |
| Edit approved PRODUCT / locked PLAN / locked DESIGN | denied |
| Edit sealed `docs/AATP/*` | denied |
| Worker touches a file outside its exact `allowed_files` | patch rejected before apply |
| Escape repository through `..` or symlink | denied by canonical path gate |
| Use `eval` | denied for the Foundry session |
| Use mutating LSP (`rename`, `rename_file`, `code_actions`, raw `request`, `reload`) | denied |
| Use arbitrary agent shell / redirects / heredocs | denied |
| Agent `git push`, publish, deploy, Docker push, release creation | always denied |
| Worker tries to call AATP lifecycle tools directly | denied |
| Review APPROVE without matching review report evidence | denied |
| Release after QA with a dirty/different tree | denied |

Implementation and review workers run through OMP isolation with **`task.isolation.apply=false`**. OMP returns a patch artifact; Foundry validates every canonical changed path against the exact ticket **before** applying it to the parent repository.

## Install

```bash
git clone https://github.com/oaichu/omp-foundry
cd omp-foundry
omp plugin link .
```

Restart OMP, then in the project you want Foundry to govern:

```text
/foundry-init
/foundry-doctor
```

On a project without `.omp/config.yml`, Foundry creates:

```yaml
task:
  isolation:
    mode: auto
    apply: false
```

If the project already has `.omp/config.yml`, Foundry **does not overwrite it**. `/foundry-doctor` checks the effective OMP settings and blocks governed workers until isolation is enabled and `apply=false`.

Foundry ignores only its own runtime state files. It does **not** ignore the whole `.omp/` directory, so project OMP configuration remains versionable if you choose to commit it.

## Everyday workflow

Usually keep running:

```text
/foundry
```

It reports the next legal step.

| Command | Purpose |
| --- | --- |
| `/foundry-init` | scaffold Foundry documents/state and safe isolation defaults |
| `/foundry-doctor` | verify OMP isolation contract |
| `/foundry` | next legal workflow step |
| `/foundry-approve product` | human product gate |
| `/plan3` | drafter → critic → finalizer |
| `/foundry-approve plan` | human plan lock |
| `/plan-revise` | human-only reopen; invalidates downstream AATP/review/QA |
| `/design` | generate design foundation + preview |
| `/design approve` / `/design skip` | human design gate |
| `/aatp` | generate AATP specs from locked plan/design |
| `/build` | validate/seal AATP manifest and run ready DAG layer |
| `/review AATP-xxx` | isolated independent review |
| `/verify` | deterministic project verification |
| `/release-check` | derive release readiness from current evidence |
| `/foundry-version` | installed Foundry, OMP version, latest stable release |

## AATP execution model

Each `docs/AATP/AATP-*.md` is an immutable work-order specification once `/build` seals the manifest. It must contain an explicit non-empty `allowed_files` scope and valid dependencies.

For each ready item:

1. Parent Foundry validates the exact `AATP-*` binding.
2. Parent state transitions `ready → active`.
3. OMP runs one blocking isolated worker with `apply=false`.
4. Worker cannot mutate Foundry state and cannot use arbitrary shell/eval.
5. OMP returns the worker patch artifact.
6. Foundry canonicalizes every touched path and checks it against that ticket only.
7. Valid patch is applied and committed by Foundry; then parent state becomes `completed`.
8. Invalid patch is never applied.

This avoids the old split-brain design where isolated children attempted to mutate `.omp/foundry-state.yml` themselves.

Before the first implementation layer, Foundry requires a clean source working tree. Governance-only setup changes may be committed as the implementation baseline. User source WIP must be committed or stashed first.

Rollback is patch-specific: Foundry never uses `git reset --hard` or `git clean -fd` to undo a failed worker patch.

## Review gate

A completed AATP is not release-ready until independently reviewed.

The reviewer is isolated and may only write its exact report:

```text
docs/reports/REVIEW-<id>.md
```

For security-critical work Foundry routes to `security-reviewer`.

The report and reviewer output must contain the same marker:

```text
FOUNDRY_REVIEW AATP-001 APPROVE
```

(or `REQUEST_CHANGES` / `BLOCK`). Foundry hashes the evidence and records the reviewer identity. Release derivation requires APPROVE + independent identity + evidence for every ticket.

## Release integrity

`/release-check` is derived, never sticky. It requires all of the following at the current repository state:

- PRODUCT approved and hash unchanged
- PLAN locked and hash unchanged
- DESIGN locked or explicitly not required
- AATP manifest sealed and unchanged
- all AATP tickets completed
- all required reviews independently APPROVE with evidence
- QA PASS against current committed HEAD
- clean working tree

Agent release commands remain denied even after this gate is green. **Release from a human shell** after `/release-check` reports `RELEASE_READY=true`.

This deliberately prevents a single shell line from mutating code and pushing it after the pre-execution check.

## State schema and upgrades

Runtime state lives at:

```text
.omp/foundry-state.yml
```

The state is schema-versioned and fail-closed. Current development schema is **v2**. Older schemas migrate forward with a one-time backup; a state created by a newer unsupported schema is rejected instead of guessed.

## Update notification

Foundry checks the latest **GitHub Release**, not `main`, with a user-level cache. Network/cache failures are fail-open and never block coding.

```text
/foundry-version
```

If a newer stable tag exists, Foundry tells you. It never self-updates while loaded.

For stable installs:

```bash
git fetch --tags
git checkout <release-tag>
```

Then restart OMP. Do not use `git pull` for a stable tagged checkout; that tracks a branch, not a release.

For a deliberate developer checkout:

```bash
git switch main
git pull
```

## Repo intelligence and verification

One `RepoFacts` detector now drives both skill routing and QA/design classification, avoiding detector drift. It recognizes relevant Web, SaaS, Android, Windows/.NET, Cloudflare, Python, Go, Rust and framework signals, and derives verification steps from the same facts.

Examples include TypeScript/Biome, Android Gradle, `go vet`/`go test`, Python pytest with optional Ruff/Mypy detection, Rust fmt/clippy/test, and .NET test/build.

Skills are filtered by phase **and role**. Only a small metadata pack is injected; detailed skill bodies are loaded on demand through `foundry_skill_read` to control token usage.

## CI / OMP compatibility

CI runs:

```text
bun install --frozen-lockfile
bun run typecheck
bun test
index.ts syntax smoke
checkout current can1357/oh-my-pi
OMP contract smoke
```

The upstream contract smoke verifies the OMP assumptions Foundry relies on: task isolation settings, `applyChanges`/patch flow, and LSP mutation capabilities. If upstream OMP changes those contracts, CI fails rather than silently shipping against an imagined API.

## Files Foundry writes

```text
docs/PRODUCT.md
docs/MASTER_PLAN.md
docs/DESIGN.md
docs/planning/*
docs/AATP/AATP-*.md
docs/AATP/INDEX.md
docs/reports/REVIEW-*.md
docs/reports/QA.md
docs/.foundry-governed
.omp/foundry-state.yml
```

## Models / roles

Foundry maps work onto OMP model roles; you choose the actual models:

| Foundry role | Typical OMP role |
| --- | --- |
| product / floor lead | `@default` |
| plan drafter | `@plan` |
| plan finalizer / security | `@advisor` |
| hard implementation | `@slow` |
| normal implementation | `@task` |
| design | `@designer` |
| trivial implementation | `@smol` |

See `roles.example.yml` for a starting point.

## Security boundary

Foundry reduces agent authority at the OMP tool and patch-application boundaries. It does **not** claim to defend against a hostile operating system, a malicious Git binary, a compromised OMP runtime, or already-malicious project build/test scripts. Those require an OS/container/VM sandbox and ordinary supply-chain controls.

---

<p align="center">
  <strong>Your models don't need permission to rewrite the mold.</strong><br/>
  <sub>Plan lock → exact work order → isolated patch → verify → pour.</sub>
</p>
