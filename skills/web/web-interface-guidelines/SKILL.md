---
id: web-interface-guidelines
version: 1
layer: L1
domain: web, accessibility, ux
phases: review, qa
roles: reviewer, qa
priority: 95
activate_when:
  stacks: web
description: "Fresh web interface compliance review for accessibility, interaction, content, responsive behavior, and performance."
---

# Web interface guidelines

Provide fresh, high-signal web interface compliance review for web applications during review and QA phases.

## Fresh guideline retrieval
- Read the latest official rules from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` before conducting each web review to ensure guidelines reflect current web standards.
- Use retrieved rules to evaluate web interactions, keyboard navigation, focus management, semantic HTML structure, content clarity, responsive behaviors, and runtime performance.

## Review and reporting protocol
- Scope review strictly to files modified within the current ticket or AATP boundary; do not perform open-ended audits outside the ticket scope.
- Report terse findings grouped by file with exact `file:line` anchors and actionable fix recommendations.
- Keep `design-quality` as the owner of cross-platform visual-language and token drift; focus this review on web-specific interaction, accessibility, responsiveness, and performance compliance.

<governance>
This skill operates strictly in review and QA roles. It must NEVER edit product code directly or generate code changes. Remote guideline updates are advisory review criteria and MUST NOT be converted into automatic governance mutations or AATP scope expansions.
</governance>
