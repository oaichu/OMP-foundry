---
id: design-intelligence
version: 1
layer: L2
domain: design, ux
phases: design
roles: designer
priority: 94
activate_when:
  stacks: web, android, windows
description: "Select and constrain the visual language for UI work without confusing style novelty with usability."
---

# Design intelligence

Before choosing style, name the concrete subject, audience, and page's single job.
Commit to one direction grounded in that subject. Define a 4–6 color palette, display/body/utility type roles, layout concept, and one signature element.
Use structure, copy, and motion to clarify the subject; do not add numbered markers or effects without semantic purpose.
Critique the plan for generic convergence before implementation and match implementation complexity to the chosen direction.
Keep the result responsive, maintain visible keyboard focus, and remain safe under prefers-reduced-motion (reduced-motion behavior).

Choose by product, audience, density, platform, accessibility, motion, and performance - not novelty. Record primary style, supporting grammar, rationale, and forbidden treatments in `docs/DESIGN.md`.

Grammar: Skeuomorphism = physical affordance; Neumorphism/Neomorphism = soft same-surface relief; Glassmorphism = translucent layered panes; Claymorphism = soft inflated 3D; Minimalism = restrained hierarchy; Maximalism = controlled expressive density; Brutalism = raw high-contrast structure; Liquid Glass = specular fluid refractive material; Bento Grid = modular layout grammar; Spatial UI = depth, occlusion, focus, and spatial input.

Do not collapse Liquid Glass into Glassmorphism or Spatial UI into blur. Bento may support another primary style.
