# Foundry P0 Hotfixes + npm Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.8.23 — the six P0 kernel hotfixes from the v0.8.22 audit plus npm as the fast distribution/update channel.

**Architecture:** All changes stay inside the existing module layout (no `index.ts` split — that is P3). One new module `src/approve.ts` deduplicates the approve logic; one new module `src/version.ts` makes the version single-source. `denyToolCall` gains a bash/lsp gate outside discovery. Update-check reads the npm registry JSON instead of parsing the GitHub redirect.

**Tech Stack:** TypeScript (Bun runtime, tabs, no semicolon-free style changes), `bun:test`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-26-foundry-3-mode-design.md` (Phase 0 + Distribution sections). The plan argues from the spec; executors read both.

## Global Constraints

- Tab indentation, double quotes, English code/comments — match `src/` style exactly.
- No new runtime dependencies (`dependencies` stays empty). `yaml` stays a devDependency.
- Every task: failing test first, then minimal implementation, then full-file pass, then commit on branch `design/3-mode-architecture`.
- Full suite must stay green: `bun install && bun test` (126+ new tests pass; the pre-existing `verify-runner` 5s-timeout flake is out of scope — do not "fix" it here).
- Never change public slash-command names or their descriptions' semantics.
- `FOUNDRY_VERSION` is read from `package.json` at module load; never hardcode a version string in `src/`.

---

### Task 1: Single version source (`src/version.ts`)

**Files:**
- Create: `src/version.ts`
- Modify: `src/types.ts:20`
- Test: `tests/version.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `FOUNDRY_VERSION: string` exported from `src/version.ts` and re-exported from `src/types.ts` (all existing `import { FOUNDRY_VERSION } from "./types"` call sites keep working unchanged).

- [ ] **Step 1: Write the failing test**

Create `tests/version.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FOUNDRY_VERSION } from "../src/version";

describe("version single source", () => {
	test("FOUNDRY_VERSION matches package.json and is never the fallback", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
		expect(FOUNDRY_VERSION).toBe(pkg.version);
		expect(FOUNDRY_VERSION).not.toBe("0.0.0");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/version.test.ts`
Expected: FAIL — `Cannot find module '../src/version'`

- [ ] **Step 3: Write minimal implementation**

Create `src/version.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version?: unknown };

/** Single source of truth: the package version. Never hardcode this elsewhere. */
export const FOUNDRY_VERSION: string = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
```

In `src/types.ts`, replace line 20 `export const FOUNDRY_VERSION = "0.8.0";` with:

```ts
export { FOUNDRY_VERSION } from "./version";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/version.test.ts tests/schema.test.ts`
Expected: PASS both (schema tests assert `last_written_by` contains `FOUNDRY_VERSION`, which now equals `0.8.22`).

- [ ] **Step 5: Commit**

```bash
git add src/version.ts src/types.ts tests/version.test.ts
git commit -m "fix: derive FOUNDRY_VERSION from package.json (single source)"
```

---

### Task 2: `enterPlan` no longer resets `awaiting_lock`

**Files:**
- Modify: `src/plan.ts:34-41`
- Test: `tests/plan.test.ts` (append inside the existing top-level describe or add a new one)

**Interfaces:**
- Consumes: `defaultState()`, `enterPlan(state, restart?)` — existing signatures unchanged.
- Produces: behavior change only — `enterPlan(state)` on `stage === "awaiting_lock"` preserves stage, epoch, and all three hashes; only `enterPlan(state, true)` resets.

- [ ] **Step 1: Write the failing tests**

Append to `tests/plan.test.ts`:

