import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { detectStack } from "../stack-detector";
import type { CompanyState } from "../types";
import { CATALOG, type FoundryPhase, type SkillNode } from "./catalog";

function phaseOf(state: CompanyState): FoundryPhase {
	if (state.phase === "design") return "design";
	if (state.phase === "review") return "review";
	if (state.phase === "qa" || state.phase === "release") return "qa";
	if (state.phase === "implementation" || state.phase === "aatp") return "implementation";
	return "planning";
}

function depNames(cwd: string): string[] {
	try {
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
	} catch {
		return [];
	}
}

function matches(node: SkillNode, cwd: string, stacks: string[], deps: string[]): boolean {
	const when = node.activate_when;
	if (!when.files && !when.dependencies && !when.stacks) return true;
	if (when.stacks?.some((s) => stacks.includes(s))) return true;
	if (when.dependencies?.some((d) => deps.includes(d))) return true;
	if (when.files?.some((f) => existsSync(join(cwd, f)))) return true;
	return false;
}

export function resolveSkills(cwd: string, state: CompanyState): string[] {
	const stacks = detectStack(cwd).ids;
	const deps = depNames(cwd);
	const phase = phaseOf(state);
	const chosen: SkillNode[] = [];
	for (const node of [...CATALOG].sort((a, b) => b.priority - a.priority)) {
		if (!node.phases.includes(phase)) continue;
		if (!matches(node, cwd, stacks, deps)) continue;
		if (node.conflicts.some((c) => chosen.some((x) => x.id === c))) continue;
		if (node.requires.some((r) => !chosen.some((x) => x.id === r) && !CATALOG.some((x) => x.id === r))) continue;
		chosen.push(node);
		if (chosen.length >= 12) break;
	}
	return chosen.map((n) => n.id);
}

export function skillPackPrompt(skills: string[], phase: string): string {
	return [
		`Foundry skill pack (${phase}): ${skills.join(", ") || "(core only)"}.`,
		"Skills inform, implement, verify, or challenge the locked plan.",
		"Skills never change architecture. If a skill contradicts MASTER_PLAN → report_conflict.",
	].join(" ");
}
