import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listAatpSpecs } from "../aatp";
import type { CompanyState } from "../types";
import { respectsConflicts, withRequires } from "./compatibility";
import { detectRepo, type RepoFacts } from "./detector";
import type { SkillManifest, SkillRole } from "./manifest-schema";
import { filterPhaseRole, phaseOf } from "./phase-filter";
import { loadRegistry } from "./registry";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");
const MAX_SKILLS = 12;
const STRONG_CONTEXT_SCORE = 14;
const MIN_RELEVANT_CONTEXT_SCORE = 6;
const STOP_WORDS = new Set([
	"a", "an", "and", "are", "as", "at", "be", "before", "by", "code", "for", "from", "in", "into", "is", "it", "of", "on", "or", "the", "this", "to", "with",
	"engineer", "engineering", "implementation", "implementer", "review", "reviewer", "planning", "planner", "skill", "rules", "project", "application", "app",
]);

export interface SkillRoutingContext {
	objective?: string;
	files?: string[];
	concerns?: string[];
	securitySensitive?: boolean;
}

export interface ResolveOptions {
	role?: SkillRole;
	skillsRoot?: string;
	registry?: SkillManifest[];
	context?: SkillRoutingContext;
}

export interface SkillRoutingScore {
	id: string;
	score: number;
	repoEvidence: number;
	contextEvidence: number;
	contextCost: number;
	selected: boolean;
	reasons: string[];
}

export interface SkillRoutingResolution {
	skills: SkillManifest[];
	scores: SkillRoutingScore[];
	context?: SkillRoutingContext;
}

function tokens(text: string): Set<string> {
	const values = text.toLowerCase().split(/[^a-z0-9@._/-]+/g)
		.flatMap((value) => value.split(/[./_-]+/g))
		.map((value) => value.trim())
		.filter((value) => value.length >= 2 && !STOP_WORDS.has(value));
	return new Set(values);
}

function contextTokens(context: SkillRoutingContext | undefined): Set<string> {
	if (!context) return new Set();
	return tokens([context.objective ?? "", ...(context.files ?? []), ...(context.concerns ?? [])].join(" "));
}

function skillTokens(item: SkillManifest): Set<string> {
	const activation = [
		...(item.activate_when.dependencies ?? []),
		...(item.activate_when.files ?? []),
		...(item.activate_when.stacks ?? []),
		...(item.activate_when.languages ?? []),
	].join(" ");
	// Routing vocabulary is intentionally metadata-only. Skill bodies contain
	// broad prose (for example "ownership" or "policy") that creates false
	// cross-domain matches; bodies affect context cost, never relevance.
	return tokens([item.id, item.domain.join(" "), item.description, activation].join(" "));
}

function repoScore(item: SkillManifest, facts: RepoFacts, reasons: string[]): number {
	const when = item.activate_when;
	const empty = !when.dependencies?.length && !when.files?.length && !when.stacks?.length && !when.languages?.length;
	let score = 0;
	if (empty && item.layer === "L1") { score += 20; reasons.push("+20 core L1"); }
	const dependencies = when.dependencies?.filter((value) => facts.dependencies.includes(value) || facts.frameworks.includes(value)) ?? [];
	const stacks = when.stacks?.filter((value) => facts.stacks.includes(value)) ?? [];
	const languages = when.languages?.filter((value) => facts.languages.includes(value)) ?? [];
	const files = when.files?.filter((value) => facts.files.includes(value)) ?? [];
	if (dependencies.length) { const value = Math.min(28, 20 + (dependencies.length - 1) * 4); score += value; reasons.push(`+${value} dependency:${dependencies.join(",")}`); }
	if (stacks.length) { const value = Math.min(20, 14 + (stacks.length - 1) * 3); score += value; reasons.push(`+${value} stack:${stacks.join(",")}`); }
	if (languages.length) { const value = Math.min(16, 11 + (languages.length - 1) * 2); score += value; reasons.push(`+${value} language:${languages.join(",")}`); }
	if (files.length) { const value = Math.min(18, 13 + (files.length - 1) * 2); score += value; reasons.push(`+${value} marker:${files.join(",")}`); }
	return score;
}

