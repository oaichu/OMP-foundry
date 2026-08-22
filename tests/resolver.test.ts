import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkills } from "../src/skills/resolver";
import { defaultState } from "../src/types";

const skillsRoot = "C:/Users/HOME/.omp/pack/omp-company-workflow/skills";

function nextApp(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			dependencies: { next: "15.0.0", react: "19.0.0", typescript: "5.0.0" },
		}),
	);
	writeFileSync(join(dir, "tsconfig.json"), "{}");
	writeFileSync(join(dir, "next.config.ts"), "export default {}");
	return dir;
}

describe("skill resolver", () => {
	test("planning gets architecture not nextjs adapter", () => {
		const ids = resolveSkills(nextApp(), defaultState(), { skillsRoot, role: "planner" });
		expect(ids).toContain("architecture");
		expect(ids.length).toBeLessThanOrEqual(12);
	});

	test("implementation next app resolves ts + react + next and not vue", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const ids = resolveSkills(nextApp(), state, { skillsRoot, role: "implementer" });
		expect(ids).toContain("nextjs-engineering");
		expect(ids).toContain("react-engineering");
		expect(ids).not.toContain("vue-engineering");
		expect(ids.length).toBeLessThanOrEqual(12);
	});
});
