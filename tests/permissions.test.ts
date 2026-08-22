import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denyToolCall, forceIsolatedTaskInput, looksLikeImpl } from "../src/permissions";
import { canonicalRepoPath } from "../src/paths";
import { defaultState } from "../src/types";

const locked = {
	...defaultState(),
	product: { status: "approved" as const, sha256: "p" },
	master_plan: { version: "1.0", status: "locked" as const, sha256: "m" },
	design: { required: true, version: "0", status: "missing" as const, sha256: "" },
};

describe("denyToolCall", () => {
	test("denies eval even before plan lock", () => {
		const hit = denyToolCall("eval", { code: "1+1" }, defaultState());
		expect(hit?.reason.startsWith("EVAL_GATE")).toBe(true);
	});

	test("blocks dotted plan path via canonicalize", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(cwd, "docs"), { recursive: true });
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "# plan\n");
		const hit = denyToolCall("write", { path: "docs/./MASTER_PLAN.md" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
		});
		expect(hit?.reason.includes("PLAN_CONFLICT")).toBe(true);
	});

	test("blocks AATP escape via parent segment", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(cwd, "src", "auth"), { recursive: true });
		writeFileSync(join(cwd, "src", "billing.ts"), "");
		const hit = denyToolCall("write", { path: "src/auth/../billing.ts" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
			activeTicket: {
				id: "AATP-1",
				status: "active",
				allowed_files: ["src/auth"],
				forbidden_files: [],
				risk: "normal",
			},
		});
		expect(hit?.reason.startsWith("AATP_SCOPE")).toBe(true);
	});

	test("blocks push until derived release", () => {
		const hit = denyToolCall("bash", { command: "git push origin main" }, locked);
		expect(hit?.reason.startsWith("RELEASE_GATE")).toBe(true);
	});

	test("detects python/go/rust as impl", () => {
		expect(looksLikeImpl("server.py")).toBe(true);
		expect(looksLikeImpl("cmd/foo.go")).toBe(true);
		expect(looksLikeImpl("docs/master_plan.md")).toBe(false);
	});

	test("enforces scope with two active tickets", () => {
		const hit = denyToolCall("write", { path: "src/payments.ts" }, locked, {
			activeTickets: [
				{ id: "AATP-1", status: "active", allowed_files: ["src/auth"], forbidden_files: [], risk: "normal" },
				{ id: "AATP-2", status: "active", allowed_files: ["src/billing"], forbidden_files: [], risk: "normal" },
			],
		});
		expect(hit?.reason.startsWith("AATP_SCOPE")).toBe(true);
	});

	test("allows write owned by one of two active tickets", () => {
		const hit = denyToolCall("write", { path: "src/auth/login.ts" }, locked, {
			activeTickets: [
				{ id: "AATP-1", status: "active", allowed_files: ["src/auth"], forbidden_files: [], risk: "normal" },
				{ id: "AATP-2", status: "active", allowed_files: ["src/billing"], forbidden_files: [], risk: "normal" },
			],
		});
		expect(hit).toBeUndefined();
	});

	test("forces isolation on flat implementer task", () => {
		const next = forceIsolatedTaskInput({ agent: "implementer", task: "do" });
		expect(next?.isolated).toBe(true);
	});

	test("forces isolation on smol-implementer in a batch", () => {
		const next = forceIsolatedTaskInput({
			tasks: [{ agent: "smol-implementer", task: "tiny" }],
		});
		expect((next?.tasks as Array<{ isolated?: boolean }>)[0]?.isolated).toBe(true);
	});

	test("bash redirect into locked plan is denied", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(cwd, "docs"), { recursive: true });
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "# plan\n");
		const hit = denyToolCall("bash", { command: "echo hacked > docs/MASTER_PLAN.md" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
		});
		expect(hit?.reason.includes("PLAN_CONFLICT")).toBe(true);
	});

	test("bash tee into state file is denied", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(cwd, ".omp"), { recursive: true });
		writeFileSync(join(cwd, ".omp", "foundry-state.yml"), "phase: qa\n");
		const hit = denyToolCall("bash", { command: "echo x | tee .omp/foundry-state.yml" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
		});
		expect(hit?.reason.startsWith("STATE_GATE")).toBe(true);
	});

	test("bash sed -i outside ticket scope is denied", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(cwd, "src"), { recursive: true });
		writeFileSync(join(cwd, "src", "billing.ts"), "x\n");
		const hit = denyToolCall("bash", { command: "sed -i s/a/b/ src/billing.ts" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
			activeTicket: { id: "AATP-1", status: "active", allowed_files: ["src/auth"], forbidden_files: [], risk: "normal" },
		});
		expect(hit?.reason.startsWith("AATP_SCOPE")).toBe(true);
	});

	test("bash redirect escaping the repo hits PATH_GATE", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		const hit = denyToolCall("bash", { command: "printf pwned > ../outside.txt" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
		});
		expect(hit?.reason.startsWith("PATH_GATE")).toBe(true);
	});

	test("write escaping the repo hits PATH_GATE, not silence", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		const hit = denyToolCall("write", { path: "../../etc/passwd" }, locked, {
			canonicalize: (raw) => canonicalRepoPath(cwd, raw),
		});
		expect(hit?.reason.startsWith("PATH_GATE")).toBe(true);
	});

	test("python -c is denied like eval", () => {
		const hit = denyToolCall("bash", { command: 'python -c "open(\'x.ts\',\'w\')"' }, locked);
		expect(hit?.reason.startsWith("EVAL_GATE")).toBe(true);
	});

	test("git restore is denied once the plan is locked", () => {
		const hit = denyToolCall("bash", { command: "git restore src/billing.ts" }, locked);
		expect(hit?.reason.startsWith("MUTATOR_GATE")).toBe(true);
	});
});
