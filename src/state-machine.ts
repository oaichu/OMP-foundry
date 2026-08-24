import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
import { safeRepoPath } from "./paths";

export { StateError };

const MAX_STATE_BYTES = 1024 * 1024;
const MAX_TICKETS = 256;
const MAX_LIST_ITEMS = 256;
const MAX_FIELD_BYTES = 16 * 1024;
const TICKET_RISKS = new Set(["trivial", "low", "normal", "difficult", "hard", "critical"]);

function pick(block: string, key: string): string | undefined {
	const match = block.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.*)`));
	if (!match) return undefined;
	const raw = match[1].trim();
	if (raw.startsWith('"') && raw.endsWith('"')) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed !== "string") throw new Error("not a string");
			return parsed;
		} catch { throw new StateError(`invalid quoted state field ${key}`); }
	}
	return raw.replace(/^['"]|['"]$/g, "");
}
function pickBlock(yaml: string, name: string): string {
	const normalized = yaml.replace(/\r\n/g, "\n");
	const match = normalized.match(new RegExp(`(?:^|\\n)${name}:\\n([\\s\\S]*?)(?=\\n[a-z_]+:|$)`));
	return match?.[1] ?? "";
}
function mustEnum<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T {
	if (!value || !allowed.includes(value as T)) throw new StateError(`invalid ${field}: ${value ?? "(missing)"}`);
	return value as T;
}
function csv(value: string | undefined): string[] {
	if (!value || value === "[]") return [];
	if (value.length > MAX_FIELD_BYTES) throw new StateError("state list field exceeds the size limit");
	if (value.trim().startsWith("[")) {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (Array.isArray(parsed) && parsed.length <= MAX_LIST_ITEMS && parsed.every((item) => typeof item === "string" && item.length <= MAX_FIELD_BYTES)) return parsed as string[];
			if (Array.isArray(parsed)) throw new StateError("state list exceeds the item/field limit");
		} catch {
			throw new StateError("invalid list encoding");
		}
	}
	const items = value.split(",").map((part) => part.trim()).filter(Boolean);
	if (items.length > MAX_LIST_ITEMS || items.some((item) => item.length > MAX_FIELD_BYTES)) throw new StateError("state list exceeds the item/field limit");
	return items;
}
function parseTickets(yaml: string): Record<string, AatpTicket> {
	const block = pickBlock(yaml, "tickets");
	if (!block.trim() || block.trim() === "{}") return {};
	const tickets: Record<string, AatpTicket> = {};
	const chunks = block.split(/\n(?=\s{2}[A-Za-z0-9_-]+:)/);
	if (chunks.length > MAX_TICKETS) throw new StateError(`state contains more than ${MAX_TICKETS} tickets`);
	for (const chunk of chunks) {
		const idMatch = chunk.match(/^\s{2}([A-Za-z0-9_-]+):/);
		if (!idMatch) continue;
		const id = idMatch[1];
		if (tickets[id]) throw new StateError(`duplicate tickets.${id}`);
		const dependencies = csv(pick(chunk, "dependencies"));
		const allowedFiles = csv(pick(chunk, "allowed_files"));
		const forbiddenFiles = csv(pick(chunk, "forbidden_files"));
		if ([...allowedFiles, ...forbiddenFiles].some((path) => /[\u0000-\u001f\u007f]/.test(path))) throw new StateError(`invalid control character in tickets.${id} path`);
		const risk = pick(chunk, "risk") || "normal";
		if (!TICKET_RISKS.has(risk.toLowerCase())) throw new StateError(`invalid tickets.${id}.risk: ${risk}`);
		const agent = pick(chunk, "agent") || undefined;
		const securityRaw = pick(chunk, "security_sensitive");
		if (securityRaw !== undefined && securityRaw !== "true" && securityRaw !== "false") throw new StateError(`invalid tickets.${id}.security_sensitive`);
		const reviewBy = pick(chunk, "review_by") || undefined;
		const reviewEvidence = pick(chunk, "review_evidence_sha256") || undefined;
		const implementationEvidence = pick(chunk, "implementation_evidence_sha256") || undefined;
		const provenance = {
			implementation_parent_sha: pick(chunk, "implementation_parent_sha") || undefined,
			implementation_commit_sha: pick(chunk, "implementation_commit_sha") || undefined,
			implementation_scope_sha256: pick(chunk, "implementation_scope_sha256") || undefined,
			verification_evidence_sha256: pick(chunk, "verification_evidence_sha256") || undefined,
			review_parent_sha: pick(chunk, "review_parent_sha") || undefined,
			review_commit_sha: pick(chunk, "review_commit_sha") || undefined,
			reviewed_scope_sha256: pick(chunk, "reviewed_scope_sha256") || undefined,
			reviewed_dependency_sha256: pick(chunk, "reviewed_dependency_sha256") || undefined,
			reviewed_manifest_sha256: pick(chunk, "reviewed_manifest_sha256") || undefined,
		};
		for (const value of [agent, reviewBy, reviewEvidence, implementationEvidence, ...Object.values(provenance)]) if (value && value.length > MAX_FIELD_BYTES) throw new StateError(`state field in tickets.${id} exceeds the size limit`);
		tickets[id] = {
			id,
			status: mustEnum(pick(chunk, "status"), TICKET_STATUSES, `tickets.${id}.status`),
			dependencies,
			allowed_files: allowedFiles,
			forbidden_files: forbiddenFiles,
			risk,
			security_sensitive: securityRaw === "true",
			agent,
			review: mustEnum(pick(chunk, "review") ?? "none", REVIEW_VERDICTS, `tickets.${id}.review`),
			review_by: reviewBy,
			review_evidence_sha256: reviewEvidence,
			implementation_evidence_sha256: implementationEvidence,
			...provenance,
		};
	}
	return tickets;
}

export function parseState(yaml: string, opts: { allowLegacy?: boolean } = {}): CompanyState {
	if (typeof yaml !== "string" || Buffer.byteLength(yaml, "utf8") > MAX_STATE_BYTES) throw new StateError(`state exceeds the ${MAX_STATE_BYTES}-byte limit`);
	if (!yaml.trim()) throw new StateError("empty state");
	yaml = yaml.replace(/\r\n/g, "\n");
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
	base.planning.epoch = pick(planning, "epoch") ?? "";
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
			if (!Number.isSafeInteger(n) || n < 0 || n > MAX_TICKETS) throw new StateError(`invalid aatp.${key}`);
			base.aatp[key] = n;
		}
	}
	base.aatp.manifest_sha256 = pick(aatp, "manifest_sha256") ?? "";
	base.aatp.epoch = pick(aatp, "epoch") ?? "";
	base.aatp.baseline_sha = pick(aatp, "baseline_sha") ?? "";
	base.aatp.governed_commits = csv(pick(aatp, "governed_commits"));
	if (base.aatp.governed_commits.length > 4096 || base.aatp.governed_commits.some((sha) => !/^[a-f0-9]{40,128}$/i.test(sha))) throw new StateError("invalid aatp.governed_commits");
	if (base.aatp.baseline_sha && !/^[a-f0-9]{40,128}$/i.test(base.aatp.baseline_sha)) throw new StateError("invalid aatp.baseline_sha");
	base.qa.status = mustEnum(pick(qa, "status") ?? "pending", QA_STATUSES, "qa.status");
	base.qa.tree_sha = pick(qa, "tree_sha") ?? "";
	base.release.ready = pick(release, "ready") === "true";
	base.release.tree_sha = pick(release, "tree_sha") ?? "";
	base.conflict.kind = mustEnum(pick(conflict, "kind") ?? "none", CONFLICT_KINDS, "conflict.kind");
	base.conflict.reason = pick(conflict, "reason") ?? "";
	for (const value of [base.created_by, base.last_written_by, base.planning.epoch, base.planning.draft_sha256, base.planning.review_sha256, base.planning.final_sha256, base.product.sha256, base.master_plan.sha256, base.design.sha256, base.aatp.manifest_sha256, base.aatp.epoch, base.aatp.baseline_sha, base.qa.tree_sha, base.release.tree_sha, base.conflict.reason, ...base.aatp.governed_commits]) {
		if (value.length > MAX_FIELD_BYTES) throw new StateError("state field exceeds the size limit");
	}
	return base;
}

function serializeTickets(tickets: Record<string, AatpTicket>): string[] {
	const ids = Object.keys(tickets).sort();
	if (ids.length === 0) return ["tickets: {}"];
	const lines = ["tickets:"];
	for (const id of ids) {
		const t = tickets[id];
		lines.push(`  ${id}:`, `    status: ${t.status}`, `    dependencies: ${JSON.stringify(t.dependencies ?? [])}`, `    allowed_files: ${JSON.stringify(t.allowed_files)}`, `    forbidden_files: ${JSON.stringify(t.forbidden_files)}`, `    risk: ${t.risk}`);
		if (t.security_sensitive) lines.push("    security_sensitive: true");
		if (t.agent) lines.push(`    agent: ${JSON.stringify(t.agent)}`);
		lines.push(`    review: ${t.review ?? "none"}`);
		if (t.review_by) lines.push(`    review_by: ${JSON.stringify(t.review_by)}`);
		if (t.review_evidence_sha256) lines.push(`    review_evidence_sha256: ${JSON.stringify(t.review_evidence_sha256)}`);
		if (t.implementation_evidence_sha256) lines.push(`    implementation_evidence_sha256: ${JSON.stringify(t.implementation_evidence_sha256)}`);
		for (const key of ["implementation_parent_sha", "implementation_commit_sha", "implementation_scope_sha256", "verification_evidence_sha256", "review_parent_sha", "review_commit_sha", "reviewed_scope_sha256", "reviewed_dependency_sha256", "reviewed_manifest_sha256"] as const) if (t[key]) lines.push(`    ${key}: ${JSON.stringify(t[key])}`);
	}
	return lines;
}

export function serializeState(state: CompanyState): string {
	if (Object.keys(state.tickets).length > MAX_TICKETS) throw new StateError(`state contains more than ${MAX_TICKETS} tickets`);
	return [
		`schema_version: ${state.schema_version}`, `created_by: ${JSON.stringify(state.created_by)}`, `last_written_by: ${JSON.stringify(state.last_written_by)}`, `mode: ${state.mode}`, `phase: ${state.phase}`,
		"planning:", `  stage: ${state.planning.stage}`, `  epoch: ${JSON.stringify(state.planning.epoch)}`, `  draft_sha256: ${JSON.stringify(state.planning.draft_sha256)}`, `  review_sha256: ${JSON.stringify(state.planning.review_sha256)}`, `  final_sha256: ${JSON.stringify(state.planning.final_sha256)}`,
		"product:", `  status: ${state.product.status}`, `  sha256: ${JSON.stringify(state.product.sha256)}`,
		"master_plan:", `  version: ${JSON.stringify(state.master_plan.version)}`, `  status: ${state.master_plan.status}`, `  sha256: ${JSON.stringify(state.master_plan.sha256)}`,
		"design:", `  required: ${state.design.required}`, `  version: ${JSON.stringify(state.design.version)}`, `  status: ${state.design.status}`, `  sha256: ${JSON.stringify(state.design.sha256)}`,
		...serializeTickets(state.tickets),
		"aatp:", `  total: ${state.aatp.total}`, `  ready: ${state.aatp.ready}`, `  active: ${state.aatp.active}`, `  completed: ${state.aatp.completed}`, `  blocked: ${state.aatp.blocked}`, `  manifest_sha256: ${JSON.stringify(state.aatp.manifest_sha256)}`, `  epoch: ${JSON.stringify(state.aatp.epoch)}`, `  baseline_sha: ${JSON.stringify(state.aatp.baseline_sha)}`, `  governed_commits: ${JSON.stringify(state.aatp.governed_commits)}`,
		"qa:", `  status: ${state.qa.status}`, `  tree_sha: ${JSON.stringify(state.qa.tree_sha)}`,
		"release:", `  ready: ${state.release.ready}`, `  tree_sha: ${JSON.stringify(state.release.tree_sha)}`,
		"conflict:", `  kind: ${state.conflict.kind}`, `  reason: ${JSON.stringify(state.conflict.reason)}`, "",
	].join("\n");
}

export function statePath(cwd: string): string { return join(cwd, STATE_REL); }
export type LoadedState = { ok: true; state: CompanyState; path: string } | { ok: false; reason: string };
export function loadStateResult(cwd: string): LoadedState {
	for (const rel of STATE_PATHS) {
		const file = safeRepoPath(cwd, rel);
		if (!file) return { ok: false, reason: `STATE_PATH_GATE: refusing ${rel} through a symlink or outside the repository` };
		let text: string;
		try {
			const stat = lstatSync(file);
			if (stat.isSymbolicLink()) return { ok: false, reason: `STATE_PATH_GATE: ${rel} must not be a symlink.` };
			if (!stat.isFile()) return { ok: false, reason: `STATE_IO_ERROR: ${rel} is not a regular file.` };
			if (stat.size > MAX_STATE_BYTES) return { ok: false, reason: `STATE_RESOURCE_GATE: ${rel} exceeds the ${MAX_STATE_BYTES}-byte limit.` };
			text = readFileSync(file, "utf8");
		}
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
	const file = safeRepoPath(cwd, STATE_REL);
	if (!file) throw new StateError(`STATE_PATH_GATE: refusing ${STATE_REL} through a symlink or outside the repository`);
	mkdirSync(dirname(file), { recursive: true });
	const serialized = serializeState(state);
	if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) throw new StateError(`STATE_RESOURCE_GATE: serialized state exceeds the ${MAX_STATE_BYTES}-byte limit.`);
	const tmp = `${file}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmp, serialized, { encoding: "utf8", flag: "wx" });
		renameSync(tmp, file);
	} catch (error) {
		try { unlinkSync(tmp); } catch { /* best effort cleanup */ }
		throw error;
	}
}
export function planLocked(state: CompanyState): boolean { return state.master_plan.status === "locked" && !!state.master_plan.sha256; }
export function productReady(state: CompanyState): boolean { return (state.product.status === "approved" || state.product.status === "locked") && !!state.product.sha256; }
export function designAllowsUi(state: CompanyState): boolean { return !state.design.required || state.design.status === "not_required" || (state.design.status === "locked" && !!state.design.sha256); }
export function recountTickets(state: CompanyState): void {
	const list = Object.values(state.tickets), manifest = state.aatp.manifest_sha256;
	state.aatp = { total: list.length, ready: list.filter((t) => t.status === "ready").length, active: list.filter((t) => t.status === "active").length, completed: list.filter((t) => t.status === "completed").length, blocked: list.filter((t) => t.status === "blocked").length, manifest_sha256: manifest, epoch: state.aatp.epoch, baseline_sha: state.aatp.baseline_sha, governed_commits: state.aatp.governed_commits };
}
export function stateFileExists(cwd: string): boolean {
	for (const rel of STATE_PATHS) {
		const file = safeRepoPath(cwd, rel);
		if (!file) throw new StateError(`STATE_PATH_GATE: refusing ${rel} through a symlink or outside the repository`);
		try {
			const stat = lstatSync(file);
			if (stat.isSymbolicLink() || !stat.isFile()) throw new StateError(`STATE_PATH_GATE: ${rel} must be a regular file.`);
			if (stat.size > MAX_STATE_BYTES) throw new StateError(`STATE_RESOURCE_GATE: ${rel} exceeds the ${MAX_STATE_BYTES}-byte limit.`);
			readFileSync(file); return true;
		}
		catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") continue;
			throw new StateError(`STATE_IO_ERROR: cannot read ${rel} (${code ?? "unknown"})`);
		}
	}
	return false;
}
