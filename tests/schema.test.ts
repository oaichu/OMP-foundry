import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSchemaVersion, migrateToCurrent, SchemaTooNewError } from "../src/schema";
import { loadStateResult, parseState, serializeState } from "../src/state-machine";
import { CURRENT_STATE_SCHEMA, defaultState, FOUNDRY_VERSION, StateError } from "../src/types";

const v0 = readFileSync(join(import.meta.dir, "fixtures/state-v0-0.2.0.yml"), "utf8");

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-schema-"));
	mkdirSync(join(dir, ".omp"), { recursive: true });
	return dir;
}

describe("schema versioning", () => {
	test("missing schema_version is legacy v0", () => {
		expect(detectSchemaVersion(v0)).toBe(0);
	});

	test("v0 fixture migrates to v1 and drops capabilities", () => {
		const out = migrateToCurrent(v0);
		expect(out.from).toBe(0);
		expect(out.didMigrate).toBe(true);
		expect(out.state.schema_version).toBe(1);
		expect(out.state.phase).toBe("planning");
		expect(out.state.master_plan.status).toBe("locked");
		expect(out.state.tickets["AATP-001"]?.status).toBe("completed");
		expect(out.yaml).toContain("schema_version: 1");
		expect(out.yaml).not.toContain("capabilities:");
		expect(() => parseState(out.yaml)).not.toThrow();
	});

	test("migration is idempotent", () => {
		const once = migrateToCurrent(v0);
		const twice = migrateToCurrent(once.yaml);
		expect(twice.didMigrate).toBe(false);
		expect(twice.state.schema_version).toBe(CURRENT_STATE_SCHEMA);
		expect(twice.state.phase).toBe(once.state.phase);
	});

	test("v1 current load does not rewrite", () => {
		const dir = tmpProject();
		const file = join(dir, ".omp", "foundry-state.yml");
		const v1 = migrateToCurrent(v0).yaml;
		writeFileSync(file, v1, "utf8");
		const loaded = loadStateResult(dir);
		expect(loaded.ok).toBe(true);
		expect(readFileSync(file, "utf8")).toBe(v1);
		expect(existsSync(`${file}.pre-v1.bak`)).toBe(false);
	});

	test("load migrates v0, backups original, persists v1", () => {
		const dir = tmpProject();
		const file = join(dir, ".omp", "foundry-state.yml");
		writeFileSync(file, v0, "utf8");
		const loaded = loadStateResult(dir);
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.state.schema_version).toBe(1);
		expect(readFileSync(`${file}.pre-v1.bak`, "utf8")).toBe(v0);
		const written = readFileSync(file, "utf8");
		expect(written).toContain("schema_version: 1");
		expect(written).toContain(`last_written_by: "${FOUNDRY_VERSION}"`);
	});

	test("legacy company-state.yml migrates to foundry-state.yml", () => {
		const dir = tmpProject();
		const legacy = join(dir, ".omp", "company-state.yml");
		writeFileSync(legacy, v0, "utf8");
		const loaded = loadStateResult(dir);
		expect(loaded.ok).toBe(true);
		expect(existsSync(join(dir, ".omp", "foundry-state.yml"))).toBe(true);
		expect(readFileSync(legacy, "utf8")).toBe(v0);
	});

	test("corrupt legacy state fails closed and leaves file", () => {
		const dir = tmpProject();
		const file = join(dir, ".omp", "foundry-state.yml");
		const bad = "phase: nope\nproduct:\n  status: approved\n";
		writeFileSync(file, bad, "utf8");
		const loaded = loadStateResult(dir);
		expect(loaded.ok).toBe(false);
		expect(readFileSync(file, "utf8")).toBe(bad);
	});

	test("unsupported newer schema fails closed with update message", () => {
		const newer = serializeState(defaultState()).replace("schema_version: 1", "schema_version: 5");
		expect(() => migrateToCurrent(newer)).toThrow(SchemaTooNewError);
		try {
			migrateToCurrent(newer);
		} catch (error) {
			expect(String(error)).toContain("STATE_SCHEMA_TOO_NEW");
			expect(String(error)).toContain("schema 5");
		}
	});

	test("empty state is corrupt not v0", () => {
		expect(() => detectSchemaVersion("")).toThrow(StateError);
		expect(() => parseState("")).toThrow(StateError);
	});
});
