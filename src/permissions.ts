import { underPrefix } from "./paths";
import { designAllowsUi, planLocked, productReady } from "./state-machine";
import {
	LOCKED_DESIGN_PATHS,
	LOCKED_PLAN_PATHS,
	LOCKED_PRODUCT_PATHS,
	PRIVILEGED_TOOLS,
	STATE_PATHS,
	type AatpTicket,
	type CompanyState,
} from "./types";

const MUTATING = new Set(["write", "edit", "ast_edit", "apply_patch", "bash", "eval"]);

const RELEASE_DENY = [
	/\bgit\s+push\b/i,
	/\bnpm\s+publish\b/i,
	/\bpnpm\s+publish\b/i,
	/\bbun\s+publish\b/i,
	/\bwrangler\s+deploy\b/i,
	/\bfirebase\s+deploy\b/i,
	/\bdotnet\s+publish\b/i,
	/\bprisma\s+migrate\s+deploy\b/i,
];

const IMPL_EXT =
	/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|kt|kts|java|cs|xaml|py|go|rs|swift|dart|php|rb|c|cc|cpp|h|hpp|m|mm)$/i;

const GOVERNED = new Set(["implementer", "hard-implementer", "smol-implementer"]);

export interface ToolInput {
	path?: unknown;
	file?: unknown;
	dst?: unknown;
	paths?: unknown;
	input?: unknown;
	command?: unknown;
	code?: unknown;
	agent?: unknown;
	task?: unknown;
	tasks?: unknown;
}

export interface DenyContext {
	activeTicket?: AatpTicket;
	activeTickets?: AatpTicket[];
	stateBroken?: string;
	cwd?: string;
	canonicalize?: (raw: string) => string | null;
}

export function collectPaths(input: ToolInput): string[] {
	const out: string[] = [];
	const add = (value: unknown) => {
		if (typeof value === "string" && value.trim()) out.push(value.trim());
		else if (Array.isArray(value)) for (const item of value) add(item);
	};
	add(input.path);
	add(input.file);
	add(input.dst);
	add(input.paths);
	if (typeof input.input === "string") {
		const header = input.input.match(/^\[([^\]#]+)/m);
		if (header?.[1]) add(header[1]);
		for (const match of input.input.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)) add(match[1]);
	}
	return out;
}

export function looksLikeImpl(rel: string): boolean {
	if (rel.startsWith("docs/") || rel.endsWith(".md")) return false;
	if (IMPL_EXT.test(rel)) return true;
	return /^(src|app|lib|cmd|pkg|internal|android|ios|windows|server|backend|frontend)\//.test(rel);
}

function matchesAny(rel: string, needles: string[]): boolean {
	return needles.some((needle) => underPrefix(rel, needle));
}

export function pathAllowed(rel: string, ticket: AatpTicket): boolean {
	if (ticket.forbidden_files.some((f) => underPrefix(rel, f))) return false;
	if (ticket.allowed_files.length === 0) return !looksLikeImpl(rel);
	return ticket.allowed_files.some((f) => underPrefix(rel, f));
}

export function denyToolCall(
	toolName: string,
	input: ToolInput,
	state: CompanyState,
	ctx: DenyContext = {},
): { block: true; reason: string } | undefined {
	if (toolName === "eval") {
		return { block: true, reason: "EVAL_GATE: eval is denied for the entire Foundry session." };
	}

	if (ctx.stateBroken && MUTATING.has(toolName) && !PRIVILEGED_TOOLS.has(toolName)) {
		return { block: true, reason: `STATE_CORRUPT: ${ctx.stateBroken}. Fix .omp/foundry-state.yml.` };
	}

	if (!MUTATING.has(toolName)) return;
	const command = typeof input.command === "string" ? input.command : "";
	if (toolName === "bash" && command && !state.release.ready && RELEASE_DENY.some((re) => re.test(command))) {
		return { block: true, reason: "RELEASE_GATE: push/publish/deploy denied until derived release is green." };
	}

	const canon = ctx.canonicalize;
	const rawPaths = collectPaths(input);
	const rels = canon ? rawPaths.map(canon).filter((p): p is string => Boolean(p)) : rawPaths.map((p) => p.replace(/\\/g, "/").toLowerCase());

	if (rels.some((rel) => matchesAny(rel, STATE_PATHS))) {
		return { block: true, reason: "STATE_GATE: .omp/foundry-state.yml is extension-owned." };
	}

	if (planLocked(state) && rels.some((rel) => matchesAny(rel, LOCKED_PLAN_PATHS))) {
		return { block: true, reason: "BLOCKED: PLAN_CONFLICT. MASTER_PLAN is locked." };
	}

	if (productReady(state) && rels.some((rel) => matchesAny(rel, LOCKED_PRODUCT_PATHS))) {
		return { block: true, reason: "PRODUCT_GATE: PRODUCT.md is approved." };
	}

	if (state.design.status === "locked" && rels.some((rel) => matchesAny(rel, LOCKED_DESIGN_PATHS))) {
		return { block: true, reason: "BLOCKED: DESIGN_CONFLICT. Design is locked." };
	}

	const impl = rels.filter(looksLikeImpl);
	if (impl.length > 0 && !planLocked(state)) {
		return { block: true, reason: "PLAN_GATE: implementation writes denied until plan lock." };
	}

	if (impl.length > 0 && state.design.required && !designAllowsUi(state)) {
		const uiish = impl.some((p) => /\.(tsx|jsx|vue|css|xaml|kt)$/i.test(p) || /(?:^|\/)(ui|design|compose|winui)\//.test(p));
		if (uiish) return { block: true, reason: "DESIGN_GATE: UI work denied until /design approve." };
	}

	if (impl.length > 0 && planLocked(state)) {
		const tickets = ctx.activeTickets ?? (ctx.activeTicket ? [ctx.activeTicket] : []);
		if (tickets.length === 0) {
			return { block: true, reason: "AATP_SCOPE: no active ticket." };
		}
		const bad = impl.filter((p) => !tickets.some((t) => pathAllowed(p, t)));
		if (bad.length) {
			return { block: true, reason: `AATP_SCOPE: no active ticket allows ${bad.join(", ")}.` };
		}
	}


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
			const next = patchAgentItem(item as Record<string, unknown>);
			if (next !== item) changed = true;
			return next;
		});
		return changed ? { ...input, tasks } : undefined;
	}
	if (typeof input.agent === "string" && GOVERNED.has(input.agent) && input.isolated !== true) {
		return { ...input, isolated: true };
	}
	return undefined;
}
