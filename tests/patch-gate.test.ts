import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyPatchArtifact, commitAppliedPatch, parseConflict, parsePatchPaths, parseReviewVerdict, prepareImplementationBaseline, restoreCleanHead, taskBindings, validatePatchArtifact, validatePatchPaths } from "../src/patch-gate";

const ticket = { id: "AATP-001", status: "active" as const, allowed_files: ["src/auth", "package.json"], forbidden_files: [], risk: "normal", review: "none" as const };
function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-patch-"));
	const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	git(["init"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
	// Pin line endings so generated patches and applied files are byte-identical
	// on Windows (autocrlf would rewrite LF to CRLF and break equality checks).
	git(["config", "core.autocrlf", "false"]);
	mkdirSync(join(dir, "src", "auth"), { recursive: true }); writeFileSync(join(dir, "src", "auth", "a.ts"), "1\n"); writeFileSync(join(dir, "package.json"), "{}\n");
	git(["add", "."]); git(["commit", "-m", "init"]); return dir;
}
function patchFor(dir: string, file: string, next: string): string {
	writeFileSync(join(dir, file), next);
	const patch = spawnSync("git", ["diff", "--", file], { cwd: dir, encoding: "utf8" }).stdout;
	spawnSync("git", ["restore", "--", file], { cwd: dir });
	const patchPath = join(dir, "worker.patch"); writeFileSync(patchPath, patch); return patchPath;
}

describe("exact governed bindings", () => {
	test("binds each batch item to exactly one ticket", () => {
		const out = taskBindings({ tasks: [{ agent: "implementer", task: "Implement AATP-001 only" }, { agent: "smol-implementer", task: "Implement AATP-002 only" }] });
		expect(out.errors).toEqual([]); expect(out.bindings.map((b) => b.ticketId)).toEqual(["AATP-001", "AATP-002"]);
	});
	test("fails closed on missing, ambiguous, or duplicate binding", () => {
		expect(taskBindings({ agent: "implementer", task: "do it" }).errors.length).toBe(1);
		expect(taskBindings({ agent: "implementer", task: "AATP-001 and AATP-002" }).errors.length).toBe(1);
		expect(taskBindings({ tasks: [{ agent: "implementer", task: "AATP-001" }, { agent: "hard-implementer", task: "AATP-001" }] }).errors.length).toBe(1);
	});
});

describe("pre-apply patch gate", () => {
	test("parses both sides of unified diff", () => expect(parsePatchPaths("diff --git a/src/auth/a.ts b/src/auth/a.ts\n--- a/src/auth/a.ts\n+++ b/src/auth/a.ts\n")).toContain("src/auth/a.ts"));
	test("implementation patch is default-deny outside exact scope", () => {
		const dir = gitRepo();
		expect(validatePatchPaths(dir, ["src/auth/a.ts", "package.json"], ticket, "implementation").rejected).toEqual([]);
		expect(validatePatchPaths(dir, ["Dockerfile"], ticket, "implementation").rejected).toEqual(["Dockerfile"]);
		expect(validatePatchPaths(dir, ["docs/MASTER_PLAN.md"], ticket, "implementation").rejected).toEqual(["docs/MASTER_PLAN.md"]);
	});
	test("review patch may only write its exact report", () => {
		const dir = gitRepo();
		expect(validatePatchPaths(dir, ["docs/reports/REVIEW-AATP-001.md"], ticket, "review").rejected).toEqual([]);
		expect(validatePatchPaths(dir, ["src/auth/a.ts"], ticket, "review").rejected).toEqual(["src/auth/a.ts"]);
	});
	test("valid patch is checked before extension-owned apply+commit", () => {
		const dir = gitRepo(), patchPath = patchFor(dir, "src/auth/a.ts", "2\n");
		expect(validatePatchArtifact(dir, patchPath, ticket, "implementation").ok).toBe(true);
		expect(applyPatchArtifact(dir, patchPath).ok).toBe(true);
		expect(readFileSync(join(dir, "src", "auth", "a.ts"), "utf8")).toBe("2\n");
		expect(commitAppliedPatch(dir, ticket.id, "implementation").ok).toBe(true);
	});
	test("rollback reverses only Foundry patch and preserves unrelated user file", () => {
		const dir = gitRepo(), patchPath = patchFor(dir, "src/auth/a.ts", "worker\n");
		expect(applyPatchArtifact(dir, patchPath).ok).toBe(true);
		writeFileSync(join(dir, "user-notes.txt"), "preserve me\n");
		restoreCleanHead(dir);
		expect(readFileSync(join(dir, "src", "auth", "a.ts"), "utf8")).toBe("1\n");
		expect(existsSync(join(dir, "user-notes.txt"))).toBe(true);
		expect(readFileSync(join(dir, "user-notes.txt"), "utf8")).toBe("preserve me\n");
	});
});

describe("worker evidence", () => {
	test("parses review and conflict markers", () => {
		expect(parseReviewVerdict("FOUNDRY_REVIEW AATP-001 APPROVE", "AATP-001")).toBe("APPROVE");
		expect(parseReviewVerdict("+FOUNDRY_REVIEW AATP-001 BLOCK", "AATP-001")).toBe("BLOCK");
		expect(parseReviewVerdict("APPROVE", "AATP-001")).toBeUndefined();
		expect(parseConflict("FOUNDRY_CONFLICT PLAN_CONFLICT locked plan mismatch")?.kind).toBe("PLAN_CONFLICT");
	});
	test("dirty source WIP blocks governed build", () => { const dir = gitRepo(); writeFileSync(join(dir, "src", "auth", "a.ts"), "user edit\n"); expect(prepareImplementationBaseline(dir).ok).toBe(false); });
});
