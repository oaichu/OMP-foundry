import { lstatSync, writeFileSync, mkdirSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { detectStack } from "./stack-detector";
import { gitHead, workingTreeClean } from "./release";
import { safeRepoPath } from "./paths";
import type { VerifyStep } from "./skills/detector";
import type { CompanyState } from "./types";

export function trustedExecutable(cwd: string, executable: string): string | undefined {
	const value = executable.trim();
	if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
	const explicitPath = isAbsolute(value) || value.includes("/") || value.includes("\\");
	const candidates: string[] = [];
	if (explicitPath) {
		const local = isAbsolute(value) ? value : safeRepoPath(cwd, value);
		if (local) candidates.push(local);
	} else {
		const extNames = process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
		for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) for (const ext of extNames) candidates.push(join(dir.replace(/^"|"$/g, ""), `${value}${ext}`));
	}
	const repoRoot = resolve(cwd);
	for (const candidate of candidates) {
		try {
			const stat = lstatSync(candidate);
			if (!stat.isFile() || stat.isSymbolicLink()) continue;
			const rel = relative(repoRoot, resolve(candidate));
			if (!explicitPath && (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))) continue;
			if (process.platform !== "win32" && (stat.mode & 0o111) === 0) continue;
			return candidate;
		} catch { /* try the next trusted PATH entry */ }
	}
	return undefined;
}

export interface VerifyRow {
	id: string;
	command: string;
	exitCode: number;
	output: string;
}
export type VerifyRows = VerifyRow[] & { headBefore?: string; headAfter?: string };

export function executeVerifyStep(cwd: string, step: VerifyStep, timeout = 10 * 60 * 1000): VerifyRow {
	const stepCwd = step.cwd ? safeRepoPath(cwd, step.cwd) : safeRepoPath(cwd, ".");
	if (!stepCwd) return { id: step.id, command: step.command, exitCode: 1, output: "PATH_GATE: verification cwd escapes the repository." };
	const executable = trustedExecutable(cwd, step.executable);
	if (!executable) return { id: step.id, command: step.command, exitCode: 1, output: `VERIFY_EXECUTABLE_GATE: ${step.executable} is not a trusted executable outside the repository.` };
	const result = spawnSync(executable, step.args, { cwd: stepCwd, encoding: "utf8", shell: false, timeout, maxBuffer: 256 * 1024 });
	return {
		id: step.id,
		command: step.command,
		exitCode: result.status ?? 1,
		output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.slice(0, 4000),
	};
}

const VERIFY_STEP_TIMEOUT = 5 * 60 * 1000;
const VERIFY_TOTAL_TIMEOUT = 15 * 60 * 1000;
const MAX_VERIFY_STEPS = 32;

export function runVerify(cwd: string): VerifyRows {
	const stack = detectStack(cwd);
	const rows = [] as VerifyRows;
	rows.headBefore = gitHead(cwd);
	const deadline = Date.now() + VERIFY_TOTAL_TIMEOUT;
	for (const step of stack.verify.slice(0, MAX_VERIFY_STEPS)) {
		const remaining = Math.min(VERIFY_STEP_TIMEOUT, deadline - Date.now());
		if (remaining <= 0) { rows.push({ id: step.id, command: step.command, exitCode: 1, output: "VERIFY_TIMEOUT: total verification deadline exceeded." }); break; }
		rows.push(executeVerifyStep(cwd, step, remaining));
	}
	if (stack.verify.length > MAX_VERIFY_STEPS) rows.push({ id: "verify-limit", command: `first ${MAX_VERIFY_STEPS} steps`, exitCode: 1, output: "VERIFY_RESOURCE_GATE: verification step limit exceeded." });
	rows.headAfter = gitHead(cwd);
	return rows;
}

export function applyQa(cwd: string, state: CompanyState, rows: VerifyRows): void {
	// `runVerify` supplies a before/after snapshot.  Keep a compatibility
	// fallback for callers that construct rows directly, but the extension's
	// /verify path always takes the snapshot-aware branch.
	const currentHead = gitHead(cwd);
	const before = rows.headBefore ?? currentHead;
	const after = rows.headAfter ?? currentHead;
	const stable = Boolean(before && after && before === after && after === currentHead);
	const clean = stable && workingTreeClean(cwd);
	const commandsOk = rows.length > 0 && rows.every((row) => row.exitCode === 0);
	// Close the small commit race between the first HEAD read and the report
	// write.  The validated SHA is retained instead of reading a newer SHA
	// after the checks have passed.
	const validatedHead = clean && commandsOk ? currentHead : "";
	const stillSameHead = validatedHead !== "" && gitHead(cwd) === validatedHead;
	const pass = clean && commandsOk && stillSameHead;
	state.qa.status = !clean ? "pending" : commandsOk ? "pass" : rows.length === 0 ? "pending" : "fail";
	if (!stillSameHead && clean && commandsOk) state.qa.status = "pending";
	state.qa.tree_sha = pass ? validatedHead : "";
	if (pass) state.phase = "qa";
	const report = safeRepoPath(cwd, "docs/reports/QA.md");
	if (!report) throw new Error("PATH_GATE: refusing QA report through a symlink or outside the repository.");
	mkdirSync(dirname(report), { recursive: true });
	const body = [
		"# QA",
		"",
		`- working_tree_clean: ${clean}`,
		...rows.map((row) => `- ${row.id}: exit ${row.exitCode} \`${row.command}\``),
		"",
		pass ? "RESULT: PASS" : "RESULT: FAIL (dirty tree or failing command)",
		"",
	].join("\n");
	writeFileSync(report, body, { encoding: "utf8", flag: "w" });
}
