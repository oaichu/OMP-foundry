---
name: company-governance
description: Foundry workflow gates
alwaysApply: true
---

# Foundry governance

- Commands: `/foundry` `/plan3` `/design` `/aatp` `/build` `/review` `/verify` `/release-check`.
- Source of truth: `.omp/foundry-state.yml` plus `docs/PRODUCT.md`, `docs/MASTER_PLAN.md`, `docs/DESIGN.md`, `docs/AATP/`.
- Implementation writes require `master_plan.status=locked`. UI writes require design locked when `design.required`.
- Workers never edit locked artifacts. Use `report_conflict`.
- Built-in Shift+Tab Plan stays single-model `@plan`. `/plan3` is the three-heat lock.
- `/verify` needs real command exit codes. `/release-check` precedes any publish/deploy.
