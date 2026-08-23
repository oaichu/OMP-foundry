import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { LOCKED_AATP_PATHS, LOCKED_DESIGN_PATHS, LOCKED_PLAN_PATHS, LOCKED_PRODUCT_PATHS, STATE_PATHS, type CompanyState, type ConflictKind, type ReviewVerdict, type TicketStatus } from "./types";
import { comparablePath, safeRepoPath } from "./paths";

export interface AatpSpec {
	id: string;
	objective: string;
	dependencies: string[];
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	acceptance?: string[];
	verification?: string[];
	security_sensitive?: boolean;
	covers?: string[];
	path: string;
}

export interface AatpTask extends AatpSpec {
	status: TicketStatus;
	review: ReviewVerdict;
	implementation_commit_sha?: string;
	implementation_scope_sha256?: string;
	verification_evidence_sha256?: string;
}

const MAX_AATP_FILES = 256;
const MAX_SPEC_BYTES = 256 * 1024;
const MAX_AATP_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_AATP_BYTES;
const MAX_DEPENDENCIES = 256;
const MAX_GRAPH_DEPTH = 256;
const MAX_FIELD_BYTES = 16 * 1024;
const MAX_GOVERNED_COMMITS = 4096;

function parseList(block: string, key: string): string[] {
	const normalized = block.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*(.*)$`).test(line));
	if (start < 0) return [];
	const header = lines[start].replace(new RegExp(`^${key}:\\s*`), "").trim();
	if (header.startsWith("[")) {
		if (!header.endsWith("]")) throw new Error("malformed inline list");
		let parsed: unknown;
		let json = true;
		try {
			parsed = JSON.parse(header) as unknown;
		} catch {
			json = false;
			/* YAML also permits single-quoted inline lists; parse that bounded form. */
		}
		if (json) {
			if (!Array.isArray(parsed)) throw new Error("inline list must be an array");
			if (parsed.length > MAX_DEPENDENCIES) throw new Error("too many list items");
			if (!parsed.every((item) => typeof item === "string" && item.length <= MAX_FIELD_BYTES)) throw new Error("invalid or oversized list item");
			return parsed as string[];
		}
		const values = header.slice(1, -1).split(",").map((value) => value.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
		if (values.length > MAX_DEPENDENCIES || values.some((value) => value.length > MAX_FIELD_BYTES)) throw new Error("oversized list");
		return values;
	}
	const out: string[] = [];
	for (let i = start + 1; i < lines.length; i += 1) {
		const item = lines[i].match(/^\s+-\s+(.+)$/);
		if (!item) break;
		const value = item[1].trim();
		if (value.length > MAX_FIELD_BYTES) throw new Error("oversized list item");
		out.push(value);
		if (out.length > MAX_DEPENDENCIES) throw new Error("too many list items");
	}
	return out;
}

function parseField(block: string, key: string): string {
	const match = block.replace(/\r\n/g, "\n").match(new RegExp(`(?:^|\\n)${key}:\\s*(.+)`));
	const value = match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
	if (value.length > MAX_FIELD_BYTES) throw new Error(`${key} exceeds the field-size limit`);
	return value;
}

function safeAatpDir(cwd: string): string {
	const dir = safeRepoPath(cwd, "docs/AATP");
	if (!dir) throw new Error("PATH_GATE: refusing docs/AATP through a symlink or outside the repository.");
	return dir;
}

function parseBoolean(block: string, key: string): boolean {
	const value = parseField(block, key);
	if (!value) return false;
	if (value !== "true" && value !== "false") throw new Error(`${key} must be true or false`);
	return value === "true";
}

/** Preserve the previous generated DAG outside the active manifest before recompiling. */
export function archiveAatpSpecs(cwd: string): number {
	const dir = safeAatpDir(cwd);
	if (!existsSync(dir)) return 0;
	const entries = readdirSync(dir, { withFileTypes: true });
	if (entries.length > MAX_AATP_FILES * 4) throw new Error("AATP_RESOURCE_GATE: docs/AATP contains too many directory entries.");
	const files = entries.filter((entry) => entry.isFile() && (/^AATP-.*\.md$/i.test(entry.name) || entry.name.toUpperCase() === "INDEX.MD"));
	if (entries.some((entry) => (/^AATP-.*\.md$/i.test(entry.name) || entry.name.toUpperCase() === "INDEX.MD") && !entry.isFile())) throw new Error("AATP_ARCHIVE_GATE: active AATP artifacts must be regular files.");
	if (files.length > MAX_AATP_FILES) throw new Error(`AATP_RESOURCE_GATE: at most ${MAX_AATP_FILES} active work orders may be archived.`);
	if (files.length === 0) return 0;
	let totalBytes = 0;
	for (const entry of files) {
		const path = safeRepoPath(cwd, `docs/AATP/${entry.name}`);
		if (!path) throw new Error(`AATP_ARCHIVE_GATE: refusing ${entry.name} through a symlink or outside the repository.`);
		const stat = lstatSync(path);
		if (stat.size > MAX_SPEC_BYTES || (totalBytes += stat.size) > MAX_ARCHIVE_BYTES) throw new Error(`AATP_RESOURCE_GATE: archive source exceeds the ${MAX_ARCHIVE_BYTES}-byte limit.`);
	}
	const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
	const archiveRoot = safeRepoPath(cwd, "docs/AATP/archive");
	if (!archiveRoot) throw new Error("AATP_ARCHIVE_GATE: refusing archive directory through a symlink or outside the repository.");
	if (existsSync(archiveRoot) && !lstatSync(archiveRoot).isDirectory()) throw new Error("AATP_ARCHIVE_GATE: docs/AATP/archive is not a real directory.");
	let archive = safeRepoPath(cwd, `docs/AATP/archive/${stamp}`), suffix = 1;
	if (!archive) throw new Error("AATP_ARCHIVE_GATE: invalid archive destination.");
	while (existsSync(archive)) {
		if (suffix > 1024) throw new Error("AATP_RESOURCE_GATE: archive destination collision limit exceeded.");
		archive = safeRepoPath(cwd, `docs/AATP/archive/${stamp}-${suffix++}`);
		if (!archive) throw new Error("AATP_ARCHIVE_GATE: invalid archive destination.");
	}
	mkdirSync(archive, { recursive: true });
	const archiveName = basename(archive);
	const moved: Array<{ source: string; destination: string }> = [];
	try {
		for (const entry of files) {
			const source = safeRepoPath(cwd, `docs/AATP/${entry.name}`), destination = safeRepoPath(cwd, `docs/AATP/archive/${archiveName}/${entry.name}`);
			if (!source || !destination) throw new Error(`AATP_ARCHIVE_GATE: invalid archive path for ${entry.name}.`);
			renameSync(source, destination);
			moved.push({ source, destination });
		}
	} catch (error) {
		for (const pair of moved.reverse()) {
			try { renameSync(pair.destination, pair.source); } catch { /* preserve the original failure; do not guess */ }
		}
		throw error;
	}
	return files.length;
}

export function listAatpSpecs(cwd: string): AatpSpec[] {
	const dir = safeAatpDir(cwd);
	if (!existsSync(dir)) return [];
	const tasks: AatpSpec[] = [];
	const allEntries = readdirSync(dir);
	if (allEntries.length > MAX_AATP_FILES * 4) throw new Error(`AATP_RESOURCE_GATE: docs/AATP contains too many directory entries.`);
	const entries = allEntries.sort().filter((file) => /^AATP-.*\.md$/i.test(file) && file.toUpperCase() !== "INDEX.MD");
	if (entries.length > MAX_AATP_FILES) throw new Error(`AATP_RESOURCE_GATE: at most ${MAX_AATP_FILES} active work orders are supported.`);
	let totalBytes = 0;
	for (const file of entries) {
		const path = join(dir, file);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`AATP_PATH_GATE: ${file} must be a regular non-symlink file.`);
		if (stat.size > MAX_SPEC_BYTES || (totalBytes += stat.size) > MAX_AATP_BYTES) throw new Error(`AATP_RESOURCE_GATE: AATP source exceeds the ${MAX_AATP_BYTES}-byte limit.`);
		const text = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
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
			acceptance: parseList(body, "acceptance"),
			verification: parseList(body, "verification"),
			security_sensitive: parseBoolean(body, "security_sensitive"),
			// Models often add a human explanation after a concern ID.  Keep the
			// machine-readable ID while discarding that bounded annotation; the
			// strict validator still rejects anything that is not a valid concern.
			covers: parseList(body, "covers").map((value) => value.split(/\s*:\s*/, 1)[0].trim().toUpperCase()),
			path,
		});
	}
	return tasks;
}

export interface AatpValidationOptions { strict?: boolean }

function normalizedPath(path: string): string {
	return comparablePath(path.trim().replace(/^\.\//, "").replace(/\/+$/, ""));
}

function underPath(path: string, prefix: string): boolean {
	const p = normalizedPath(prefix);
	return path === p || path.startsWith(`${p}/`);
}

function exactPathError(path: string): string | undefined {
	const normalized = normalizedPath(path);
	if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized) || normalized.split("/").some((part) => part === "." || part === "..") || /[*?,]/.test(normalized) || /[\u0000-\u001f\u007f]/.test(path) || (process.platform !== "win32" && path.includes("\\"))) return "must be a repository-relative exact path (no absolute path, dot segments, delimiters, control characters, or glob)";
	return undefined;
}

export function validateAatpSpecs(specs: AatpSpec[], options: AatpValidationOptions = {}): string[] {
	const errors: string[] = [];
	if (specs.length > MAX_AATP_FILES) errors.push(`AATP_RESOURCE_GATE: at most ${MAX_AATP_FILES} work orders are supported`);
	const ids = new Set<string>();
	const strict = options.strict === true;
	const risks = new Set(["trivial", "low", "normal", "difficult", "hard", "critical"]);
	const governance = [
		...LOCKED_PLAN_PATHS,
		...LOCKED_PRODUCT_PATHS,
		...LOCKED_DESIGN_PATHS,
		...LOCKED_AATP_PATHS,
		...STATE_PATHS,
		".omp/config.yml",
		".omp/config.yaml",
		"docs/.foundry-governed",
		"docs/reports/",
		".gitignore",
	];
	const governancePath = (value: string) => normalizedPath(value).toLowerCase();
	for (const spec of specs) {
		if (ids.has(spec.id)) errors.push(`duplicate id ${spec.id}`);
		ids.add(spec.id);
		if (!/^AATP-[A-Z0-9][A-Z0-9_-]*$/.test(spec.id)) errors.push(`${spec.id}: id must use the AATP-* format`);
		if (strict) {
			const fileId = (spec.path.replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.md$/i, "").toUpperCase();
			if (fileId !== spec.id) errors.push(`${spec.id}: artifact filename must match its id`);
		}
		if (!spec.objective) errors.push(`${spec.id}: objective missing`);
		if (spec.allowed_files.length === 0) errors.push(`${spec.id}: allowed_files must be explicit and non-empty`);
		if (strict) {
			for (const path of [...spec.allowed_files, ...spec.forbidden_files]) { const pathError = exactPathError(path); if (pathError) errors.push(`${spec.id}: ${path} ${pathError}`); }
			if (!risks.has(spec.risk.toLowerCase())) errors.push(`${spec.id}: invalid risk ${spec.risk}`);
			if (!spec.acceptance?.length) errors.push(`${spec.id}: acceptance must be explicit and non-empty`);
			if (!spec.verification?.length) errors.push(`${spec.id}: verification must be explicit and non-empty`);
			if (spec.verification?.some((value) => !/^[A-Za-z0-9_.:@/-]+$/.test(value) && !/^(?:bun|npm)\s+test(?:\s+--silent)?$/i.test(value))) errors.push(`${spec.id}: verification entries must be step ids or package-script names, not shell commands`);
			if (spec.security_sensitive !== undefined && typeof spec.security_sensitive !== "boolean") errors.push(`${spec.id}: security_sensitive must be boolean`);
			if (spec.covers?.some((concern) => !/^(?:REQ|ARCH|SEC|DES|OPS)-[A-Z0-9_-]+$/.test(concern))) errors.push(`${spec.id}: covers must use REQ-/ARCH-/SEC-/DES-/OPS- concern IDs`);
			if (!spec.forbidden_files.length || !spec.forbidden_files.some((file) => governance.some((locked) => underPath(governancePath(file), governancePath(locked)) || underPath(governancePath(locked), governancePath(file))))) {
				errors.push(`${spec.id}: forbidden_files must include Foundry governance artifacts`);
			}
			for (const allowed of spec.allowed_files) if (governance.some((locked) => underPath(governancePath(allowed), governancePath(locked)) || underPath(governancePath(locked), governancePath(allowed)))) errors.push(`${spec.id}: allowed_files includes a Foundry governance artifact at ${allowed}`);
			for (const allowed of spec.allowed_files) if (spec.forbidden_files.some((forbidden) => underPath(normalizedPath(allowed), normalizedPath(forbidden)) || underPath(normalizedPath(forbidden), normalizedPath(allowed)))) errors.push(`${spec.id}: allowed_files and forbidden_files overlap at ${allowed}`);
		}
	}
	for (const spec of specs) {
		if (spec.dependencies.length > MAX_DEPENDENCIES) errors.push(`${spec.id}: too many dependencies`);
		for (const dep of spec.dependencies) {
			if (dep && dep !== "NONE" && !ids.has(dep)) errors.push(`${spec.id}: unknown dependency ${dep}`);
			if (dep === spec.id) errors.push(`${spec.id}: self dependency`);
		}
	}

	const graph = new Map(specs.map((spec) => [spec.id, spec.dependencies.filter((dep) => dep && dep !== "NONE" && ids.has(dep))]));
	const visiting = new Set<string>(), visited = new Set<string>();
	const visit = (id: string, chain: string[]): void => {
		if (chain.length > MAX_GRAPH_DEPTH) { errors.push(`dependency graph exceeds ${MAX_GRAPH_DEPTH} levels`); return; }
		if (visiting.has(id)) {
			const start = chain.indexOf(id);
			const cycle = [...chain.slice(start), id].join(" -> ");
			const message = `dependency cycle: ${cycle}`;
			if (!errors.includes(message)) errors.push(message);
			return;
		}
		if (visited.has(id)) return;
		visiting.add(id);
		for (const dep of graph.get(id) ?? []) visit(dep, [...chain, id]);
		visiting.delete(id);
		visited.add(id);
	};
	for (const id of graph.keys()) visit(id, []);

	if (strict) {
		const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
			if (from === target) return true;
			if (seen.has(from)) return false;
			seen.add(from);
			return (graph.get(from) ?? []).some((dep) => reaches(dep, target, seen));
		};
		for (let i = 0; i < specs.length; i += 1) for (let j = i + 1; j < specs.length; j += 1) {
			const left = specs[i], right = specs[j];
			const overlap = left.allowed_files.some((a) => right.allowed_files.some((b) => underPath(normalizedPath(a), normalizedPath(b)) || underPath(normalizedPath(b), normalizedPath(a))));
			if (overlap && !reaches(left.id, right.id) && !reaches(right.id, left.id)) errors.push(`scope overlap: ${left.id} and ${right.id} share allowed files without a dependency`);
		}
	}
	return errors;
}

/** Verify machine-readable concern coverage when the locked plan/design uses IDs. */
export function validateAatpCoverage(cwd: string, specs: AatpSpec[]): string[] {
	const concerns = new Set<string>();
	for (const rel of ["docs/MASTER_PLAN.md", "docs/DESIGN.md"]) {
		const file = safeRepoPath(cwd, rel);
		if (!file) continue;
		try {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/\b(?:REQ|ARCH|SEC|DES|OPS)-[A-Z0-9_-]+\b/gi)) concerns.add(match[0].toUpperCase());
		} catch { /* missing optional design artifact is handled by the phase gate */ }
	}
	if (concerns.size === 0) return [];
	const covered = new Set(specs.flatMap((spec) => spec.covers ?? []).map((value) => value.toUpperCase()));
	return [...concerns].filter((concern) => !covered.has(concern)).map((concern) => `AATP_COVERAGE_GATE: locked concern ${concern} is not covered by any AATP work order`);
}

export function aatpManifestHash(cwd: string): string {
	const specs = listAatpSpecs(cwd);
	if (specs.length === 0) return "";
	const hash = createHash("sha256");
	for (const spec of specs.sort((a, b) => a.id.localeCompare(b.id))) {
		hash.update(comparablePath(relative(cwd, spec.path)));
		hash.update("\0");
		hash.update(readFileSync(spec.path));
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function hydrateAatp(cwd: string, state: CompanyState): AatpTask[] {
	return listAatpSpecs(cwd).map((spec) => {
		const ticket = state.tickets[spec.id];
		return { ...spec, status: ticket?.status ?? "ready", review: ticket?.review ?? "none", implementation_commit_sha: ticket?.implementation_commit_sha, implementation_scope_sha256: ticket?.implementation_scope_sha256, verification_evidence_sha256: ticket?.verification_evidence_sha256 };
	});
}

export function readyIndependent(tasks: AatpTask[]): AatpTask[] {
	const done = new Set(tasks.filter((t) => t.status === "completed" && t.review === "APPROVE" && t.implementation_commit_sha && t.implementation_scope_sha256 && t.verification_evidence_sha256).map((t) => t.id));
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
	const dir = safeAatpDir(cwd);
	if (tasks.length > MAX_AATP_FILES) throw new Error(`AATP_RESOURCE_GATE: at most ${MAX_AATP_FILES} work orders may be indexed.`);
	mkdirSync(dir, { recursive: true });
	const lines = [
		"# AATP index", "", "| id | status | review | risk | deps | objective |", "| --- | --- | --- | --- | --- | --- |",
		...tasks.map((t) => `| ${t.id} | ${t.status} | ${t.review} | ${t.risk} | ${t.dependencies.join(", ") || "none"} | ${t.objective.replace(/\|/g, "/")} |`), "",
	];
	const index = safeRepoPath(cwd, "docs/AATP/INDEX.md");
	if (!index) throw new Error("AATP_PATH_GATE: refusing INDEX.md through a symlink or outside the repository.");
	writeFileSync(index, lines.join("\n"), "utf8");
}

export function routeAgent(risk: string): string {
	const r = risk.toLowerCase();
	if (r === "trivial" || r === "low") return "smol-implementer";
	if (r === "difficult" || r === "hard" || r === "critical") return "hard-implementer";
	// Unknown risk must never silently downgrade to the cheap/default worker.
	return r === "normal" ? "implementer" : "hard-implementer";
}

/** Critical/security work must be adjudicated by the security reviewer. */
export function reviewAgentForRisk(risk: string, securitySensitive = false): "reviewer" | "security-reviewer" {
	return securitySensitive || risk.toLowerCase() === "critical" ? "security-reviewer" : "reviewer";
}

export function seedTickets(state: CompanyState, specs: AatpSpec[]): void {
	const valid = new Set(specs.map((s) => s.id));
	for (const id of Object.keys(state.tickets)) if (!valid.has(id)) delete state.tickets[id];
	for (const spec of specs) {
		const ticket = state.tickets[spec.id] ?? { id: spec.id, status: "ready" as const, dependencies: spec.dependencies, allowed_files: spec.allowed_files, forbidden_files: spec.forbidden_files, risk: spec.risk, security_sensitive: spec.security_sensitive === true, review: "none" as const };
		ticket.dependencies = spec.dependencies;
		ticket.allowed_files = spec.allowed_files;
		ticket.forbidden_files = spec.forbidden_files;
		ticket.risk = spec.risk;
		ticket.security_sensitive = spec.security_sensitive === true;
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
		if (depTicket.status !== "completed" || depTicket.review !== "APPROVE" || !depTicket.implementation_scope_sha256 || !depTicket.implementation_commit_sha) return { ok: false, reason: `DEPENDENCY_CONFLICT: ${dep} is not an approved, provenance-bound implementation.` };
	}
	const ticket = existing ?? { id, status: "ready" as const, allowed_files: spec?.allowed_files ?? [], forbidden_files: spec?.forbidden_files ?? [], risk: spec?.risk ?? "normal", review: "none" as const };
	if (ticket.status !== "ready") return { ok: false, reason: `${id} is ${ticket.status}; only ready tickets can begin.` };
	ticket.status = "active";
	ticket.agent = agent;
	ticket.review = "none";
	ticket.review_by = undefined;
	ticket.review_evidence_sha256 = undefined;
	ticket.implementation_evidence_sha256 = undefined;
	ticket.implementation_parent_sha = undefined;
	ticket.implementation_commit_sha = undefined;
	ticket.implementation_scope_sha256 = undefined;
	ticket.verification_evidence_sha256 = undefined;
	ticket.review_parent_sha = undefined;
	ticket.review_commit_sha = undefined;
	ticket.reviewed_scope_sha256 = undefined;
	ticket.reviewed_dependency_sha256 = undefined;
	ticket.reviewed_manifest_sha256 = undefined;
	if (spec) { ticket.dependencies = spec.dependencies; ticket.allowed_files = spec.allowed_files; ticket.forbidden_files = spec.forbidden_files; ticket.risk = spec.risk; ticket.security_sensitive = spec.security_sensitive === true; }
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export interface ImplementationProvenance { parentSha?: string; commitSha?: string; scopeSha?: string; verificationSha?: string }
export interface ReviewProvenance { parentSha?: string; commitSha?: string; scopeSha?: string; dependencySha?: string; manifestSha?: string }

function recordGovernedCommit(state: CompanyState, sha: string | undefined): void {
	if (!sha || !/^[a-f0-9]{40,128}$/i.test(sha)) return;
	if (!state.aatp.governed_commits.includes(sha)) {
		state.aatp.governed_commits.push(sha);
		if (state.aatp.governed_commits.length > MAX_GOVERNED_COMMITS) state.aatp.governed_commits.splice(0, state.aatp.governed_commits.length - MAX_GOVERNED_COMMITS);
	}
}

export function completeTicket(state: CompanyState, id: string, evidenceSha?: string, provenance: ImplementationProvenance = {}): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	if (ticket.status !== "active") return { ok: false, reason: `${id} is ${ticket.status}; only active tickets can complete.` };
	ticket.status = "completed";
	ticket.implementation_evidence_sha256 = evidenceSha;
	ticket.implementation_parent_sha = provenance.parentSha;
	ticket.implementation_commit_sha = provenance.commitSha;
	ticket.implementation_scope_sha256 = provenance.scopeSha;
	ticket.verification_evidence_sha256 = provenance.verificationSha;
	recordGovernedCommit(state, provenance.commitSha);
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
	ticket.implementation_evidence_sha256 = undefined;
	ticket.implementation_parent_sha = undefined;
	ticket.implementation_commit_sha = undefined;
	ticket.implementation_scope_sha256 = undefined;
	ticket.verification_evidence_sha256 = undefined;
	ticket.review_parent_sha = undefined;
	ticket.review_commit_sha = undefined;
	ticket.reviewed_scope_sha256 = undefined;
	ticket.reviewed_dependency_sha256 = undefined;
	ticket.reviewed_manifest_sha256 = undefined;
	state.tickets[id] = ticket;
	return { ok: true, ticket };
}

export function blockTicket(state: CompanyState, id: string, reason: string, kind: ConflictKind = "SCOPE_INSUFFICIENT"): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	ticket.status = "blocked";
	ticket.review = "BLOCK";
	ticket.review_by = undefined;
	ticket.review_evidence_sha256 = undefined;
	ticket.implementation_evidence_sha256 = undefined;
	ticket.implementation_parent_sha = undefined;
	ticket.implementation_commit_sha = undefined;
	ticket.implementation_scope_sha256 = undefined;
	ticket.verification_evidence_sha256 = undefined;
	ticket.review_parent_sha = undefined;
	ticket.review_commit_sha = undefined;
	ticket.reviewed_scope_sha256 = undefined;
	ticket.reviewed_dependency_sha256 = undefined;
	ticket.reviewed_manifest_sha256 = undefined;
	state.tickets[id] = ticket;
	state.conflict = { kind, reason };
	return { ok: true, ticket };
}

export function reviewTicket(state: CompanyState, id: string, verdict: Exclude<ReviewVerdict, "none">, reviewer = "reviewer", evidenceSha?: string, provenance: ReviewProvenance = {}): TransitionResult {
	const ticket = state.tickets[id];
	if (!ticket) return { ok: false, reason: "Unknown ticket." };
	if (ticket.status !== "completed") return { ok: false, reason: `${id} is ${ticket.status}; review requires completed.` };
	ticket.review = verdict;
	ticket.review_by = reviewer;
	ticket.review_evidence_sha256 = evidenceSha;
	ticket.review_parent_sha = provenance.parentSha;
	ticket.review_commit_sha = provenance.commitSha;
	ticket.reviewed_scope_sha256 = provenance.scopeSha;
	ticket.reviewed_dependency_sha256 = provenance.dependencySha;
	ticket.reviewed_manifest_sha256 = provenance.manifestSha;
	recordGovernedCommit(state, provenance.commitSha);
	if (verdict === "REQUEST_CHANGES") ticket.status = "ready";
	if (verdict === "BLOCK") ticket.status = "blocked";
	state.tickets[id] = ticket;
	if (verdict === "REQUEST_CHANGES") invalidateDescendants(state, id);
	return { ok: true, ticket };
}

/** Reset every downstream ticket when an upstream implementation is reopened. */
export function invalidateDescendants(state: CompanyState, rootId: string): string[] {
	const invalidated: string[] = [], queue = [rootId], seen = new Set<string>(queue);
	while (queue.length) {
		const parent = queue.shift()!;
		for (const ticket of Object.values(state.tickets)) {
			if (!(ticket.dependencies ?? []).some((dep) => dep.toUpperCase() === parent.toUpperCase()) || seen.has(ticket.id)) continue;
			seen.add(ticket.id);
			if (ticket.status !== "ready" || ticket.review !== "none") {
				ticket.status = "ready";
				ticket.review = "none";
				ticket.review_by = undefined;
				ticket.review_evidence_sha256 = undefined;
				ticket.implementation_evidence_sha256 = undefined;
				ticket.implementation_parent_sha = undefined;
				ticket.implementation_commit_sha = undefined;
				ticket.implementation_scope_sha256 = undefined;
				ticket.verification_evidence_sha256 = undefined;
				ticket.review_parent_sha = undefined;
				ticket.review_commit_sha = undefined;
				ticket.reviewed_scope_sha256 = undefined;
				ticket.reviewed_dependency_sha256 = undefined;
				ticket.reviewed_manifest_sha256 = undefined;
				invalidated.push(ticket.id);
			}
			queue.push(ticket.id);
		}
	}
	return invalidated;
}

export function resetAatp(state: CompanyState): void {
	state.tickets = {};
	state.aatp = { total: 0, ready: 0, active: 0, completed: 0, blocked: 0, manifest_sha256: "", epoch: "", baseline_sha: "", governed_commits: [] };
}
