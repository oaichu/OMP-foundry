import { describe, expect, test } from "bun:test";
import { parseState, serializeState } from "../src/state-machine";
import { defaultState, StateError } from "../src/types";

describe("state", () => {
	test("roundtrip default", () => {
		const again = parseState(serializeState(defaultState()));
		expect(again.phase).toBe("discovery");
		expect(again.release.ready).toBe(false);
	});

	test("rejects invalid enum", () => {
		expect(() => parseState("phase: nope\n")).toThrow(StateError);
	});

	test("rejects empty", () => {
		expect(() => parseState("")).toThrow(StateError);
	});
});

describe("loadStateResult fail-closed", () => {
	test("unreadable state file is not treated as absent", async () => {
		const { mkdirSync, mkdtempSync } = await import("node:fs");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const { loadStateResult } = await import("../src/state-machine");
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		// A directory where the state file should be makes the read fail with
		// a non-ENOENT error; only ENOENT may count as "no state".
		mkdirSync(join(cwd, ".omp", "foundry-state.yml"), { recursive: true });
		const result = loadStateResult(cwd);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason.startsWith("STATE_IO_ERROR")).toBe(true);
	});
});
