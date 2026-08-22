import { designAllowsUi, planLocked, productReady } from "./state-machine";
import {
	LOCKED_DESIGN_PATHS,
	LOCKED_PLAN_PATHS,
	LOCKED_PRODUCT_PATHS,
	STATE_PATHS,
	type CompanyState,
} from "./types";

const MUTATING = new Set(["write", "edit", "ast_edit", "apply_patch", "bash", "eval"]);

const RELEASE_DENY = [
	/\bgit\s+push\b/i,
	/\bnpm\s+publish\b/i,
	/\bpnpm\s+publish\b/i,
	/\bwrangler\s+deploy\b/i,
	/\bfirebase\s+deploy\b/i,
	/\bdotnet\s+publish\b/i,
	/\bprisma\s+migrate\s+deploy\b/i,
];

export interface ToolInput {
	path?: unknown;
	file?: unknown;
	dst?: unknown;
	paths?: unknown;
	input?: unknown;
	command?: unknown;
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

function norm(path: string): string {
	return path.replace(/\\/g, "/").toLowerCase();
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

export function denyToolCall(
	toolName: string,
	input: ToolInput,
	state: CompanyState,
): { block: true; reason: string } | undefined {
	if (!MUTATING.has(toolName)) return;
	const command = typeof input.command === "string" ? input.command : "";
	if ((toolName === "bash" || toolName === "eval") && command) {
		if (!state.release.ready && RELEASE_DENY.some((re) => re.test(command))) {
			return { block: true, reason: "RELEASE_GATE: push/publish/deploy denied until /release-check is green." };
		}
	}

	const paths = collectPaths(input);
	const consider = [...paths, command];

	if (consider.some((p) => hits(p, STATE_PATHS)) || (command && bashMutates(command, STATE_PATHS))) {
		return { block: true, reason: "STATE_GATE: .omp/company-state.yml is extension-owned. Use company_* tools." };
	}

	if (planLocked(state)) {
		if (consider.some((p) => hits(p, LOCKED_PLAN_PATHS)) || (command && bashMutates(command, LOCKED_PLAN_PATHS))) {
			return {
				block: true,
				reason: "BLOCKED: PLAN_CONFLICT. docs/MASTER_PLAN.md is locked. Call report_conflict, then /plan3 after /plan-revise.",
			};
		}
	}

	if (productReady(state)) {
		if (consider.some((p) => hits(p, LOCKED_PRODUCT_PATHS)) || (command && bashMutates(command, LOCKED_PRODUCT_PATHS))) {
			return { block: true, reason: "PRODUCT_GATE: docs/PRODUCT.md is approved. Re-open via /company-init product only." };
		}
	}

	if (state.design.status === "locked") {
		if (consider.some((p) => hits(p, LOCKED_DESIGN_PATHS)) || (command && bashMutates(command, LOCKED_DESIGN_PATHS))) {
			return { block: true, reason: "BLOCKED: DESIGN_CONFLICT. Design is locked. Call report_conflict or /design." };
		}
	}

	const looksLikeSrc =
		paths.some((p) => /(?:^|\/)src\//i.test(norm(p)) || /\.(ts|tsx|js|jsx|kt|cs|xaml)$/i.test(p)) ||
		/\b(src\/|app\/)/i.test(command);

	if (looksLikeSrc && !planLocked(state)) {
		return { block: true, reason: "PLAN_GATE: implementation writes denied until master_plan.status=locked (/plan3)." };
	}

	if (looksLikeSrc && state.design.required && !designAllowsUi(state)) {
		const uiish = paths.some((p) => /\.(tsx|jsx|vue|css|xaml|kt)$/i.test(p) || /design|ui|compose|winui/i.test(norm(p)));
		if (uiish) {
			return { block: true, reason: "DESIGN_GATE: UI work denied until design.status=locked (/design approve)." };
		}
	}

	return undefined;
}
