import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { CompanyState, ReviewVerdict, TicketStatus } from "./types";

export interface AatpSpec {
	id: string;
	objective: string;
	dependencies: string[];
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	recommended_agent: string;
	path: string;
}

export interface AatpTask extends AatpSpec {
	status: TicketStatus;
	review: ReviewVerdict;
}

function parseList(block: string, key: string): string[] {
	const match = block.match(new RegExp(`${key}:\\n((?:\\s+-\\s+.+\n?)+)`));
	if (!match) return [];
	return match[1]
		.split("\n")
		.map((line) => line.replace(/^\s+-\s+/, "").trim())
		.filter(Boolean);
}

function parseField(block: string, key: string): string {
	const match = block.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+)`));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

export function aatpDir(cwd: string): string {
	return join(cwd, "docs", "AATP");
}

export function listAatpSpecs(cwd: string): AatpSpec[] {
	const dir = aatpDir(cwd);
	if (!existsSync(dir)) return [];
	const tasks: AatpSpec[] = [];
	for (const file of readdirSync(dir).sort()) {
		if (!/^AATP-.*\.md$/i.test(file) || file.toUpperCase() === "INDEX.MD") continue;
		const path = join(dir, file);
		const text = readFileSync(path, "utf8");
		const fm = text.match(/^---\n([\s\S]*?)\n---/);
		const body = fm?.[1] ?? text;
		const id = (parseField(body, "id") || file.replace(/\.md$/i, "")).toUpperCase();
		tasks.push({
			id,
			objective: parseField(body, "objective"),
			dependencies: parseList(body, "dependencies").map((d) => d.toUpperCase()),
			allowed_files: parseList(body, "allowed_files"),
			forbidden_files: parseList(body, "forbidden_files"),
			risk: parseField(body, "risk") || "normal",
			recommended_agent: parseField(body, "recommended_agent") || parseField(body, "recommended_worker") || "implementer",
			path,
		});
	}
	return tasks;
}

export function validateAatpSpecs(specs: AatpSpec[]): string[] {
	const errors: string[] = [];
	const ids = new Set<string>();
	for (const spec of specs) {
		if (ids.has(spec.id)) errors.push(`duplicate id ${spec.id}`);
		ids.add(spec.id);
		if (!spec.objective) errors.push(`${spec.id}: objective missing`);
		if (spec.allowed_files.length === 0) errors.push(`${spec.id}: allowed_files must be explicit and non-empty`);
	}
	for (const spec of specs) {
		for (const dep of spec.dependencies) {
			if (dep && dep !== "NONE" && !ids.has(dep)) errors.push(`${spec.id}: unknown dependency ${dep}`);
		}
	}
	return errors;
}

export function aatpManifestHash(cwd: string): string {
	const specs = listAatpSpecs(cwd);
	if (specs.length === 0) return "";
	const hash = createHash("sha256");
	for (const spec of specs.sort((a, b) => a.id.localeCompare(b.id))) {
		hash.update(relative(cwd, spec.path).replace(/\\/g, "/").toLowerCase());
		hash.update("\0");
		hash.update(readFileSync(spec.path));
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function hydrateAatp(cwd: string, state: CompanyState): AatpTask[] {
	return listAatpSpecs(cwd).map((spec) => {
		const ticket = state.tickets[spec.id];
		return { ...spec, status: ticket?.status ?? "ready", review: ticket?.review ?? "none" };
	});
}

export function readyIndependent(tasks: AatpTask[]): AatpTask[] {
	const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
	return tasks.filter((task) => task.status === "ready" && task.dependencies.every((dep) => done.has(dep) || dep === "NONE" || dep === ""));
}

export function summarizeAatp(tasks: AatpTask[]) {
	return {
		total: tasks.length,
		ready: tasks.filter((t) => t.status === "ready").length,
		active: tasks.filter((t) => t.status === "active").length,
		completed: tasks.filter((t) => t.status === "completed").length,
		blocked: tasks.filter((t) => t.status === "blocked").length,
	};
}

export function writeAatpIndex(cwd: string, tasks: AatpTask[]): void {
	const dir = aatpDir(cwd);
	mkdirSync(dir, { recursive: true });
	const lines = [
		"# AATP index", "", "| id | status | review | risk | agent | deps | objective |", "| --- | --- | --- | --- | --- | --- | --- |",
		...tasks.map((t) => `| ${t.id} | ${t.status} | ${t.review} | ${t.risk} | ${t.recommended_agent} | ${t.dependencies.join(", ") || "none"} | ${t.objective.replace(/\|/g, "/")} |`), "",
	];
	writeFileSync(join(dir, "INDEX.md"), lines.join("\n"), "utf8");
}

export function routeAgent(risk: string): string {
	const r = risk.toLowerCase();
	if (r === "trivial" || r === "low") return "smol-implementer";
	if (r === "difficult" || r === "hard" || r === "critical") return "hard-implementer";
	return "implementer";
}

export function seedTickets(state: CompanyState, specs: AatpSpec[]): void {
	const valid = new Set(specs.map((s) => s.id));
	for (const id of Object.keys(state.tickets)) if (!valid.has(id)) delete state.tickets[id];
	for (const spec of specs) {
		const ticket = state.tickets[spec.id] ?? { id: spec.id, status: "ready" as const, allowed_files: spec.allowed_files, forbidden_files: spec.forbidden_files, risk: spec.risk, review: "none" as const };
		ticket.allowed_files = spec.allowed_files;
		ticket.forbidden_files = spec.forbidden_files;
		ticket.risk = spec.risk;
		state.tickets[spec.id] = ticket;
	}
}

export type TransitionResult = { ok: true; ticket: CompanyState["tickets"][string] } | { ok: false; reason: string };

export function beginTicket(state: CompanyState, spec: AatpSpec | undefined, id: string, agent?: string): TransitionResult {
	const existing = state.tickets[id];
	if (!existing && !spec) return { ok: false, reason: `Unknown ticket ${id}. No spec found under docs/AATP.` };
	for (const dep of spec?.dependencies ?? []) {
		if (dep === "NONE" || dep === "") continue;
		const depTicket = state.tickets[dep];
		if (!depTicket) return { ok: false, reason: `DEPENDENCY_CONFLICT: ${id} depends on unknown ticket ${dep}.` };
		if (depTicket.status !== "completed") return { ok: false, reason: `DEPENDENCY_CONFLICT: ${dep} is ${depTicket.status}.` };
	}
	const ticket = existing ?? { id, status: "ready" as const, allowed_files: spec?.allowed_files ?? [], forbidden_files: spec?.forbidden_files ?? [], risk: spec?.risk ?? "normal", review: "none" as const };
	if (ticket.status !== "ready") return { ok: false, reason: `${id} is ${ticket.status}; only ready tickets can begin.` };
	ticket.status = "active";
	ticket.agent = agent;
	ticket.review = "none";
	ticket.review_by = undefined;
	ticket.review_evidence_sha256 = undefined;
	if (spec) { ticket.allowed_files = spec.allowed_files; ticket.forbidden_files = spec.forbidden_files; ticket.risk = spec.risk; }
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export function completeTicket(state: CompanyState, id: string, evidenceSha?: string): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	if (ticket.status !== "active") return { ok: false, reason: `${id} is ${ticket.status}; only active tickets can complete.` };
	ticket.status = "completed";
	ticket.implementation_evidence_sha256 = evidenceSha;
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export function resetTicket(state: CompanyState, id: string): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	ticket.status = "ready";
	ticket.review = "none";
	ticket.review_by = undefined;
	ticket.review_evidence_sha256 = undefined;
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export function blockTicket(state: CompanyState, id: string, reason: string): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	ticket.status = "blocked";
	ticket.review = "BLOCK";
	state.tickets[id] = ticket;
	state.conflict = { kind: "SCOPE_INSUFFICIENT", reason };
	return { ok: true, ticket };
}

export function reviewTicket(state: CompanyState, id: string, verdict: Exclude<ReviewVerdict, "none">, reviewer = "reviewer", evidenceSha?: string): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	if (ticket.status !== "completed") return { ok: false, reason: `${id} is ${ticket.status}; review requires completed.` };
	ticket.review = verdict;
	ticket.review_by = reviewer;
	ticket.review_evidence_sha256 = evidenceSha;
	if (verdict === "REQUEST_CHANGES") ticket.status = "ready";
	if (verdict === "BLOCK") ticket.status = "blocked";
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export function resetAatp(state: CompanyState): void {
	state.tickets = {};
	state.aatp = { total: 0, ready: 0, active: 0, completed: 0, blocked: 0, manifest_sha256: "" };
}
