import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyQa } from "../src/verify-runner";
import { workingTreeClean } from "../src/release";
import { defaultState } from "../src/types";

describe("qa identity", () => {
	test("dirty working tree cannot PASS", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-"));
		const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
		git(["init"]);
		git(["config", "user.email", "t@t"]);
		git(["config", "user.name", "t"]);
		writeFileSync(join(dir, "a.txt"), "1\n");
		git(["add", "."]);
		git(["commit", "-m", "init"]);
		writeFileSync(join(dir, "a.txt"), "dirty\n");
		const state = defaultState();
		applyQa(dir, state, [{ id: "unit", command: "true", exitCode: 0, output: "" }]);
		expect(state.qa.status).not.toBe("pass");
		expect(state.qa.tree_sha).toBe("");
	});
});

describe("foundry-owned cleanliness", () => {
	test("state file and QA report do not dirty the tree", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-"));
		const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
		git(["init"]);
		git(["config", "user.email", "t@t"]);
		git(["config", "user.name", "t"]);
		writeFileSync(join(dir, "a.txt"), "1\n");
		git(["add", "."]);
		git(["commit", "-m", "init"]);
		const { mkdirSync, writeFileSync: wf } = require("node:fs");
		mkdirSync(join(dir, ".omp"), { recursive: true });
		wf(join(dir, ".omp", "foundry-state.yml"), "phase: qa\n");
		mkdirSync(join(dir, "docs", "reports"), { recursive: true });
		wf(join(dir, "docs", "reports", "QA.md"), "# QA\n");
		expect(workingTreeClean(dir)).toBe(true);
		wf(join(dir, "a.txt"), "dirty\n");
		expect(workingTreeClean(dir)).toBe(false);
	});

	test("clean verify flow: QA pass does not self-dirty", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-"));
		const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
		git(["init"]);
		git(["config", "user.email", "t@t"]);
		git(["config", "user.name", "t"]);
		writeFileSync(join(dir, "a.txt"), "1\n");
		git(["add", "."]);
		git(["commit", "-m", "init"]);
		const state = defaultState();
		applyQa(dir, state, [{ id: "unit", command: "true", exitCode: 0, output: "" }]);
		expect(state.qa.status).toBe("pass");
		expect(workingTreeClean(dir)).toBe(true);
	});
});
