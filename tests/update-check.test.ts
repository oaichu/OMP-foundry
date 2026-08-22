import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdate, compareSemver, parseTagFromUrl, versionReport } from "../src/update-check";

describe("update-check", () => {
	test("parses GitHub latest redirect URL", () => {
		expect(parseTagFromUrl("https://github.com/oaichu/omp-foundry/releases/tag/v0.3.0")).toBe("0.3.0");
	});

	test("compares semver", () => {
		expect(compareSemver("0.3.0", "0.2.2")).toBeGreaterThan(0);
		expect(compareSemver("0.3.0", "0.3.0")).toBe(0);
		expect(compareSemver("0.2.9", "0.3.0")).toBeLessThan(0);
	});

	test("fresh cache skips fetch", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-upd-"));
		const cachePath = join(dir, "foundry-update.json");
		writeFileSync(cachePath, JSON.stringify({ checkedAt: 1_000, latest: "0.4.0" }), "utf8");
		let fetched = 0;
		const result = await checkForUpdate({
			now: () => 1_000 + 60_000,
			installed: "0.3.0",
			omp: "18.0.0",
			cachePath,
			fetchLatest: async () => {
				fetched += 1;
				return "9.9.9";
			},
		});
		expect(fetched).toBe(0);
		expect(result.newer).toBe(true);
		expect(result.notify).toContain("Foundry 0.4.0 available");
	});

	test("stale cache fetches and writes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-upd-"));
		const cachePath = join(dir, "foundry-update.json");
		writeFileSync(cachePath, JSON.stringify({ checkedAt: 1, latest: "0.2.0" }), "utf8");
		const result = await checkForUpdate({
			now: () => 1 + 25 * 60 * 60 * 1000,
			installed: "0.3.0",
			omp: "18.0.0",
			cachePath,
			fetchLatest: async () => "0.3.1",
		});
		expect(result.latest).toBe("0.3.1");
		expect(result.newer).toBe(true);
		expect(JSON.parse(readFileSync(cachePath, "utf8")).latest).toBe("0.3.1");
	});

	test("same version does not notify", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-upd-"));
		const cachePath = join(dir, "foundry-update.json");
		const result = await checkForUpdate({
			now: () => 10,
			installed: "0.3.0",
			omp: "18.0.0",
			cachePath,
			fetchLatest: async () => "0.3.0",
		});
		expect(result.newer).toBe(false);
		expect(result.notify).toBeUndefined();
		expect(versionReport(result)).toContain("Foundry: 0.3.0");
		expect(versionReport(result)).toContain("OMP: 18.0.0");
	});

	test("fetch failure keeps prior cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-upd-"));
		const cachePath = join(dir, "foundry-update.json");
		writeFileSync(cachePath, JSON.stringify({ checkedAt: 1, latest: "0.2.0" }), "utf8");
		const result = await checkForUpdate({
			now: () => 1 + 25 * 60 * 60 * 1000,
			installed: "0.3.0",
			omp: "18.0.0",
			cachePath,
			fetchLatest: async () => {
				throw new Error("timeout");
			},
		});
		expect(result.latest).toBe("0.2.0");
		expect(result.newer).toBe(false);
	});
});
