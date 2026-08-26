# OMP Foundry

OMP Foundry is a governed workflow extension for [Oh My Pi](https://github.com/can1357/oh-my-pi). It turns a product request into explicit artifacts, a three-stage plan, bounded AATP work orders, parent-applied patches, verification evidence, and a derived release decision.

It is a workflow and enforcement layer. It is not an operating-system sandbox, a cryptographic signing system, or an automatic replacement for engineering judgment.

<p align="center">
  <a href="https://github.com/oaichu/OMP-foundry/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/oaichu/OMP-foundry?display_name=tag&sort=semver"/></a>
  <a href="https://www.npmjs.com/package/omp-foundry"><img alt="npm" src="https://img.shields.io/npm/v/omp-foundry"/></a>
  <a href="https://github.com/oaichu/OMP-foundry/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/oaichu/OMP-foundry/ci.yml?branch=main&label=CI"/></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-14110E"/></a>
</p>

## What is shipped

Version `0.8.23` ships the P0 governance and distribution layer:

- Product → Plan3 → Design → AATP → Build → Review → Verify → Release lifecycle.
- Draft → Redteam → Synth planning with human plan locking.
- SHA-256 content evidence for Product, Plan, Design, AATP, review, and verification artifacts.
- AATP dependency, overlap, path, size, and provenance validation.
- Parent-owned patch application and commit; workers do not self-apply their patches.
- Fail-closed governance checks for locked artifacts and known bash/LSP mutation paths.
- Retry state persisted in `.omp/foundry-state.yml`.
- Risk routing: trivial/low work starts on `smol-implementer`; retries escalate to `hard-implementer`.
- npm packaging and GitHub Actions release publishing with npm provenance.

The Fast/Lite/Full router, cost ledger, and `/foundry-stats` are specified in the architecture document but are **not shipped in v0.8.23**. They are the next implementation phases, not current behavior.

## Install and update

### npm (recommended)

After the package is published:

```text
omp plugin install omp-foundry
```

This is also the update command. Re-running it resolves the latest npm version.

### Git fallback

```text
omp plugin install github:oaichu/omp-foundry#v0.8.23
```

Use a release tag for reproducibility. Installing `github:oaichu/omp-foundry` without a tag follows the repository default branch and is a development/canary path.

Check the installed plugin:

```text
omp plugin list
omp plugin doctor
```

`omp update --plugins` upgrades marketplace plugins. It is not the update path for this npm/git plugin. Restart OMP after updating so the extension module, commands, hooks, and skills are loaded again.

## Quick start

From a project repository, start OMP and run:

```text
/foundry Build a REST API with authentication and PostgreSQL
```

Foundry bootstraps the project-local artifacts and asks the product analyst to write `docs/PRODUCT.md`. The normal human-controlled flow is:

```text
/approve product
/plan
/approve plan
/design
/design approve       # or /design skip for a non-UI project
/aatp
/build
/review AATP-<id>
/verify
/release-check
```

When Plan3 reaches `awaiting_lock`, `/ok`, `/run`, or `/go` performs the same plan-lock operation as `/approve plan`. At other stages these commands only advance to the next legal step; they are not a general natural-language approval parser.

## Governed lifecycle

| Phase | Artifact or action | Authority |
|---|---|---|
| Discovery | `docs/PRODUCT.md` | Product analyst writes; human approves with `/approve product` |
| Planning | `MASTER_PLAN_DRAFT.md` → `PLAN_REVIEW.md` → `MASTER_PLAN.md` | `plan-drafter`, `plan-redteam`, `plan-synth`; human locks the final plan |
| Design | `docs/DESIGN.md` and, for UI work, a preview verified by Foundry | `design-foundation`; human uses `/design approve` or `/design skip` |
| AATP | `docs/AATP/AATP-*.md` and `INDEX.md` | `aatp-compiler` or the explicit human `/aatp-seal` escape hatch |
| Implementation | Sealed AATP tickets | Isolated worker produces a patch; parent validates, applies, verifies, and commits |
| Review | `docs/reports/review-<id>.md` | Separate `reviewer` or `security-reviewer` role |
| QA | Declared verification IDs and `docs/reports/QA.md` | Deterministic commands with real exit codes |
| Release | Derived readiness state | Human/CI performs any publish or deployment action |

Source-of-truth files:

```text
.omp/foundry-state.yml
docs/PRODUCT.md
docs/planning/MASTER_PLAN_DRAFT.md
docs/planning/PLAN_REVIEW.md
docs/MASTER_PLAN.md
docs/DESIGN.md
docs/AATP/
```

## AATP boundaries

Strict AATP validation currently enforces:

- Explicit non-empty `allowed_files`.
- At most five `allowed_files` per work order.
- At most 200 declared work-order lines.
- Explicit acceptance and verification entries.
- Repository-relative paths without globbing or dot-segment escapes.
- Valid dependencies, no cycles, and no unsequenced overlapping scopes.
- Governance artifacts in `forbidden_files`.
- Risk and security-sensitive routing metadata.

`allowed_files` may still contain directory prefixes. v0.8.23 does **not** enforce a hard 80-line unified-diff limit; patch validation currently has byte/path/resource limits and exact path/scope checks. A diff that grows beyond the intended ticket should be split or escalated by the future mode router, not rejected under an undocumented line-count claim.

## Security model and limits

### Protections that are implemented

- Locked artifact content is re-hashed with SHA-256 before downstream transitions.
- Plan and AATP writer tools require short-lived random bearer capabilities tied to the active stage; they are not signatures or OS capabilities.
- Repository path canonicalization rejects traversal, symlink escapes, reserved Windows paths, and unsafe patch targets.
- Patch application checks paths, symlinks, hard links, gitlinks, expected bytes, and the repository HEAD before commit.
- Governed workers require a clean parent tree and the parent extension owns apply/commit.
- Outside discovery, the shell gate permits only constrained read-only Git inspection; known compound-command, redirection, subshell, and dangerous Git execution forms are rejected.
- Verification passes a reduced environment and disposable HOME/TMP paths.

### Explicit limitations

- The default verification runner is a trusted-host operation. It does not provide an OS sandbox unless `FOUNDRY_VERIFY_REQUIRE_SANDBOX=1` and a working external sandbox executable are configured.
- A content hash stored in extension-owned state is evidence of bytes, not a signed or tamper-proof lock. A process that can bypass the extension can still mutate the repository.
- `/debug` currently emits the five-step debugging protocol; it is not an automated debugger.
- `/approve` handles Product and Plan. Design approval remains `/design approve` or `/design skip`.
- Natural-language words such as `duyệt` are not parsed as a privileged approval command.
- Do not run `/verify` on an untrusted repository without an external OS sandbox.

## Model and context strategy

The current release keeps expensive reasoning at architectural boundaries and uses cheaper roles for bounded implementation:

| Work | Default role |
|---|---|
| Product analysis | `product-analyst` |
| Plan Draft/Redteam/Synth | `plan-drafter`, `plan-redteam`, `plan-synth` |
| Trivial/low-risk first attempt | `smol-implementer` |
| Normal implementation | `implementer` |
| Difficult, hard, critical, or retried implementation | `hard-implementer` |
| Normal review | `reviewer` |
| Security-sensitive or critical review | `security-reviewer` |

Foundry skills are selected just in time by repository facts, lifecycle phase, and agent role. The package contains compact guidance for web, backend, data, cloud, desktop, mobile, systems, AI, UI foundation, verification, testing, debugging, review, security, and architecture. It deliberately does not inject every skill into every prompt. `foundry_skill_read` loads up to three selected skill bodies on demand.

The packaged skill files are concise operational hints, not proof that every stack has a complete enterprise playbook. Project-specific acceptance criteria and verification commands remain authoritative.

## Command reference

| Command | Purpose |
|---|---|
| `/foundry [prompt]` | Bootstrap or advance the next legal phase. |
| `/foundry-init` | Advanced/manual project bootstrap. |
| `/foundry-doctor` | Check isolation and Foundry model-role availability. |
| `/foundry-version` | Compare the installed version with the npm registry latest version. |
| `/plan [status\|abort\|restart]` | Start, inspect, abort, or restart the three-stage Plan cycle. |
| `/plan-revise` | Human-only plan revision; downstream evidence is invalidated. |
| `/design [approve\|skip]` | Run or close the Design gate after Plan lock. |
| `/foundry-approve` / `/approve [product\|plan]` | Human approval for Product or Plan. |
| `/ok` `/run` `/go` | Advance the workflow; at `awaiting_lock`, lock the completed Plan. |
| `/aatp` | Run the AATP compiler for the locked architecture. |
| `/aatp-seal` | Human-controlled validation/sealing path for offline or transplanted AATP specs. |
| `/build` | Dispatch the next ready isolated implementation layer. |
| `/review [AATP-ID]` | Dispatch the appropriate independent reviewer. |
| `/verify` | Run detected verification commands and derive QA state. |
| `/release-check` | Derive release readiness from artifacts, tickets, reviews, provenance, QA, and tree state. |
| `/debug` | Show the five-step systematic debugging protocol. |

The extension also exposes read/write tools for status, bootstrap, verification, skill loading, approval, Plan artifact writes, and AATP artifact writes. Plan/AATP writers are intended for their active stage agents, not ordinary project work.

## Verification and development

```bash
bun install
bun test
bun run typecheck
bun run check:omp-contract
npm pack --dry-run
```

The CI workflow runs Bun installation, typecheck, tests, extension syntax smoke, and an Oh My Pi contract check on Linux and Windows.

## Release process

A `v*` tag triggers the GitHub Release workflow. The workflow creates the GitHub release and publishes the package to public npm with provenance. Configure the repository `NPM_TOKEN` secret before pushing a release tag.

For a local release check:

```bash
npm pack --dry-run
git tag v<version>
git push origin main --tags
```

The update checker uses the npm registry as the latest-version source. GitHub releases remain the release-history and source-code distribution channel.

## Architecture documents

- Design: [`docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md`](docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md)
- Current P0 plan: [`docs/superpowers/plans/2026-08-26-foundry-p0-hotfixes-npm.md`](docs/superpowers/plans/2026-08-26-foundry-p0-hotfixes-npm.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## License

MIT. See [`LICENSE`](LICENSE).
