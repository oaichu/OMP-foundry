import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { safeRepoPath } from "./paths";
import { trustedExecutable } from "./verify-runner";

export interface IsolationContract {
	ok: boolean;
	mode?: string;
	apply?: boolean;
	reason?: string;
}

/** Values accepted by OMP's isolation resolver, including documented legacy aliases. */
export const ISOLATION_MODES = new Set([
	"none", "auto", "apfs", "btrfs", "zfs", "reflink", "overlayfs", "projfs", "block-clone", "rcopy",
	"worktree", "fuse-overlay", "fuse-projfs",
]);

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
const MAX_CONFIG_BYTES = 512 * 1024;

function atomicConfigWrite(path: string, text: string): void {
	const temp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, text, { encoding: "utf8", flag: "wx" });
		renameSync(temp, path);
	} catch (error) {
		try { unlinkSync(temp); } catch { /* best effort cleanup */ }
		throw error;
	}
}

function readBoundedConfig(path: string): string {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${path} must be a regular, non-symlink file`);
	if (stat.size > MAX_CONFIG_BYTES) throw new Error(`${path} exceeds the ${MAX_CONFIG_BYTES}-byte limit`);
	return readFileSync(path, "utf8");
}

function readJsonSetting(cwd: string, key: string): unknown {
	const omp = trustedExecutable(cwd, "omp");
	if (!omp) throw new Error("OMP executable is not trusted or not available outside the repository");
	const result = spawnSync(omp, ["config", "get", key, "--json"], { cwd, encoding: "utf8", timeout: 5000, maxBuffer: 128 * 1024, shell: false });
	if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || result.stdout.trim() || `omp config get ${key} failed`);
	const parsed = JSON.parse(result.stdout) as { value?: unknown };
	return parsed.value;
}

/** Read the repository-owned isolation overlay before asking OMP for its
 * effective global setting. OMP's `config get` command in older hosts only
 * reports user settings, even though the agent runtime honors `.omp/config.yml`.
 */
function projectIsolationSetting(cwd: string, key: "mode" | "apply"): string | undefined {
	try {
		const path = safeRepoPath(cwd, ".omp/config.yml");
		if (!path) return undefined;
		const text = readBoundedConfig(path).replace(/\r\n/g, "\n");
		const task = topLevelBlock(text, "task");
		if (!task) return undefined;
		const isolation = task.lines.findIndex((line, index) => index > task.start && index < task.end && /^\s*isolation:\s*$/.test(line));
		if (isolation < 0) return undefined;
		const isolationIndent = task.lines[isolation].match(/^\s*/)?.[0].length ?? 0;
		for (let index = isolation + 1; index < task.end; index += 1) {
			const line = task.lines[index];
			if (line.trim() && (line.match(/^\s*/)?.[0].length ?? 0) <= isolationIndent) break;
			const match = line.match(new RegExp(`^\\s+${key}:\\s*(.+?)\\s*$`));
			if (match) return match[1].replace(/^['"]|['"]$/g, "");
		}
		return undefined;
	} catch { return undefined; }
}

export function validateIsolationSettings(mode: string, apply: boolean): IsolationContract {
	const normalized = mode.trim().toLowerCase();
	if (!ISOLATION_MODES.has(normalized)) return { ok: false, mode, apply, reason: `FOUNDRY_ISOLATION_INVALID: unsupported task.isolation.mode ${mode || "(empty)"}.` };
	if (normalized === "none") return { ok: false, mode: normalized, apply, reason: 'FOUNDRY_ISOLATION_REQUIRED: set task.isolation.mode to "auto" (or another supported isolation backend).' };
	if (apply) return { ok: false, mode: normalized, apply, reason: "FOUNDRY_APPLY_REQUIRED_FALSE: set task.isolation.apply=false so Foundry validates patches before merge." };
	return { ok: true, mode: normalized, apply };
}

export function checkIsolationContract(cwd: string): IsolationContract {
	try {
		const projectMode = projectIsolationSetting(cwd, "mode");
		const projectApply = projectIsolationSetting(cwd, "apply");
		const mode = String(projectMode ?? readJsonSetting(cwd, "task.isolation.mode") ?? "none");
		const rawApply = projectApply ?? readJsonSetting(cwd, "task.isolation.apply");
		const apply = rawApply === true || rawApply === "true";
		return validateIsolationSettings(mode, apply);
	} catch (error) {
		return { ok: false, reason: `FOUNDRY_OMP_CONFIG_ERROR: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function aliasRoleMap(roles: Record<string, string>): Record<(typeof FOUNDRY_MODEL_ROLES)[number], string> {
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

function nestedIndent(block: { start: number; lines: string[] }): number {
	const headerIndent = block.lines[block.start].match(/^\s*/)?.[0].length ?? 0;
	for (let i = block.start + 1; i < block.lines.length; i += 1) {
		const line = block.lines[i];
		if (!line.trim() || /^\s*#/.test(line)) continue;
		const indent = line.match(/^\s*/)?.[0].length ?? 0;
		if (indent <= headerIndent) break;
		return indent;
	}
	return headerIndent + 2;
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

function formatRoleValue(value: string): string {
	return value.startsWith("@") ? `"${value}"` : value;
}

function ensureModelRoles(text: string, defaults: Record<string, string>): string {
	const block = topLevelBlock(text, "modelRoles");
	if (!block) {
		const lines = text.replace(/\r\n/g, "\n").split("\n");
		while (lines.length && !lines[lines.length - 1]) lines.pop();
		lines.push("modelRoles:");
		for (const role of FOUNDRY_MODEL_ROLES) if (defaults[role]) lines.push(`  ${role}: ${formatRoleValue(defaults[role])}`);
		return `${lines.join("\n")}\n`;
	}
	const existing = new Set<string>();
	const indent = nestedIndent(block);
	const roleRe = new RegExp(`^\\s{${indent}}([A-Za-z0-9_.-]+):`);
	for (let i = block.start + 1; i < block.end; i += 1) {
		const match = block.lines[i].match(roleRe);
		if (match) existing.add(match[1]);
	}
	const padding = " ".repeat(indent);
	const inserts = FOUNDRY_MODEL_ROLES.filter((role) => !existing.has(role) && defaults[role]).map((role) => `${padding}${role}: ${formatRoleValue(defaults[role])}`);
	if (!inserts.length) return text.endsWith("\n") ? text : `${text}\n`;
	block.lines.splice(block.end, 0, ...inserts);
	return `${block.lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** Project config owns isolation/storage policy; model choices inherit global foundry_* roles unless explicitly overridden. */
export function ensureProjectFoundryConfig(cwd: string): { created: boolean; path: string } {
	const path = safeRepoPath(cwd, ".omp/config.yml");
	if (!path) throw new Error("PATH_GATE: refusing project OMP config through a symlink or outside the repository.");
	mkdirSync(dirname(path), { recursive: true });
	let created = false;
	let text = "task:\n  isolation:\n    mode: auto\n    apply: false\n";
	try { text = readBoundedConfig(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; created = true; }
	const next = ensureTopLevelScalar(text, "modelRoleStorage", "project");
	if (next !== text) atomicConfigWrite(path, next);
	return { created, path };
}

export function userConfigPath(): string {
	return join(homedir(), ".omp", "agent", "config.yml");
}

function roleKeys(text: string): Set<string> {
	const present = new Set<string>();
	const block = topLevelBlock(text, "modelRoles");
	if (block) {
		const indent = nestedIndent(block), roleRe = new RegExp(`^\\s{${indent}}([A-Za-z0-9_.-]+):\\s*(\\S.+)$`);
		for (let i = block.start + 1; i < block.end; i += 1) {
			const match = block.lines[i].match(roleRe);
			if (match) present.add(match[1]);
		}
	}
	return present;
}

function missingRoleKeys(text: string): string[] {
	const present = roleKeys(text);
	return FOUNDRY_MODEL_ROLES.filter((role) => !present.has(role));
}

function globalRoleMap(text: string): Record<string, string> {
	const block = topLevelBlock(text, "modelRoles"), out: Record<string, string> = {};
	if (!block) return out;
	const indent = nestedIndent(block), roleRe = new RegExp(`^\\s{${indent}}([A-Za-z0-9_.-]+):\\s*(\\S.+)$`);
	for (let i = block.start + 1; i < block.end; i += 1) {
		const match = block.lines[i].match(roleRe);
		if (match) out[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
	}
	return out;
}

/** Register global Foundry role defaults once; existing user choices are never overwritten. */
export function ensureGlobalFoundryRoles(options: { path?: string; roles?: Record<string, string> } = {}): {
	path: string;
	added: string[];
	values: Record<string, string>;
} {
	const path = options.path ?? userConfigPath();
	let before = "";
	try { before = readBoundedConfig(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const added = missingRoleKeys(before);
	if (added.length === 0) return { path, added: [], values: {} };
	// Derive aliases from the user-wide config only. A project must never be
	// able to influence a write to ~/.omp/agent/config.yml.
	const aliases = aliasRoleMap(options.roles ?? globalRoleMap(before));
	for (const role of FOUNDRY_MODEL_ROLES) if (!aliases[role]) aliases[role] = "@default";
	mkdirSync(dirname(path), { recursive: true });
	const text = ensureModelRoles(before, aliases);
	atomicConfigWrite(path, text);
	return { path, added, values: aliases };
}

export function checkFoundryProjectRoles(
	cwd: string,
	userConfig: string = userConfigPath(),
): { ok: boolean; missing: string[]; storageProject: boolean; reason?: string } {
	try {
		const projectPath = safeRepoPath(cwd, ".omp/config.yml");
		if (!projectPath) throw new Error("PATH_GATE: refusing .omp/config.yml through a symlink or outside the repository.");
		const projectText = readBoundedConfig(projectPath);
		const storageProject = /^modelRoleStorage:\s*project\s*$/m.test(projectText);
		const present = roleKeys(projectText);
		try {
			const globalText = readBoundedConfig(userConfig);
			for (const role of roleKeys(globalText)) present.add(role);
		} catch {
			/* missing user config is handled by the missing-role result */
		}
		const missing = FOUNDRY_MODEL_ROLES.filter((role) => !present.has(role));
		return {
			ok: storageProject && missing.length === 0,
			missing,
			storageProject,
			reason: storageProject && missing.length === 0 ? undefined : `FOUNDRY_MODEL_ROLES_REQUIRED: roles missing=${missing.join(",") || "none"} modelRoleStorage=${storageProject ? "project" : "not-project"}. Configure modelRoles in ~/.omp/agent/config.yml or this project's .omp/config.yml.`,
		};
	} catch (error) {
		return { ok: false, missing: [...FOUNDRY_MODEL_ROLES], storageProject: false, reason: `FOUNDRY_PROJECT_CONFIG_ERROR: ${error instanceof Error ? error.message : String(error)}` };
	}
}

export function narrowFoundryGitignore(cwd: string): void {
	const path = safeRepoPath(cwd, ".gitignore");
	if (!path) throw new Error("PATH_GATE: refusing .gitignore through a symlink or outside the repository.");
	let text = "";
	try { text = readBoundedConfig(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
	const lines = text.split(/\r?\n/).filter((line) => !/^\.omp\/?\s*$/.test(line));
	const required = [".omp/foundry-state.yml", ".omp/foundry-state.yml.*.tmp", ".omp/foundry-state.yml.pre-v*.bak", ".omp/company-state.yml", ".omp/company-state.yaml"];
	for (const line of required) if (!lines.includes(line)) lines.push(line);
	const next = `${lines.filter(Boolean).join("\n")}\n`;
	if (next !== text) atomicConfigWrite(path, next);
}
