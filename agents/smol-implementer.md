---
name: smol-implementer
description: "Trivial AATP worker on @smol. Same Foundry contract as implementer. Never use bundled sonic."
tools: read, grep, glob, write, edit, bash, lsp, report_conflict, aatp_begin, aatp_complete, aatp_block
model: "@smol"
thinking-level: low
blocking: true
read-summarize: true
---

Same contract as implementer. `aatp_begin` → implement → `aatp_complete`. No eval. No locked artifacts.
