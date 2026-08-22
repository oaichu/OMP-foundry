import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateAatp, readyIndependent, routeAgent } from "../src/aatp";
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
