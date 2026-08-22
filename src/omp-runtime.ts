import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface IsolationContract {
	ok: boolean;
	mode?: string;
	apply?: boolean;
	reason?: string;
}

function readJsonSetting(cwd: string, key: string): unknown {
	const result = spawnSync("omp", ["config", "get", key, "--json"], { cwd, encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `omp config get ${key} failed`);
	const parsed = JSON.parse(result.stdout) as { value?: unknown };
	return parsed.value;
}

export function validateIsolationSettings(mode: string, apply: boolean): IsolationContract {
	if (mode === "none") return { ok: false, mode, apply, reason: 'FOUNDRY_ISOLATION_REQUIRED: set task.isolation.mode to "auto" (or another isolation backend).' };
	if (apply) return { ok: false, mode, apply, reason: "FOUNDRY_APPLY_REQUIRED_FALSE: set task.isolation.apply=false so Foundry validates patches before merge." };
	return { ok: true, mode, apply };
}

export function checkIsolationContract(cwd: string): IsolationContract {
	try {
		const mode = String(readJsonSetting(cwd, "task.isolation.mode") ?? "none");
		const rawApply = readJsonSetting(cwd, "task.isolation.apply");
		const apply = rawApply === true || rawApply === "true";
		return validateIsolationSettings(mode, apply);
	} catch (error) {
		return { ok: false, reason: `FOUNDRY_OMP_CONFIG_ERROR: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function ensureProjectIsolationConfig(cwd: string): { created: boolean; path: string } {
	const path = join(cwd, ".omp", "config.yml");
	if (existsSync(path)) return { created: false, path };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "task:\n  isolation:\n    mode: auto\n    apply: false\n", "utf8");
	return { created: true, path };
}

export function narrowFoundryGitignore(cwd: string): void {
	const path = join(cwd, ".gitignore");
	let text = "";
	try {
		text = readFileSync(path, "utf8");
	} catch {
		/* absent */
	}
	const lines = text.split(/\r?\n/).filter((line) => !/^\.omp\/?\s*$/.test(line));
	const required = [
		".omp/foundry-state.yml",
		".omp/foundry-state.yml.*.tmp",
		".omp/foundry-state.yml.pre-v*.bak",
		".omp/company-state.yml",
		".omp/company-state.yaml",
	];
	for (const line of required) if (!lines.includes(line)) lines.push(line);
	writeFileSync(path, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
}
