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

export interface ToolInput {
	path?: unknown;
	file?: unknown;
	dst?: unknown;
	paths?: unknown;
	input?: unknown;
	command?: unknown;
	code?: unknown;
}

export interface DenyContext {
	activeTicket?: AatpTicket;
	stateBroken?: string;
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

export function norm(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function hits(path: string, needles: string[]): boolean {
	const n = norm(path);
	return needles.some((needle) => n.includes(needle));
}

function bashMutates(command: string, needles: string[]): boolean {
	const lower = command.toLowerCase();
	if (!needles.some((needle) => lower.includes(needle))) return false;
	return /(>|>>|\btee\b|\brm\s|\bmv\s|\bcp\s|\bsed\s+-i|\bperl\s+-i)/i.test(command);
}

export function looksLikeImpl(path: string): boolean {
	const n = norm(path);
	if (n.includes("/docs/") || n.endsWith(".md")) return false;
	if (IMPL_EXT.test(n)) return true;
	return /(^|\/)(src|app|lib|cmd|pkg|internal|android|ios|windows|server|backend|frontend)\//.test(n);
}

function pathAllowed(path: string, ticket: AatpTicket): boolean {
	const n = norm(path);
	if (ticket.forbidden_files.some((f) => n.includes(norm(f)))) return false;
	if (ticket.allowed_files.length === 0) return !looksLikeImpl(path);
	return ticket.allowed_files.some((f) => n.includes(norm(f)) || norm(f).includes(n));
}

export function denyToolCall(
	toolName: string,
	input: ToolInput,
	state: CompanyState,
	ctx: DenyContext = {},
): { block: true; reason: string } | undefined {
	if (ctx.stateBroken) {
		if (MUTATING.has(toolName) && !PRIVILEGED_TOOLS.has(toolName)) {
			return { block: true, reason: `STATE_CORRUPT: ${ctx.stateBroken}. Fix .omp/foundry-state.yml.` };
		}
	}

	if (toolName === "eval" && planLocked(state)) {
		return {
			block: true,
			reason: "EVAL_GATE: eval is denied after plan lock. Isolated implementer + write/edit only. No code-scan bypass.",
		};
	}

	if (!MUTATING.has(toolName)) return;
	const command = typeof input.command === "string" ? input.command : "";
	if ((toolName === "bash" || toolName === "eval") && command) {
		if (!state.release.ready && RELEASE_DENY.some((re) => re.test(command))) {
			return { block: true, reason: "RELEASE_GATE: push/publish/deploy denied until derived release is green." };
		}
	}

	const paths = collectPaths(input);
	const consider = [...paths, command];

	if (consider.some((p) => hits(p, STATE_PATHS)) || (command && bashMutates(command, STATE_PATHS))) {
		return { block: true, reason: "STATE_GATE: .omp/foundry-state.yml is extension-owned." };
	}

	if (planLocked(state)) {
		if (consider.some((p) => hits(p, LOCKED_PLAN_PATHS)) || (command && bashMutates(command, LOCKED_PLAN_PATHS))) {
			return {
				block: true,
				reason: "BLOCKED: PLAN_CONFLICT. docs/MASTER_PLAN.md is locked. report_conflict then human /foundry approve-plan.",
			};
		}
	}

	if (productReady(state)) {
		if (consider.some((p) => hits(p, LOCKED_PRODUCT_PATHS)) || (command && bashMutates(command, LOCKED_PRODUCT_PATHS))) {
			return { block: true, reason: "PRODUCT_GATE: docs/PRODUCT.md is approved." };
		}
	}

	if (state.design.status === "locked") {
		if (consider.some((p) => hits(p, LOCKED_DESIGN_PATHS)) || (command && bashMutates(command, LOCKED_DESIGN_PATHS))) {
			return { block: true, reason: "BLOCKED: DESIGN_CONFLICT. Design is locked." };
		}
	}

	const implPaths = paths.filter((p) => looksLikeImpl(p));
	if (implPaths.length > 0 && !planLocked(state)) {
		return { block: true, reason: "PLAN_GATE: implementation writes denied until master_plan.status=locked." };
	}

	if (implPaths.length > 0 && state.design.required && !designAllowsUi(state)) {
		const uiish = implPaths.some((p) => /\.(tsx|jsx|vue|css|xaml|kt)$/i.test(p) || /design|ui|compose|winui/i.test(norm(p)));
		if (uiish) {
			return { block: true, reason: "DESIGN_GATE: UI work denied until /design approve." };
		}
	}

	if (ctx.activeTicket && implPaths.length > 0) {
		const bad = implPaths.filter((p) => !pathAllowed(p, ctx.activeTicket!));
		if (bad.length > 0) {
			return {
				block: true,
				reason: `AATP_SCOPE: ${ctx.activeTicket.id} cannot write ${bad.join(", ")}.`,
			};
		}
	}

	return undefined;
}

export function forceIsolatedTaskInput(input: Record<string, unknown>): Record<string, unknown> | undefined {
	const tasks = input.tasks;
	if (!Array.isArray(tasks)) return undefined;
	let changed = false;
	const next = tasks.map((item) => {
		if (!item || typeof item !== "object") return item;
		const rec = item as Record<string, unknown>;
		const agent = String(rec.agent ?? "");
		if ((agent === "implementer" || agent === "hard-implementer") && rec.isolated !== true) {
			changed = true;
			return { ...rec, isolated: true };
		}
		return rec;
	});
	return changed ? { ...input, tasks: next } : undefined;
}
