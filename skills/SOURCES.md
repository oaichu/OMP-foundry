# Native skill provenance policy

OMP Foundry ships its engineering skill catalog as self-contained control-plane guidance. Runtime skill resolution must not require external `skill://` packs, cloned repositories, npm skill bundles, or remote prompt corpora.

The catalog distills stable engineering practice, platform documentation knowledge, security review patterns, and lessons from public agent-skill ecosystems into original Foundry-native rules. External projects may be reviewed as research inputs, but are never auto-synced or treated as runtime authorities. The shipped text is an original Foundry distillation, remote rules are not vendored, and current official docs must be fetched when freshness matters.

Policy:
- one Foundry capability owner per concern;
- compact `SKILL.md` control planes, progressively/JIT loaded by the existing resolver;
- deterministic code/tests own governance and lifecycle, not prose skills;
- upstream-specific facts that can go stale should be verified against current official documentation during project work rather than frozen into the catalog;
- no external skill pointer may be required for correctness or security review.

## Reviewed research inputs

- `anthropics/skills` (Apache-2.0): Frontend Design art direction, subject-grounded intent, typography/layout/signature choices, and two-pass critique.
- `shadcn-ui/ui` (MIT): component composition, registry patterns, and semantic token conventions.
- `vercel-labs/agent-skills` (Apache-2.0): Web Interface Guidelines review formatting, interaction contracts, and live rule retrieval pattern.
