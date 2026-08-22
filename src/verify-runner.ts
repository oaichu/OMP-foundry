import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectStack } from "./stack-detector";
import { gitHead, workingTreeClean } from "./release";
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
	const clean = workingTreeClean(cwd);
	const commandsOk = rows.length > 0 && rows.every((row) => row.exitCode === 0);
	const pass = clean && commandsOk;
	state.qa.status = !clean ? "pending" : commandsOk ? "pass" : rows.length === 0 ? "pending" : "fail";
	state.qa.tree_sha = pass ? gitHead(cwd) : "";
	if (pass) state.phase = "qa";
	mkdirSync(join(cwd, "docs", "reports"), { recursive: true });
	const body = [
		"# QA",
		"",
		`- working_tree_clean: ${clean}`,
		...rows.map((row) => `- ${row.id}: exit ${row.exitCode} \`${row.command}\``),
		"",
		pass ? "RESULT: PASS" : "RESULT: FAIL (dirty tree or failing command)",
		"",
	].join("\n");
	writeFileSync(join(cwd, "docs", "reports", "QA.md"), body, "utf8");
}
