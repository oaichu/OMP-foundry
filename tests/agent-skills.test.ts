import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../src/skills/registry";

const root = join(import.meta.dir, "..");

describe("agent skill dependencies", () => {
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
