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
	test("eval is always denied", () => expect(denyToolCall("eval", { code: "1+1" }, defaultState())?.reason).toContain("EVAL_GATE"));
	test("arbitrary bash and redirects are denied", () => { expect(denyToolCall("bash", { command: 'echo x > "docs/MASTER_PLAN.md"' }, locked())?.reason).toContain("BASH_GATE"); expect(denyToolCall("bash", { command: "python - <<'PY'\nprint(1)\nPY" }, locked())?.reason).toContain("BASH_GATE"); });
	test("agent release actions are always denied even when release is green", () => { const state = locked(); state.release.ready = true; expect(denyToolCall("bash", { command: "git push origin main" }, state)?.reason).toContain("RELEASE_GATE"); });
	test("read-only git shell remains available", () => expect(denyToolCall("bash", { command: "git diff --stat" }, locked())).toBeUndefined());
	test("mutating LSP actions are denied", () => { expect(denyToolCall("lsp", { action: "rename", file: "src/a.ts" }, locked())?.reason).toContain("LSP_GATE"); expect(denyToolCall("lsp", { action: "request", file: "src/a.ts" }, locked())?.reason).toContain("LSP_GATE"); expect(denyToolCall("lsp", { action: "hover", file: "src/a.ts" }, locked())).toBeUndefined(); });
	test("canonical locked plan path is denied", () => { const cwd = mkdtempSync(join(tmpdir(), "foundry-perm-")); mkdirSync(join(cwd, "docs"), { recursive: true }); writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "x\n"); const hit = denyToolCall("write", { path: "docs/./MASTER_PLAN.md" }, locked(), { canonicalize: (raw) => canonicalRepoPath(cwd, raw), activeTickets: [ticket] }); expect(hit?.reason).toContain("PLAN_CONFLICT"); });
	test("AATP scope applies to config/package files, not only code", () => { const state = locked(); expect(denyToolCall("write", { path: "Dockerfile" }, state, { activeTickets: [ticket] })?.reason).toContain("AATP_SCOPE"); expect(denyToolCall("write", { path: "package.json" }, state, { activeTickets: [ticket] })).toBeUndefined(); });
	test("no active ticket means no post-lock writes", () => expect(denyToolCall("write", { path: "src/auth/login.ts" }, locked(), { activeTickets: [] })?.reason).toContain("AATP_SCOPE"));
	test("sealed AATP specs are immutable", () => { const state = { ...locked(), phase: "aatp" as const }; state.aatp.manifest_sha256 = "sealed"; expect(denyToolCall("write", { path: "docs/AATP/AATP-1.md" }, state, { activeTickets: [ticket] })?.reason).toContain("AATP_SPEC_GATE"); });
	test("isolated child without state cannot touch governance artifacts", () => expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, defaultState(), { isolatedWithoutState: true })?.reason).toContain("ISOLATION_GATE"));
	test("forces isolation for implementation and review agents", () => { expect(forceIsolatedTaskInput({ agent: "implementer", task: "AATP-1" })?.isolated).toBe(true); const batch = forceIsolatedTaskInput({ tasks: [{ agent: "reviewer", task: "Review AATP-1" }] }); expect((batch?.tasks as Array<{ isolated?: boolean }>)[0]?.isolated).toBe(true); });
});
