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
