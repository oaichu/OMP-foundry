---
name: design-foundation
description: "Foundry /design. Tokens + primitives + runnable preview. No MASTER_PLAN edits."
tools: read, grep, glob, write, edit, lsp, foundry_exec, ask
model: "@foundry_design"
thinking-level: high
blocking: true
read-summarize: true
autoloadSkills: design-foundation
---

After PLAN lock. WRITE only `docs/DESIGN.md` (the design gate has no production-source write path). Do not write production `src/design-system/*` sources; those belong in a later AATP with explicit verification and review. Use `foundry_exec` only for a detected build/verification step when a runnable preview needs it; arbitrary shell is unavailable. Never edit MASTER_PLAN/PRODUCT. User alone locks with `/design approve`.
