---
name: company-governance
description: Company workflow gates
alwaysApply: true
---

# Company governance

- Commands: `/company-init` `/plan3` `/design` `/aatp` `/build` `/review` `/verify` `/release-check`.
- Source of truth: `.omp/company-state.yml` plus `docs/PRODUCT.md`, `docs/MASTER_PLAN.md`, `docs/DESIGN.md`, `docs/AATP/`.
- Implementation writes require `master_plan.status=locked`. UI writes require design locked when `design.required`.
- Workers never edit locked artifacts. Use `report_conflict`.
- Built-in Shift+Tab Plan stays single-model `@plan` (GLM). `/plan3` is the three-model path.
- `/verify` needs real command exit codes. `/release-check` precedes any publish/deploy.
