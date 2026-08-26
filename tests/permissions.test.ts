import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denyToolCall, forceIsolatedTaskInput } from "../src/permissions";
import { canonicalRepoPath } from "../src/paths";
import { defaultState } from "../src/types";

const locked = () => ({ ...defaultState(), phase: "implementation" as const, product: { status: "approved" as const, sha256: "p" }, master_plan: { version: "1.0", status: "locked" as const, sha256: "m" }, design: { required: false, version: "0", status: "not_required" as const, sha256: "" } });
const ticket = { id: "AATP-1", status: "active" as const, allowed_files: ["src/auth", "package.json"], forbidden_files: [], risk: "normal", review: "none" as const };

describe("hard execution boundary", () => {
	test("read-only git shell remains available", () => expect(denyToolCall("bash", { command: "git diff --stat" }, locked())).toBeUndefined());
	test("declared planning control tools remain available", () => { expect(denyToolCall("ask", {}, defaultState())).toBeUndefined(); expect(denyToolCall("report_conflict", {}, defaultState())).toBeUndefined(); });
	test("canonical locked plan path is denied", () => { const cwd = mkdtempSync(join(tmpdir(), "foundry-perm-")); mkdirSync(join(cwd, "docs"), { recursive: true }); writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "x\n"); const hit = denyToolCall("write", { path: "docs/./MASTER_PLAN.md" }, locked(), { canonicalize: (raw) => canonicalRepoPath(cwd, raw), activeTickets: [ticket] }); expect(hit?.reason).toContain("PLAN_CONFLICT"); });
	test("AATP scope applies to config/package files, not only code", () => { const state = locked(); expect(denyToolCall("write", { path: "Dockerfile" }, state, { activeTickets: [ticket] })?.reason).toContain("AATP_SCOPE"); expect(denyToolCall("write", { path: "package.json" }, state, { activeTickets: [ticket] })).toBeUndefined(); });
	test("no active ticket means no post-lock writes", () => expect(denyToolCall("write", { path: "src/auth/login.ts" }, locked(), { activeTickets: [] })?.reason).toContain("AATP_SCOPE"));
	test("sealed AATP specs are immutable", () => { const state = { ...locked(), phase: "aatp" as const }; state.aatp.manifest_sha256 = "sealed"; expect(denyToolCall("write", { path: "docs/AATP/AATP-1.md" }, state, { activeTickets: [ticket] })?.reason).toContain("AATP_SPEC_GATE"); });
	test("unsealed AATP native writes are always denied", () => { const state = { ...locked(), phase: "aatp" as const }; expect(denyToolCall("write", { path: "docs/AATP/AATP-1.md" }, state)?.reason).toContain("AATP_COMPILER_GATE"); expect(denyToolCall("write", { path: "docs/AATP/archive/old.md" }, state)?.reason).toContain("AATP_COMPILER_GATE"); });
	test("isolated child without state cannot touch governance artifacts", () => expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, defaultState(), { isolatedWithoutState: true })?.reason).toContain("ISOLATION_GATE"));
	test("forces isolation for implementation and review agents", () => { expect(forceIsolatedTaskInput({ agent: "implementer", task: "AATP-1" })?.isolated).toBe(true); const batch = forceIsolatedTaskInput({ tasks: [{ agent: "reviewer", task: "Review AATP-1" }] }); expect((batch?.tasks as Array<{ isolated?: boolean }>)[0]?.isolated).toBe(true); });
});

describe("shell and LSP gates outside discovery", () => {
	test("mutating bash is denied when the plan is locked", () => {
		expect(denyToolCall("bash", { command: "echo hi >> docs/MASTER_PLAN.md" }, locked())?.reason).toContain("BASH_GATE");
	});
	test("compound shell commands and operators are denied", () => {
		expect(denyToolCall("bash", { command: "git diff && rm -rf ." }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git status; echo hi" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git log | sh" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff > out.txt" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff < in.txt" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff $(touch pwn)" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff `touch pwn`" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff\nrm -rf ." }, locked())?.reason).toContain("BASH_GATE");
	});
	test("dangerous git flags are denied", () => {
		expect(denyToolCall("bash", { command: "git diff --ext-diff" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git diff --output=out.patch" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git -c core.pager=sh diff" }, locked())?.reason).toContain("BASH_GATE");
		expect(denyToolCall("bash", { command: "git log --exec=sh" }, locked())?.reason).toContain("BASH_GATE");
	});
	test("read-only git remains available", () => {
		expect(denyToolCall("bash", { command: "git diff --stat" }, locked())).toBeUndefined();
		expect(denyToolCall("bash", { command: "git status --porcelain" }, locked())).toBeUndefined();
		expect(denyToolCall("bash", { command: "git log -n 5 --oneline" }, locked())).toBeUndefined();
		expect(denyToolCall("bash", { command: "git show HEAD" }, locked())).toBeUndefined();
		expect(denyToolCall("bash", { command: "git --no-pager diff" }, locked())).toBeUndefined();
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
