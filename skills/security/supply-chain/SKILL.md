---
id: security-supply-chain
version: 1
layer: L2
domain: security, supply-chain
phases: planning, review, qa
roles: planner, reviewer, qa
priority: 89
activate_when:
  files: package.json, package-lock.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml
description: "Assess dependency advisories, lockfile coverage, publisher/install risk, and unassessable evidence."
---

# security-supply-chain

Perform static supply-chain risk assessment on declared dependencies, lockfiles, and package configurations. Never install or build dependencies during assessment.

## Assessment Scope

1. **Advisory Matching**: Match declared and resolved dependencies against authoritative vulnerability databases (CVE, GHSA, OSV). Quote measured data: package name, resolved version, advisory ID, CVSS score, and affected range.
2. **Lockfile Integrity & Coverage**: Verify lockfile presence, deterministic resolution, checksum hashes (e.g. SHA-512 integrity, Cargo.lock checksums, go.sum entries), and check for phantom or unpinned dependencies.
3. **Install & Publisher Risk**: Review lifecycle scripts (`preinstall`, `postinstall`, custom build hooks), unexpected external network calls, publisher reputation signals, and typosquatting proximity to popular packages.
4. **Preserve Unassessable Rows**: Explicitly record unassessable components (e.g. private registry packages, vendored binary blobs, unversioned Git references) as `UNASSESSABLE` with documented reasons rather than assuming safety.

## Operational Constraints

- Strictly static analysis: read manifests and lockfiles; never execute package managers (`npm install`, `pip install`, `cargo build`) or package scripts.
- Quote exact version numbers and measured findings; do not extrapolate speculative CVEs.
- Provide clear dependency update recommendations with minimal version bumps to resolve identified vulnerabilities.
