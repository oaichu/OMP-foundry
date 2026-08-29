import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadRegistry } from "../src/skills/registry";

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