function concernScore(item: SkillManifest, context: SkillRoutingContext, reasons: string[]): number {
	const concerns = (context.concerns ?? []).map((value) => value.toUpperCase());
	const domains = new Set(item.domain.map((value) => value.toLowerCase()));
	const id = item.id.toLowerCase();
	let score = 0;
	if (context.securitySensitive && (domains.has("security") || id.includes("security"))) { score += 40; reasons.push("+40 security-sensitive"); }
	if (concerns.some((value) => value.startsWith("SEC-")) && (domains.has("security") || id.includes("security"))) { score += 30; reasons.push("+30 SEC concern"); }
	if (concerns.some((value) => value.startsWith("DES-")) && (domains.has("design") || id.includes("design"))) { score += 26; reasons.push("+26 DES concern"); }
	if (concerns.some((value) => value.startsWith("ARCH-")) && id === "architecture") { score += 24; reasons.push("+24 ARCH concern"); }
	if (concerns.some((value) => value.startsWith("OPS-")) && (domains.has("cloud") || id.includes("devops") || id === "performance")) { score += 20; reasons.push("+20 OPS concern"); }
	return score;
}

function taskScore(item: SkillManifest, context: SkillRoutingContext | undefined, reasons: string[]): number {
	if (!context) return 0;
	const task = contextTokens(context);
	if (!task.size) return concernScore(item, context, reasons);
	const vocab = skillTokens(item);
	const idParts = [...tokens(item.id)].filter((value) => value !== "engineering");
	let score = concernScore(item, context, reasons);
	const directIdHits = idParts.filter((value) => task.has(value));
	if (directIdHits.length) { const value = Math.min(32, directIdHits.length * 22); score += value; reasons.push(`+${value} task-id:${directIdHits.join(",")}`); }
	const domainHits = item.domain.map((value) => value.toLowerCase()).filter((value) => task.has(value));
	if (domainHits.length) { const value = Math.min(18, domainHits.length * 12); score += value; reasons.push(`+${value} task-domain:${domainHits.join(",")}`); }
	const semanticHits = [...task].filter((value) => vocab.has(value) && !directIdHits.includes(value) && !domainHits.includes(value)).slice(0, 4);
	if (semanticHits.length) { const value = semanticHits.length * 3; score += value; reasons.push(`+${value} task-term:${semanticHits.join(",")}`); }
	return score;
}

function contextCost(item: SkillManifest): number {
	return Math.min(8, Math.max(1, Math.ceil(item.body.length / 450)));
}

function inferContext(cwd: string, state: CompanyState, role: SkillRole | undefined): SkillRoutingContext | undefined {
	if (role !== "implementer" && role !== "reviewer") return undefined;
	const tickets = Object.values(state.tickets).filter((ticket) => role === "implementer"
		? ticket.status === "active"
		: ticket.status === "completed" && ticket.review !== "APPROVE");
	if (!tickets.length) return undefined;
	let specs: ReturnType<typeof listAatpSpecs> = [];
	try { specs = listAatpSpecs(cwd); } catch { return undefined; }
	const ids = new Set(tickets.map((ticket) => ticket.id.toUpperCase()));
	const active = specs.filter((spec) => ids.has(spec.id.toUpperCase()));
	if (!active.length) return undefined;
	return {
		objective: active.map((spec) => `${spec.id}: ${spec.objective}`).join("\n"),
		files: [...new Set(active.flatMap((spec) => spec.allowed_files))],
		concerns: [...new Set(active.flatMap((spec) => spec.covers ?? []))],
		securitySensitive: active.some((spec) => spec.security_sensitive === true),
	};
}

