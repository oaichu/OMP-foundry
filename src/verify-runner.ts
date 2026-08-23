import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { detectStack } from "./stack-detector";
import { gitHead, workingTreeClean } from "./release";
import { safeRepoPath } from "./paths";
import type { VerifyStep } from "./skills/detector";
import type { CompanyState } from "./types";
import { provenanceEvidence } from "./provenance";

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
			const linkStat = lstatSync(candidate);
			const resolvedCandidate = linkStat.isSymbolicLink() ? realpathSync(candidate) : candidate;
			const stat = lstatSync(resolvedCandidate);
			if (!stat.isFile()) continue;
			const rel = relative(repoRoot, resolve(resolvedCandidate));
			// System shims (notably Linux/macOS npm) may be symlinks, but an
			// executable whose resolved target is inside the governed repo is
			// never trusted, even when the caller supplied an explicit path.
			if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) continue;
			if (process.platform !== "win32" && (stat.mode & 0o111) === 0) continue;
			return resolvedCandidate;
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

const VERIFY_ENV_ALLOWLIST = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ"];
const VERIFY_STEP_TIMEOUT = 5 * 60 * 1000;
const VERIFY_TOTAL_TIMEOUT = 15 * 60 * 1000;
const MAX_VERIFY_STEPS = 32;
const MAX_TICKET_VERIFY_STEPS = 8;

function verificationEnv(executable: string, sandboxHome: string): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of VERIFY_ENV_ALLOWLIST) if (process.env[key]) env[key] = process.env[key];
	const executableDir = dirname(executable);
	const pathKey = process.platform === "win32" && env.Path !== undefined ? "Path" : "PATH";
	const existingPath = env[pathKey] ?? "";
	env[pathKey] = [executableDir, existingPath].filter(Boolean).join(delimiter);
	// Project code must not inherit operator credentials/configuration. These
	// directories are disposable and removed immediately after the step.
	env.HOME = sandboxHome;
	env.USERPROFILE = sandboxHome;
	env.APPDATA = join(sandboxHome, "AppData", "Roaming");
	env.LOCALAPPDATA = join(sandboxHome, "AppData", "Local");
	env.XDG_CONFIG_HOME = join(sandboxHome, ".config");
	env.XDG_CACHE_HOME = join(sandboxHome, ".cache");
	env.TMPDIR = join(sandboxHome, "tmp");
	env.TMP = join(sandboxHome, "tmp");
	env.TEMP = join(sandboxHome, "tmp");
	env.CI = "1";
	env.FOUNDRY_VERIFY = "1";
	env.GIT_CONFIG_NOSYSTEM = "1";
	env.GIT_TERMINAL_PROMPT = "0";
	env.NO_COLOR = "1";
	return env;
}

function terminateProcessTree(pid: number | undefined): void {
	if (!pid) return;
	try {
		if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8", shell: false, windowsHide: true, timeout: 5000 });
		else process.kill(-pid, "SIGKILL");
	} catch {
		try { process.kill(pid, "SIGKILL"); } catch { /* best effort; the parent timeout remains a hard failure */ }
	}
}

