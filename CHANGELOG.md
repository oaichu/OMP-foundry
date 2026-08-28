# Changelog

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
