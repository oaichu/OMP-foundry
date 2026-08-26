import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FOUNDRY_VERSION } from "../src/version";

describe("version single source", () => {
	test("FOUNDRY_VERSION matches package.json and is never the fallback", () => {
		const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
		expect(FOUNDRY_VERSION).toBe(pkg.version);
		expect(FOUNDRY_VERSION).not.toBe("0.0.0");
	});
});