```ts
describe("awaiting_lock is resume-only", () => {
	test("enterPlan preserves a completed awaiting_lock cycle", () => {
		const state = defaultState();
		state.mode = "plan";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "a", review_sha256: "b", final_sha256: "c" };
		enterPlan(state);
		expect(state.planning.stage).toBe("awaiting_lock");
		expect(state.planning.epoch).toBe("e1");
		expect(state.planning.final_sha256).toBe("c");
	});

	test("enterPlan(restart) still resets awaiting_lock", () => {
		const state = defaultState();
		state.mode = "plan";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "a", review_sha256: "b", final_sha256: "c" };
		enterPlan(state, true);
		expect(state.planning.stage).toBe("draft");
		expect(state.planning.final_sha256).toBe("");
		expect(state.planning.epoch).not.toBe("e1");
	});
});
```

Check the file's existing imports; add `defaultState` to the `../src/types` import if absent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/plan.test.ts`
Expected: first new test FAIL (`stage` becomes `"draft"`), second PASS.

- [ ] **Step 3: Write minimal implementation**

In `src/plan.ts`, change line 37 from:

```ts
	if (restart || state.planning.stage === "idle" || state.planning.stage === "awaiting_lock") {
```

to:

```ts
	// awaiting_lock holds a complete Draft→Redteam→Synth cycle awaiting the
	// human lock; a plain resume must never destroy it. Only an explicit
	// restart (or /plan-revise) may reset the stage.
	if (restart || state.planning.stage === "idle") {
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/plan.test.ts`
Expected: PASS (5 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/plan.ts tests/plan.test.ts
git commit -m "fix: enterPlan no longer wipes a completed awaiting_lock cycle"
```

---

### Task 3: Deduplicated approve + `/ok` locks at `awaiting_lock`

**Files:**
- Create: `src/approve.ts`
- Modify: `src/index.ts` — `foundry_approve` tool (~line 880), `approveHandler` (~line 954), `/ok` `/run` `/go` registrations (~line 984-986), `foundry_step` tool (~line 906)
- Test: `tests/approve.test.ts`

**Interfaces:**
- Consumes: `lockArtifactHash`, `invalidateQa` from `./release`; `enterPlan`, `planArtifactsMatch` from `./plan`; `resetAatp` from `./aatp`; `CompanyState` from `./types`.
- Produces: `src/approve.ts` exports `ApproveDeps`, `ApproveResult`, `approveProduct(cwd, state, deps): ApproveResult`, `approvePlan(cwd, state, deps): ApproveResult`. `index.ts` imports them; Task 6 and the P1 router plan will reuse them.

- [ ] **Step 1: Write the failing tests**

Create `tests/approve.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveProduct, approvePlan, type ApproveDeps } from "../src/approve";
import { defaultState } from "../src/types";
import { saveState } from "../src/state-machine";

function deps(log: string[]): ApproveDeps {
	return {
		persist: (state) => log.push(`persist:${state.phase}:${state.master_plan.status}`),
		orchestrate: (title) => log.push(`orchestrate:${title}`),
		enterOrResumePlan: () => log.push("enterOrResumePlan"),
		requestAatpCompile: () => log.push("requestAatpCompile"),
		advanceFoundry: () => log.push("advanceFoundry"),
	};
}

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-approve-"));
	mkdirSync(join(dir, "docs"), { recursive: true });
	return dir;
}

describe("approveProduct", () => {
	test("locks a non-empty PRODUCT.md and starts Plan", () => {
		const dir = repo(), log: string[] = [];
		writeFileSync(join(dir, "docs", "PRODUCT.md"), "product\n");
		const state = defaultState();
		const result = approveProduct(dir, state, deps(log));
		expect(result.ok).toBe(true);
		expect(state.product.status).toBe("approved");
		expect(state.phase).toBe("planning");
		expect(state.mode).toBe("plan");
		expect(log).toContain("enterOrResumePlan");
	});

	test("fails closed on missing PRODUCT.md", () => {
		const dir = repo(), log: string[] = [];
		const result = approveProduct(dir, defaultState(), deps(log));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("PRODUCT_GATE");
		expect(log).not.toContain("enterOrResumePlan");
	});
});

