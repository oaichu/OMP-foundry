# Native skill provenance policy

OMP Foundry ships its engineering skill catalog as self-contained control-plane guidance. Runtime skill resolution must not require external `skill://` packs, cloned repositories, npm skill bundles, or remote prompt corpora.

The catalog distills stable engineering practice, platform documentation knowledge, security review patterns, and lessons from public agent-skill ecosystems into original Foundry-native rules. External projects may be reviewed as research inputs, but are never auto-synced or treated as runtime authorities.

Policy:
- one Foundry capability owner per concern;
- compact `SKILL.md` control planes, progressively/JIT loaded by the existing resolver;
- deterministic code/tests own governance and lifecycle, not prose skills;
- upstream-specific facts that can go stale should be verified against current official documentation during project work rather than frozen into the catalog;
- no external skill pointer may be required for correctness or security review.
