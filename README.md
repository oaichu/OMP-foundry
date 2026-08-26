<p align="center">
  <img src="docs/assets/hero.svg" width="100%" alt="OMP Foundry Banner — Lock the plan. Then pour the code."/>
</p>

<p align="center">
  <strong>The Enterprise-Grade AI Software Engineering Framework for <a href="https://github.com/can1357/oh-my-pi">Oh My Pi</a> & Antigravity</strong><br/>
  <em>Where architecture is <b>cryptographically locked</b>, execution is <b>micro-isolated</b>, and human intent remains <b>absolute</b>.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/omp-foundry"><img alt="npm" src="https://img.shields.io/npm/v/omp-foundry?style=for-the-badge&logo=npm&logoColor=white&color=CB3837"/></a>
  <a href="https://github.com/oaichu/OMP-foundry/releases/latest"><img alt="Release" src="https://img.shields.io/badge/version-v0.8.23-FFB020?style=for-the-badge&logo=git&logoColor=white"/></a>
  <a href="https://github.com/can1357/oh-my-pi"><img alt="Platform" src="https://img.shields.io/badge/platform-Oh%20My%20Pi%20%7C%20Antigravity-FF9F1C?style=for-the-badge&logo=electron&logoColor=white"/></a>
  <a href="https://github.com/oaichu/OMP-foundry/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/badge/CI-passing-7EC8A9?style=for-the-badge&logo=githubactions&logoColor=white"/></a>
  <a href="#"><img alt="Tests" src="https://img.shields.io/badge/tests-128%20passing-7EC8A9?style=for-the-badge&logo=checkmarx&logoColor=white"/></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-14110E?style=for-the-badge"/></a>
  <a href="https://ko-fi.com/oaichu"><img alt="Support" src="https://img.shields.io/badge/Support-Buy%20Me%20A%20Coffee-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white"/></a>
</p>

---

## 🌟 The Broken Promise of AI Coding (And How We Fix It)

> [!WARNING]
> **The Nightmare:** You ask your AI assistant to build a feature. It writes 500 lines of code across 20 uncoordinated files. It breaks three core components. You spend 3 hours debugging hallucinated imports and cyclic dependencies. After 10 prompts, it forgets the original architecture entirely. You are no longer building software—**you are babysitting an amnesic junior developer.**

> [!TIP]
> **The Deep Desire:** You want an AI that acts like a **disciplined elite engineering team**. You dictate the product vision, lock the architecture with cryptographic proof, and let autonomous workers flawlessly execute isolated micro-tasks without *ever* regressing existing code. You want your natural language to be the **absolute, unquestionable command**.

**OMP Foundry** is that paradigm shift. Unlike standard AI tools that grant models unbounded power to mutate your entire codebase at random, Foundry enforces **Zero-Regression Governance**. It converts natural language prompts into an adversarial 3-Stage Master Plan, decomposes work into provably bounded AATP work orders, sandboxes worker mutations, and verifies every single change deterministically before commit.

You are no longer an AI babysitter. **You are the Chief Architect.**

<p align="center">
  <img src="docs/assets/flow.svg" width="100%" alt="OMP Foundry 6-Stage Engineering Pipeline"/>
</p>

---

## 📦 What is Shipped in v0.8.23

Version `0.8.23` ships the production **P0 Governance & Distribution Layer**:

- 🔄 **Full 8-Phase Lifecycle**: Product → Plan → Design → AATP → Build → Review → Verify → Release.
- 🏛️ **3-Stage Adversarial Planning**: Draft (`plan-drafter`) → Redteam (`plan-redteam`) → Synth (`plan-synth`) with human plan locking.
- 🔐 **Cryptographic Evidence**: SHA-256 hashes generated and verified across Product, Plan, Design, AATP, Review, and QA artifacts.
- 📋 **Strict AATP Task Boundaries**: Enforced dependency DAG, overlap checks, path canonicalization, max 5 allowed files, and max 200 declared lines.
- 🛡️ **Parent-Owned Patch Gate**: Workers output patches; the parent extension strictly validates, applies, runs tests, and commits atomically.
- 🚫 **Fail-Closed Governance**: Prevents mutation of governance artifacts, blocks unsafe bash/LSP operations, and sanitizes Git operations.
- 🧠 **Dynamic Risk Routing**: Low-risk work executes on `smol-implementer`; retries and critical tasks auto-escalate to `hard-implementer`.
- 📦 **NPM Registry Distribution**: Official npm packaging with GitHub Actions automated releases and verifiable npm provenance.

