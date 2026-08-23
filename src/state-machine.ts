import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type AatpTicket,
	ARTIFACT_STATUSES,
	type CompanyState,
	CONFLICT_KINDS,
	CURRENT_STATE_SCHEMA,
	FOUNDRY_MODES,
	FOUNDRY_VERSION,
	PHASES,
	PLAN3_STAGES,
	QA_STATUSES,
	REVIEW_VERDICTS,
	STATE_PATHS,
	STATE_REL,
	TICKET_STATUSES,
	StateError,
	defaultState,
} from "./types";
import { backupOnce, migrateToCurrent } from "./schema";

export { StateError };

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
	if (!value || !allowed.includes(value as T)) throw new StateError(`invalid ${field}: ${value ?? "(missing)"}`);
	return value as T;
}
function csv(value: string | undefined): string[] {
	if (!value || value === "[]") return [];
	return value.split(",").map((part) => part.trim()).filter(Boolean);
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
			review: mustEnum(pick(chunk, "review") ?? "none", REVIEW_VERDICTS, `tickets.${id}.review`),
			review_by: pick(chunk, "review_by") || undefined,
			review_evidence_sha256: pick(chunk, "review_evidence_sha256") || undefined,
			implementation_evidence_sha256: pick(chunk, "implementation_evidence_sha256") || undefined,
		};
	}
	return tickets;
}

export function parseState(yaml: string, opts: { allowLegacy?: boolean } = {}): CompanyState {
	if (!yaml.trim()) throw new StateError("empty state");
	const base = defaultState();
	const rawVersion = yaml.match(/(?:^|\n)schema_version:\s*(\S+)/);
	if (rawVersion) {
		const n = Number(rawVersion[1]);
		if (!Number.isInteger(n) || n < 0) throw new StateError("invalid schema_version");
		base.schema_version = n;
	} else if (!opts.allowLegacy) throw new StateError("missing schema_version (legacy v0 — loadState migrates)");
	else base.schema_version = 0;
	base.created_by = pick(yaml, "created_by") ?? (opts.allowLegacy ? "" : base.created_by);
	base.last_written_by = pick(yaml, "last_written_by") ?? (opts.allowLegacy ? "" : base.last_written_by);
	base.mode = mustEnum(pick(yaml, "mode") ?? "normal", FOUNDRY_MODES, "mode");
	base.phase = mustEnum(pick(yaml, "phase"), PHASES, "phase");
	const planning = pickBlock(yaml, "planning"), product = pickBlock(yaml, "product"), plan = pickBlock(yaml, "master_plan"), design = pickBlock(yaml, "design"), aatp = pickBlock(yaml, "aatp"), qa = pickBlock(yaml, "qa"), release = pickBlock(yaml, "release"), conflict = pickBlock(yaml, "conflict");
	base.planning.stage = mustEnum(pick(planning, "stage") ?? "idle", PLAN3_STAGES, "planning.stage");
	base.planning.draft_sha256 = pick(planning, "draft_sha256") ?? "";
	base.planning.review_sha256 = pick(planning, "review_sha256") ?? "";
	base.planning.final_sha256 = pick(planning, "final_sha256") ?? "";
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
			if (!Number.isSafeInteger(n) || n < 0) throw new StateError(`invalid aatp.${key}`);
			base.aatp[key] = n;
		}
	}
	base.aatp.manifest_sha256 = pick(aatp, "manifest_sha256") ?? "";
	base.qa.status = mustEnum(pick(qa, "status") ?? "pending", QA_STATUSES, "qa.status");
	base.qa.tree_sha = pick(qa, "tree_sha") ?? "";
	base.release.ready = pick(release, "ready") === "true";
	base.release.tree_sha = pick(release, "tree_sha") ?? "";
	base.conflict.kind = mustEnum(pick(conflict, "kind") ?? "none", CONFLICT_KINDS, "conflict.kind");
	base.conflict.reason = pick(conflict, "reason") ?? "";
	return base;
}

function serializeTickets(tickets: Record<string, AatpTicket>): string[] {
	const ids = Object.keys(tickets).sort();
	if (ids.length === 0) return ["tickets: {}"];
	const lines = ["tickets:"];
	for (const id of ids) {
		const t = tickets[id];
		lines.push(`  ${id}:`, `    status: ${t.status}`, `    allowed_files: ${t.allowed_files.join(",")}`, `    forbidden_files: ${t.forbidden_files.join(",")}`, `    risk: ${t.risk}`);
		if (t.agent) lines.push(`    agent: ${t.agent}`);
		lines.push(`    review: ${t.review ?? "none"}`);
		if (t.review_by) lines.push(`    review_by: ${t.review_by}`);
		if (t.review_evidence_sha256) lines.push(`    review_evidence_sha256: ${t.review_evidence_sha256}`);
		if (t.implementation_evidence_sha256) lines.push(`    implementation_evidence_sha256: ${t.implementation_evidence_sha256}`);
	}
	return lines;
}

