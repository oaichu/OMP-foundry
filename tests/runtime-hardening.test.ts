import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFoundryProjectRoles, ensureProjectFoundryConfig, ensureProjectIsolationConfig, narrowFoundryGitignore, validateIsolationSettings } from "../src/omp-runtime";
import { reviewsApproved } from "../src/release";
import { defaultState } from "../src/types";

describe("OMP isolation + project scope contract", () => {
	test("requires isolation and apply=false", () => { expect(validateIsolationSettings("none", false).ok).toBe(false); expect(validateIsolationSettings("auto", true).reason).toContain("APPLY_REQUIRED_FALSE"); expect(validateIsolationSettings("auto", false).ok).toBe(true); });
	test("new config is project-scoped and never requires global mutation", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-runtime-"));
		const made = ensureProjectFoundryConfig(dir), text = readFileSync(made.path, "utf8");
		expect(made.created).toBe(true);
		expect(text).toContain("apply: false");
		expect(text).toContain("modelRoleStorage: project");
	});
	test("existing project config is preserved while Foundry storage policy is appended", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-runtime-existing-"));
		const made = ensureProjectIsolationConfig(dir);
		writeFileSync(made.path, "custom: true\n");
		const again = ensureProjectIsolationConfig(dir), text = readFileSync(again.path, "utf8");
		expect(again.created).toBe(false);
		expect(text).toContain("custom: true");
		expect(text).toContain("modelRoleStorage: project");
	});
	test("doctor fails closed when project role mappings are absent", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-role-doctor-"));
		const made = ensureProjectFoundryConfig(dir);
		writeFileSync(made.path, "modelRoleStorage: project\nmodelRoles:\n  foundry_plan: openai/example\n");
		const result = checkFoundryProjectRoles(dir);
		expect(result.ok).toBe(false);
		expect(result.missing).toContain("foundry_redteam");
	});
	test("narrows legacy .omp ignore without hiding project config", () => { const dir = mkdtempSync(join(tmpdir(), "foundry-ignore-")); writeFileSync(join(dir, ".gitignore"), "node_modules/\n.omp/\n"); narrowFoundryGitignore(dir); const text = readFileSync(join(dir, ".gitignore"), "utf8"); expect(text).not.toMatch(/^\.omp\/$/m); expect(text).toContain(".omp/foundry-state.yml"); expect(text).not.toContain(".omp/config.yml"); });
});

describe("review evidence gate", () => {
	test("requires independent reviewer identity and evidence", () => { const state = defaultState(); state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: ["src"], forbidden_files: [], risk: "normal", review: "APPROVE", review_by: "reviewer", review_evidence_sha256: "sha" }; expect(reviewsApproved(state)).toBe(true); state.tickets["AATP-1"]!.review_evidence_sha256 = ""; expect(reviewsApproved(state)).toBe(false); state.tickets["AATP-1"]!.review_evidence_sha256 = "sha"; state.tickets["AATP-1"]!.review_by = "implementer"; expect(reviewsApproved(state)).toBe(false); });
});

describe("foundry role aliases", () => {
	test("bootstrap writes @role aliases that follow the user's OMP roles", () => {
		const { aliasRoleMap } = require("../src/omp-runtime");
		const map: Record<string, string> = aliasRoleMap({ default: "x/a", plan: "x/b", slow: "x/c", task: "x/d", smol: "x/e", designer: "x/f" });
		expect(map.foundry_plan).toBe("@plan");
		expect(map.foundry_redteam).toBe("@slow");
		expect(map.foundry_review).toBe("@default");
		expect(map.foundry_impl).toBe("@task");
		expect(map.foundry_smol).toBe("@smol");
		expect(Object.values(map).every((v) => v === "" || v.startsWith("@"))).toBe(true);
	});
	test("roles with no matching OMP role stay empty and are not written", () => {
		const { aliasRoleMap } = require("../src/omp-runtime");
		const map: Record<string, string> = aliasRoleMap({});
		expect(Object.values(map).every((v) => v === "")).toBe(true);
	});
});

describe("global role registration", () => {
	test("registers missing foundry_* roles as @aliases without touching existing keys", () => {
		const { ensureGlobalFoundryRoles } = require("../src/omp-runtime");
		const dir = mkdtempSync(join(tmpdir(), "foundry-global-"));
		const path = join(dir, "config.yml");
		writeFileSync(path, "shellPath: /bin/bash\nmodelRoles:\n  default: x/a:high\n  foundry_plan: openai/pinned\n");
		const result = ensureGlobalFoundryRoles({ path, roles: { default: "x/a:high", slow: "x/c:max", task: "x/d:high" } });
		expect(result.added.length).toBe(9); // foundry_plan already present
		expect(result.added).not.toContain("foundry_plan");
		const text = readFileSync(path, "utf8");
		expect(text).toContain("shellPath: /bin/bash");
		expect(text).toContain("foundry_plan: openai/pinned"); // never overwritten
		expect(text).toContain(String.raw`foundry_redteam: "@slow"`);
		expect(text).toContain(String.raw`foundry_impl: "@task"`);
		expect(text).toContain(String.raw`foundry_review: "@default"`);
	});
	test("idempotent: second run adds nothing", () => {
		const { ensureGlobalFoundryRoles } = require("../src/omp-runtime");
		const dir = mkdtempSync(join(tmpdir(), "foundry-global2-"));
		const path = join(dir, "config.yml");
		ensureGlobalFoundryRoles({ path, roles: { default: "x/a" } });
		const before = readFileSync(path, "utf8");
		const second = ensureGlobalFoundryRoles({ path, roles: { default: "x/a" } });
		expect(second.added).toEqual([]);
		expect(readFileSync(path, "utf8")).toBe(before);
	});
	test("empty roleset still writes @default for every foundry role", () => {
		const { ensureGlobalFoundryRoles } = require("../src/omp-runtime");
		const dir = mkdtempSync(join(tmpdir(), "foundry-global3-"));
		const path = join(dir, "config.yml");
		const result = ensureGlobalFoundryRoles({ path, roles: {} });
		expect(result.added.length).toBe(10);
		const text = readFileSync(path, "utf8");
		expect((text.match(/: "@default"/g) ?? []).length).toBe(10);
	});
});

describe("generated config must be valid YAML", () => {
	test("quoted @aliases parse and resolve back to the same strings", async () => {
		const { parse } = await import("yaml");
		const { ensureGlobalFoundryRoles } = require("../src/omp-runtime");
		const dir = mkdtempSync(join(tmpdir(), "foundry-yaml-"));
		const path = join(dir, "config.yml");
		writeFileSync(path, "shellPath: /bin/bash\n");
		const result = ensureGlobalFoundryRoles({ path, roles: { default: "x/a:high", slow: "x/c:max" } });
		const parsed = parse(readFileSync(path, "utf8")) as { modelRoles: Record<string, string>; shellPath: string };
		expect(parsed.shellPath).toBe("/bin/bash");
		expect(parsed.modelRoles.foundry_redteam).toBe("@slow");
		expect(parsed.modelRoles.foundry_review).toBe("@default");
		for (const role of result.added) expect(typeof parsed.modelRoles[role]).toBe("string");
	});
});
