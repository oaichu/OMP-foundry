---
name: foundry-governance
description: Foundry workflow gates
alwaysApply: true
---

# Foundry governance

- Commands: `/foundry` `/plan` `/design` `/aatp` `/build` `/review` `/verify` `/release-check`.
- Source of truth: `.omp/foundry-state.yml` plus `docs/PRODUCT.md`, `docs/MASTER_PLAN.md`, `docs/DESIGN.md`, `docs/AATP/`.
- Implementation writes require `master_plan.status=locked`. UI writes require design locked when `design.required`.
- After the human locks the plan/design, only the blocking `aatp-compiler` routed through `@foundry_synth` may create unsealed `docs/AATP/AATP-*.md`; implementation and review workers are denied until Foundry validates and seals the project-wide DAG.
- The compiler may not rewrite `docs/MASTER_PLAN.md`, `docs/DESIGN.md`, product artifacts, code, or Foundry state. AATP work orders must name exact scope, dependencies, risk, acceptance, verification, and forbidden governance paths.
- Workers never edit locked artifacts. Use `report_conflict`.
- Built-in Shift+Tab Plan stays single-model `@plan`. `/plan` is the three-heat lock.
- `/verify` needs real command exit codes. `/release-check` precedes any publish/deploy.
