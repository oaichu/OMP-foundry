import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectStack } from "./stack-detector";
import { gitTreeSha } from "./release";
import type { CompanyState } from "./types";

export interface VerifyRow {
	id: string;
	command: string;
	exitCode: number;
	output: string;
}

export function runVerify(cwd: string): VerifyRow[] {
	const stack = detectStack(cwd);
	const rows: VerifyRow[] = [];
	for (const step of stack.verify) {
		const result = spawnSync(step.command, {
			cwd: step.cwd ?? cwd,
			encoding: "utf8",
			shell: true,
			timeout: 10 * 60 * 1000,
		});
		rows.push({
			id: step.id,
			command: step.command,
			exitCode: result.status ?? 1,
			output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(0, 4000),
		});
	}
	return rows;
}

export function applyQa(cwd: string, state: CompanyState, rows: VerifyRow[]): void {
	const pass = rows.length > 0 && rows.every((row) => row.exitCode === 0);
	state.qa.status = pass ? "pass" : rows.length === 0 ? "pending" : "fail";
	state.qa.tree_sha = pass ? gitTreeSha(cwd) : "";
	state.phase = pass ? "qa" : state.phase;
	mkdirSync(join(cwd, "docs", "reports"), { recursive: true });
	const body = [
		"# QA",
		"",
		...rows.map((row) => `- ${row.id}: exit ${row.exitCode} \`${row.command}\``),
		"",
		pass ? "RESULT: PASS" : "RESULT: FAIL",
		"",
	].join("\n");
	writeFileSync(join(cwd, "docs", "reports", "QA.md"), body, "utf8");
}
