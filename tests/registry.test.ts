import { describe, expect, test } from "bun:test";
import { parseManifest } from "../src/skills/registry";
import { PHASES, ROLES } from "../src/skills/manifest-schema";

function skill(extra: string): string {
	return `---\nid: example\nlayer: L1\n${extra}---\nbody\n`;
}

describe("skill manifest parser", () => {
	test("omitted roles/phases intentionally default to all", () => {
		const parsed = parseManifest("x", skill(""));
		expect(parsed?.roles).toEqual(ROLES);
		expect(parsed?.phases).toEqual(PHASES);
	});
	test("invalid or partially invalid roles fail closed", () => {
		expect(parseManifest("x", skill("roles: typo\n"))).toBeNull();
		expect(parseManifest("x", skill("roles: planner, typo\n"))).toBeNull();
	});
	test("invalid or partially invalid phases fail closed", () => {
		expect(parseManifest("x", skill("phases: typo\n"))).toBeNull();
		expect(parseManifest("x", skill("phases: planning, typo\n"))).toBeNull();
	});
});