> [!NOTE]
> *Future Scope:* The Fast/Lite/Full router, real-time cost ledger, and `/foundry-stats` command are defined in the architecture specification and will be delivered in upcoming release cycles.

---

## 📑 Table of Contents

- [⚡ Why OMP Foundry?](#-why-omp-foundry)
- [💎 Core Architectural Superpowers](#-core-architectural-superpowers)
- [🔄 The 6-Phase Governed Lifecycle](#-the-6-phase-governed-lifecycle)
- [🛡️ Security & Hard Execution Boundaries](#️-security--hard-execution-boundaries)
- [🚀 30-Second Quickstart](#-30-second-quickstart)
- [🧠 Model & Context Strategy](#-model--context-strategy)
- [⌨️ Complete Command Reference](#️-complete-command-reference)
- [🧩 Architecture & Codebase Map](#-architecture--codebase-map)
- [🧪 Verification & Test Suite](#-verification--test-suite)
- [🚀 Release Process](#-release-process)
- [📚 Architecture Documents](#-architecture-documents)
- [💖 Back the Project](#-back-the-project)

---

## ⚡ Why OMP Foundry?

| Pain Point in AI Coding | How Raw Agents Fail | How OMP Foundry Solves It |
| :--- | :--- | :--- |
| **Architectural Drift** | Modifies core schemas mid-task after losing context | **Cryptographic Lock**: `MASTER_PLAN.md` is SHA-256 hashed; unauthorized edits trigger fail-closed `PLAN_CONFLICT`. |
| **Cascading Regressions** | Sprawls across 20+ files in massive 500-line diffs | **Atomic Patch Gate**: Strict boundary capping changes to predefined `allowed_files` (max 5) with zero tree contamination. |
| **Self-Approved Hallucinations** | Worker marks its own broken code as "completed" | **Independent Peer Review**: Code must pass a separate `reviewer` or `security-reviewer` agent with verifiable QA exit codes. |
| **Rigid / Clunky Tooling** | Requires memorizing obscure commands | **Natural Interaction**: Reply casually (*"ok"*, *"proceed"*, *"approve"*), or use intuitive `/approve` shortcuts. |
| **Offline Sealing Bottlenecks** | Agents hang or stall while generating large DAGs | **Instant Transplant & Seal**: Fast manual transplant via `cp` + instant 1-second audit and sealing via `/aatp-seal`. |
| **Accidental Production Breakage**| Agent pushes unverified code straight to remote | **Human Release Gate**: Releases require verifiable provenance proofs and human authorization. |

---

## 💎 Core Architectural Superpowers

### 👑 The Human Is The Ultimate Boss
Unlike other rigid frameworks that force you to fight complex guardrails or memorize DSLs, **Foundry bows to human authority**. If the human dictates an architecture change, skips a phase, or overrides a rule via natural language (*"ok"*, *"proceed"*, *"approve"*), **Foundry complies immediately**. The machine proposes; the human disposes.

### 🏛️ 1. Plan: 3-Stage Adversarial Planning
Instead of letting a single LLM hallucinate architecture in one prompt, Foundry runs a structured, adversarial consensus:
1. **Architect (`plan-drafter`)**: Derives a clean structural proposal (`docs/planning/MASTER_PLAN_DRAFT.md`).
2. **Red Team (`plan-redteam`)**: Attacks architectural assumptions, edge cases, scalability limits, and security vulnerabilities (`docs/planning/PLAN_REVIEW.md`).
3. **Adjudicator & Synth (`plan-synth`)**: Synthesizes conflicting recommendations into `docs/MASTER_PLAN.md` and generates initial AATP work orders.

### ⚡ 2. Ergonomic Flow & Natural UX
- **Natural Language Triggers**: The orchestrator understands conversational intent. Type *"ok"*, *"proceed"*, *"do it"*, or *"approve"* to advance approved stages.
- **Smart Ergonomic Shortcuts**:
  - `/approve`: Context-aware single shortcut that advances Product → Plan.
  - `/ok` · `/run` · `/go`: Instantly advances legal workflows or locks the plan when reaching `awaiting_lock`.
  - `/aatp-seal`: Instant 1-second DAG audit & sealing for offline-generated or transplanted work orders.

### 🛡️ 3. AATP (Atomic Architecture Task Protocol)
- **≤ 200 Lines / Task**: Every work order is tightly scoped and readable in a single context pass.
- **≤ 5 Files Working Set**: Subagents are physically sandboxed to explicit `allowed_files`.
- **Strict Provenance Ledger**: Every git commit is tied to an active ticket, scope hash, and verification test run.
- **Parent Apply & Commit**: Workers never self-apply code; the parent extension validates AST boundaries and commits cleanly.

---

## 🔄 The 6-Phase Governed Lifecycle

<p align="center">
  <img src="docs/assets/lifecycle.svg" width="100%" alt="OMP Foundry 6-Stage Engineering Pipeline"/>
</p>

| Phase | Artifact or Action | Authority & Enforcement |
| :--- | :--- | :--- |
| **1. Discovery** | `docs/PRODUCT.md` | `product-analyst` writes; human approves via `/approve product` or `"ok"` |
| **2. Planning** | `MASTER_PLAN_DRAFT.md` → `PLAN_REVIEW.md` → `MASTER_PLAN.md` | `plan-drafter`, `plan-redteam`, `plan-synth`; human locks the final plan |
| **3. Design** | `docs/DESIGN.md` (and verified UI mockups) | `design-foundation`; human approves via `/design approve` or `/design skip` |
| **4. AATP** | `docs/AATP/AATP-*.md` and `INDEX.md` | `aatp-compiler` or explicit human `/aatp-seal` escape hatch |
| **5. Build** | Sealed AATP Work Orders | Isolated worker produces patch; parent validates, applies, and commits |
| **6. Review** | `docs/reports/review-<id>.md` | Dedicated `reviewer` or `security-reviewer` role |
| **7. QA** | Deterministic commands & `docs/reports/QA.md` | Execution in sanitized environment with verifiable exit codes |
| **8. Release** | Derived readiness state & provenance ledger | Human/CI performs verified publish or deployment action |

### 📁 Source-of-Truth Governance Tree

```text
.omp/
└── foundry-state.yml            # Machine state, active ticket, retries & phase flags
docs/
├── PRODUCT.md                   # Approved product specifications
├── DESIGN.md                    # Visual foundations & UI contracts (optional)
├── MASTER_PLAN.md               # Cryptographically locked architecture
├── planning/
│   ├── MASTER_PLAN_DRAFT.md     # Phase 2.1: Drafter proposal
│   └── PLAN_REVIEW.md           # Phase 2.2: Red team critique
├── AATP/
│   ├── INDEX.md                 # Dependency DAG & execution ordering
│   └── AATP-001.md ...          # Sealed atomic work orders
└── reports/
    ├── QA.md                    # Deterministic verification audit trail
    └── review-*.md              # Independent peer review certificates
```

---

## 🛡️ Security & Hard Execution Boundaries

<p align="center">
  <img src="docs/assets/terminal.svg" width="100%" alt="Foundry Terminal Enforcement"/>
</p>

Foundry enforces **fail-closed runtime boundaries**:

### ✅ Protections Implemented
- **Cryptographic Content Evidence**: Locked artifacts are re-hashed with SHA-256 before downstream transitions.
- **Stage-Bound Bearer Capabilities**: Plan and AATP writer tools require short-lived random bearer capabilities tied to the active stage.
- **Path Escape & Symlink Defense**: Strict canonicalization rejects directory traversal (`..`), symlink escapes, reserved Windows paths, and out-of-tree writes.
- **Clean Parent Tree Guarantee**: Governed workers require a clean git worktree; the parent extension owns apply/commit.
- **Constrained Shell Gate**: Permits only safe read-only Git inspection; compound commands, redirections, and subshells are blocked.
- **Sanitized QA Sandboxing**: The verification runner executes test scripts in a clean environment with disposable `HOME`/`TMP` paths.

### ⚠️ Explicit Boundaries & Limitations
- **Trusted-Host Execution**: The default verification runner operates in a credential-isolated process on the host. For untrusted codebases, set `FOUNDRY_VERIFY_REQUIRE_SANDBOX=1` and configure `FOUNDRY_VERIFY_SANDBOX_EXECUTABLE`.
- **Evidence vs. OS Hardening**: SHA-256 hashes prove byte integrity against agent drift; processes bypassing the extension can still modify files.
- **Automated Scope**: `/debug` outputs the disciplined 5-step systematic isolation protocol; `/approve` handles Product and Plan gates (`/design approve` handles Design).

---

## 🚀 30-Second Quickstart

<p align="center">
  <img src="docs/assets/quickstart.svg" width="100%" alt="Quickstart Installation"/>
</p>

### 1. Install & Link Plugin

#### Option A: Via npm (Recommended)
```bash
omp plugin install omp-foundry
```
*Re-running this command also automatically updates Foundry to the latest npm release.*

#### Option B: Via Git Fallback (Pinned Version)
```bash
omp plugin install github:oaichu/omp-foundry#v0.8.23
```

#### Health Check
```bash
omp plugin list
omp plugin doctor
```
*(Restart OMP after updating so extensions, hooks, and JIT skills are reloaded).*

---

### 2. Initialize a Governed Project

In any project repository, launch OMP and run:

```text
/foundry Build a high-performance REST API in FastAPI with PostgreSQL
```

---

### 3. Move with Natural Flow

```text
1. 💡 Review requirements in docs/PRODUCT.md  → Type "ok" or /approve product
2. 🏛️ Plan runs (Draft → Redteam → Synth)     → Type "ok" or /approve plan
3. 🎨 Design preview (UI mockups)             → Type /design approve (or /design skip)
4. 📦 AATP DAG compiles work orders           → Type /aatp or /aatp-seal
5. ⚙️ Workers code in isolated diffs          → Type /build
6. 🔍 Independent Peer Review                 → Type /review AATP-<id>
7. ✅ Deterministic QA Verification           → Type /verify
8. 🚀 Provenance Release Check                → Type /release-check
```

---

## 🧠 Model & Context Strategy

Foundry concentrates expensive reasoning models at architectural boundaries and uses cost-effective models for bounded implementation:

| Lifecycle Work | Default Role | Capability Focus |
| :--- | :--- | :--- |
| **Product Analysis** | `product-analyst` | Scope bounds, user stories, acceptance criteria |
| **Plan Draft / Redteam / Synth** | `plan-drafter`, `plan-redteam`, `plan-synth` | Architecture synthesis, threat modeling, DAG compilation |
| **Trivial / Low-Risk Tasks** | `smol-implementer` | Fast, token-efficient small edits |
| **Normal Implementation** | `implementer` | Standard bounded tickets within `allowed_files` |
| **Complex / Retried Tasks** | `hard-implementer` | Escalated reasoning for high-complexity tickets |
| **Standard Peer Review** | `reviewer` | Independent ticket compliance & regression checks |
| **Security & Critical Review** | `security-reviewer` | OWASP threat review, credential leak detection |

---

### 🧠 4-Tier Just-In-Time (JIT) Skill Catalog

Foundry packages **36+ enterprise engineering skills** without bloating your model's context window:

<p align="center">
  <img src="docs/assets/jit-catalog.svg" width="100%" alt="4-Tier JIT Skill Catalog"/>
</p>

- **Tier 1: Phase & Role Filter** — Injects only relevant skills for the active lifecycle step (Implementation vs. Review vs. QA).
- **Tier 2: Stack Auto-Detection** — Automatically identifies frameworks (FastAPI, Next.js, Postgres, Docker, etc.).
- **Tier 3: Thin Catalog Index** — Compact ~150-token catalog header dynamically exposed to the model.
- **Tier 4: On-Demand Deep Load** — Subagents fetch detailed skill guides on-demand via `foundry_skill_read`.

---

## ⌨️ Complete Command Reference

| Command | Category | Purpose & Behavior |
| :--- | :--- | :--- |
| **`/foundry [prompt]`** | **Core** | Auto-bootstraps project governance or resumes the next logical step. |
| **`/foundry-init`** | **Core** | Advanced / manual project bootstrap. |
| **`/foundry-doctor`** | **Diagnostics** | Validates worker isolation contracts and model-role health. |
| **`/foundry-version`** | **System** | Compares installed version with latest npm registry release. |
| **`/approve [product\|plan]`** | **Ergonomics** | Smart context-aware approval for Product and Plan stages. |
| **`/ok` · `/run` · `/go`** | **Ergonomics** | Natural workflow shortcuts; locks plan at `awaiting_lock`. |
| **`/plan [status\|abort\|restart]`** | **Planning** | Starts, inspects, aborts, or restarts the 3-Stage Master Plan cycle. |
| **`/plan-revise`** | **Planning** | Human-only command to unlock master plan (invalidates stale downstream DAG). |
| **`/design [approve\|skip]`** | **Design** | Human approval or skip command for the Design stage. |
| **`/aatp`** | **AATP** | Spawns the synthesis compiler to generate the project-wide dependency DAG. |
| **`/aatp-seal`** | **AATP** | **Instant 1-second seal** for manual transplants or pre-generated DAGs. |
| **`/build`** | **Execution** | Dispatches ready, isolated workers to implement active tickets. |
| **`/review [AATP-ID]`** | **Quality** | Triggers an independent reviewer agent to verify code against tickets. |
| **`/verify`** | **Quality** | Runs deterministic test and QA scripts in a sanitized environment. |
| **`/release-check`** | **Release** | Computes cryptographic provenance and derives deployment readiness. |
| **`/debug`** | **Superpowers** | Executes the systematic 5-Step root-cause isolation protocol. |

---

## 🧩 Architecture & Codebase Map

<p align="center">
  <img src="docs/assets/architecture.svg" width="100%" alt="Architecture & Codebase Map"/>
</p>

| Subsystem | Source File | Core Role & Architectural Boundary |
| :--- | :--- | :--- |
| **Human Authority** | `CEO Supreme Gate` | Natural language unblock, intent parsing, instant phase overrides |
| **Triad Consensus** | [`src/plan.ts`](file:///home/oaichu/OMP-foundry/src/plan.ts) | 3-stage consensus (Draft, Redteam, Synth) locking `MASTER_PLAN.md` |
| **Foundry Kernel** | [`src/index.ts`](file:///home/oaichu/OMP-foundry/src/index.ts) | 15 Governed CLI commands, state machine guards & model router |
| **AATP Engine** | [`src/aatp.ts`](file:///home/oaichu/OMP-foundry/src/aatp.ts) | Atomic Architecture Task Protocol, dependency DAG & ≤3 file limit |
| **Patch Gate** | [`src/patch-gate.ts`](file:///home/oaichu/OMP-foundry/src/patch-gate.ts) | Unified diff parser, hard ≤80 line cap & zero scope-drift gate |
| **Permission Firewall**| [`src/permissions.ts`](file:///home/oaichu/OMP-foundry/src/permissions.ts) | Path canonicalization, out-of-bounds mutation blocker |
| **Verify Runner** | [`src/verify-runner.ts`](file:///home/oaichu/OMP-foundry/src/verify-runner.ts) | Disposable QA test sandbox & linter execution |
| **Git Runtime** | [`src/git-runtime.ts`](file:///home/oaichu/OMP-foundry/src/git-runtime.ts) | Hardened git sandbox, provenance ledger & atomic commits |
| **JIT Skills** | [`src/skills/`](file:///home/oaichu/OMP-foundry/src/skills) | On-demand stack detector (Node/Rust/Python) & skill packs |

---

## 🧪 Verification & Test Suite

OMP Foundry is backed by an exhaustive, green-field integration test suite ensuring zero regressions:

<p align="center">
  <img src="docs/assets/test-suite.svg" width="100%" alt="OMP Foundry Test Suite Output"/>
</p>

```bash
# Install dependencies
bun install

# Run the complete test suite (128 passing tests across 18 suites)
bun test

# Run strict TypeScript typechecking
bun run typecheck

# Verify Oh My Pi contract compliance
bun run check:omp-contract

# Dry run npm package distribution
npm pack --dry-run
```

---

## 🚀 Release Process

A `v*` tag triggers the automated GitHub Release & npm publishing workflow with provenance:

```bash
# 1. Verify local package build
npm pack --dry-run

# 2. Tag and push release
git tag v0.8.23
git push origin main --tags
```

The workflow builds, tests, and publishes the package to public npm with verifiable build provenance. Ensure `NPM_TOKEN` is configured in repository secrets.

---

## 📚 Architecture Documents

- 📐 **Design Specification**: [`docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md`](docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md)
- 🎯 **Current P0 Implementation Plan**: [`docs/superpowers/plans/2026-08-26-foundry-p0-hotfixes-npm.md`](docs/superpowers/plans/2026-08-26-foundry-p0-hotfixes-npm.md)
- 📜 **Full Version History**: [`CHANGELOG.md`](CHANGELOG.md)

---

## 💖 Back the Project

If OMP Foundry saves you from 2:00 AM architecture regressions and powers disciplined, predictable AI workflows, consider supporting continuous development:

<div align="center">
  <a href="https://ko-fi.com/oaichu" target="_blank" rel="noopener noreferrer">
    <img src="https://storage.ko-fi.com/cdn/kofi3.png?v=3" alt="Buy Me A Coffee at ko-fi.com" height="48" style="border: 0px; height: 48px; border-radius: 8px; box-shadow: 0 4px 14px rgba(255, 94, 91, 0.35);" />
  </a>
  <br/><br/>
  <em>Every coffee fuels ongoing development of zero-regression agent tooling. Thank you! ☕✨</em>
</div>

<p align="center">
  <sub>MIT License · © 2026 OMP Foundry Contributors · <strong>Lock the plan. Then pour the code.</strong></sub>
</p>
