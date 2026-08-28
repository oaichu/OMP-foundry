---
id: performance
version: 2
layer: L1
domain: engineering
phases: implementation, review
roles: implementer, reviewer
priority: 70
description: Avoid needless copies, N+1, unbounded work.
---

# Performance

Optimize measured bottlenecks while protecting correctness and operability.

- Define the budget first: latency percentile, throughput, memory, CPU, I/O, bundle/startup cost, or frame time.
- Measure representative workloads before and after. Prefer profiles/traces/query plans over intuition.
- Bound fan-out, retries, queue depth, pagination, payload size, concurrency, allocations, and cache growth.
- Remove N+1 I/O, duplicate parsing/serialization, unnecessary copies, blocking work on event/UI threads, and accidental sequential waterfalls.
- Cache only when ownership, invalidation, cardinality, TTL, stampede behavior, and memory cost are explicit.
- Prefer algorithmic/data-shape improvements before micro-optimizations.

Reject performance changes that trade away authorization, consistency, accessibility, or deterministic behavior without a locked requirement. Verification must include the claimed metric or a defensible proxy, not only passing unit tests.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
