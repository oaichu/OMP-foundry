import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type AatpTicket,
	ARTIFACT_STATUSES,
	type ArtifactStatus,
	CONFLICT_KINDS,
	type CompanyState,
	type ConflictKind,
	type HumanCap,
	PHASES,
	type Phase,
	QA_STATUSES,
	type QaStatus,
	STATE_PATHS,
	STATE_REL,
	TICKET_STATUSES,
	type TicketStatus,
	CAP_TTL_MS,
	defaultState,
} from "./types";

export class StateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StateError";
	}
}

function pick(block: string, key: string): string | undefined {
	const match = block.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.*)`));
	if (!match) return undefined;
	return match[1].trim().replace(/^["']|["']$/g, "");
}

function pickBlock(yaml: string, name: string): string {
	const match = yaml.match(new RegExp(`(?:^|\\n)${name}:\\n([\\s\\S]*?)(?=\\n[a-z_]+:|$)`));
	return match?.[1] ?? "";
}

function mustEnum<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T {
	if (!value || !allowed.includes(value as T)) {
		throw new StateError(`invalid ${field}: ${value ?? "(missing)"}`);
	}
	return value as T;
}

function csv(value: string | undefined): string[] {
	if (!value || value === "[]") return [];
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

function parseTickets(yaml: string): Record<string, AatpTicket> {
	const block = pickBlock(yaml, "tickets");
	if (!block.trim() || block.trim() === "{}") return {};
	const tickets: Record<string, AatpTicket> = {};
	const chunks = block.split(/\n(?=\s{2}[A-Za-z0-9_-]+:)/);
	for (const chunk of chunks) {
		const idMatch = chunk.match(/^\s{2}([A-Za-z0-9_-]+):/);
		if (!idMatch) continue;
		const id = idMatch[1];
		tickets[id] = {
			id,
			status: mustEnum(pick(chunk, "status"), TICKET_STATUSES, `tickets.${id}.status`),
			allowed_files: csv(pick(chunk, "allowed_files")),
			forbidden_files: csv(pick(chunk, "forbidden_files")),
			risk: pick(chunk, "risk") || "normal",
			agent: pick(chunk, "agent") || undefined,
			review: (pick(chunk, "review") as AatpTicket["review"]) || "none",
		};
	}
	return tickets;
}

export function parseState(yaml: string): CompanyState {
	if (!yaml.trim()) throw new StateError("empty state");
	const base = defaultState();
	base.phase = mustEnum(pick(yaml, "phase"), PHASES, "phase");
	const product = pickBlock(yaml, "product");
	const plan = pickBlock(yaml, "master_plan");
	const design = pickBlock(yaml, "design");
	const aatp = pickBlock(yaml, "aatp");
	const qa = pickBlock(yaml, "qa");
	const release = pickBlock(yaml, "release");
	const conflict = pickBlock(yaml, "conflict");
	base.product.status = mustEnum(pick(product, "status"), ARTIFACT_STATUSES, "product.status");
	base.product.sha256 = pick(product, "sha256") ?? "";
	base.master_plan.status = mustEnum(pick(plan, "status"), ARTIFACT_STATUSES, "master_plan.status");
	base.master_plan.version = pick(plan, "version") || "0";
	base.master_plan.sha256 = pick(plan, "sha256") ?? "";
	const dReq = pick(design, "required");
	if (dReq !== "true" && dReq !== "false") throw new StateError("invalid design.required");
	base.design.required = dReq === "true";
	base.design.status = mustEnum(pick(design, "status"), ARTIFACT_STATUSES, "design.status");
	base.design.version = pick(design, "version") || "0";
	base.design.sha256 = pick(design, "sha256") ?? "";
	base.tickets = parseTickets(yaml);
	for (const key of ["total", "ready", "active", "completed", "blocked"] as const) {
		const raw = pick(aatp, key);
		if (raw !== undefined && raw !== "") {
			const n = Number(raw);
			if (!Number.isFinite(n)) throw new StateError(`invalid aatp.${key}`);
			base.aatp[key] = n;
		}
	}
	base.qa.status = mustEnum(pick(qa, "status") ?? "pending", QA_STATUSES, "qa.status");
	base.qa.tree_sha = pick(qa, "tree_sha") ?? "";
	base.release.ready = pick(release, "ready") === "true";
	base.release.tree_sha = pick(release, "tree_sha") ?? "";
	base.unlock_token = pick(yaml, "unlock_token") ?? "";
	base.conflict.kind = mustEnum(pick(conflict, "kind") ?? "none", CONFLICT_KINDS, "conflict.kind");
	base.conflict.reason = pick(conflict, "reason") ?? "";
	return base;
}

function serializeTickets(tickets: Record<string, AatpTicket>): string[] {
	const ids = Object.keys(tickets);
	if (ids.length === 0) return ["tickets: {}"];
	const lines = ["tickets:"];
	for (const id of ids) {
		const t = tickets[id];
		lines.push(`  ${id}:`);
		lines.push(`    status: ${t.status}`);
		lines.push(`    allowed_files: ${t.allowed_files.join(",")}`);
		lines.push(`    forbidden_files: ${t.forbidden_files.join(",")}`);
		lines.push(`    risk: ${t.risk}`);
		if (t.agent) lines.push(`    agent: ${t.agent}`);
		lines.push(`    review: ${t.review ?? "none"}`);
	}
	return lines;
}

export function serializeState(state: CompanyState): string {
	return [
		`phase: ${state.phase}`,
		`product:`,
		`  status: ${state.product.status}`,
		`  sha256: "${state.product.sha256}"`,
		`master_plan:`,
		`  version: "${state.master_plan.version}"`,
		`  status: ${state.master_plan.status}`,
		`  sha256: "${state.master_plan.sha256}"`,
		`design:`,
		`  required: ${state.design.required}`,
		`  version: "${state.design.version}"`,
		`  status: ${state.design.status}`,
		`  sha256: "${state.design.sha256}"`,
		...serializeTickets(state.tickets),
		`aatp:`,
		`  total: ${state.aatp.total}`,
		`  ready: ${state.aatp.ready}`,
		`  active: ${state.aatp.active}`,
		`  completed: ${state.aatp.completed}`,
		`  blocked: ${state.aatp.blocked}`,
		`qa:`,
		`  status: ${state.qa.status}`,
		`  tree_sha: "${state.qa.tree_sha}"`,
		`release:`,
		`  ready: ${state.release.ready}`,
		`  tree_sha: "${state.release.tree_sha}"`,
		`unlock_token: "${state.unlock_token}"`,
		`conflict:`,
		`  kind: ${state.conflict.kind}`,
		`  reason: ${JSON.stringify(state.conflict.reason)}`,
		"",
	].join("\n");
}

export function statePath(cwd: string): string {
	return join(cwd, STATE_REL);
}

export type LoadedState = { ok: true; state: CompanyState; path: string } | { ok: false; reason: string };

export function loadStateResult(cwd: string): LoadedState {
	for (const rel of STATE_PATHS) {
		const file = join(cwd, rel);
		try {
			const text = readFileSync(file, "utf8");
			return { ok: true, state: parseState(text), path: file };
		} catch (error) {
			if (error instanceof StateError) return { ok: false, reason: `${rel}: ${error.message}` };
			/* missing file — try next */
		}
	}
	return { ok: true, state: defaultState(), path: statePath(cwd) };
}

export function loadState(cwd: string): CompanyState {
	const loaded = loadStateResult(cwd);
	if (!loaded.ok) throw new StateError(loaded.reason);
	return loaded.state;
}

export function saveState(cwd: string, state: CompanyState): void {
	const file = statePath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, serializeState(state), "utf8");
	renameSync(tmp, file);
}

export function planLocked(state: CompanyState): boolean {
	return state.master_plan.status === "locked";
}

export function productReady(state: CompanyState): boolean {
	return state.product.status === "approved" || state.product.status === "locked";
}

export function designAllowsUi(state: CompanyState): boolean {
	if (!state.design.required) return true;
	return state.design.status === "locked" || state.design.status === "not_required";
}

export function grantCap(state: CompanyState, cap: HumanCap, now = Date.now()): void {
	state.capabilities[cap] = now + CAP_TTL_MS;
}

export function consumeCap(state: CompanyState, cap: HumanCap, now = Date.now()): boolean {
	const exp = state.capabilities[cap];
	if (!exp || exp < now) return false;
	delete state.capabilities[cap];
	return true;
}

export function recountTickets(state: CompanyState): void {
	const list = Object.values(state.tickets);
	state.aatp = {
		total: list.length,
		ready: list.filter((t) => t.status === "ready").length,
		active: list.filter((t) => t.status === "active").length,
		completed: list.filter((t) => t.status === "completed").length,
		blocked: list.filter((t) => t.status === "blocked").length,
	};
}

export function stateFileExists(cwd: string): boolean {
	return STATE_PATHS.some((rel) => {
		try {
			readFileSync(join(cwd, rel));
			return true;
		} catch {
			return false;
		}
	});
}
