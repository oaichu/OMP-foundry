import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export interface IsolationContract {
	ok: boolean;
	mode?: string;
	apply?: boolean;
	reason?: string;
}

export const FOUNDRY_MODEL_ROLES = [
	"foundry_product",
	"foundry_plan",
	"foundry_redteam",
	"foundry_synth",
	"foundry_design",
	"foundry_impl",
	"foundry_hard",
	"foundry_smol",
	"foundry_review",
	"foundry_security",
] as const;

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

function effectiveRoles(cwd: string): Record<string, string> {
	try {
		const value = readJsonSetting(cwd, "modelRoles");
		return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, string> : {};
	} catch {
		return {};
	}
}

export function aliasRoleMap(roles: Record<string, string>): Record<(typeof FOUNDRY_MODEL_ROLES)[number], string> {
	// Bootstrap writes cross-role aliases (e.g. "@slow"), not concrete model
	// ids: the role keeps following the user's own OMP roles when they
	// reassign them in /models, and never goes stale. Users who want a
	// specific model overwrite the alias with a model id.
	const pick = (...names: string[]) => {
		const role = names.find((name) => typeof roles[name] === "string" && roles[name].trim());
		return role ? `@${role}` : "";
	};
	return {
		foundry_product: pick("default", "task", "slow"),
		foundry_plan: pick("plan", "slow", "default", "task"),
		foundry_redteam: pick("slow", "review", "advisor", "default"),
		foundry_synth: pick("slow", "advisor", "plan", "default"),
		foundry_design: pick("designer", "default", "task"),
		foundry_impl: pick("task", "default"),
		foundry_hard: pick("slow", "task", "default"),
		foundry_smol: pick("smol", "default", "task"),
		foundry_review: pick("review", "default", "slow"),
		foundry_security: pick("slow", "advisor", "review", "default"),
	};
}

function fallbackRoleMap(cwd: string): Record<(typeof FOUNDRY_MODEL_ROLES)[number], string> {
	return aliasRoleMap(effectiveRoles(cwd));
}

function topLevelBlock(text: string, key: string): { start: number; end: number; lines: string[] } | undefined {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((line) => line.trim() === `${key}:` && !/^\s/.test(line));
	if (start < 0) return undefined;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i += 1) {
		if (lines[i] && !/^\s/.test(lines[i]) && /^[A-Za-z0-9_.-]+:/.test(lines[i])) { end = i; break; }
	}
	return { start, end, lines };
}

function ensureTopLevelScalar(text: string, key: string, value: string): string {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const re = new RegExp(`^${key}:\\s*`);
	const index = lines.findIndex((line) => re.test(line));
	if (index >= 0) lines[index] = `${key}: ${value}`;
	else {
		while (lines.length && !lines[lines.length - 1]) lines.pop();
		lines.push(`${key}: ${value}`);
	}
	return `${lines.join("\n")}\n`;
}

// A leading @ is a reserved YAML indicator: alias values must be quoted or
// the whole settings file fails to parse and OMP quarantines it.
function formatRoleValue(value: string): string {
	return value.startsWith("@") ? `"${value}"` : value;
}

function ensureModelRoles(text: string, defaults: Record<string, string>): string {
	let next = text;
	let block = topLevelBlock(next, "modelRoles");
	if (!block) {
		const lines = next.replace(/\r\n/g, "\n").split("\n");
		while (lines.length && !lines[lines.length - 1]) lines.pop();
		lines.push("modelRoles:");
		for (const role of FOUNDRY_MODEL_ROLES) if (defaults[role]) lines.push(`  ${role}: ${formatRoleValue(defaults[role])}`);
		return `${lines.join("\n")}\n`;
	}
	const existing = new Set<string>();
	for (let i = block.start + 1; i < block.end; i += 1) {
		const match = block.lines[i].match(/^\s{2}([A-Za-z0-9_.-]+):/);
		if (match) existing.add(match[1]);
	}
	const inserts = FOUNDRY_MODEL_ROLES.filter((role) => !existing.has(role) && defaults[role]).map((role) => `  ${role}: ${formatRoleValue(defaults[role])}`);
	if (!inserts.length) return next.endsWith("\n") ? next : `${next}\n`;
	block.lines.splice(block.end, 0, ...inserts);
	return `${block.lines.join("\n").replace(/\n+$/, "")}\n`;
}

export function ensureProjectFoundryConfig(cwd: string): { created: boolean; path: string; rolesBootstrapped: string[] } {
	const path = join(cwd, ".omp", "config.yml");
	mkdirSync(dirname(path), { recursive: true });
	const created = !existsSync(path);
	let text = created ? "task:\n  isolation:\n    mode: auto\n    apply: false\n" : readFileSync(path, "utf8");
	text = ensureTopLevelScalar(text, "modelRoleStorage", "project");
	const defaults = fallbackRoleMap(cwd);
	text = ensureModelRoles(text, defaults);
	writeFileSync(path, text, "utf8");
	return { created, path, rolesBootstrapped: FOUNDRY_MODEL_ROLES.filter((role) => Boolean(defaults[role])) };
}

