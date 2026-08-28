---
id: desktop-engineering
version: 2
layer: L2
domain: desktop
activate_when:
  stacks: desktop, windows
phases: planning, implementation, review
roles: planner, implementer, reviewer
priority: 75
description: Desktop windowing, packaging, a11y.
---

# Desktop engineering

Treat window lifecycle, filesystem/process access, updates, and keyboard accessibility as first-class contracts.

- Keep UI thread free of blocking I/O/CPU work; marshal only presentation updates back to it.
- Define ownership for windows/dialogs/background tasks/tray processes so close, suspend, and app exit cannot leak work.
- Validate file paths, protocol/deep links, drag-drop, clipboard, IPC, and shell inputs before privileged operations.
- Store user data/config in platform-appropriate locations with atomic writes and migration/versioning where needed.
- Design keyboard-first: visible focus, logical tab order, shortcuts without collisions, screen-reader names, high-contrast/theme behavior, and scaling.
- Multi-window state must not accidentally share mutable view state unless intentionally app-global.
- Packaging, signing, permissions, updater behavior, rollback, and uninstall cleanup are release concerns, not afterthoughts.

Verify resize/minimize/restore, multiple DPI/scales, keyboard-only flow, high contrast, shutdown during work, and installer/update path when changed.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
