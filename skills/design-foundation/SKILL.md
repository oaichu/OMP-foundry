---
id: design-foundation
name: design-foundation
version: 2
layer: L1
domain: design
requires: design-intelligence, design-system-contract, design-quality
phases: design
roles: designer
priority: 96
activate_when:
  stacks: web, android, windows
description: "Foundry visual design gate: direction, durable design contract, and design QA after plan lock."
---

# design-foundation

Own only `docs/DESIGN.md` after Plan lock. Resolve product and plan constraints, choose one primary visual language, freeze the design-system contract, then run design-quality before asking for approval. Prefer one primary style plus at most one supporting layout grammar unless the locked plan says otherwise. Do not implement production UI in this phase. Preview verification may run only through Foundry-owned verification. Human alone runs `/design approve`; backend-only work may `/design skip`.

<governance>
The locked Product and Master Plan outrank design preferences. Never edit `docs/MASTER_PLAN.md` or `docs/PRODUCT.md`. Production source changes belong to a later sealed AATP. Contradiction -> report_conflict.
</governance>
