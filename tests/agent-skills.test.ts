import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../src/skills/registry";

const root = join(import.meta.dir, "..");

describe("agent skill dependencies", () => {
	test("AATP compiler is an authority alias, not a new model role", () => {
		const text = readFileSync(join(root, "agents", "aatp-compiler.md"), "utf8");
		expect(text).toContain("name: aatp-compiler");
		expect(text).toContain('model: "@foundry_synth"');
		expect(text).toContain("foundry_aatp_write");
		expect(text).not.toContain('model: "@foundry_aatp"');
	});
	test("all Master Plan stages keep high or max reasoning without nested context expansion", () => {
		for (const file of ["plan-drafter.md", "plan-redteam.md", "plan-synth.md"]) {
			const text = readFileSync(join(root, "agents", file), "utf8");
			expect(text).toMatch(/thinking-level:\s*(?:high|max)/);
			expect(text).not.toContain("web_search");
			expect(text).not.toContain("spawns:");
			expect(text).not.toContain(", task,");
		}
	});
	test("every autoloadSkills id is packaged by Foundry", () => {
		const packaged = new Set(loadRegistry(join(root, "skills")).map((skill) => skill.id));
		const missing: string[] = [];
		for (const file of readdirSync(join(root, "agents")).filter((name) => name.endsWith(".md"))) {
			const text = readFileSync(join(root, "agents", file), "utf8");
			const match = text.match(/^autoloadSkills:\s*(.+)$/m);
			if (!match) continue;
			for (const id of match[1].replace(/[\[\]]/g, "").split(",").map((value) => value.trim()).filter(Boolean)) {
				if (!packaged.has(id)) missing.push(`${file}: ${id}`);
			}
		}
		expect(missing).toEqual([]);
	});
});
