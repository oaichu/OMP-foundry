import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginTicket, completeTicket, hydrateAatp, readyIndependent, reviewTicket, routeAgent } from "../src/aatp";
import { defaultState } from "../src/types";

describe("aatp authority", () => {
	test("routes low risk to smol-implementer not sonic", () => {
		expect(routeAgent("low")).toBe("smol-implementer");
		expect(routeAgent("hard")).toBe("hard-implementer");
		expect(routeAgent("normal")).toBe("implementer");
	});

	test("status comes from state not markdown", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-"));
		mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(
			join(dir, "docs", "AATP", "AATP-001.md"),
			"---\nid: AATP-001\nobjective: x\nstatus: ready\nrisk: low\ndependencies:\n  - none\nallowed_files:\n  - src/a\n---\n",
		);
		const state = defaultState();
		state.tickets["AATP-001"] = {
			id: "AATP-001",
			status: "completed",
			allowed_files: ["src/a"],
			forbidden_files: [],
			risk: "low",
			review: "APPROVE",
		};
		const tasks = hydrateAatp(dir, state);
		expect(tasks[0]?.status).toBe("completed");
		expect(readyIndependent(tasks)).toHaveLength(0);
	});
});

describe("aatp transitions", () => {
	const spec = (id: string, deps: string[] = []) => ({
		id,
		objective: "x",
		dependencies: deps,
		allowed_files: [`src/${id.toLowerCase()}`],
		forbidden_files: [],
		risk: "normal",
		recommended_agent: "implementer",
		path: `docs/AATP/${id}.md`,
	});

	test("begin rejects unknown ticket with no spec", () => {
		const state = defaultState();
		expect(beginTicket(state, undefined, "AATP-9").ok).toBe(false);
	});

	test("begin rejects until dependencies are completed", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "ready", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		state.tickets["AATP-2"] = { id: "AATP-2", status: "ready", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		const result = beginTicket(state, spec("AATP-2", ["AATP-1"]), "AATP-2");
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.reason.includes("DEPENDENCY_CONFLICT")).toBe(true);
	});

	test("ready -> active -> completed -> APPROVE is the only path", () => {
		const state = defaultState();
		expect(beginTicket(state, spec("AATP-1"), "AATP-1").ok).toBe(true);
		expect(completeTicket(state, "AATP-1").ok).toBe(true);
		expect(reviewTicket(state, "AATP-1", "APPROVE").ok).toBe(true);
		expect(state.tickets["AATP-1"]?.review).toBe("APPROVE");
	});

	test("complete rejects a ready ticket", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "ready", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(completeTicket(state, "AATP-1").ok).toBe(false);
	});

	test("review rejects a non-completed ticket", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "active", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(reviewTicket(state, "AATP-1", "APPROVE").ok).toBe(false);
	});

	test("REQUEST_CHANGES sends the ticket back to ready", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(reviewTicket(state, "AATP-1", "REQUEST_CHANGES").ok).toBe(true);
		expect(state.tickets["AATP-1"]?.status).toBe("ready");
	});
});
