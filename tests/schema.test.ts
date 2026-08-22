import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectSchemaVersion, migrateToCurrent, SchemaTooNewError } from "../src/schema";
import { loadStateResult, parseState, serializeState } from "../src/state-machine";
import { CURRENT_STATE_SCHEMA, defaultState, FOUNDRY_VERSION, StateError } from "../src/types";
const v0 = readFileSync(join(import.meta.dir, "fixtures/state-v0-0.2.0.yml"), "utf8");
function tmpProject(): string { const dir = mkdtempSync(join(tmpdir(), "foundry-schema-")); mkdirSync(join(dir, ".omp"), { recursive: true }); return dir; }

describe("state schema v2", () => {
	test("v0 migrates all the way to current", () => { const out = migrateToCurrent(v0); expect(out.from).toBe(0); expect(out.state.schema_version).toBe(CURRENT_STATE_SCHEMA); expect(out.yaml).toContain(`schema_version: ${CURRENT_STATE_SCHEMA}`); expect(out.state.aatp.manifest_sha256).toBe(""); expect(() => parseState(out.yaml)).not.toThrow(); });
	test("migration idempotent and current load does not rewrite", () => { const current = migrateToCurrent(v0).yaml; expect(migrateToCurrent(current).didMigrate).toBe(false); const dir = tmpProject(), file = join(dir, ".omp", "foundry-state.yml"); writeFileSync(file, current); expect(loadStateResult(dir).ok).toBe(true); expect(readFileSync(file, "utf8")).toBe(current); });
	test("legacy load keeps original backup", () => { const dir = tmpProject(), file = join(dir, ".omp", "foundry-state.yml"); writeFileSync(file, v0); expect(loadStateResult(dir).ok).toBe(true); expect(existsSync(`${file}.pre-v1.bak`)).toBe(true); expect(readFileSync(file, "utf8")).toContain(`last_written_by: "${FOUNDRY_VERSION}"`); });
	test("review and manifest evidence roundtrip", () => {
		const state = defaultState(); state.aatp.manifest_sha256 = "manifest"; state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: ["src"], forbidden_files: [], risk: "normal", review: "APPROVE", review_by: "reviewer", review_evidence_sha256: "review", implementation_evidence_sha256: "impl" };
		const again = parseState(serializeState(state)); expect(again.aatp.manifest_sha256).toBe("manifest"); expect(again.tickets["AATP-1"]?.review_by).toBe("reviewer"); expect(again.tickets["AATP-1"]?.review_evidence_sha256).toBe("review");
	});
	test("newer schema and corrupt state fail closed", () => { const newer = serializeState(defaultState()).replace(`schema_version: ${CURRENT_STATE_SCHEMA}`, "schema_version: 99"); expect(() => migrateToCurrent(newer)).toThrow(SchemaTooNewError); expect(() => detectSchemaVersion("")).toThrow(StateError); const dir = tmpProject(), file = join(dir, ".omp", "foundry-state.yml"); writeFileSync(file, "phase: nope\n"); expect(loadStateResult(dir).ok).toBe(false); });
});
