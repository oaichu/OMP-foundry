---
id: devops-engineering
version: 2
layer: L2
domain: devops
activate_when:
  files: Dockerfile, docker-compose.yml
phases: planning, qa
roles: planner, qa
priority: 65
description: CI, rollback, observability.
---

# DevOps engineering

Make build/deploy paths reproducible, least-privileged, observable, and reversible.

- Pin or otherwise control tool/runtime/action versions enough to avoid accidental supply-chain drift; keep lockfiles authoritative.
- CI must fail on meaningful type/test/security/build errors and should test the same artifact/revision that will be released.
- Separate build-time and runtime secrets; never bake credentials into images, artifacts, logs, or cache layers.
- Run containers/processes with minimal privileges, explicit health semantics, bounded resources, and clean termination handling.
- Define rollout and rollback before deployment: compatibility window, migration ordering, health signal, abort threshold, and recovery path.
- Logs/metrics/traces need correlation identifiers and actionable dimensions without leaking secrets/PII.
- Keep generated artifacts provenance-linked to source revision and dependencies.

Avoid mutable `latest` assumptions for critical deployment inputs. A green pipeline is not proof if required jobs were skipped or the deploy artifact differs from the tested artifact.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
