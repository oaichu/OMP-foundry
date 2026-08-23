import { describe, expect, test } from "bun:test";
import { join } from "node:path";

describe("index.ts", () => {
	test("parses and contains no retired authority aliases", async () => {
		const src = await Bun.file(join(import.meta.dir, "../src/index.ts")).text();
		expect(src.includes("const sub = args.trim().toLowerCase()")).toBe(true);
		expect(src.includes("name: \"plan_revise\"")).toBe(false);
		expect(src.includes("name: \"plan_commit\"")).toBe(false);
		expect(src.includes('startsWith("foundry_")')).toBe(false);
		expect(src.includes('startsWith("company_")')).toBe(false);
		expect(src.includes("plan-critic")).toBe(false);
		expect(src.includes("plan-finalizer")).toBe(false);
		expect(src.includes("unlock_token")).toBe(false);
		expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(src)).not.toThrow();
	});
});