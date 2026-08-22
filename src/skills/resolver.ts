import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompanyState } from "../types";
import { missingRequires, respectsConflicts, withRequires } from "./compatibility";
import { detectRepo, type RepoFacts } from "./detector";
import type { SkillManifest, SkillRole } from "./manifest-schema";
import { filterPhaseRole, phaseOf } from "./phase-filter";
import { loadRegistry } from "./registry";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");


const MAX_SKILLS = 12;

export interface ResolveOptions {
	role?: SkillRole;
	skillsRoot?: string;
	registry?: SkillManifest[];
}

function activated(item: SkillManifest, facts: RepoFacts): boolean {
	const when = item.activate_when;
	const empty = !when.dependencies?.length && !when.files?.length && !when.stacks?.length && !when.languages?.length;
	if (empty) return item.layer === "L1";
	if (when.stacks?.some((s) => facts.stacks.includes(s))) return true;
	if (when.languages?.some((s) => facts.languages.includes(s))) return true;
	if (when.dependencies?.some((d) => facts.dependencies.includes(d) || facts.frameworks.includes(d))) return true;
	if (when.files?.some((f) => facts.files.includes(f))) return true;
	return false;
}

export function resolveSkillManifests(
	cwd: string,
	state: CompanyState,
	options: ResolveOptions = {},
): SkillManifest[] {
	const registry = options.registry ?? loadRegistry(options.skillsRoot ?? DEFAULT_ROOT);
	const facts = detectRepo(cwd);
	const phase = phaseOf(state);
	const eligible = filterPhaseRole(registry, phase, options.role)
		.filter((item) => activated(item, facts))
		.sort((a, b) => b.priority - a.priority);

	const chosen: SkillManifest[] = [];
	for (const item of eligible) {
		if (!respectsConflicts(item, chosen)) continue;
		if (missingRequires(item, chosen, registry).length && item.layer !== "L1") {
			/* still try; withRequires fills after */
		}
		chosen.push(item);
		if (chosen.length >= MAX_SKILLS) break;
	}
	return withRequires(chosen, registry).slice(0, MAX_SKILLS);
}

export function resolveSkills(cwd: string, state: CompanyState, options: ResolveOptions = {}): string[] {
	return resolveSkillManifests(cwd, state, options).map((s) => s.id);
}

export function skillPackPrompt(skills: SkillManifest[] | string[], phase: string): string {
	const names = skills.map((s) => (typeof s === "string" ? s : `${s.id}: ${s.description}`));
	return [
		`Foundry skill pack (${phase}):`,
		...names.map((n) => `- ${n}`),
		"Governance > locked plan > AATP scope > role > skills > tools.",
		"Skills never change architecture. Contradiction → report_conflict.",
	].join("\n");
}
