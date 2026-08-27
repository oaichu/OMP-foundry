import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../src/skills/registry";

const root = join(import.meta.dir, "..");
const registry = loadRegistry(join(root, "skills"));
const byId = new Map(registry.map((skill) => [skill.id, skill]));

describe("native design intelligence pack", () => {
	test("design foundation requires one owner for direction contract and quality", () => {
		const foundation = byId.get("design-foundation");
		expect(foundation).toBeDefined();
		expect(foundation?.requires).toEqual([
			"design-intelligence",
			"design-system-contract",
			"design-quality",
		]);
	});

	test("visual language vocabulary covers the supported style families", () => {
		const body = byId.get("design-intelligence")?.body ?? "";
		for (const style of [
			"Skeuomorphism",
			"Neumorphism",
			"Neomorphism",
			"Glassmorphism",
			"Claymorphism",
			"Minimalism",
			"Maximalism",
			"Brutalism",
			"Liquid Glass",
			"Bento Grid",
			"Spatial UI",
		]) expect(body).toContain(style);
	});

	test("design contract template carries implementation-grade design evidence", () => {
		const template = readFileSync(join(root, "templates", "DESIGN.md"), "utf8");
		for (const section of [
			"## Visual language",
			"## Design tokens",
			"### Primitive tokens",
			"### Semantic tokens",
			"## Layout, responsive, and platform adaptation",
			"## Components and states",
			"## Interaction and accessibility",
			"## Motion",
			"## Design QA",
			"## Preview verification",
		]) expect(template).toContain(section);
	});

	test("quality skill is available to design review and qa roles", () => {
		const quality = byId.get("design-quality");
		expect(quality?.phases).toEqual(["design", "review", "qa"]);
		expect(quality?.roles).toEqual(["designer", "reviewer", "qa"]);
	});
});