describe("approvePlan", () => {
	test("rejects approval before the cycle completes", () => {
		const dir = repo(), log: string[] = [];
		const state = defaultState();
		state.mode = "plan";
		state.planning.stage = "synth";
		const result = approvePlan(dir, state, deps(log));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("PLAN_GATE");
	});

	test("locks at awaiting_lock when planning artifacts match", () => {
		const dir = repo(), log: string[] = [];
		mkdirSync(join(dir, "docs", "planning"), { recursive: true });
		writeFileSync(join(dir, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n");
		writeFileSync(join(dir, "docs", "planning", "PLAN_REVIEW.md"), "review\n");
		writeFileSync(join(dir, "docs", "MASTER_PLAN.md"), "plan\n");
		const state = defaultState();
		state.product = { status: "approved", sha256: "x" };
		state.mode = "plan";
		state.phase = "planning";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "", review_sha256: "", final_sha256: "" };
		// Seed accepted hashes from the artifacts on disk.
		const { hashPlanArtifact } = await import("../src/plan");
		state.planning.draft_sha256 = hashPlanArtifact(dir, "draft")!;
		state.planning.review_sha256 = hashPlanArtifact(dir, "redteam")!;
		state.planning.final_sha256 = hashPlanArtifact(dir, "synth")!;
		const result = approvePlan(dir, state, deps(log));
		expect(result.ok).toBe(true);
		expect(state.master_plan.status).toBe("locked");
		expect(state.mode).toBe("normal");
		saveState(dir, state);
	});
});
```

Note: `await import` inside a non-async test function is invalid — hoist it: add `import { hashPlanArtifact } from "../src/plan";` at the top of the file instead and use it directly.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/approve.test.ts`
Expected: FAIL — `Cannot find module '../src/approve'`

- [ ] **Step 3: Write `src/approve.ts`**

```ts
import type { CompanyState } from "./types";
import { enterPlan, planArtifactsMatch } from "./plan";
import { resetAatp } from "./aatp";
import { invalidateQa, lockArtifactHash } from "./release";

export interface ApproveDeps {
	persist: (state: CompanyState) => void;
	orchestrate: (title: string, body: string) => void;
	enterOrResumePlan: () => void;
	requestAatpCompile: () => void;
	advanceFoundry: () => void;
}

export type ApproveResult = { ok: true; message: string } | { ok: false; message: string };

export function approveProduct(cwd: string, state: CompanyState, deps: ApproveDeps): ApproveResult {
	if (!lockArtifactHash(cwd, state, "product")) return { ok: false, message: "PRODUCT_GATE: docs/PRODUCT.md must exist and be non-empty before approval." };
	state.product.status = "approved";
	state.phase = "planning";
	enterPlan(state);
	invalidateQa(state);
	deps.persist(state);
	deps.orchestrate("PRODUCT approved.", "Product approved. Running Plan...");
	deps.enterOrResumePlan();
	return { ok: true, message: "Product phase approved successfully." };
}

export function approvePlan(cwd: string, state: CompanyState, deps: ApproveDeps): ApproveResult {
	if (state.mode === "plan" && state.planning.stage !== "awaiting_lock") return { ok: false, message: "PLAN_GATE: plan approval requires a completed Draft → Redteam → Synth cycle." };
	if (!planArtifactsMatch(cwd, state)) return { ok: false, message: "PLAN_EVIDENCE_GATE: planning artifacts changed after their stage completed. Restart Plan or restore the accepted artifacts." };
	if (!lockArtifactHash(cwd, state, "master_plan")) return { ok: false, message: "PLAN_GATE: docs/MASTER_PLAN.md must exist and be non-empty before lock." };
	state.master_plan.status = "locked";
	state.master_plan.version = state.master_plan.version === "0" ? "1.0" : state.master_plan.version;
	state.conflict = { kind: "none", reason: "" };
	state.mode = "normal";
	invalidateQa(state);
	deps.persist(state);
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") {
		state.phase = "design";
		resetAatp(state);
		deps.persist(state);
		deps.orchestrate("PLAN LOCKED by user.", "Plan evidence accepted. Continue with /design; after the design gate Foundry compiles the AATP DAG.");
	} else {
		if (state.aatp.manifest_sha256) deps.advanceFoundry();
		else deps.requestAatpCompile();
	}
	return { ok: true, message: "Plan phase approved successfully." };
}
```

- [ ] **Step 4: Rewire `index.ts`**

Add to imports: `import { approvePlan, approveProduct, type ApproveDeps } from "./approve";`

Replace the body of the `foundry_approve` tool execute and `approveHandler` to delegate. Both build the same deps:

```ts
const deps = (cwd: string): ApproveDeps => ({
	persist: (state) => persist(cwd, state),
	orchestrate: (title, body) => orchestrate(pi, title, body),
	enterOrResumePlan: () => enterOrResumePlan(pi, cwd, loadState(cwd)),
	requestAatpCompile: () => requestAatpCompile(pi, cwd, loadState(cwd)),
	advanceFoundry: () => advanceFoundry(pi, cwd, ""),
});
```

`approveHandler` becomes:

```ts
const approveHandler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: "error" | "info" | "warning") => void } }) => {
	const which = args.trim().toLowerCase(), state = loadState(ctx.cwd);
	if (which === "product" || which === "approve-product" || (!which && !productReady(state))) {
		const result = approveProduct(ctx.cwd, state, deps(ctx.cwd));
		ctx.ui.notify(result.message, result.ok ? "info" : "error");
		return;
	}
	if (which === "plan" || which === "approve-plan" || (!which && productReady(state))) {
		const result = approvePlan(ctx.cwd, state, deps(ctx.cwd));
		ctx.ui.notify(result.message, result.ok ? "info" : "error");
		return;
	}
	ctx.ui.notify("Usage: /approve [product|plan]", "warning");
};
```

Apply the same delegation inside the `foundry_approve` tool (return `isError: !result.ok` with `result.message`).

Then make `/ok` `/run` `/go` and `foundry_step` lock instead of restarting. Replace their registrations:

```ts
const okHandler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: "error" | "info" | "warning") => void } }) => {
	const state = loadState(ctx.cwd);
	// A completed plan cycle waits for the human lock; /ok at that point IS the approval the prompt promised.
	if (state.mode === "plan" && state.planning.stage === "awaiting_lock") return approveHandler("plan", ctx);
	advanceFoundry(pi, ctx.cwd, args);
};
pi.registerCommand("ok", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
pi.registerCommand("run", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
pi.registerCommand("go", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
```

In `foundry_step`'s execute, insert the same `awaiting_lock` check before `advanceFoundry`:

```ts
	const state = loadState(ctx.cwd);
	if (state.mode === "plan" && state.planning.stage === "awaiting_lock") {
		const result = approvePlan(ctx.cwd, state, deps(ctx.cwd));
		return { content: [{ type: "text", text: result.message }], isError: !result.ok };
	}
	advanceFoundry(pi, ctx.cwd, "");
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/approve.test.ts tests/index-integration.test.ts`
Expected: PASS — the integration suite's `/approve ""` behavior is unchanged (same gate strings), and no test asserted the old restart-on-ok path.

- [ ] **Step 6: Commit**

```bash
git add src/approve.ts src/index.ts tests/approve.test.ts
git commit -m "fix: dedupe approve logic; /ok locks the plan at awaiting_lock"
```

---

### Task 4: bash/lsp fail-closed outside discovery

**Files:**
- Modify: `src/permissions.ts:67-86` (insert between the NETWORK_GATE block and the `FILE_MUTATING` check)
- Test: `tests/permissions.test.ts` (append)

**Interfaces:**
- Consumes: `denyToolCall(toolName, input, state, ctx)` — signature unchanged.
- Produces: behavior — in a governed project with `state.phase !== "discovery"`, `bash` is allowed only for read-only git and `lsp` only for read-only actions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/permissions.test.ts` (reuse the file's existing `locked()` helper and imports; add `defaultState` to the types import if absent):

```ts
describe("shell and LSP gates outside discovery", () => {
	test("mutating bash is denied when the plan is locked", () => {
		expect(denyToolCall("bash", { command: "echo hi >> docs/MASTER_PLAN.md" }, locked())?.reason).toContain("BASH_GATE");
	});
	test("read-only git remains available", () => {
		expect(denyToolCall("bash", { command: "git diff --stat" }, locked())).toBeUndefined();
		expect(denyToolCall("bash", { command: "git status --porcelain" }, locked())).toBeUndefined();
	});
	test("bash stays open during discovery", () => {
		expect(denyToolCall("bash", { command: "node -v" }, defaultState())).toBeUndefined();
	});
	test("mutating LSP actions are denied when locked", () => {
		expect(denyToolCall("lsp", { action: "rename", file: "src/a.ts" }, locked())?.reason).toContain("LSP_GATE");
		expect(denyToolCall("lsp", { action: "code_actions", apply: true, file: "src/a.ts" }, locked())?.reason).toContain("LSP_GATE");
	});
	test("read-only LSP actions remain available", () => {
		expect(denyToolCall("lsp", { action: "definition", file: "src/a.ts" }, locked())).toBeUndefined();
		expect(denyToolCall("lsp", { action: "diagnostics", path: "src/**/*.ts" }, locked())).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/permissions.test.ts`
Expected: the BASH_GATE and LSP_GATE tests FAIL (returns `undefined` today).

- [ ] **Step 3: Write minimal implementation**

In `src/permissions.ts`, immediately after the NETWORK_GATE block (before `if (!FILE_MUTATING.has(toolName)) return;`) insert:

```ts
const BASH_READ_ONLY = /^git\s+(?:diff|status|log|show)\b/;
const LSP_READ_ONLY = new Set(["status", "capabilities", "definition", "type_definition", "implementation", "references", "hover", "symbols", "diagnostics", "reload"]);
	// Outside discovery the parent shell is read-only: every mutation must
	// flow through AATP tickets and the foundry_* tools so gates see it.
	if (state.phase !== "discovery") {
		if (toolName === "bash") {
			const command = typeof input.command === "string" ? input.command.trim() : "";
			if (!BASH_READ_ONLY.test(command)) return { block: true, reason: "BASH_GATE: governed projects allow read-only git only (diff|status|log|show); mutations go through AATP tickets and foundry tools." };
			return undefined;
		}
		if (toolName === "lsp") {
			const action = typeof input.action === "string" ? input.action : "";
			if (!LSP_READ_ONLY.has(action)) return { block: true, reason: "LSP_GATE: read-only LSP actions only in a governed project; renames and edits go through AATP tickets." };
			return undefined;
		}
	}
```

(Move the two `const` declarations to module scope next to `FILE_MUTATING`, keeping the `if` block inside `denyToolCall`.)

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/permissions.test.ts`
Expected: PASS — including the pre-existing `read-only git shell remains available` test.

- [ ] **Step 5: Commit**

```bash
git add src/permissions.ts tests/permissions.test.ts
git commit -m "fix: fail-closed bash/lsp outside discovery (read-only allowlists)"
```

---

### Task 5: Persist `ticket.attempts` + smol routing

**Files:**
- Modify: `src/state-machine.ts` — `parseTickets` (~line 71-123) and `serializeTickets` (~line 185-201)
- Modify: `src/aatp.ts:354-361` (`routeAgent`)
- Test: `tests/state.test.ts` (append), `tests/aatp.test.ts` (append)

**Interfaces:**
- Consumes: `AatpTicket.attempts?: number` (already in `src/types.ts:37`).
- Produces: `attempts` survives save/load; `routeAgent("trivial"|"low") === "smol-implementer"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/state.test.ts` (match its existing imports; add `saveState`/`loadState` if absent):

```ts
test("ticket attempts roundtrip through save/load", () => {
	const dir = mkdtempSync(join(tmpdir(), "foundry-attempts-"));
	const state = defaultState();
	state.tickets["AATP-1"] = { id: "AATP-1", status: "ready", allowed_files: ["src"], forbidden_files: [], risk: "trivial", attempts: 2 };
	saveState(dir, state);
	const loaded = loadState(dir);
	expect(loaded.tickets["AATP-1"]?.attempts).toBe(2);
});
```

Append to `tests/aatp.test.ts` (inside the routing describe, or a new one):

```ts
test("trivial and low risk route to smol-implementer; retries escalate", () => {
	expect(routeAgent("trivial")).toBe("smol-implementer");
	expect(routeAgent("low")).toBe("smol-implementer");
	expect(routeAgent("normal")).toBe("implementer");
	expect(routeAgent("low", 1)).toBe("hard-implementer");
	expect(routeAgent("critical")).toBe("hard-implementer");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/state.test.ts tests/aatp.test.ts`
Expected: state roundtrip FAIL (`attempts` undefined after load); routing FAIL (`trivial` returns `implementer`).

- [ ] **Step 3: Write minimal implementation**

In `src/state-machine.ts` `parseTickets`, add to the ticket object literal:

```ts
		attempts: Number(pick(block, "attempts") ?? 0) || 0,
```

In `serializeTickets`, after the `agent` line add:

```ts
		if (t.attempts) lines.push(`    attempts: ${t.attempts}`);
```

In `src/aatp.ts`, replace `routeAgent`:

```ts
export function routeAgent(risk: string, attempts = 0): string {
	if (attempts >= 1) return "hard-implementer";
	const r = risk.toLowerCase();
	if (r === "trivial" || r === "low") return "smol-implementer";
	// Unknown risk must never silently downgrade to the cheap/default worker.
	return r === "normal" ? "implementer" : "hard-implementer";
}
```

(`index.ts` `AATP_ROUTE_GATE` rank map already ranks `smol-implementer` = 0, so escalation-only routing stays intact.)

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/state.test.ts tests/aatp.test.ts`
Expected: PASS. Note: `tests/aatp.test.ts` may assert `routeAgent("trivial") === "implementer"` from before — update that assertion to `"smol-implementer"` (behavior change is the point of this task).

- [ ] **Step 5: Commit**

```bash
git add src/state-machine.ts src/aatp.ts tests/state.test.ts tests/aatp.test.ts
git commit -m "fix: persist ticket attempts; route trivial/low to smol-implementer"
```

---

### Task 6: State guards for `/plan-revise` `/verify` `/release-check`

**Files:**
- Modify: `src/index.ts` — the three handlers (~lines 932, 1040, 1041)
- Test: `tests/index-integration.test.ts` (append)

**Interfaces:**
- Consumes: `stateFileExists(cwd)` from `./state-machine` (add to the import list).
- Produces: behavior — the three commands no-op with a warning on projects without `.omp/foundry-state.yml`, and never persist a default state there.

- [ ] **Step 1: Write the failing test**

Append to `tests/index-integration.test.ts` (reuse its existing fake-pi harness and tmp-dir patterns; `notify` array as in other tests):

```ts
test("verify refuses ungoverned projects and writes no state", async () => {
	const dir = mkdtempSync(join(tmpdir(), "foundry-ungoverned-"));
	const notifies: string[] = [];
	const ctx = { cwd: dir, ui: { notify: (m: string) => notifies.push(m) }, waitForIdle: async () => {} };
	await commands.get("verify")!.handler("", ctx);
	expect(notifies.some((m) => m.includes("FOUNDRY_GATE"))).toBe(true);
	expect(existsSync(join(dir, ".omp", "foundry-state.yml"))).toBe(false);
});
```

Adapt names to whatever the harness actually exposes (`commands.get(...)`, `existsSync` import from `node:fs`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/index-integration.test.ts -t "ungoverned"`
Expected: FAIL — no notify, and/or a state file gets created.

- [ ] **Step 3: Write minimal implementation**

At the top of each of the three handlers (`plan-revise`, `verify`, `release-check`), immediately after `loadState`/handler entry, insert:

```ts
		if (!stateFileExists(ctx.cwd)) { ctx.ui.notify("FOUNDRY_GATE: this project is not governed by Foundry yet; run /foundry first.", "warning"); return; }
```

For `plan-revise` the handler currently starts with `const state = loadState(ctx.cwd);` — put the guard before any mutation and before `persist`.

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/index-integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index-integration.test.ts
git commit -m "fix: plan-revise/verify/release-check refuse ungoverned projects"
```

---

### Task 7: Update-check reads npm registry; notify uses `omp plugin install`

**Files:**
- Modify: `src/update-check.ts` — `fetchLatestTag` (~line 73-82), `notifyText` (~line 83), `versionReport` (~line 96-98)
- Test: `tests/update-check.test.ts` (append)

**Interfaces:**
- Consumes: `checkForUpdate(deps)` with injectable `fetchLatest` (unchanged).
- Produces: default `fetchLatestTag()` queries `https://registry.npmjs.org/omp-foundry/latest`; notify/report text names `omp plugin install omp-foundry`. `parseTagFromUrl` stays exported (still used by tests and as a fallback for git-based installs).

- [ ] **Step 1: Write the failing test**

Append to `tests/update-check.test.ts`:

```ts
test("notify text instructs the npm install command", async () => {
	const dir = mkdtempSync(join(tmpdir(), "foundry-upd-npm-"));
	const result = await checkForUpdate({
		now: () => 5_000_000,
		installed: "0.8.22",
		cachePath: join(dir, "c.json"),
		fetchLatest: async () => "0.9.0",
	});
	expect(result.newer).toBe(true);
	expect(result.notify).toContain("omp plugin install omp-foundry");
	expect(versionReport(result)).toContain("omp plugin install omp-foundry");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/update-check.test.ts -t "npm install command"`
Expected: FAIL — notify still contains `git fetch --tags`.

- [ ] **Step 3: Write minimal implementation**

In `src/update-check.ts`, replace `fetchLatestTag`, `notifyText`, and the update line of `versionReport`:

```ts
const REGISTRY_LATEST = "https://registry.npmjs.org/omp-foundry/latest";
async function fetchLatestTag(): Promise<string | undefined> {
	const response = await fetch(REGISTRY_LATEST, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
	if (!response.ok) return undefined;
	try {
		const data = (await response.json()) as { version?: unknown };
		return typeof data.version === "string" && /^\d+\.\d+\.\d+/.test(data.version) ? data.version.replace(/^v/, "") : undefined;
	} catch { return undefined; }
}
function notifyText(installed: string, latest: string): string { return `Foundry ${latest} available. Installed: ${installed}. Update: run 'omp plugin install omp-foundry' and restart OMP.`; }
```

In `versionReport`, replace the update line with:

```ts
	result.newer ? `Update (stable): omp plugin install omp-foundry then restart OMP.` : "Installed Foundry is current or newer than the latest release.",
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/update-check.test.ts`
Expected: PASS — existing tests assert `notify` contains `"Foundry 0.4.0 available"`, which the new text keeps verbatim.

- [ ] **Step 5: Commit**

```bash
git add src/update-check.ts tests/update-check.test.ts
git commit -m "feat: update-check reads npm registry; notify uses omp plugin install"
```

---

### Task 8: npm publish packaging + CI job

**Files:**
- Modify: `package.json` — add `files` and `publishConfig`
- Modify: `.github/workflows/release.yml` — add `publish-npm` job

**Interfaces:**
- Consumes: existing `release` job (tag push `v*`).
- Produces: `npm pack` tarball limited to `src`, `skills`, `agents`, `rules`, `templates`, `types`; CI publishes with provenance. Prerequisite (human, one-time): add the `NPM_TOKEN` secret with publish rights for `omp-foundry`.

- [ ] **Step 1: Add packaging fields to `package.json`**

Insert after the `"license"` line:

```json
	"files": ["src", "skills", "agents", "rules", "templates", "types"],
	"publishConfig": { "access": "public" },
```

- [ ] **Step 2: Verify the tarball locally**

Run: `npm pack --dry-run`
Expected: file list contains only the whitelisted directories plus `package.json`, `README.md`, `LICENSE`; no `tests/`, no `docs/assets/`.

- [ ] **Step 3: Add the publish job**

Append to `.github/workflows/release.yml`:

```yaml
  publish-npm:
    runs-on: ubuntu-latest
    needs: release
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
      - name: Publish to npm
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 4: Verify nothing behavioral changed**

Run: `bun install && bun test`
Expected: suite green (packaging only).

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/release.yml
git commit -m "build: npm publish packaging and CI publish job"
```

---

### Task 9: Release prep v0.8.23

**Files:**
- Modify: `package.json:3` — `"version": "0.8.23"`
- Modify: `CHANGELOG.md` — new entry at top
- Modify: `README.md:11` — badge version

**Interfaces:**
- Consumes: Task 1 (version follows package.json automatically).
- Produces: tagged release `v0.8.23` ready to push, which triggers GitHub Release + npm publish.

- [ ] **Step 1: Bump version**

`package.json` → `"version": "0.8.23"`.

- [ ] **Step 2: CHANGELOG entry**

Prepend to `CHANGELOG.md`:

```md
## 0.8.23 — P0 kernel hotfixes + npm distribution

- `FOUNDRY_VERSION` is derived from `package.json` (single source; fixes the false "update available" signal).
- `/ok` `/run` `/go` at `awaiting_lock` now lock the plan instead of restarting Draft and wiping stage hashes.
- `bash`/`lsp` fail closed outside discovery in governed projects (read-only git allowlist; read-only LSP actions).
- `ticket.attempts` is persisted across sessions; `trivial`/`low` risk routes to `smol-implementer`.
- `/plan-revise`, `/verify`, `/release-check` refuse to create state in ungoverned projects.
- Approve logic deduplicated behind `src/approve.ts` (tool and slash command share one implementation).
- Update check reads the npm registry; install/update with `omp plugin install omp-foundry`.
```

- [ ] **Step 3: README badge**

`README.md` line 11: change the version badge URL segment from `v0.8.11` to `v0.8.23` (keep the rest of the badge markup identical).

- [ ] **Step 4: Full verification**

Run: `bun install && bun test && bun run typecheck`
Expected: all green; `tests/version.test.ts` asserts `FOUNDRY_VERSION === "0.8.23"`.

- [ ] **Step 5: Commit and tag**

```bash
git add package.json CHANGELOG.md README.md
git commit -m "chore: release 0.8.23"
git tag v0.8.23
```

Push (`git push origin design/3-mode-architecture --tags` or merge to `main` first per your flow) only after the human confirms the `NPM_TOKEN` secret exists — the tag triggers publishing.

---

## Self-Review (done)

- **Spec coverage:** P0 items 1→Tasks 1+7, 2→Task 2+3, 3→Task 4, 4→Task 5, 5→Task 6, 6→Task 3; Distribution section→Tasks 7+8; release→Task 9. No gaps.
- **Placeholders:** none — every step carries code or an exact command.
- **Type consistency:** `ApproveDeps`/`ApproveResult` defined in Task 3 and used verbatim in the Task 3 wiring and Task 6 (no other task touches approve); `FOUNDRY_VERSION` re-export keeps every existing import site valid.
