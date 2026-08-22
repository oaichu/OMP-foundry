import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
	governedTask,
	parsePatchPaths,
	rejectChangedPaths,
	revertPaths,
	reviewTaskDelta,
} from "../src/patch-gate";

function gitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-patch-"));
	const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	git(["init"]);
	git(["config", "user.email", "t@t"]);
	git(["config", "user.name", "t"]);
	mkdirSync(join(dir, "src", "auth"), { recursive: true });
	writeFileSync(join(dir, "src", "auth", "ok.ts"), "1\n");
	writeFileSync(join(dir, "src", "billing.ts"), "1\n");
	git(["add", "."]);
	git(["commit", "-m", "init"]);
	return dir;
}

describe("patch-gate", () => {
	test("parses unified diff and apply_patch headers", () => {
		const paths = parsePatchPaths(
			[
				"diff --git a/src/auth/a.ts b/src/auth/a.ts",
				"+++ b/src/auth/a.ts",
				"*** Add File: src/new.ts",
			].join("\n"),
		);
		expect(paths).toContain("src/auth/a.ts");
		expect(paths).toContain("src/new.ts");
	});

	test("rejects impl path no ticket owns", () => {
		const dir = gitRepo();
		const hit = rejectChangedPaths(dir, ["src/billing.ts"], [
			{ id: "AATP-1", status: "active", allowed_files: ["src/auth"], forbidden_files: [], risk: "normal" },
		]);
		expect(hit.rejected).toContain("src/billing.ts");
	});

	test("reverts untracked out-of-scope file", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "src", "leak.ts"), "secret\n");
		const reverted = revertPaths(dir, ["src/leak.ts"]);
		expect(reverted).toContain("src/leak.ts");
		expect(existsSync(join(dir, "src", "leak.ts"))).toBe(false);
	});

	test("reviewTaskDelta reverts leaked impl after isolated apply", () => {
		const dir = gitRepo();
		writeFileSync(join(dir, "src", "billing.ts"), "hacked\n");
		const tickets = [
			{ id: "AATP-1", status: "active" as const, allowed_files: ["src/auth"], forbidden_files: [], risk: "normal" },
		];
		const reviewed = reviewTaskDelta(dir, new Set(), tickets, undefined, "");
		expect(reviewed.rejected.some((p) => p.includes("billing"))).toBe(true);
		expect(readFileSync(join(dir, "src", "billing.ts"), "utf8").replace(/\r\n/g, "\n")).toBe("1\n");
	});

	test("governedTask detects batch implementers", () => {
		expect(governedTask({ agent: "scout" })).toBe(false);
		expect(governedTask({ tasks: [{ agent: "smol-implementer", task: "x" }] })).toBe(true);
	});
});