export function userConfigPath(): string {
	return join(homedir(), ".omp", "agent", "config.yml");
}

function missingRoleKeys(text: string): string[] {
	if (!text.trim()) return [...FOUNDRY_MODEL_ROLES];
	const block = topLevelBlock(text, "modelRoles");
	const present = new Set<string>();
	if (block) {
		for (let i = block.start + 1; i < block.end; i++) {
			const match = block.lines[i].match(/^\s{2}([A-Za-z0-9_.-]+):/);
			if (match) present.add(match[1]);
		}
	}
	return FOUNDRY_MODEL_ROLES.filter((role) => !present.has(role));
}

/**
 * Register the foundry_* roles at user level so they show up in /models
 * everywhere as soon as the plugin runs. Only missing keys are inserted,
 * as @aliases that follow the user's own roles; nothing existing is ever
 * modified or removed. This is the plugin's one deliberate global write.
 */
export function ensureGlobalFoundryRoles(options: { path?: string; roles?: Record<string, string> } = {}): {
	path: string;
	added: string[];
	values: Record<string, string>;
} {
	const path = options.path ?? userConfigPath();
	const before = existsSync(path) ? readFileSync(path, "utf8") : "";
	const added = missingRoleKeys(before);
	if (added.length === 0) {
		return { path, added: [], values: {} };
	}
	const aliases = aliasRoleMap(options.roles ?? effectiveRoles(process.cwd()));
	for (const role of FOUNDRY_MODEL_ROLES) if (!aliases[role]) aliases[role] = "@default";
	mkdirSync(dirname(path), { recursive: true });
	let text = before;
	text = ensureModelRoles(text, aliases);
	writeFileSync(path, text, "utf8");
	return { path, added, values: aliases };
}

export function ensureProjectIsolationConfig(cwd: string): { created: boolean; path: string } {
	const result = ensureProjectFoundryConfig(cwd);
	return { created: result.created, path: result.path };
}

export function checkFoundryProjectRoles(
	cwd: string,
	userConfig: string = userConfigPath(),
): { ok: boolean; missing: string[]; storageProject: boolean; reason?: string } {
	try {
		const path = join(cwd, ".omp", "config.yml");
		const text = readFileSync(path, "utf8");
		const storageProject = /^modelRoleStorage:\s*project\s*$/m.test(text);
		const block = topLevelBlock(text, "modelRoles");
		const present = new Set<string>();
		if (block) for (let i = block.start + 1; i < block.end; i++) {
			const match = block.lines[i].match(/^\s{2}([A-Za-z0-9_.-]+):\s*(\S.+)$/);
			if (match) present.add(match[1]);
		}
		// Roles registered at user level by ensureGlobalFoundryRoles count too:
		// project scope only needs to override them, not duplicate them.
		for (const role of missingRoleKeys(text)) {
			try {
				const globalText = readFileSync(userConfig, "utf8");
				const globalBlock = topLevelBlock(globalText, "modelRoles");
				if (globalBlock && new RegExp(`^\\s{2}${role}:\\s*\\S`, "m").test(globalBlock.lines.join("\n"))) present.add(role);
			} catch {
				break;
			}
		}
		const missing = FOUNDRY_MODEL_ROLES.filter((role) => !present.has(role));
		return { ok: storageProject && missing.length === 0, missing, storageProject, reason: storageProject && missing.length === 0 ? undefined : `FOUNDRY_MODEL_ROLES_REQUIRED: roles missing=${missing.join(",") || "none"} modelRoleStorage=${storageProject ? "project" : "not-project"}. Open /model Roles inside this project.` };
	} catch (error) {
		return { ok: false, missing: [...FOUNDRY_MODEL_ROLES], storageProject: false, reason: `FOUNDRY_PROJECT_CONFIG_ERROR: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function narrowFoundryGitignore(cwd: string): void {
	const path = join(cwd, ".gitignore");
	let text = "";
	try { text = readFileSync(path, "utf8"); } catch { /* absent */ }
	const lines = text.split(/\r?\n/).filter((line) => !/^\.omp\/?\s*$/.test(line));
	const required = [".omp/foundry-state.yml", ".omp/foundry-state.yml.*.tmp", ".omp/foundry-state.yml.pre-v*.bak", ".omp/company-state.yml", ".omp/company-state.yaml"];
	for (const line of required) if (!lines.includes(line)) lines.push(line);
	writeFileSync(path, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
}