export function serializeState(state: CompanyState): string {
	return [
		`schema_version: ${state.schema_version}`, `created_by: "${state.created_by}"`, `last_written_by: "${state.last_written_by}"`, `mode: ${state.mode}`, `phase: ${state.phase}`,
		"planning:", `  stage: ${state.planning.stage}`, `  draft_sha256: "${state.planning.draft_sha256}"`, `  review_sha256: "${state.planning.review_sha256}"`, `  final_sha256: "${state.planning.final_sha256}"`,
		"product:", `  status: ${state.product.status}`, `  sha256: "${state.product.sha256}"`,
		"master_plan:", `  version: "${state.master_plan.version}"`, `  status: ${state.master_plan.status}`, `  sha256: "${state.master_plan.sha256}"`,
		"design:", `  required: ${state.design.required}`, `  version: "${state.design.version}"`, `  status: ${state.design.status}`, `  sha256: "${state.design.sha256}"`,
		...serializeTickets(state.tickets),
		"aatp:", `  total: ${state.aatp.total}`, `  ready: ${state.aatp.ready}`, `  active: ${state.aatp.active}`, `  completed: ${state.aatp.completed}`, `  blocked: ${state.aatp.blocked}`, `  manifest_sha256: "${state.aatp.manifest_sha256}"`,
		"qa:", `  status: ${state.qa.status}`, `  tree_sha: "${state.qa.tree_sha}"`,
		"release:", `  ready: ${state.release.ready}`, `  tree_sha: "${state.release.tree_sha}"`,
		"conflict:", `  kind: ${state.conflict.kind}`, `  reason: ${JSON.stringify(state.conflict.reason)}`, "",
	].join("\n");
}

export function statePath(cwd: string): string { return join(cwd, STATE_REL); }
export type LoadedState = { ok: true; state: CompanyState; path: string } | { ok: false; reason: string };
export function loadStateResult(cwd: string): LoadedState {
	for (const rel of STATE_PATHS) {
		const file = join(cwd, rel);
		let text: string;
		try { text = readFileSync(file, "utf8"); }
		catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			return { ok: false, reason: `STATE_IO_ERROR: cannot read ${rel} (${code ?? "unknown"})` };
		}
		try {
			const migrated = migrateToCurrent(text);
			if (migrated.didMigrate) { backupOnce(file, migrated.from); saveState(cwd, migrated.state); return { ok: true, state: migrated.state, path: statePath(cwd) }; }
			return { ok: true, state: migrated.state, path: file };
		} catch (error) { return { ok: false, reason: `${rel}: ${error instanceof Error ? error.message : String(error)}` }; }
	}
	return { ok: true, state: defaultState(), path: statePath(cwd) };
}
export function loadState(cwd: string): CompanyState {
	const loaded = loadStateResult(cwd);
	if ("reason" in loaded) throw new StateError(loaded.reason);
	return loaded.state;
}
export function saveState(cwd: string, state: CompanyState): void {
	state.schema_version = CURRENT_STATE_SCHEMA;
	state.last_written_by = FOUNDRY_VERSION;
	if (!state.created_by) state.created_by = FOUNDRY_VERSION;
	const file = statePath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, serializeState(state), "utf8");
	renameSync(tmp, file);
}
export function planLocked(state: CompanyState): boolean { return state.master_plan.status === "locked"; }
export function productReady(state: CompanyState): boolean { return state.product.status === "approved" || state.product.status === "locked"; }
export function designAllowsUi(state: CompanyState): boolean { return !state.design.required || state.design.status === "locked" || state.design.status === "not_required"; }
export function recountTickets(state: CompanyState): void {
	const list = Object.values(state.tickets), manifest = state.aatp.manifest_sha256;
	state.aatp = { total: list.length, ready: list.filter((t) => t.status === "ready").length, active: list.filter((t) => t.status === "active").length, completed: list.filter((t) => t.status === "completed").length, blocked: list.filter((t) => t.status === "blocked").length, manifest_sha256: manifest };
}
export function stateFileExists(cwd: string): boolean {
	for (const rel of STATE_PATHS) {
		try { readFileSync(join(cwd, rel)); return true; }
		catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			throw new StateError(`STATE_IO_ERROR: cannot read ${rel} (${code ?? "unknown"})`);
		}
	}
	return false;
}
