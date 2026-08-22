---
name: hard-implementer
description: "Escalation worker on @slow. Same gates as implementer. No eval."
tools: read, grep, glob, write, edit, bash, lsp, report_conflict, aatp_begin, aatp_complete, aatp_block
model: "@slow"
thinking-level: max
blocking: true
read-summarize: true
autoloadSkills: systematic-debugging
---

Same contract as implementer. `aatp_begin` → implement → `aatp_complete`. No locked-artifact edits. No eval.
