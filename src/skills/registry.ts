import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LAYERS, PHASES, ROLES, type SkillLayer, type SkillManifest, type SkillPhase, type SkillRole } from "./manifest-schema";

function csv(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.replace(/[\[\]]/g, "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
	const norm = text.replace(/\r\n/g, "\n");
	const match = norm.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
	if (!match) return { fields: {}, body: norm };
	const fields: Record<string, string> = {};
	let key = "";
	for (const line of match[1].split("\n")) {
		const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (kv) {
			key = kv[1];
			fields[key] = kv[2];
			continue;
		}
		const nested = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
		if (nested && key) fields[`${key}.${nested[1]}`] = nested[2];
	}
	return { fields, body: match[2].trim() };
}

const MAX_SKILL_FILES = 256;
const MAX_SKILL_DEPTH = 32;
const MAX_SKILL_BYTES = 512 * 1024;

function walk(dir: string, acc: string[], depth = 0): void {
	if (depth > MAX_SKILL_DEPTH || acc.length >= MAX_SKILL_FILES) return;
	let entries: import("node:fs").Dirent[] = [];
	try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
	for (const entry of entries) {
		if (entry.isSymbolicLink()) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, acc, depth + 1);
		else if (entry.isFile() && entry.name === "SKILL.md") acc.push(full);
		if (acc.length >= MAX_SKILL_FILES) return;
	}
}

export function parseManifest(path: string, text: string): SkillManifest | null {
	const { fields, body } = parseFrontmatter(text);
	const id = fields.id || fields.name;
	if (!id) return null;
	const layer = (fields.layer || "L2") as SkillLayer;
	if (!LAYERS.includes(layer)) return null;

	const rawPhases = csv(fields.phases);
	const rawRoles = csv(fields.roles);
	const phases = rawPhases.filter((p): p is SkillPhase => PHASES.includes(p as SkillPhase));
	const roles = rawRoles.filter((r): r is SkillRole => ROLES.includes(r as SkillRole));
	if (rawPhases.length !== phases.length || rawRoles.length !== roles.length) return null;

	return {
		id,
		version: Number(fields.version || 1) || 1,
		description: (fields.description || "").replace(/^["']|["']$/g, ""),
		layer,
		domain: csv(fields.domain),
		requires: csv(fields.requires),
		conflicts: csv(fields.conflicts),
		activate_when: {
			dependencies: csv(fields["activate_when.dependencies"] || fields.dependencies),
			files: csv(fields["activate_when.files"] || fields.files),
			stacks: csv(fields["activate_when.stacks"] || fields.stacks),
			languages: csv(fields["activate_when.languages"] || fields.languages),
		},
		roles: rawRoles.length ? roles : [...ROLES],
		phases: rawPhases.length ? phases : [...PHASES],
		priority: Number(fields.priority || 50) || 50,
		body,
		path,
	};
}

export function loadRegistry(root: string): SkillManifest[] {
	const files: string[] = [];
	walk(root, files);
	const out: SkillManifest[] = [];
	for (const file of files) {
		let text = "";
		try {
			const stat = lstatSync(file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SKILL_BYTES) continue;
			text = readFileSync(file, "utf8");
		} catch { continue; }
		const parsed = parseManifest(file, text);
		if (parsed) {
			if (parsed.layer !== "L1") {
				const when = parsed.activate_when;
				const empty = !when.dependencies?.length && !when.files?.length && !when.stacks?.length && !when.languages?.length;
				if (empty) console.warn(`[Foundry Skill Registry] Warning: ${parsed.id} (Layer ${parsed.layer}) has no activate_when conditions and will never auto-resolve.`);
			}
			out.push(parsed);
		}
	}
	return out;
}
