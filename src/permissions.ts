import { underPrefix } from "./paths";
import { designAllowsUi, planLocked, productReady } from "./state-machine";
import {
	LOCKED_AATP_PATHS,
	LOCKED_DESIGN_PATHS,
	LOCKED_PLAN_PATHS,
	LOCKED_PRODUCT_PATHS,
	STATE_PATHS,
	type AatpTicket,
	type CompanyState,
} from "./types";

const FILE_MUTATING = new Set(["write", "edit", "ast_edit", "apply_patch"]);
const SHELL_CONTROL_CHARS = /[;&|<>$`\n\r\0(){}]/;
const DANGEROUS_GIT_FLAGS = /(?:^|\s)(?:--ext-diff|--textconv|--output(?:=|\s|$)|-o(?:=|\s|$)|--tool(?:=|\s|$)|-t(?:=|\s|$)|--exec\b|-c\b|--config\b)/;

export function isReadOnlyGitCommand(command: string): boolean {
	if (typeof command !== "string") return false;
	const cmd = command.trim();
	if (!cmd || SHELL_CONTROL_CHARS.test(cmd)) return false;
	const match = cmd.match(/^git(?:\s+--no-pager)?\s+(diff|status|log|show)(?:\s+(.*))?$/);
	if (!match) return false;
	const rest = match[2];
	if (rest && DANGEROUS_GIT_FLAGS.test(rest)) return false;
	return true;
}
const LSP_READ_ONLY = new Set(["status", "capabilities", "definition", "type_definition", "implementation", "references", "hover", "symbols", "diagnostics", "reload"]);
const GOVERNED = new Set(["implementer", "hard-implementer", "smol-implementer", "reviewer", "security-reviewer"]);
const EXTENSION_OWNED_PATHS = [
	...STATE_PATHS,
	".omp/config.yml",
	".omp/config.yaml",
	"docs/.foundry-governed",
	"docs/reports/qa.md",
	"docs/reports/review-",
];

export interface ToolInput {
	path?: unknown; file?: unknown; dst?: unknown; paths?: unknown; input?: unknown; command?: unknown; code?: unknown;
	action?: unknown; apply?: unknown; agent?: unknown; task?: unknown; tasks?: unknown; isolated?: unknown;
	pattern?: unknown; cwd?: unknown; directory?: unknown; root?: unknown; base?: unknown; uri?: unknown; textDocument?: unknown;
	url?: unknown; query?: unknown;
}
export interface DenyContext {
	activeTickets?: AatpTicket[]; stateBroken?: string;
	canonicalize?: (raw: string) => string | null; isolatedWithoutState?: boolean;
}

export function collectPaths(input: ToolInput): string[] {
	const out: string[] = [];
	const add = (value: unknown) => { if (typeof value === "string" && value.trim()) out.push(value.trim()); else if (Array.isArray(value)) for (const item of value) add(item); };
	add(input.path); add(input.file); add(input.dst); add(input.paths); add(input.uri);
	if (typeof input.input === "string") {
		const header = input.input.match(/^\[([^\]#]+)/m); if (header?.[1]) add(header[1]);
		for (const match of input.input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) add(match[1]);
	}
	return out;
}
function matchesAny(rel: string, needles: string[]): boolean {
	// Governance artifact names are intentionally case-insensitive across
	// platforms: a lower-case shadow file must not evade a lock on Linux.
	const candidate = rel.toLowerCase();
	return needles.some((needle) => underPrefix(candidate, needle.toLowerCase()));
}
function isReviewReport(rel: string): boolean { return /^docs\/reports\/review-[^/]+(?:-sec)?\.md$/i.test(rel); }
export function pathAllowed(rel: string, ticket: AatpTicket): boolean {
	if (ticket.forbidden_files.some((f) => underPrefix(rel, f))) return false;
	if (ticket.allowed_files.length === 0) return false;
	return ticket.allowed_files.some((f) => underPrefix(rel, f));
}
function prePlanAllowed(rel: string, state: CompanyState): boolean {
	if (state.phase === "discovery") return underPrefix(rel, "docs/product.md");
	if (state.phase !== "planning") return false;
	if (state.mode !== "plan") return matchesAny(rel, ["docs/master_plan.md", "docs/planning/"]);
	if (state.planning.stage === "draft") return underPrefix(rel, "docs/planning/master_plan_draft.md");
	if (state.planning.stage === "redteam") return underPrefix(rel, "docs/planning/plan_review.md");
	if (state.planning.stage === "synth") return underPrefix(rel, "docs/master_plan.md");
	return false;
}

export function denyToolCall(toolName: string, input: ToolInput, state: CompanyState, ctx: DenyContext = {}): { block: true; reason: string } | undefined {
		// Extension tools and the task dispatcher are known control-plane tools.
	// Unknown tools that advertise mutation semantics fail closed; ordinary
	// OMP read/fetch tools remain compatible with the extension.
	if (toolName === "fetch" || toolName === "web_fetch" || toolName === "web_search") {
		const target = String(input.url ?? input.uri ?? input.query ?? input.path ?? "");
		try {
			const urls = target.match(/https?:\/\/[^\s"']+/g) || [target];
			for (const u of urls) {
				if (!/^https?:\/\//i.test(u)) continue;
				const host = new URL(u).hostname.toLowerCase();
				if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0" ||
					/^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
					/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) || host.endsWith(".local")) {
					return { block: true, reason: "NETWORK_GATE: fetch target must not be a loopback or private network address." };
				}
			}
		} catch { /* malformed URLs are handled by the tool */ }
	}
	// Outside discovery the parent shell is read-only: every mutation must
	// flow through AATP tickets and the foundry_* tools so gates see it.
	if (state.phase !== "discovery") {
		if (toolName === "bash") {
			const command = typeof input.command === "string" ? input.command.trim() : "";
			if (!isReadOnlyGitCommand(command)) return { block: true, reason: "BASH_GATE: governed projects allow read-only git only (diff|status|log|show); mutations go through AATP tickets and foundry tools." };
			return undefined;
		}
		if (toolName === "lsp") {
			const action = typeof input.action === "string" ? input.action : "";
			if (!LSP_READ_ONLY.has(action)) return { block: true, reason: "LSP_GATE: read-only LSP actions only in a governed project; renames and edits go through AATP tickets." };
			return undefined;
		}
	}
	if (!FILE_MUTATING.has(toolName)) return;
	if (ctx.stateBroken) return { block: true, reason: `STATE_CORRUPT: ${ctx.stateBroken}. Fix .omp/foundry-state.yml.` };
	const rawPaths = collectPaths(input);
	if (rawPaths.length === 0) return { block: true, reason: `PATH_GATE: ${toolName} did not expose a verifiable target path.` };
	const rels: string[] = [];
	for (const raw of rawPaths) {
		const rel = ctx.canonicalize ? ctx.canonicalize(raw) : raw.replace(/\\/g, "/");
		if (rel === null) return { block: true, reason: `PATH_GATE: path escapes the repository: ${raw}` };
		rels.push(rel);
	}
	if (rels.some((rel) => matchesAny(rel, STATE_PATHS))) return { block: true, reason: "STATE_GATE: Foundry state is extension-owned." };
	if (rels.some((rel) => (!isReviewReport(rel) && matchesAny(rel, EXTENSION_OWNED_PATHS.filter((path) => path !== "docs/reports/review-"))) || (isReviewReport(rel) && state.phase !== "review"))) return { block: true, reason: "FOUNDRY_OWNED_GATE: extension-owned artifacts are immutable to agents." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_PLAN_PATHS)) && planLocked(state)) return { block: true, reason: "BLOCKED: PLAN_CONFLICT. MASTER_PLAN is locked." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_PRODUCT_PATHS)) && productReady(state)) return { block: true, reason: "PRODUCT_GATE: PRODUCT.md is approved." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_DESIGN_PATHS)) && state.design.status === "locked") return { block: true, reason: "BLOCKED: DESIGN_CONFLICT. Design is locked." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_AATP_PATHS)) && state.aatp.manifest_sha256) return { block: true, reason: "AATP_SPEC_GATE: AATP specs are sealed for this plan." };
	if (ctx.isolatedWithoutState) {
		if (rels.some((rel) => matchesAny(rel, [...LOCKED_PLAN_PATHS, ...LOCKED_PRODUCT_PATHS, ...LOCKED_DESIGN_PATHS, ...LOCKED_AATP_PATHS]))) return { block: true, reason: "ISOLATION_GATE: isolated worker cannot modify governance artifacts." };
		return;
	}
	if (state.mode === "plan" && state.phase === "planning" && state.planning.stage !== "idle" && state.planning.stage !== "awaiting_lock") {
		return { block: true, reason: "PLAN_COMPILER_GATE: native planning-artifact writes are disabled; the active stage agent must use foundry_plan_write." };
	}
	if (!planLocked(state)) {
		const bad = rels.filter((rel) => !prePlanAllowed(rel, state));
		if (bad.length) {
			const stage = state.mode === "plan" ? ` Plan stage=${state.planning.stage}.` : "";
			return { block: true, reason: `PLAN_GATE:${stage} pre-lock writes are limited to the active planning artifact; denied ${bad.join(", ")}.` };
		}
		return;
	}
	if (state.phase === "design" && state.design.status !== "locked") {
		const bad = rels.filter((rel) => !matchesAny(rel, LOCKED_DESIGN_PATHS));
		if (bad.length) return { block: true, reason: `DESIGN_GATE: design phase may only change design artifacts; denied ${bad.join(", ")}.` };
		return;
	}
	if (state.phase === "aatp" && !state.aatp.manifest_sha256) {
		return { block: true, reason: "AATP_COMPILER_GATE: native file writes are disabled while the DAG is unsealed; the compiler must use foundry_aatp_write." };
	}
	if (state.phase === "review") {
		const bad = rels.filter((rel) => !isReviewReport(rel));
		if (bad.length) return { block: true, reason: `REVIEW_GATE: reviewer may only write review reports; denied ${bad.join(", ")}.` };
		return;
	}
	if (state.design.required && !designAllowsUi(state)) return { block: true, reason: "DESIGN_GATE: implementation denied until /design approve or skip." };
	const tickets = ctx.activeTickets ?? [];
	if (tickets.length === 0) return { block: true, reason: "AATP_SCOPE: no active ticket." };
	const bad = rels.filter((p) => !tickets.some((t) => pathAllowed(p, t)));
	if (bad.length) return { block: true, reason: `AATP_SCOPE: no active ticket allows ${bad.join(", ")}.` };
	return undefined;
}

function patchAgentItem(item: Record<string, unknown>): Record<string, unknown> {
	const agent = String(item.agent ?? "").trim().toLowerCase();
	if (!GOVERNED.has(agent)) return item;
	const normalized = agent === item.agent ? item : { ...item, agent };
	return normalized.isolated === true ? normalized : { ...normalized, isolated: true };
}
export function forceIsolatedTaskInput(input: Record<string, unknown>): Record<string, unknown> | undefined {
	if (Array.isArray(input.tasks)) {
		let changed = false;
		const tasks = input.tasks.map((item) => {
			if (!item || typeof item !== "object") return item;
			const next = patchAgentItem(item as Record<string, unknown>); if (next !== item) changed = true; return next;
		});
		return changed ? { ...input, tasks } : undefined;
	}
	if (typeof input.agent === "string" && GOVERNED.has(input.agent.trim().toLowerCase())) {
		const normalized = input.agent.trim().toLowerCase();
		return input.isolated === true && normalized === input.agent ? undefined : { ...input, agent: normalized, isolated: true };
	}
	return undefined;
}
