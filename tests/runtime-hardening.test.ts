import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProjectIsolationConfig, narrowFoundryGitignore, validateIsolationSettings } from "../src/omp-runtime";
import { reviewsApproved } from "../src/release";
import { defaultState } from "../src/types";

describe("OMP isolation contract", () => {
	test("requires isolation and apply=false", () => { expect(validateIsolationSettings("none", false).ok).toBe(false); expect(validateIsolationSettings("auto", true).reason).toContain("APPLY_REQUIRED_FALSE"); expect(validateIsolationSettings("auto", false).ok).toBe(true); });
	test("creates config only when absent", () => { const dir = mkdtempSync(join(tmpdir(), "foundry-runtime-")); const made = ensureProjectIsolationConfig(dir); expect(made.created).toBe(true); expect(readFileSync(made.path, "utf8")).toContain("apply: false"); writeFileSync(made.path, "custom: true\n"); expect(ensureProjectIsolationConfig(dir).created).toBe(false); expect(readFileSync(made.path, "utf8")).toBe("custom: true\n"); });
	test("narrows legacy .omp ignore without hiding project config", () => { const dir = mkdtempSync(join(tmpdir(), "foundry-ignore-")); writeFileSync(join(dir, ".gitignore"), "node_modules/\n.omp/\n"); narrowFoundryGitignore(dir); const text = readFileSync(join(dir, ".gitignore"), "utf8"); expect(text).not.toMatch(/^\.omp\/$/m); expect(text).toContain(".omp/foundry-state.yml"); expect(text).not.toContain(".omp/config.yml"); });
});

describe("review evidence gate", () => {
	test("requires independent reviewer identity and evidence", () => { const state = defaultState(); state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: ["src"], forbidden_files: [], risk: "normal", review: "APPROVE", review_by: "reviewer", review_evidence_sha256: "sha" }; expect(reviewsApproved(state)).toBe(true); state.tickets["AATP-1"]!.review_evidence_sha256 = ""; expect(reviewsApproved(state)).toBe(false); state.tickets["AATP-1"]!.review_evidence_sha256 = "sha"; state.tickets["AATP-1"]!.review_by = "implementer"; expect(reviewsApproved(state)).toBe(false); });
});
