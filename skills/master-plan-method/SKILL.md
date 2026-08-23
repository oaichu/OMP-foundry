---
id: master-plan-method
name: master-plan-method
version: 1
layer: L1
domain: planning
phases: planning
roles: planner
priority: 96
description: "Methodology and rubrics for architecting, red-teaming, and synthesizing a Foundry master plan."
---

# master-plan-method

This skill contains planning **methodology only**. It does not own lifecycle, stage transitions, agent spawning, approval, or plan locking. `/plan3` and the Foundry runtime state machine own those concerns.

## Architect rubric

A draft must make the decision surface explicit:
- product requirements, constraints, non-goals, and success criteria;
- assumptions separated from verified facts;
- architecture boundaries, trust boundaries, data/control flows, ownership, and external dependencies;
- security, privacy, performance, reliability, operability, cost, and portability constraints;
- irreversible or expensive-to-reverse choices;
- dependency/task DAG and an AATP-ready decomposition;
- acceptance criteria and unresolved decisions.

Prefer the simplest architecture that satisfies the locked product constraints. Do not invent requirements merely to justify infrastructure.

## Red-team rubric

Attack the draft rather than polishing it. Look for:
- false or unsupported assumptions;
- missing threat model or trust boundary;
- hidden coupling and single points of failure;
- scaling/performance/cost breakpoints;
- unsafe migration/deployment/rollback assumptions;
- unnecessary services, abstractions, queues, databases, or distributed components;
- missing requirements and untestable acceptance criteria;
- dependency, supply-chain, portability, and vendor-lock risks;
- mismatch between the proposed DAG and the actual architecture.

Every material finding should identify the target claim, concrete evidence, consequence, severity, and smallest corrective action.

## Synthesis/adjudication rubric

The synthesis stage is a judge, not an editor. For each blocker or major red-team finding:
1. mark it ACCEPT or REJECT;
2. state the evidence/rationale;
3. reflect accepted changes consistently across architecture, DAG, risks, and acceptance criteria;
4. never silently average incompatible recommendations.

The final master plan must be internally consistent and executable without requiring implementation agents to reinterpret architecture. Any unresolved architectural conflict remains explicit for human resolution.
