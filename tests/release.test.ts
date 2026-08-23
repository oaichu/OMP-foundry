import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyQa } from "../src/verify-runner";
import { governedCommitLedgerFresh, workingTreeClean } from "../src/release";
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
	test("provenance ledger rejects a clean external commit", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-ledger-"));
		const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
		const sha = () => git(["rev-parse", "HEAD"]).stdout.trim();
		git(["init"]); git(["config", "user.email", "t@t"]); git(["config", "user.name", "t"]);
		writeFileSync(join(dir, "a.txt"), "baseline\n"); git(["add", "."]); git(["commit", "-m", "baseline"]); const baseline = sha();
		writeFileSync(join(dir, "a.txt"), "governed\n"); git(["add", "."]); git(["commit", "-m", "foundry: complete AATP-1"]); const governed = sha();
		const state = defaultState(); state.aatp.baseline_sha = baseline; state.aatp.governed_commits = [governed];
		expect(governedCommitLedgerFresh(dir, state, governed)).toBe(true);
		writeFileSync(join(dir, "a.txt"), "external\n"); git(["add", "."]); git(["commit", "-m", "external clean commit"]); const external = sha();
		expect(governedCommitLedgerFresh(dir, state, external)).toBe(false);
	});

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
