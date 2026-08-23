import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalRepoPath } from "../src/paths";

describe("canonicalRepoPath", () => {
	test("keeps normal repo-relative paths", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		expect(canonicalRepoPath(cwd, "src/App.tsx")).toBe(process.platform === "win32" ? "src/app.tsx" : "src/App.tsx");
	});

	test("rejects parent escapes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-"));
		expect(canonicalRepoPath(cwd, "../outside.ts")).toBeNull();
	});

	test("symlinked dir cannot smuggle a new file outside the repo", () => {
		const cwd = mkdtempSync(join(tmpdir(), "foundry-in-"));
		const outside = mkdtempSync(join(tmpdir(), "foundry-out-"));
		writeFileSync(join(outside, "real.ts"), "x\n");
		try {
			symlinkSync(outside, join(cwd, "out"), "dir");
		} catch {
			// Windows without symlink privilege: soft-skip this check.
			return;
		}
		expect(canonicalRepoPath(cwd, "out/new-file.ts")).toBeNull();
		expect(canonicalRepoPath(cwd, "out/real.ts")).toBeNull();
	});
});