export function executeVerifyStep(cwd: string, step: VerifyStep, timeout = 10 * 60 * 1000): VerifyRow {
	const stepCwd = step.cwd ? safeRepoPath(cwd, step.cwd) : safeRepoPath(cwd, ".");
	if (!stepCwd) return { id: step.id, command: step.command, exitCode: 1, output: "PATH_GATE: verification cwd escapes the repository." };
	const executable = trustedExecutable(cwd, step.executable);
	if (!executable) return { id: step.id, command: step.command, exitCode: 1, output: `VERIFY_EXECUTABLE_GATE: ${step.executable} is not a trusted executable outside the repository.` };
	let command = executable;
	let args = [...step.args];
	if (process.env.FOUNDRY_VERIFY_REQUIRE_SANDBOX === "1") {
		const wrapperName = process.env.FOUNDRY_VERIFY_SANDBOX_EXECUTABLE?.trim() ?? "";
		const wrapper = wrapperName ? trustedExecutable(cwd, wrapperName) : undefined;
		if (!wrapper) return { id: step.id, command: step.command, exitCode: 1, output: "VERIFY_SANDBOX_GATE: an external OS sandbox wrapper is required. Set FOUNDRY_VERIFY_SANDBOX_EXECUTABLE to a trusted wrapper or use a trusted repository mode." };
		command = wrapper;
		args = [executable, ...args];
	}
	let sandboxHome = "";
	try {
		sandboxHome = mkdtempSync(join(tmpdir(), "omp-foundry-verify-"));
		mkdirSync(join(sandboxHome, "tmp"), { recursive: true });
		const result = spawnSync(command, args, {
			cwd: stepCwd,
			encoding: "utf8",
			shell: false,
			timeout: Math.max(1, Math.min(timeout, VERIFY_STEP_TIMEOUT)),
			killSignal: "SIGKILL",
			windowsHide: true,
			maxBuffer: 256 * 1024,
			env: verificationEnv(executable, sandboxHome),
		});
		if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") terminateProcessTree((result as { pid?: number }).pid);
		return {
			id: step.id,
			command: step.command,
			exitCode: result.status ?? 1,
			output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}` : ""}`.slice(0, 4000),
		};
	} catch (error) {
		return { id: step.id, command: step.command, exitCode: 1, output: `VERIFY_RUNTIME_GATE: ${error instanceof Error ? error.message : String(error)}` };
	} finally {
		if (sandboxHome) {
			try { rmSync(sandboxHome, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
		}
	}
}

function declaredStep(cwd: string, token: string, available: VerifyStep[]): VerifyStep | undefined {
	const wanted = token.trim();
	if (!wanted) return undefined;
	if (!/^[A-Za-z0-9_.:@/-]+$/.test(wanted) && !/^(?:bun|npm)\s+test(?:\s+--silent)?$/i.test(wanted)) return undefined;
	const exact = available.find((step) => step.id.toLowerCase() === wanted.toLowerCase() || step.command.toLowerCase() === wanted.toLowerCase());
	if (exact) return exact;
	let scripts: Record<string, string> = {};
	try {
		const packagePath = safeRepoPath(cwd, "package.json");
		if (packagePath) scripts = (JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
	} catch { /* malformed package metadata is reported as an unresolved declaration */ }
	const script = wanted.replace(/^test:/i, "");
	if (scripts[script]) return { id: `script:${script}`, command: `npm run ${script} --silent`, executable: "npm", args: ["run", script, "--silent"] };
	if (/^(?:bun\s+test|npm\s+test)$/i.test(wanted) && scripts.test) return { id: "unit", command: "npm test --silent", executable: "npm", args: ["test", "--silent"] };
	return undefined;
}

/** Run only the verification IDs declared by one AATP work order. */
export function runDeclaredVerification(cwd: string, declarations: string[]): { rows: VerifyRows; evidenceSha256: string; ok: boolean } {
	const available = detectStack(cwd).verify;
	const rows = [] as VerifyRows;
	rows.headBefore = gitHead(cwd);
	if (declarations.length > MAX_TICKET_VERIFY_STEPS) {
		rows.push({ id: "ticket-verify-limit", command: `first ${MAX_TICKET_VERIFY_STEPS} declarations`, exitCode: 1, output: "AATP_VERIFY_RESOURCE_GATE: ticket verification declaration limit exceeded." });
		rows.headAfter = gitHead(cwd);
		return { rows, evidenceSha256: provenanceEvidence(rows[0]?.output, rows.headBefore, rows.headAfter), ok: false };
	}
	const selected: VerifyStep[] = [];
	for (const declaration of declarations) {
		const step = declaredStep(cwd, declaration, available);
		if (!step) rows.push({ id: `declaration:${declaration}`, command: declaration, exitCode: 1, output: `AATP_VERIFY_GATE: declaration ${declaration} does not resolve to a detected verification step or package script.` });
		else if (!selected.some((item) => item.command === step.command)) selected.push(step);
	}
	const deadline = Date.now() + VERIFY_TOTAL_TIMEOUT;
	for (const step of selected) {
		const remaining = Math.min(VERIFY_STEP_TIMEOUT, deadline - Date.now());
		if (remaining <= 0) { rows.push({ id: "ticket-verify-timeout", command: step.command, exitCode: 1, output: "AATP_VERIFY_TIMEOUT: ticket verification deadline exceeded." }); break; }
		rows.push(executeVerifyStep(cwd, step, remaining));
	}
	rows.headAfter = gitHead(cwd);
	const evidenceSha256 = provenanceEvidence(...rows.map((row) => `${row.id}\0${row.command}\0${row.exitCode}\0${row.output}`), rows.headBefore, rows.headAfter);
	return { rows, evidenceSha256, ok: rows.length > 0 && rows.every((row) => row.exitCode === 0) && Boolean(rows.headBefore && rows.headBefore === rows.headAfter) };
}

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
