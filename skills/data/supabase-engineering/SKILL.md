---
id: supabase-engineering
version: 1
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

# Supabase
Never expose service role. RLS on every table.


<governance>
Inform, implement, verify, or challenge the locked plan.
NEVER edit docs/MASTER_PLAN.md, docs/PRODUCT.md, or docs/DESIGN.md.
If this expertise contradicts the plan: report_conflict.
</governance>