function candidateScores(registry: SkillManifest[], facts: RepoFacts, context: SkillRoutingContext | undefined, phase: ReturnType<typeof phaseOf>, role: SkillRole | undefined): Array<{ item: SkillManifest; score: SkillRoutingScore }> {
	const phaseEligible = filterPhaseRole(registry, phase, role);
	const rows = phaseEligible.map((item) => {
		const reasons: string[] = [];
		const repoEvidence = repoScore(item, facts, reasons);
		const contextEvidence = taskScore(item, context, reasons);
		const cost = contextCost(item);
		const priority = item.priority / 12;
		const total = repoEvidence + contextEvidence + priority - cost;
		reasons.push(`+${priority.toFixed(1)} priority`, `-${cost} context-cost`);
		return { item, score: { id: item.id, score: total, repoEvidence, contextEvidence, contextCost: cost, selected: false, reasons } };
	});
	const strongestContext = Math.max(0, ...rows.filter(({ item }) => item.layer !== "L1").map(({ score }) => score.contextEvidence));
	return rows.filter(({ item, score }) => {
		if (item.layer === "L1") return score.repoEvidence > 0 || score.contextEvidence > 0;
		if (score.repoEvidence === 0 && score.contextEvidence < MIN_RELEVANT_CONTEXT_SCORE) return false;
		// Strong governed task evidence switches non-core routing from repo-wide
		// presence to task relevance. Required companions remain safe because
		// withRequires expands them after ranking.
		if (context && strongestContext >= STRONG_CONTEXT_SCORE && score.contextEvidence < MIN_RELEVANT_CONTEXT_SCORE) return false;
		return true;
	});
}

export function resolveSkillRouting(cwd: string, state: CompanyState, options: ResolveOptions = {}): SkillRoutingResolution {
	const registry = options.registry ?? loadRegistry(options.skillsRoot ?? DEFAULT_ROOT);
	const facts = detectRepo(cwd);
	const phase = phaseOf(state);
	const context = options.context ?? inferContext(cwd, state, options.role);
	const ranked = candidateScores(registry, facts, context, phase, options.role)
		.sort((a, b) => b.score.score - a.score.score || b.item.priority - a.item.priority || a.item.id.localeCompare(b.item.id));
	const chosen: SkillManifest[] = [];
	for (const row of ranked) {
		if (!respectsConflicts(row.item, chosen)) continue;
		chosen.push(row.item);
		if (chosen.length >= MAX_SKILLS) break;
	}
	const skills = withRequires(chosen, registry);
	const selected = new Set(skills.map((item) => item.id));
	const scoreById = new Map(ranked.map((row) => [row.item.id, row.score]));
	const scores: SkillRoutingScore[] = ranked.map((row) => ({ ...row.score, selected: selected.has(row.item.id) }));
	for (const item of skills) {
		if (!scoreById.has(item.id)) scores.push({ id: item.id, score: 0, repoEvidence: 0, contextEvidence: 0, contextCost: contextCost(item), selected: true, reasons: ["required companion"] });
	}
	return { skills, scores, ...(context ? { context } : {}) };
}

export function resolveSkillManifests(cwd: string, state: CompanyState, options: ResolveOptions = {}): SkillManifest[] {
	return resolveSkillRouting(cwd, state, options).skills;
}

export function resolveSkills(cwd: string, state: CompanyState, options: ResolveOptions = {}): string[] {
	return resolveSkillManifests(cwd, state, options).map((s) => s.id);
}

export function skillPackPrompt(skills: SkillManifest[] | string[], phase: string): string {
	const manifests = skills.filter((s): s is SkillManifest => typeof s !== "string");
	const names = skills.map((s) => (typeof s === "string" ? s : `${s.id}: ${s.description}`));
	const bodies = manifests.slice(0, 3).map((s) => {
		const body = s.body.length > 800 ? `${s.body.slice(0, 800)}\n…` : s.body;
		return `### ${s.id}\n${body}`;
	});
	return [
		`Foundry skill pack (${phase}):`,
		...names.map((n) => `- ${n}`),
		"Governance > locked plan > AATP scope > role > skills > tools.",
		"Precedence: Foundry governance/scope > functional correctness/security > accessibility/semantic interaction > framework/component contracts > web interface quality > visual art direction.",
		"A skill cannot override a locked artifact, AATP scope, security requirement, accessibility contract, or component contract.",
		"Skills never change architecture. Contradiction → report_conflict.",
		"More bodies: foundry_skill_read({ ids }).",
		...bodies,
	].join("\n");
}
