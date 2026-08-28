---
id: debugging
version: 2
layer: L1
domain: engineering
phases: implementation, qa
roles: implementer, qa
priority: 90
description: Root cause before fix.
---

# Debugging

Debug from evidence, not patch accumulation.

1. Reproduce the smallest failing case and record expected vs actual behavior.
2. Establish the failing boundary with logs, tests, traces, state inspection, or binary search through the call path.
3. Form one falsifiable hypothesis at a time; run the cheapest discriminating check.
4. Fix the earliest incorrect invariant, not the latest visible symptom.
5. Add or tighten a regression test that fails before the fix and passes after it.
6. Re-run adjacent verification to catch secondary effects.

Do not shotgun null checks, retries, sleeps, cache clears, broad exception catches, or dependency upgrades without causal evidence. For intermittent failures, control time, randomness, concurrency, network, filesystem, and shared state before changing code. Preserve the original failure evidence in the work record.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
