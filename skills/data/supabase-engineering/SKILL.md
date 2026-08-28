---
id: supabase-engineering
version: 2
layer: L4
domain: data, saas
activate_when:
  dependencies: @supabase/supabase-js
requires: postgres-engineering
phases: implementation
roles: implementer
priority: 64
description: Supabase Auth/Storage/RLS.
---

# Supabase engineering

Assume browser clients are hostile; RLS/policy is the authorization boundary for exposed data APIs.

- Enable and test RLS for client-accessible tables. Policies must express tenant/resource ownership for each operation, not only reads.
- Never ship service-role credentials to clients. Server use of service role bypasses RLS and therefore owns authorization explicitly.
- Derive user identity from verified auth context, not client-supplied user IDs.
- Keep storage bucket/object policies aligned with database ownership; signed URLs must be scoped and short-lived when sensitive.
- Treat realtime subscriptions as data exposure paths governed by the same policy assumptions.
- Make migrations reproducible and source-controlled; do not rely on dashboard-only schema/policy edits.
- Bound select shapes and pagination to avoid exposing entire rows/tables unintentionally.

Test policies with at least owner, different tenant/user, anonymous/expired auth, insert/update/delete, and storage/realtime paths touched by the change.

<governance>
Inform, implement, verify, or challenge the locked plan. NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md. If this expertise contradicts the plan: report_conflict.
</governance>
