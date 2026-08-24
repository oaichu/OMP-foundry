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
const READ_PATH_TOOLS = new Set(["read", "read_file", "read_text", "grep", "glob", "find", "list_files", "ls", "ast_grep"]);
const SAFE_CONTROL_TOOLS = new Set(["task", "fetch", "web_fetch", "web_search", "question", "ask", "report_conflict", "todo", "memory", "plan", "compact", "session"]);
const FOUNDRY_CONTROL_TOOLS = new Set(["foundry_status", "foundry_skill_read", "foundry_exec", "foundry_aatp_write", "foundry_plan_write", "foundry_approve", "foundry_step"]);
const GOVERNED = new Set(["implementer", "hard-implementer", "smol-implementer", "reviewer", "security-reviewer"]);
const LSP_MUTATING = new Set(["rename", "rename_file", "code_actions", "request", "reload"]);
const LSP_READ_ONLY = new Set(["hover", "definition", "type_definition", "implementation", "references", "document_symbol", "workspace_symbol", "completion", "signature_help", "diagnostics", "document_diagnostics", "workspace_diagnostics", "folding_range", "inlay_hints"]);
const RELEASE_ACTION = [
	/\bgit\s+push\b/i, /\bnpm\s+publish\b/i, /\bpnpm\s+publish\b/i, /\bbun\s+publish\b/i,
	/\bwrangler\s+deploy\b/i, /\bfirebase\s+deploy\b/i, /\bdotnet\s+publish\b/i, /\bprisma\s+migrate\s+deploy\b/i,
	/\bgh\s+release\s+create\b/i, /\bvercel\b/i, /\bnetlify\s+deploy\b/i, /\bdocker\s+push\b/i,
	/\bfly(?:ctl)?\s+deploy\b/i, /\bgcloud\s+(?:app|run|functions)\s+deploy\b/i,
];
const EXTENSION_OWNED_PATHS = [
	...STATE_PATHS,
	".omp/config.yml",
	".omp/config.yaml",
	"docs/.foundry-governed",
	"docs/reports/qa.md",
	"docs/reports/review-",
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
function collectReadPaths(input: ToolInput, toolName = ""): string[] {
	const paths = collectPaths(input);
	for (const value of [input.cwd, input.directory, input.root, input.base]) {
		if (typeof value === "string" && value.trim()) paths.push(value.trim());
	}
	if (toolName === "glob" && typeof input.pattern === "string" && input.pattern.trim()) paths.push(input.pattern.trim());
	// LSP clients commonly nest the target under textDocument.uri.  Only
	// inspect the documented path-bearing fields; arbitrary JSON strings must
	// not become an authorization bypass.
	const addUri = (value: unknown): void => {
		if (typeof value === "string" && value.trim()) paths.push(value.trim());
		else if (value && typeof value === "object") {
			const record = value as Record<string, unknown>;
			for (const key of ["uri", "path", "file"]) addUri(record[key]);
		}
	};
	addUri(input.uri); addUri(input.textDocument);
	return [...new Set(paths)];
}
function readPathEscapes(raw: string, canonicalize?: (raw: string) => string | null): boolean {
	if (!raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) return true;
	if (/^(?:[a-z]:[\\/]|[\\/]|~[\\/])/i.test(raw) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(raw)) return true;
	return canonicalize ? canonicalize(raw) === null : false;
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
function bashAllowed(command: string, canonicalize?: (raw: string) => string | null): boolean {
	const trimmed = command.trim();
	if (!trimmed || SHELL_META.test(trimmed) || /--output(?:=|\s)/i.test(trimmed)) return false;
	if (/^(?:[a-z]:[\\/]|[\\/]|~[\\/])/i.test(trimmed) || /(?:^|\s)\.\.(?:[\\/]|\s|$)/.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) return false;
	if (/(?:--ext-diff|--textconv|--paginate|--exec-path|--upload-pack|--receive-pack|--config(?:=|\s)|--pre(?:=|\s)|--command(?:=|\s)|--plugin(?:=|\s))/i.test(trimmed)) return false;
	if (/\b(?:tail|head)\b[^;&|<>`$]*(?:\s|^)(?:-[A-Za-z]*f[A-Za-z]*|--follow|--pid|--retry)\b/i.test(trimmed) || /\b(?:cat|head|tail|wc|stat|grep|rg)\b[^;&|<>`$]{0,4096}$/.test(trimmed) === false && trimmed.length > 4096) return false;
	if (!READ_ONLY_BASH.some((re) => re.test(trimmed))) return false;
	if (!canonicalize) return true;
	const tokens = trimmed.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*'|[^\s]+/g)?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
	for (const token of tokens.slice(1)) {
		if (!token || token === "--" || token.startsWith("-")) continue;
		if (canonicalize(token) === null) return false;
	}
	return true;
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
		if (!LSP_READ_ONLY.has(action)) return { block: true, reason: `LSP_GATE: unknown or non-read-only action ${action || "unknown"} is denied.` };
		const paths = collectReadPaths(input, toolName);
		if (paths.length === 0 || paths.some((path) => readPathEscapes(path, ctx.canonicalize))) return { block: true, reason: "PATH_GATE: read-only LSP request must expose an in-repository target." };
		return;
	}
	if (toolName === "bash") {
		const command = String(input.command ?? "");
		if (RELEASE_ACTION.some((re) => re.test(command))) return { block: true, reason: "RELEASE_GATE: agent push/publish/deploy is always denied. Run /release-check, then release from a human shell." };
		if (!bashAllowed(command, ctx.canonicalize)) return { block: true, reason: "BASH_GATE: arbitrary shell is denied in Foundry. Use read-only shell commands or extension-owned verification." };
		return;
	}
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
	if (toolName === "foundry_init") return { block: true, reason: "FOUNDRY_INIT_GATE: initialization is human-command-only; use /foundry-init or /foundry." };
	if (!FILE_MUTATING.has(toolName) && !SAFE_CONTROL_TOOLS.has(toolName) && !FOUNDRY_CONTROL_TOOLS.has(toolName) && !READ_PATH_TOOLS.has(toolName) && toolName !== "bash" && toolName !== "lsp") {
		return { block: true, reason: "TOOL_GATE: unknown mutation-capable tool is denied in Foundry." };
	}
	if (READ_PATH_TOOLS.has(toolName)) {
		const paths = collectReadPaths(input, toolName);
		if (paths.length === 0 || paths.some((path) => readPathEscapes(path, ctx.canonicalize))) return { block: true, reason: "PATH_GATE: read-only tool must expose an in-repository target path." };
		return;
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
	if (state.mode === "plan3" && state.phase === "planning" && state.planning.stage !== "idle" && state.planning.stage !== "awaiting_lock") {
		return { block: true, reason: "PLAN3_COMPILER_GATE: native planning-artifact writes are disabled; the active stage agent must use foundry_plan_write." };
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
