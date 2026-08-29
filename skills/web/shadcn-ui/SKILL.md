---
id: shadcn-ui
version: 2
layer: L3
domain: web, design-system
phases: implementation, review
roles: implementer, reviewer
priority: 89
activate_when:
  files: components.json
requires: react-engineering
description: "Project-aware shadcn/ui composition, registry, token, and accessibility rules."
---

# shadcn/ui engineering

Use project-aware shadcn/ui composition, registry inspection, semantic tokens, and accessibility contracts.

## Inspection and configuration
- Inspect `components.json` first to discover configured paths, resolved aliases (`@/components/ui`), base primitive (`radix` or `base-ui`), icon library (`lucide-react`, `radix-icons`, etc.), Tailwind CSS version (v3 or v4), and package manager.
- Check already installed UI files and existing component states before adding new components or writing custom UI primitives.
- Prefer existing installed components. When new primitives are required, use explicit registry search and component definitions matching the project configuration.

## Composition and design tokens
- Compose primitives cleanly without breaking underlying slot or DOM structures.
- Rely on semantic tokens (e.g., `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `ring-ring`) and built-in component variants (`cva`) rather than hardcoded colors or ad-hoc utilities.
- Ensure custom styles integrate with the project's CSS variable theme and dark-mode styling contract.

## Interaction and accessibility contracts
- Preserve accessible component structure: group labels (`FieldGroup`, `RadioGroup`), overlay titles and descriptions (`DialogTitle`, `SheetDescription`), and appropriate ARIA attributes.
- Ensure all interactive controls have visible keyboard focus indicators, accessible names, and adhere to standard keyboard navigation patterns.
- Maintain form validation states, disabled states, loading indicators, and error feedback across interactive forms.
- Review all generated source code before accepting it into the codebase to prevent dead code, unstyled elements, or unhandled prop pass-through.

<governance>
Governed workers cannot run shell mutations or bypass AATP scope. The shadcn CLI belongs to a parent or human action that is already in approved scope. Always inspect, compose, and review existing component code within ticket boundaries. If required changes exceed ticket scope, report conflict.
</governance>
