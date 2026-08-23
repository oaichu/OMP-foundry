import { underPrefix } from "./paths";
import { designAllowsUi, planLocked, productReady } from "./state-machine";
import {
	LOCKED_AATP_PATHS,
	LOCKED_DESIGN_PATHS,
	LOCKED_PLAN_PATHS,
	LOCKED_PRODUCT_PATHS,
	PRIVILEGED_TOOLS,
	STATE_PATHS,
	type AatpTicket,
	type CompanyState,
} from "./types";

const FILE_MUTATING = new Set(["write", "edit", "ast_edit", "apply_patch"]);
const GOVERNED = new Set(["implementer", "hard-implementer", "smol-implementer", "reviewer", "security-reviewer"]);
const LSP_MUTATING = new Set(["rename", "rename_file", "code_actions", "request", "reload"]);
const RELEASE_ACTION = [
	/\bgit\s+push\b/i, /\bnpm\s+publish\b/i, /\bpnpm\s+publish\b/i, /\bbun\s+publish\b/i,
	/\bwrangler\s+deploy\b/i, /\bfirebase\s+deploy\b/i, /\bdotnet\s+publish\b/i, /\bprisma\s+migrate\s+deploy\b/i,
	/\bgh\s+release\s+create\b/i, /\bvercel\b/i, /\bnetlify\s+deploy\b/i, /\bdocker\s+push\b/i,
	/\bfly(?:ctl)?\s+deploy\b/i, /\bgcloud\s+(?:app|run|functions)\s+deploy\b/i,
];
const SHELL_META = /(?:>|<|;|&&|\|\||\||`|\$\(|\r|\n|\s&\s)/;
const READ_ONLY_BASH = [
	/^pwd$/i,
	/^ls(?:\s+-[A-Za-z]+)*(?:\s+[^;&|<>`$]+)?$/i,
	/^(?:cat|head|tail|wc|stat)\s+[^;&|<>`$]+$/i,
	/^(?:grep|rg)\s+[^;&|<>`$]+$/i,
	/^git\s+(?:status|diff|show|log|rev-parse|ls-files)(?:\s+[^;&|<>`$]+)?$/i,
];

export interface ToolInput {
	path?: unknown; file?: unknown; dst?: unknown; paths?: unknown; input?: unknown; command?: unknown; code?: unknown;
	action?: unknown; apply?: unknown; agent?: unknown; task?: unknown; tasks?: unknown; isolated?: unknown;
}
export interface DenyContext {
	activeTicket?: AatpTicket; activeTickets?: AatpTicket[]; stateBroken?: string; cwd?: string;
	canonicalize?: (raw: string) => string | null; isolatedWithoutState?: boolean;
}

export function collectPaths(input: ToolInput): string[] {
	const out: string[] = [];
	const add = (value: unknown) => { if (typeof value === "string" && value.trim()) out.push(value.trim()); else if (Array.isArray(value)) for (const item of value) add(item); };
	add(input.path); add(input.file); add(input.dst); add(input.paths);
	if (typeof input.input === "string") {
		const header = input.input.match(/^\[([^\]#]+)/m); if (header?.[1]) add(header[1]);
		for (const match of input.input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) add(match[1]);
	}
	return out;
}
export function looksLikeImpl(rel: string): boolean {
	if (rel.startsWith("docs/") || rel.endsWith(".md")) return false;
	if (/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|kt|kts|java|cs|xaml|py|go|rs|swift|dart|php|rb|c|cc|cpp|h|hpp|m|mm)$/i.test(rel)) return true;
	return /^(src|app|lib|cmd|pkg|internal|android|ios|windows|server|backend|frontend)\//.test(rel);
}
function matchesAny(rel: string, needles: string[]): boolean { return needles.some((needle) => underPrefix(rel, needle)); }
export function pathAllowed(rel: string, ticket: AatpTicket): boolean {
	if (ticket.forbidden_files.some((f) => underPrefix(rel, f))) return false;
	if (ticket.allowed_files.length === 0) return false;
	return ticket.allowed_files.some((f) => underPrefix(rel, f));
}
function bashAllowed(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed || SHELL_META.test(trimmed) || /--output(?:=|\s)/i.test(trimmed)) return false;
	return READ_ONLY_BASH.some((re) => re.test(trimmed));
}
function prePlanAllowed(rel: string, state: CompanyState): boolean {
	if (state.phase === "discovery") return underPrefix(rel, "docs/product.md");
	if (state.phase !== "planning") return false;
	if (state.mode !== "plan3") return matchesAny(rel, ["docs/master_plan.md", "docs/planning/"]);
	if (state.planning.stage === "draft") return underPrefix(rel, "docs/planning/master_plan_draft.md");
	if (state.planning.stage === "redteam") return underPrefix(rel, "docs/planning/plan_review.md");
	if (state.planning.stage === "synth") return underPrefix(rel, "docs/master_plan.md");
	return false;
}

export function denyToolCall(toolName: string, input: ToolInput, state: CompanyState, ctx: DenyContext = {}): { block: true; reason: string } | undefined {
	if (toolName === "eval") return { block: true, reason: "EVAL_GATE: eval is denied for the entire Foundry session." };
	if (toolName === "lsp") {
		const action = String(input.action ?? "").toLowerCase();
		if (LSP_MUTATING.has(action) || (action === "code_actions" && input.apply === true)) return { block: true, reason: `LSP_GATE: mutating LSP action ${action || "unknown"} is denied; use read-only navigation/diagnostics.` };
		return;
	}
	if (toolName === "bash") {
		const command = String(input.command ?? "");
		if (RELEASE_ACTION.some((re) => re.test(command))) return { block: true, reason: "RELEASE_GATE: agent push/publish/deploy is always denied. Run /release-check, then release from a human shell." };
		if (!bashAllowed(command)) return { block: true, reason: "BASH_GATE: arbitrary shell is denied in Foundry. Use read-only shell commands or extension-owned verification." };
		return;
	}
	if (!FILE_MUTATING.has(toolName)) return;
	if (ctx.stateBroken && !PRIVILEGED_TOOLS.has(toolName)) return { block: true, reason: `STATE_CORRUPT: ${ctx.stateBroken}. Fix .omp/foundry-state.yml.` };
	const rawPaths = collectPaths(input);
	if (rawPaths.length === 0) return { block: true, reason: `PATH_GATE: ${toolName} did not expose a verifiable target path.` };
	const rels: string[] = [];
	for (const raw of rawPaths) {
		const rel = ctx.canonicalize ? ctx.canonicalize(raw) : raw.replace(/\\/g, "/").toLowerCase();
		if (rel === null) return { block: true, reason: `PATH_GATE: path escapes the repository: ${raw}` };
		rels.push(rel);
	}
	if (rels.some((rel) => matchesAny(rel, STATE_PATHS))) return { block: true, reason: "STATE_GATE: Foundry state is extension-owned." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_PLAN_PATHS)) && planLocked(state)) return { block: true, reason: "BLOCKED: PLAN_CONFLICT. MASTER_PLAN is locked." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_PRODUCT_PATHS)) && productReady(state)) return { block: true, reason: "PRODUCT_GATE: PRODUCT.md is approved." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_DESIGN_PATHS)) && state.design.status === "locked") return { block: true, reason: "BLOCKED: DESIGN_CONFLICT. Design is locked." };
	if (rels.some((rel) => matchesAny(rel, LOCKED_AATP_PATHS)) && state.aatp.manifest_sha256) return { block: true, reason: "AATP_SPEC_GATE: AATP specs are sealed for this plan." };
	if (ctx.isolatedWithoutState) {
		if (rels.some((rel) => matchesAny(rel, [...LOCKED_PLAN_PATHS, ...LOCKED_PRODUCT_PATHS, ...LOCKED_DESIGN_PATHS, ...LOCKED_AATP_PATHS]))) return { block: true, reason: "ISOLATION_GATE: isolated worker cannot modify governance artifacts." };
		return;
	}
	if (!planLocked(state)) {
		const bad = rels.filter((rel) => !prePlanAllowed(rel, state));
		if (bad.length) {
			const stage = state.mode === "plan3" ? ` Plan3 stage=${state.planning.stage}.` : "";
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
		const bad = rels.filter((rel) => !matchesAny(rel, LOCKED_AATP_PATHS));
		if (bad.length) return { block: true, reason: `AATP_SPEC_GATE: AATP generation may only change docs/AATP; denied ${bad.join(", ")}.` };
		return;
	}
	if (state.phase === "review") {
		const bad = rels.filter((rel) => !underPrefix(rel, "docs/reports/review-"));
		if (bad.length) return { block: true, reason: `REVIEW_GATE: reviewer may only write review reports; denied ${bad.join(", ")}.` };
		return;
	}
	if (state.design.required && !designAllowsUi(state)) return { block: true, reason: "DESIGN_GATE: implementation denied until /design approve or skip." };
	const tickets = ctx.activeTickets ?? (ctx.activeTicket ? [ctx.activeTicket] : []);
	if (tickets.length === 0) return { block: true, reason: "AATP_SCOPE: no active ticket." };
	const bad = rels.filter((p) => !tickets.some((t) => pathAllowed(p, t)));
	if (bad.length) return { block: true, reason: `AATP_SCOPE: no active ticket allows ${bad.join(", ")}.` };
	return undefined;
}

function patchAgentItem(item: Record<string, unknown>): Record<string, unknown> {
	const agent = String(item.agent ?? "");
	if (!GOVERNED.has(agent)) return item;
	return item.isolated === true ? item : { ...item, isolated: true };
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
	if (typeof input.agent === "string" && GOVERNED.has(input.agent) && input.isolated !== true) return { ...input, isolated: true };
	return undefined;
}
