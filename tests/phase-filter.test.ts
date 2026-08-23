import { describe, expect, test } from "bun:test";
import { phaseOf, roleOf } from "../src/skills/phase-filter";
import { defaultState } from "../src/types";

describe("role-aware skill routing", () => {
	test("all current agents resolve to a role", () => {
		expect(roleOf("plan-drafter")).toBe("planner");
		expect(roleOf("plan-redteam")).toBe("planner");
		expect(roleOf("plan-synth")).toBe("planner");
		expect(roleOf("aatp-compiler")).toBe("planner");
		expect(roleOf("product-analyst")).toBe("planner");
		expect(roleOf("implementer")).toBe("implementer");
		expect(roleOf("hard-implementer")).toBe("implementer");
		expect(roleOf("smol-implementer")).toBe("implementer");
		expect(roleOf("reviewer")).toBe("reviewer");
		expect(roleOf("security-reviewer")).toBe("reviewer");
		expect(roleOf("design-foundation")).toBe("designer");
	});

	test("retired plan aliases no longer resolve", () => {
		expect(roleOf("plan-critic")).toBeUndefined();
		expect(roleOf("plan-finalizer")).toBeUndefined();
	});

	test("unknown agents have no role", () => {
		expect(roleOf("scout")).toBeUndefined();
		expect(roleOf(undefined)).toBeUndefined();
	});

	test("phaseOf maps implementation and qa families", () => {
		expect(phaseOf({ ...defaultState(), phase: "implementation" })).toBe("implementation");
		expect(phaseOf({ ...defaultState(), phase: "qa" })).toBe("qa");
		expect(phaseOf(defaultState())).toBe("planning");
	});
});
