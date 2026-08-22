import { describe, expect, test } from "bun:test";
import { denyToolCall, looksLikeImpl } from "../src/permissions";
import { defaultState } from "../src/types";

const locked = {
	...defaultState(),
	product: { status: "approved" as const, sha256: "p" },
	master_plan: { version: "1.0", status: "locked" as const, sha256: "m" },
	design: { required: true, version: "0", status: "missing" as const, sha256: "" },
};

describe("denyToolCall", () => {
	test("blocks eval after plan lock without reading code", () => {
		const hit = denyToolCall("eval", { code: "write('docs/MASTER_PLAN.md','x')" }, locked);
		expect(hit?.reason.startsWith("EVAL_GATE")).toBe(true);
	});

	test("blocks locked plan writes", () => {
		const hit = denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, locked);
		expect(hit?.reason.includes("PLAN_CONFLICT")).toBe(true);
	});

	test("allows non-UI src after plan lock", () => {
		expect(denyToolCall("write", { path: "src/app.ts" }, locked)).toBeUndefined();
	});

	test("blocks UI before design lock", () => {
		const hit = denyToolCall("write", { path: "src/ui/Button.tsx" }, locked);
		expect(hit?.reason.startsWith("DESIGN_GATE")).toBe(true);
	});

	test("blocks push until derived release", () => {
		const hit = denyToolCall("bash", { command: "git push origin main" }, locked);
		expect(hit?.reason.startsWith("RELEASE_GATE")).toBe(true);
	});

	test("read is never gated", () => {
		expect(denyToolCall("read", { path: "docs/MASTER_PLAN.md" }, locked)).toBeUndefined();
	});

	test("enforces allowed_files on active ticket", () => {
		const hit = denyToolCall("write", { path: "src/other.ts" }, locked, {
			activeTicket: {
				id: "AATP-1",
				status: "active",
				allowed_files: ["src/auth.ts"],
				forbidden_files: [],
				risk: "normal",
			},
		});
		expect(hit?.reason.startsWith("AATP_SCOPE")).toBe(true);
	});

	test("fail-closed on corrupt state", () => {
		const hit = denyToolCall("write", { path: "src/app.ts" }, defaultState(), { stateBroken: "bad yaml" });
		expect(hit?.reason.startsWith("STATE_CORRUPT")).toBe(true);
	});

	test("detects python/go/rust as impl", () => {
		expect(looksLikeImpl("server.py")).toBe(true);
		expect(looksLikeImpl("cmd/foo.go")).toBe(true);
		expect(looksLikeImpl("crates/x/src/lib.rs")).toBe(true);
		expect(looksLikeImpl("docs/MASTER_PLAN.md")).toBe(false);
	});
});
