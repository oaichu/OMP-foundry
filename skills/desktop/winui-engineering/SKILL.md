---
id: winui-engineering
version: 2
layer: L3
domain: desktop
activate_when:
  stacks: windows
phases: implementation, design
roles: implementer, designer
priority: 74
description: WinUI 3 / WASDK.
---

# WinUI engineering

Implement Fluent behavior without sacrificing Windows accessibility or lifecycle correctness.

- Prefer typed `x:Bind`/clear view-model contracts over opaque code-behind state coupling.
- Keep long work off the dispatcher/UI thread and cancel it when its owning page/window exits.
- Use resource dictionaries/theme resources for design tokens; support light/dark/high-contrast without hardcoded foreground/background pairs.
- Preserve keyboard accelerators, access keys, focus order, automation names/patterns, narrator behavior, and text scaling.
- Handle window activation, resize, DPI changes, multiple windows, and app lifecycle explicitly.
- Keep navigation state separate from loaded domain data; avoid retaining pages solely to preserve mutable state.
- Gate Windows App SDK/API usage by the actual target/runtime contract.

Do not use blur/material effects when contrast or device capability makes content ambiguous; follow locked Design degradation rules. Verify packaged build on the declared Windows target plus keyboard/high-contrast flows affected by the change.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
