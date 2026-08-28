---
id: testing
version: 2
layer: L1
domain: engineering
phases: implementation, qa
roles: implementer, qa
priority: 90
description: Test the behavior contract, not plumbing.
---

# Testing

Test observable contracts and failure boundaries, not implementation trivia.

- Choose the lowest test level that proves the behavior: pure/unit for local invariants, integration for boundaries, end-to-end only for critical cross-system journeys.
- Cover happy path, meaningful edge cases, authorization/validation failures, and regression cases created by the change.
- Keep tests deterministic: control clock, randomness, network, filesystem, process state, and concurrency where practical.
- Assert outputs, persisted state, emitted effects, or protocol contracts rather than private method calls.
- Avoid mocks that duplicate the implementation. Fake only external boundaries or expensive nondeterminism.
- Make fixtures minimal and explicit; each failure should identify the broken contract quickly.

A test suite that passes without exercising the changed branch is not evidence. For bugs, capture the reproducer before the fix. For migrations or concurrency, test backward/forward compatibility and race-sensitive invariants where feasible.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
