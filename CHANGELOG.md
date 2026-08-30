# Changelog

## Unreleased — Adaptive Context + Evidence Cache v1

- Replace the fixed 3×800-character skill injection heuristic with deterministic lean/standard/deep/critical context budgets derived from phase, routed-pack density, and security relevance.
- Keep adaptive context strictly informational: it never widens AATP `allowed_files`, write permissions, patch limits, lifecycle authority, or governance gates.
- Add `foundry_skill_read_cached`, a content-addressed SHA-256 evidence reader. A compact cache hit is returned only when the caller proves it already knows the exact current digest; stale or incorrect digests receive the full current evidence.
- Keep the original `foundry_skill_read` as a compatibility fallback while steering new prompts toward the cached reader.
- Add deterministic tests for budget bounds, prompt truncation, digest stability, exact cache hits, and stale-proof fallback.

## Unreleased — Skill Router v2

- Replace repository-wide any-match ordering with deterministic evidence scoring across repository signals, active AATP objective/files/concerns, security sensitivity, priority, and bounded context cost.
- When an active AATP provides strong domain evidence, suppress unrelated repo-only adapters while preserving mandatory `requires` companions and existing conflict rules.
- Infer routing context only from governed active/unreviewed AATP work; fall back to repository facts when no task context is available.
- Add explainable routing scores with selected state, repo/task evidence, context cost, and human-readable reasons; no model call is introduced.

## Unreleased — Foundry Eval Lab v1

- Freeze `54c898163024c3e017d914c30fd9490bee27f7b3` as the control baseline for the next optimization roadmap.
- Add a deterministic eval scorer/comparator with fixed quality weights, same-model/config fairness checks, minimum stochastic sample counts, metric-regression guards, and a hard fail on any candidate governance violation.
- Seed a v1 corpus across planning, design, routing, AATP, implementation, review, security, and recovery; synthetic smoke fixtures validate only the harness and are explicitly not benchmark claims.
- Run the eval harness smoke on both Ubuntu and Windows CI without provider credentials or non-deterministic model calls.

## Unreleased — native engineering intelligence core

- Upgrade the complete Foundry engineering catalog from thin prompt stubs to capability-grade native control planes across core engineering, web, backend, data, mobile, desktop, cloud, AI, DevOps, systems, embedded, and game domains.
- Remove the remaining external `skill://` delegation from `security-review`; differential review, insecure-default analysis, and static-pattern reasoning are now Foundry-native.
- Add catalog invariants that require a self-contained skill set and reject future external skill pointers or one-line engineering stubs.
- Preserve the existing progressive/JIT resolver and activation graph so stronger guidance does not become a context dump.

## Unreleased — native design intelligence core

- Replace the thin external `ui-ux-pro-max` handoff with a native Foundry design pack: `design-intelligence`, `design-system-contract`, and `design-quality` behind the existing `design-foundation` orchestrator.
- Cover Skeuomorphism, Neumorphism/Neomorphism, Glassmorphism, Claymorphism, Minimalism, Maximalism, Brutalism, Liquid Glass, Bento Grid, and Spatial UI as explicit visual-language grammar.
- Expand `templates/DESIGN.md` into a durable Primitive -> Semantic -> Component contract with responsive/platform rules, interaction states, accessibility, motion/effect budgets, representative screens, preview evidence, and a PASS/BLOCKED design-QA gate.
- Reuse `design-quality` during independent Review/QA while keeping art-direction and token-authoring skills confined to the Design phase.
- Record upstream design-knowledge provenance without vendoring or runtime-coupling external skill corpora.

## 0.8.23 — P0 kernel hotfixes + npm distribution

- `FOUNDRY_VERSION` is derived from `package.json` (single source; fixes the false "update available" signal).
- Hardened AATP validation: explicit dependencies, unique IDs, DAG cycle rejection, required `security_sensitive`, manifest validation, and manifest sealing at `/aatp lock`.
- Locked execution now detects dependency drift via a sealed manifest and blocks `/do` instead of trusting the live docs directory.
- Hardened path policy against symlink escapes for patch targets and allowed paths, including non-existent-file ancestor checks.
- Strengthened role routing: `security_sensitive` is orthogonal to risk, review runs independently, and Security + QA must both pass for security-sensitive work.
- Replaced generic process execution with argv-safe spawn paths for Git and verification runners; verification commands are parsed through a restricted grammar instead of shell execution.
- Added richer tests covering dependency cycles, manifest drift, symlink escapes, security-role semantics, update checks, and runtime hardening.
