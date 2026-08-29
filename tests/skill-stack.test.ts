import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepo } from "../src/skills/detector";
import { loadRegistry } from "../src/skills/registry";
import { skillPackPrompt } from "../src/skills/resolver";
const root = join(import.meta.dir, "..");
const registry = loadRegistry(join(root, "skills"));
const byId = new Map(registry.map((skill) => [skill.id, skill]));

describe("frontend skill stack manifests", () => {
	test("manifest metadata adheres to the skill router contract", () => {
		expect(byId.get("shadcn-ui")).toMatchObject({
			layer: "L3",
			phases: ["implementation", "review"],
			roles: ["implementer", "reviewer"],
			requires: ["react-engineering"],
		});
		expect(byId.get("web-interface-guidelines")).toMatchObject({
			layer: "L1",
			phases: ["review", "qa"],
			roles: ["reviewer", "qa"],
			priority: 95,
		});
	});

	test("conditional activation rules match project evidence and stack", () => {
		const shadcn = byId.get("shadcn-ui");
		expect(shadcn?.activate_when.files).toContain("components.json");

		const webGuidelines = byId.get("web-interface-guidelines");
		expect(webGuidelines?.activate_when.stacks).toContain("web");
	});

	test("skill bodies include governance and domain boundary terms", () => {
		const shadcnBody = byId.get("shadcn-ui")?.body ?? "";
		expect(shadcnBody).toContain("AATP");
		expect(shadcnBody).toContain("semantic");
		expect(shadcnBody).toContain("keyboard");

		const guidelinesBody = byId.get("web-interface-guidelines")?.body ?? "";
		expect(guidelinesBody).toContain("file:line");
		expect(guidelinesBody).toContain("AATP");
	});
});

function createFixture(options: { componentsJson?: boolean } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-skill-stack-"));
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

describe("frontend skill detector and prompt precedence", () => {
	test("detectRepo includes components.json only when the file exists", () => {
		const withoutMarker = createFixture();
		expect(detectRepo(withoutMarker).files).not.toContain("components.json");

		const withMarker = createFixture({ componentsJson: true });
		expect(detectRepo(withMarker).files).toContain("components.json");
	});

	test("skillPackPrompt states six-level precedence contract in order", () => {
		const prompt = skillPackPrompt([], "implementation");
		expect(prompt).toContain(
			"Precedence: Foundry governance/scope > functional correctness/security > accessibility/semantic interaction > framework/component contracts > web interface quality > visual art direction.",
		);
		expect(prompt).toContain(
			"A skill cannot override a locked artifact, AATP scope, security requirement, accessibility contract, or component contract.",
		);

		const normalized = prompt.toLowerCase();
		const governanceIdx = normalized.indexOf("foundry governance");
		const functionalIdx = normalized.indexOf("functional correctness");
		const accessibilityIdx = normalized.indexOf("accessibility");
		const frameworkIdx = normalized.indexOf("framework");
		const webInterfaceIdx = normalized.indexOf("web interface quality");
		const visualArtIdx = normalized.indexOf("visual art direction");

		expect(governanceIdx).toBeGreaterThan(-1);
		expect(functionalIdx).toBeGreaterThan(governanceIdx);
		expect(accessibilityIdx).toBeGreaterThan(functionalIdx);
		expect(frameworkIdx).toBeGreaterThan(accessibilityIdx);
		expect(webInterfaceIdx).toBeGreaterThan(frameworkIdx);
		expect(visualArtIdx).toBeGreaterThan(webInterfaceIdx);
	});
});
