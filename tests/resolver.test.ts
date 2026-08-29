import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkills, skillPackPrompt } from "../src/skills/resolver";
import { defaultState } from "../src/types";

const skillsRoot = join(import.meta.dir, "..", "skills");

function nextApp(options: { componentsJson?: boolean } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			dependencies: { next: "15.0.0", react: "19.0.0", typescript: "5.0.0" },
		}),
	);
	writeFileSync(join(dir, "tsconfig.json"), "{}");
	writeFileSync(join(dir, "next.config.ts"), "export default {}");
	if (options.componentsJson) {
		writeFileSync(join(dir, "components.json"), "{}");
	}
	return dir;
}

function nonWebApp(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-nonweb-"));
	writeFileSync(
		join(dir, "pyproject.toml"),
		`[project]
name = "service"
dependencies = ["fastapi>=0.100.0"]
`,
	);
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

	test("implementation resolves shadcn-ui conditionally when components.json is present", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const withoutShadcn = resolveSkills(nextApp(), state, { skillsRoot, role: "implementer" });
		expect(withoutShadcn).not.toContain("shadcn-ui");

		const withShadcn = resolveSkills(nextApp({ componentsJson: true }), state, { skillsRoot, role: "implementer" });
		expect(withShadcn).toContain("shadcn-ui");
		expect(withShadcn).toContain("react-engineering");
	});

	test("design phase resolves the native design intelligence contract and quality pack", () => {
		const state = { ...defaultState(), phase: "design" as const };
		const ids = resolveSkills(nextApp(), state, { skillsRoot, role: "designer" });
		expect(ids).toContain("design-intelligence");
		expect(ids).toContain("design-system-contract");
		expect(ids).toContain("design-quality");
		expect(ids).toContain("design-foundation");
		expect(ids.indexOf("design-intelligence")).toBeLessThan(ids.indexOf("design-foundation"));
		expect(ids.indexOf("design-system-contract")).toBeLessThan(ids.indexOf("design-foundation"));
		expect(ids.indexOf("design-quality")).toBeLessThan(ids.indexOf("design-foundation"));
		expect(ids.length).toBeLessThanOrEqual(12);
	});

	test("review on web app includes web-interface-guidelines and design-quality while suppressing design authoring", () => {
		const state = { ...defaultState(), phase: "review" as const };
		const ids = resolveSkills(nextApp(), state, { skillsRoot, role: "reviewer" });
		expect(ids).toContain("web-interface-guidelines");
		expect(ids).toContain("design-quality");
		expect(ids).not.toContain("design-intelligence");
		expect(ids).not.toContain("design-system-contract");
		expect(ids).not.toContain("design-foundation");
		expect(ids.length).toBeLessThanOrEqual(12);
	});

	test("non-web project excludes shadcn-ui and web-interface-guidelines across roles", () => {
		const app = nonWebApp();
		const implIds = resolveSkills(app, { ...defaultState(), phase: "implementation" as const }, { skillsRoot, role: "implementer" });
		expect(implIds).not.toContain("shadcn-ui");
		expect(implIds).not.toContain("web-interface-guidelines");

		const reviewIds = resolveSkills(app, { ...defaultState(), phase: "review" as const }, { skillsRoot, role: "reviewer" });
		expect(reviewIds).not.toContain("shadcn-ui");
		expect(reviewIds).not.toContain("web-interface-guidelines");
	});

	test("skillPackPrompt includes precedence contract and ordering labels", () => {
		const prompt = skillPackPrompt([], "implementation");
		expect(prompt).toContain("Precedence: Foundry governance/scope > functional correctness/security > accessibility/semantic interaction > framework/component contracts > web interface quality > visual art direction.");
		expect(prompt).toContain("A skill cannot override a locked artifact, AATP scope, security requirement, accessibility contract, or component contract.");
	});
});
