---
version: "0"
status: DRAFT
---

# Design

## Design intent

- Product promise:
- Concrete subject:
- Primary users:
- Single job:
- Hero thesis:
- Platforms:
- Constraints inherited from `docs/MASTER_PLAN.md`:
- Success criteria:

## Visual language

- Primary style:
- Supporting layout grammar (optional):
- Why this fits the product/users/platform:
- Layout concept:
- Signature element:
- Compact palette (4–6 core colors):
- Typography roles (display / body / utility):
- Density and hierarchy:
- Material/depth model:
- Motion character:
- Genericity critique:
- Forbidden treatments / anti-patterns:
> Use one primary visual language by default. Bento Grid may be a supporting layout grammar. Do not treat Liquid Glass as a synonym for Glassmorphism, or Spatial UI as blur-only styling.

## Information architecture

- Navigation model:
- Primary destinations:
- Content hierarchy:

## UX flows

### Primary flow

1. 
2. 
3. 

### Critical alternate/error flows

- Empty:
- Loading:
- Error/retry:
- Offline/degraded (if applicable):
- Permission/auth (if applicable):

## Design tokens

### Primitive tokens

| Family | Scale / rule |
| --- | --- |
| Color | |
| Typography | |
| Spacing | |
| Radius | |
| Border | |
| Elevation / material | |
| Motion | |

### Semantic tokens

| Intent | Token(s) | Rule |
| --- | --- | --- |
| Background / surface | | |
| Text / icon | | |
| Primary action | | |
| Secondary action | | |
| Success / warning / danger | | |
| Focus / selection | | |
| Disabled | | |

### Component tokens and exceptions

- Component values derive from semantic tokens by default.
- Explicit exceptions:

## Typography and content

- Type scale:
- Line-height / measure:
- Weight hierarchy:
- Truncation/wrapping rules:
- Numeric/data formatting:

## Layout, responsive, and platform adaptation

- Grid / container model:
- Breakpoints or adaptive rules:
- Minimum/maximum content widths:
- Density changes by viewport:
- Web-specific behavior:
- Android-specific behavior:
- Windows/desktop-specific behavior:
- Pointer/touch/keyboard adaptation:

## Components and states

| Component | Anatomy | Required states | Responsive behavior | Accessibility contract |
| --- | --- | --- | --- | --- |
| | | default / hover / focus / pressed / disabled / loading / error | | |

## Interaction and accessibility

- Focus order and visible focus:
- Keyboard navigation:
- Touch/pointer target rules:
- Contrast and non-color semantics:
- Screen-reader/accessibility naming:
- Text scaling/zoom behavior:
- High-contrast/dark-mode behavior:

## Motion

- Motion purpose:
- Duration/easing tokens:
- Enter/exit/feedback rules:
- Reduced-motion fallback:
- Performance/effect budget:

## Representative screens

| Screen / state | Purpose | Key components | Required viewport/platform |
| --- | --- | --- | --- |
| | | | |

## Design QA

- [ ] Primary hierarchy is obvious without relying on effects alone.
- [ ] Contrast and state meaning remain usable without color-only cues.
- [ ] Focus, keyboard, pointer/touch targets, and text scaling are defined.
- [ ] Empty/loading/error/disabled states are covered.
- [ ] Responsive rules avoid overflow and preserve usable content density.
- [ ] Reduced-motion behavior exists where motion is used.
- [ ] Expensive blur/refraction/shadow/3D effects have a performance fallback or budget.
- [ ] Components trace back to the locked token hierarchy.
- [ ] Representative screens demonstrate the chosen visual language consistently.

**Verdict:** BLOCKED

**Open issues before approval:**

- 

## Preview verification

### Preview command

```text
<command>
```

- Routes/screens to inspect:
- Viewports/platforms:
- Required interaction states:
- Expected evidence:
- Known preview limitations:
