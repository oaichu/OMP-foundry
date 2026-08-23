# Changelog

## 0.7.3 — terminal capability completion

- synchronize the runtime version with the package/release version;
- stop Plan3/AATP child sessions after their terminal capability writes;
- recover and validate a terminal artifact when an OMP provider reports a post-write task failure;
- keep invalid, incomplete, or unproven artifacts fail-closed and unsealed.

## 0.7.2 — capability handoff and circuit-breaker hardening

- Hide Plan3/AATP capability writers from the default orchestrator tool surface while keeping them explicitly available to their declared stage agents.
- Share short-lived capability state across OMP sub-agent runners and bind writes to the spawned session, so a parent cannot use a leaked token.
- Detect the real OMP `session_init` agent identity, provide actionable non-retryable errors, and abort/revoke a run after repeated invalid capability attempts.
- Added integration coverage for parent-token misuse, session-bound handoff, hidden tools, and guessed-token circuit breaking.

## 0.7.1 — verification portability patch

- Resolve trusted system executable shims (including Linux/macOS `npm` symlinks) before verification while continuing to reject targets inside the governed repository.

## 0.7.0 — security and provenance hardening

- Added schema v6 provenance fields for implementation, verification, review, dependency, manifest, scope evidence, and a bounded baseline/commit ledger.
- Descendant AATP work now waits for an approved, provenance-bound dependency; request-changes recursively invalidates descendants.
- Added dispatch HEAD checks and Plan3/AATP epochs to reject stale worker and compiler capabilities.
- Added pre-commit execution of declared AATP verification steps with bounded output, sanitized environment, and disposable HOME/TMP.
- Design preview execution now fails closed if it changes the visible Git worktree; production design-system code must still enter through AATP.
- Added optional fail-closed external sandbox mode with `FOUNDRY_VERIFY_REQUIRE_SANDBOX=1` and `FOUNDRY_VERIFY_SANDBOX_EXECUTABLE`.
- Plan revisions invalidate the design gate; production design-system sources must enter through AATP.
- Added concern-ID coverage (`REQ-*`, `ARCH-*`, `SEC-*`, `DES-*`, `OPS-*`) and separate `security_sensitive` reviewer routing.
- Improved nested-workspace UI detection, archive baseline handling, atomic OMP config writes, and skill dependency handling.
- Legacy completed/approved tickets without provenance are reopened during migration instead of being trusted.

Verification remains a trusted-host operation unless an external OS sandbox is explicitly configured. Do not run `/verify` on hostile repositories without that sandbox.
