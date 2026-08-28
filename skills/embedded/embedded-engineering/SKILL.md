---
id: embedded-engineering
version: 2
layer: L2
domain: embedded
activate_when:
  languages: c, rust
phases: planning, implementation
roles: planner, implementer
priority: 55
description: Timing, memory, hardware interfaces.
---

# Embedded engineering

Treat timing, memory, power, interrupts, and hardware state as explicit budgets.

- Avoid unbounded allocation, recursion, queues, retries, or blocking on real-time/hot paths.
- Separate interrupt work from deferred processing; keep ISRs minimal and make shared-state synchronization safe for the target memory model.
- Model device/protocol behavior as explicit state machines with timeout/error/recovery transitions.
- Validate peripheral/register assumptions against the target and keep volatile/atomic semantics correct; do not optimize away hardware interactions.
- Define startup/reset/brownout/watchdog behavior and safe defaults for actuators/outputs.
- Bound parsing and DMA/buffer operations; defend against overflow, wraparound, stale buffers, and partial frames.
- Keep hardware abstraction thin enough that timing-critical behavior remains inspectable.

Verification should include host/unit tests where possible plus target/HIL evidence for timing, reset/recovery, boundary inputs, and hardware interactions affected by the change.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
