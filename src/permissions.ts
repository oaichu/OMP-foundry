import { underPrefix } from "./paths";
import { deriveRelease } from "./release";
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
	/\bgh\s+release\s+create\b/i,
	/\bvercel\s+(?:deploy|publish|--prod)\b/i,
	/\bnetlify\s+deploy\b/i,
	/\bdocker\s+push\b/i,
	/\bfly(?:ctl)?\s+deploy\b/i,
	/\bgcloud\s+(?:app|run|functions)\s+deploy\b/i,
];

// Arbitrary inline code execution is equivalent to the eval tool, which the
// governance model denies for the whole session.
const EVAL_LIKE = [
	/\bnode\s+(?:-e|--eval)\b/,
	/\bdeno\s+(?:eval\b|-e\b)/,
	/\bpython[23]?\s+(?:-c\b|--command\b)/,
	/\bperl\s+(?:-e\b|--eval\b)/,
	/\bruby\s+(?:-e\b|--eval\b)/,
];

// Workspace mutators whose effects Foundry cannot inspect path-by-path once
// the plan is locked; inspectable tools (write/edit/apply_patch) remain open.
const WORKSPACE_MUTATORS = [
	/\bgit\s+apply\b/,
	/(?:^|[\s;])patch\s+-/,
	/\bgit\s+checkout\s+--/,
	/\bgit\s+restore\b/,
	/\bgit\s+clean\b/,
	/\bgit\s+stash\s+(?:push|drop|clear)\b/,
];

const IMPL_EXT =
	/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|kt|kts|java|cs|xaml|py|go|rs|swift|dart|php|rb|c|cc|cpp|h|hpp|m|mm)$/i;

const GOVERNED = new Set(["implementer", "hard-implementer", "smol-implementer"]);

const NON_PATH_TARGET = /^(?:&\d+|\/dev\/(?:null|stdin|stdout|stderr|tty|fd\/\d+))$/i;

function isPathLike(token: string): boolean {
	if (!token || NON_PATH_TARGET.test(token)) return false;
	if (token.startsWith("-") || token.startsWith("$")) return false;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) return false;
	return true;
}

function lastToken(segment: string): string | undefined {
	const tokens = segment.trim().split(/\s+/).filter(Boolean);
	return tokens[tokens.length - 1];
}

// Heuristic extraction of filesystem write targets from a shell command so
// redirect-style mutation runs through the same path gates as write/edit.
export function bashWriteTargets(command: string): string[] {
	const out: string[] = [];
	const add = (token: string | undefined) => {
		if (token && isPathLike(token)) out.push(token);
	};
	for (const rawSegment of command.split(/&&|\|\||;|\||&|\n/)) {
		const segment = rawSegment.trim();
		if (!segment) continue;
		for (const match of segment.matchAll(/(?:>>?)\s*(\S+)/g)) add(match[1]);
		for (const match of segment.matchAll(/\btee\s+(?:-[a-z]+\s+)*([^\s;&|)]+)/gi)) add(match[1]);
		for (const match of segment.matchAll(/\bdd\s+[^;]*?\bof=(\S+)/gi)) add(match[1]);
		if (/\bsed\b[^|]*\s-i/.test(segment) || /\bperl\b[^|]*\s-[a-z]*i[a-z]*\b/.test(segment)) add(lastToken(segment));
		if (/\b(?:cp|mv|rsync|install)\s/.test(segment)) add(lastToken(segment));
		if (/\b(?:rm|unlink)\s/.test(segment)) {
			for (const token of segment.split(/\s+/)) {
				if (/^(?:rm|unlink)$/i.test(token) || token.startsWith("-")) continue;
				add(token);
			}
		}
	}
	return [...new Set(out)];
}

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
	if (!MUTATING.has(toolName)) return;
	const command = typeof input.command === "string" ? input.command : "";

	if (toolName === "bash" && command && EVAL_LIKE.some((re) => re.test(command))) {
		return { block: true, reason: "EVAL_GATE: inline code execution (node -e, python -c, …) is denied. Use write/edit files instead." };
	}

	if (ctx.stateBroken && !PRIVILEGED_TOOLS.has(toolName)) {
		return { block: true, reason: `STATE_CORRUPT: ${ctx.stateBroken}. Fix .omp/foundry-state.yml.` };
	}

	if (toolName === "bash" && command && planLocked(state) && WORKSPACE_MUTATORS.some((re) => re.test(command))) {
		return { block: true, reason: "MUTATOR_GATE: git apply/patch/restore/clean cannot be verified path-by-path. Land changes via write/edit/apply_patch." };
	}

	if (toolName === "bash" && command && RELEASE_DENY.some((re) => re.test(command))) {
		if (ctx.cwd) deriveRelease(ctx.cwd, state);
		if (!state.release.ready) {
			return { block: true, reason: "RELEASE_GATE: push/publish/deploy denied until the release gate is green at execution time." };
		}
	}

	const rawPaths = toolName === "bash" ? [...collectPaths(input), ...bashWriteTargets(command)] : collectPaths(input);
	const canon = ctx.canonicalize;
	const rels: string[] = [];
	for (const raw of rawPaths) {
		const rel = canon ? canon(raw) : raw.replace(/\\/g, "/").toLowerCase();
		if (rel === null) {
			return { block: true, reason: `PATH_GATE: path escapes the repository: ${raw}` };
		}
		rels.push(rel);
	}

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
