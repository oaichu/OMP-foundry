import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { listAatp, readyIndependent, routeAgent, summarizeAatp, writeAatpIndex } from "./aatp";
import { CONTEXT_POLICY, phasePrompt } from "./context-policy";
import { requireDesignIfUi, requirePlan, requireProduct } from "./gates";
import { denyToolCall, forceIsolatedTaskInput, type ToolInput } from "./permissions";
import { deriveRelease, invalidateQa, refreshArtifactHashes } from "./release";
import { resolveSkills, skillPackPrompt } from "./skills/resolver";
import { detectStack } from "./stack-detector";
import { consumeCap, grantCap, loadState, loadStateResult, recountTickets, saveState, stateFileExists } from "./state-machine";
import { type CompanyState, defaultState } from "./types";
import { applyQa, runVerify } from "./verify-runner";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUSTOM = "com.omp.company-workflow.state";

function token(): string {
	return randomBytes(16).toString("hex");
}

function copyTemplate(cwd: string, name: string): void {
	const dest = join(cwd, "docs", name);
	if (existsSync(dest)) return;
	mkdirSync(dirname(dest), { recursive: true });
	const src = join(ROOT, "templates", name);
	if (existsSync(src)) writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
}

function persist(cwd: string, state: CompanyState): CompanyState {
	saveState(cwd, state);
	return state;
}

function orchestrate(pi: ExtensionAPI, title: string, body: string): void {
	pi.sendUserMessage([title, "", body, "", CONTEXT_POLICY].join("\n"));
}

export default function ompCompanyWorkflow(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.setLabel("OMP Foundry");

	const statusOf = (state: CompanyState): string =>
		`${state.phase} plan=${state.master_plan.status} design=${state.design.status}`;

	const safeState = (cwd: string): { state: CompanyState; broken?: string } => {
		const loaded = loadStateResult(cwd);
		if (!loaded.ok) return { state: defaultState(), broken: loaded.reason };
		return { state: loaded.state };
	};

	pi.on("session_start", async (_e, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		ctx.ui.setStatus("foundry", broken ? "STATE_CORRUPT" : statusOf(state));
	});

	pi.on("before_agent_start", async (_e, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		const skills = broken ? [] : resolveSkills(ctx.cwd, state);
		return {
			message: {
				customType: CUSTOM,
				content: broken
					? `Foundry state corrupt: ${broken}`
					: `${phasePrompt(state.phase)} ${statusOf(state)}. ${skillPackPrompt(skills, state.phase)}`,
				display: true,
				details: { ...state, unlock_token: undefined, skills },
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "task") {
			const raw = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			const isolated = forceIsolatedTaskInput(raw);
			if (isolated) return { input: isolated };
		}
		if (
			String(event.toolName).startsWith("company_") ||
			event.toolName.startsWith("plan_") ||
			event.toolName.startsWith("aatp_") ||
			event.toolName === "report_conflict"
		) {
			return;
		}
		const { state, broken } = safeState(ctx.cwd);
		const active = Object.values(state.tickets).filter((t) => t.status === "active");
		return denyToolCall(event.toolName, (event.input ?? {}) as ToolInput, state, {
			stateBroken: broken,
			activeTicket: active.length === 1 ? active[0] : undefined,
		});
	});

	pi.registerTool({
		name: "company_status",
		label: "Foundry Status",
		description: "Read .omp/foundry-state.yml and AATP counters. No writes.",
		loadMode: "essential",
		approval: "read",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			const { state, broken } = safeState(ctx.cwd);
			if (broken) return { content: [{ type: "text", text: broken }], isError: true };
			const tasks = listAatp(ctx.cwd);
			const stack = detectStack(ctx.cwd);
			const publicState = { ...state, aatp: summarizeAatp(tasks), unlock_token: undefined, stack };
			return {
				content: [{ type: "text", text: JSON.stringify(publicState, null, 2) }],
				details: publicState,
			};
		},
	});

	pi.registerTool({
		name: "company_init",
		label: "Foundry Init",
		description: "Create docs templates and .omp/foundry-state.yml if missing. Never clobber existing foundry state.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({
			name: z.string().optional(),
		}),
		async execute(_id, params, _s, _u, ctx) {
			mkdirSync(join(ctx.cwd, "docs", "planning"), { recursive: true });
			mkdirSync(join(ctx.cwd, "docs", "AATP"), { recursive: true });
			mkdirSync(join(ctx.cwd, "docs", "reports"), { recursive: true });
			for (const name of ["PRODUCT.md", "MASTER_PLAN.md", "DESIGN.md", "SECURITY.md", "ARCHITECTURE.md", "AATP.md", "RELEASE_REPORT.md"]) {
				copyTemplate(ctx.cwd, name);
			}
			const existed = stateFileExists(ctx.cwd);
			const existing = existed ? loadState(ctx.cwd) : defaultState();
			const stack = detectStack(ctx.cwd);
			if (!existed) {
				existing.design.required = stack.ui;
				existing.phase = "discovery";
				persist(ctx.cwd, existing);
			}
			ctx.ui.setStatus("foundry", statusOf(existing));
			return {
				content: [
					{
						type: "text",
						text: `${existed ? "Kept" : "Initialized"} foundry state. stack=${stack.ids.join(",")} ui=${stack.ui} name=${params.name ?? ""}`,
					},
				],
				details: existing,
			};
		},
	});

	pi.registerTool({
		name: "product_approve",
		label: "Product Approve",
		description: "Mark PRODUCT approved. Requires a live human capability from /foundry approve-product.",
		loadMode: "discoverable",
		approval: "write",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			if (!existsSync(join(ctx.cwd, "docs", "PRODUCT.md"))) {
				return { content: [{ type: "text", text: "docs/PRODUCT.md missing." }], isError: true };
			}
			const state = loadState(ctx.cwd);
			if (!consumeCap(state, "product_approve")) {
				return { content: [{ type: "text", text: "HUMAN_GATE: run /foundry approve-product." }], isError: true };
			}
			state.product.status = "approved";
			state.phase = "planning";
			refreshArtifactHashes(ctx.cwd, state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: "PRODUCT approved." }], details: state };
		},
	});

	pi.registerTool({
		name: "plan_commit",
		label: "Plan Commit",
		description: "Lock MASTER_PLAN. Requires /foundry approve-plan human capability.",
		loadMode: "discoverable",
		approval: "write",
		parameters: z.object({
			unlockToken: z.string().optional(),
			version: z.string().optional(),
		}),
		async execute(_id, params, _s, _u, ctx) {
			if (!existsSync(join(ctx.cwd, "docs", "MASTER_PLAN.md"))) {
				return { content: [{ type: "text", text: "docs/MASTER_PLAN.md missing." }], isError: true };
			}
			const state = loadState(ctx.cwd);
			if (!consumeCap(state, "plan_lock")) {
				return { content: [{ type: "text", text: "HUMAN_GATE: run /foundry approve-plan after reading the draft." }], isError: true };
			}
			if (state.unlock_token && params.unlockToken !== state.unlock_token) {
				return { content: [{ type: "text", text: "unlockToken mismatch." }], isError: true };
			}
			state.master_plan.status = "locked";
			state.master_plan.version = params.version || (state.master_plan.version === "0" ? "1.0" : state.master_plan.version);
			state.unlock_token = "";
			state.conflict = { kind: "none", reason: "" };
			state.phase = state.design.required ? "design" : "aatp";
			refreshArtifactHashes(ctx.cwd, state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `PLAN LOCKED v${state.master_plan.version}` }], details: state };
		},
	});
	pi.registerTool({
		name: "design_skip",
		label: "Design Skip",
		description: "Mark design not required. Requires /design skip human capability.",
		loadMode: "discoverable",
		approval: "write",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			if (!consumeCap(state, "design_skip")) {
				return { content: [{ type: "text", text: "HUMAN_GATE: run /design skip." }], isError: true };
			}
			state.design.required = false;
			state.design.status = "not_required";
			state.phase = "aatp";
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: "DESIGN not required." }], details: state };
		},
	});

	pi.registerTool({
		name: "design_lock",
		label: "Design Lock",
		description: "Lock design. Requires /design approve human capability.",
		loadMode: "discoverable",
		approval: "write",
		parameters: z.object({ version: z.string().optional() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const gate = requirePlan(state);
			if (gate) return { content: [{ type: "text", text: gate }], isError: true };
			if (!consumeCap(state, "design_lock")) {
				return { content: [{ type: "text", text: "HUMAN_GATE: run /design approve." }], isError: true };
			}
			state.design.status = "locked";
			state.design.required = true;
			state.design.version = params.version || "1.0";
			state.phase = "aatp";
			refreshArtifactHashes(ctx.cwd, state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `DESIGN LOCKED v${state.design.version}` }], details: state };
		},
	});

	pi.registerTool({
		name: "report_conflict",
		label: "Report Conflict",
		description: "Worker escape hatch. Does not unlock. PLAN_CONFLICT | DESIGN_CONFLICT | DEPENDENCY_CONFLICT | SCOPE_INSUFFICIENT.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({
			kind: z.enum(["PLAN_CONFLICT", "DESIGN_CONFLICT", "DEPENDENCY_CONFLICT", "SCOPE_INSUFFICIENT"]),
			reason: z.string(),
			evidence: z.string(),
		}),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			state.conflict = { kind: params.kind, reason: `${params.reason} | ${params.evidence}` };
			state.aatp.blocked += 1;
			persist(ctx.cwd, state);
			return {
				content: [
					{
						type: "text",
						text: `BLOCKED: ${params.kind}\n${params.reason}\n${params.evidence}\nDo not edit locked artifacts. Orchestrator revises via /plan3 or /design.`,
					},
				],
				details: state,
			};
		},
	});

	pi.registerTool({
		name: "aatp_begin",
		label: "AATP Begin",
		description: "Mark a ticket active and bind allowed_files from docs/AATP.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ id: z.string() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const listed = listAatp(ctx.cwd).find((t) => t.id === params.id);
			const ticket = state.tickets[params.id] ?? {
				id: params.id,
				status: "ready" as const,
				allowed_files: listed?.allowed_files ?? [],
				forbidden_files: listed?.forbidden_files ?? ["docs/MASTER_PLAN.md", "docs/PRODUCT.md", "docs/DESIGN.md"],
				risk: listed?.risk ?? "normal",
				review: "none" as const,
			};
			ticket.status = "active";
			ticket.allowed_files = listed?.allowed_files ?? ticket.allowed_files;
			state.tickets[params.id] = ticket;
			state.phase = "implementation";
			recountTickets(state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `ACTIVE ${params.id}` }], details: ticket };
		},
	});

	pi.registerTool({
		name: "aatp_complete",
		label: "AATP Complete",
		description: "Mark a ticket completed with evidence. Extension-owned status.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ id: z.string(), evidence: z.string() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const ticket = state.tickets[params.id];
			if (!ticket) return { content: [{ type: "text", text: "Unknown ticket. aatp_begin first." }], isError: true };
			ticket.status = "completed";
			state.tickets[params.id] = ticket;
			recountTickets(state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `COMPLETED ${params.id}: ${params.evidence}` }], details: ticket };
		},
	});

	pi.registerTool({
		name: "aatp_block",
		label: "AATP Block",
		description: "Mark a ticket blocked.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ id: z.string(), kind: z.string(), evidence: z.string() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const ticket = state.tickets[params.id] ?? {
				id: params.id,
				status: "blocked" as const,
				allowed_files: [],
				forbidden_files: [],
				risk: "normal",
				review: "none" as const,
			};
			ticket.status = "blocked";
			state.tickets[params.id] = ticket;
			state.conflict = { kind: "SCOPE_INSUFFICIENT", reason: `${params.kind}: ${params.evidence}` };
			recountTickets(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `BLOCKED ${params.id}` }], details: ticket };
		},
	});


	pi.registerTool({
		name: "plan_revise",
		label: "Plan Revise",
		description: "Open a locked plan for a new GLM→Grok→Sol version. Returns unlockToken for plan_commit.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ reason: z.string().optional() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const t = token();
			state.master_plan.status = "draft";
			state.unlock_token = t;
			state.phase = "planning";
			persist(ctx.cwd, state);
			return {
				content: [{ type: "text", text: `REVISING plan. unlockToken=${t}\n${params.reason ?? ""}` }],
				details: { unlockToken: t },
			};
		},
	});

	pi.registerCommand("foundry", {
		description: "Next foundry step — the only command a non-coder needs",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			const idea = args.trim();
			if (!existsSync(join(ctx.cwd, ".omp", "foundry-state.yml")) && !existsSync(join(ctx.cwd, ".omp", "company-state.yml"))) {
				orchestrate(
					pi,
					"Start the foundry.",
					[
						"Call company_init.",
						idea ? `User idea: ${idea}` : "If the user has not described the product, ask in one short question then spawn product-analyst.",
						"Spawn blocking product-analyst. Then product_approve.",
					].join("\n"),
				);
				return;
			}
			if (!productOk(state)) {
				orchestrate(pi, "Finish the product.", "Spawn blocking product-analyst, then product_approve. Do not plan or code.");
				return;
			}
			if (state.master_plan.status !== "locked") {
				orchestrate(
					pi,
					"Run /plan3 automatically.",
					"Spawn blocking plan-drafter, then plan-critic, then plan-finalizer. Finalizer calls plan_commit. Do not implement.",
				);
				return;
			}
			if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") {
				orchestrate(
					pi,
					"Design is required.",
					"Spawn blocking design-foundation and show a real preview. Wait for the user to say approve or skip. Do not implement features.",
				);
				return;
			}
			const tasks = listAatp(ctx.cwd);
			if (tasks.length === 0) {
				orchestrate(pi, "Generate AATP.", "Write docs/AATP/AATP-*.md + INDEX.md from MASTER_PLAN. Do not implement.");
				return;
			}
			const ready = readyIndependent(tasks);
			const counts = summarizeAatp(tasks);
			if (ready.length > 0) {
				orchestrate(
					pi,
					"Build the next independent AATP layer.",
					ready.map((t) => `${t.id} → ${routeAgent(t.risk)} :: ${t.objective}`).join("\n"),
				);
				return;
			}
			if (counts.completed === counts.total && counts.total > 0 && state.qa.status !== "pass") {
				orchestrate(pi, "All AATP done. Run /verify.", "Execute real test/build commands. Write docs/reports/QA.md.");
				return;
			}
			orchestrate(pi, "Run /release-check.", "Compare gates and report what is still red.");
		},
	});

	pi.registerCommand("company", {
		description: "Alias of /foundry",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			const idea = args.trim();
			if (!existsSync(join(ctx.cwd, ".omp", "company-state.yml"))) {
				orchestrate(
					pi,
					"Start the company workflow.",
					[
						"Call company_init.",
						idea ? `User idea: ${idea}` : "If the user has not described the product, ask in one short question then spawn product-analyst.",
						"Spawn blocking product-analyst. Then product_approve.",
					].join("\n"),
				);
				return;
			}
			if (!productOk(state)) {
				orchestrate(pi, "Finish the product.", "Spawn blocking product-analyst, then product_approve. Do not plan or code.");
				return;
			}
			if (state.master_plan.status !== "locked") {
				orchestrate(
					pi,
					"Run /plan3 automatically.",
					"Spawn blocking plan-drafter, then plan-critic, then plan-finalizer. Finalizer calls plan_commit. Do not implement.",
				);
				return;
			}
			if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") {
				orchestrate(
					pi,
					"Design is required.",
					"Spawn blocking design-foundation and show a real preview. Wait for the user to say approve or skip. Do not implement features.",
				);
				return;
			}
			const tasks = listAatp(ctx.cwd);
			if (tasks.length === 0) {
				orchestrate(pi, "Generate AATP.", "Write docs/AATP/AATP-*.md + INDEX.md from MASTER_PLAN. Do not implement.");
				return;
			}
			const ready = readyIndependent(tasks);
			const counts = summarizeAatp(tasks);
			if (ready.length > 0) {
				orchestrate(
					pi,
					"Build the next independent AATP layer.",
					ready.map((t) => `${t.id} → ${routeAgent(t.risk)} :: ${t.objective}`).join("\n"),
				);
				return;
			}
			if (counts.completed === counts.total && counts.total > 0 && state.qa.status !== "pass") {
				orchestrate(pi, "All AATP done. Run /verify.", "Execute real test/build commands. Write docs/reports/QA.md.");
				return;
			}
			orchestrate(pi, "Run /release-check.", "Compare gates and report what is still red.");
		},
	});

	pi.registerCommand("company-init", {
		description: "Bootstrap PRODUCT/docs + company state",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();
			orchestrate(
				pi,
				"Read skill://three-stage-plan and run company init.",
				[
					"Call company_init.",
					"If docs/PRODUCT.md is still a stub, spawn blocking product-analyst.",
					"Then product_approve when PRODUCT is decision-complete.",
					args.trim() ? `Project: ${args.trim()}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			);
		},
	});

	pi.registerCommand("plan3", {
		description: "GLM draft → Grok critique → Sol lock",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			const missing = requireProduct(state);
			if (missing) {
				ctx.ui.notify(missing, "warning");
				orchestrate(pi, "Product first.", "Spawn product-analyst, then product_approve, then /plan3 again.");
				return;
			}
			orchestrate(
				pi,
				"Run /plan3. Read skill://three-stage-plan.",
				[
					"Spawn blocking, sequential: plan-drafter → plan-critic → plan-finalizer.",
					"Artifacts: docs/planning/MASTER_PLAN_DRAFT.md, docs/planning/PLAN_REVIEW.md, docs/MASTER_PLAN.md.",
					"Finalizer must call plan_commit.",
					"Do not implement.",
					args.trim(),
				]
					.filter(Boolean)
					.join("\n"),
			);
		},
	});

	pi.registerCommand("3-stage-plan", {
		description: "Alias of /plan3",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			if (requireProduct(state)) {
				orchestrate(pi, "Product first.", "Approve PRODUCT.md then /plan3.");
				return;
			}
			orchestrate(pi, "Alias /plan3", `Run the /plan3 pipeline.\n${args}`);
		},
	});

	pi.registerCommand("design", {
		description: "Gemini design foundation after plan lock",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			const gate = requirePlan(state);
			if (gate) {
				ctx.ui.notify(gate, "warning");
				return;
			}
			if (sub === "approve") {
				grantCap(state, "design_lock");
				state.design.status = "locked";
				state.design.required = true;
				state.design.version = state.design.version === "0" ? "1.0" : state.design.version;
				state.phase = "aatp";
				refreshArtifactHashes(ctx.cwd, state);
				invalidateQa(state);
				persist(ctx.cwd, state);
				orchestrate(pi, "DESIGN LOCKED by user.", "Continue with /aatp. Do not call design_lock.");
				return;
			}
			if (sub === "skip") {
				grantCap(state, "design_skip");
				state.design.required = false;
				state.design.status = "not_required";
				state.phase = "aatp";
				persist(ctx.cwd, state);
				orchestrate(pi, "DESIGN skipped by user.", "Continue with /aatp.");
				return;
			}
			const stack = detectStack(ctx.cwd);
			if (!stack.ui && !state.design.required) {
				orchestrate(pi, "No UI stack detected.", "User can /design skip unless they want UI.");
				return;
			}
			orchestrate(
				pi,
				"Run /design. Read skill://design-foundation.",
				"Spawn blocking design-foundation. Preview must actually build. Do not lock until the user runs /design approve.",
			);
		},
	});

	pi.registerCommand("foundry-approve", {
		description: "Human gate: product | plan",
		handler: async (args, ctx) => {
			const which = args.trim().toLowerCase();
			const state = loadState(ctx.cwd);
			if (which === "product" || which === "approve-product") {
				grantCap(state, "product_approve");
				state.product.status = "approved";
				state.phase = "planning";
				refreshArtifactHashes(ctx.cwd, state);
				persist(ctx.cwd, state);
				orchestrate(pi, "PRODUCT approved by user.", "Run /plan3.");
				return;
			}
			if (which === "plan" || which === "approve-plan") {
				grantCap(state, "plan_lock");
				state.master_plan.status = "locked";
				state.master_plan.version = state.master_plan.version === "0" ? "1.0" : state.master_plan.version;
				state.phase = state.design.required ? "design" : "aatp";
				refreshArtifactHashes(ctx.cwd, state);
				invalidateQa(state);
				persist(ctx.cwd, state);
				orchestrate(pi, "PLAN LOCKED by user.", "Continue /foundry (design or AATP).");
				return;
			}
			ctx.ui.notify("Usage: /foundry-approve product|plan", "warning");
		},
	});

	pi.registerCommand("aatp", {
		description: "Generate AATP DAG from locked plan+design",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const gate = requireDesignIfUi(state);
			if (gate) {
				ctx.ui.notify(gate, "warning");
				return;
			}
			state.phase = "aatp";
			persist(ctx.cwd, state);
			orchestrate(
				pi,
				"Generate AATP. Read docs/AATP.md template.",
				[
					"Write docs/AATP/AATP-*.md then call aatp_begin only when implementing.",
					"Do not implement in this turn.",
				].join("\n"),
			);
		},
	});

	pi.registerCommand("build", {
		description: "Spawn ready independent AATP workers",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const gate = requireDesignIfUi(state);
			if (gate) {
				ctx.ui.notify(gate, "warning");
				return;
			}
			const tasks = listAatp(ctx.cwd);
			writeAatpIndex(ctx.cwd, tasks);
			const ready = readyIndependent(tasks);
			state.phase = "implementation";
			persist(ctx.cwd, state);
			const lines = ready.map((t) => `- ${t.id} agent=${routeAgent(t.risk)} isolated=true :: ${t.objective}`);
			orchestrate(
				pi,
				"Run /build on the ready DAG layer only.",
				[
					`Ready (${ready.length}):`,
					lines.join("\n") || "(none)",
					"Spawn implementer/hard-implementer with isolated:true.",
					"Each worker: aatp_begin → implement → aatp_complete. Conflicts → report_conflict.",
				].join("\n"),
			);
		},
	});

	pi.registerCommand("review", {
		description: "Independent AATP review",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			state.phase = "review";
			persist(ctx.cwd, state);
			orchestrate(
				pi,
				"Review AATP. Reviewer must not implement.",
				`Spawn blocking reviewer. Target: ${args.trim() || "(latest completed)"}`,
			);
		},
	});

	pi.registerCommand("verify", {
		description: "Deterministic QA — Foundry runs the commands",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const rows = runVerify(ctx.cwd);
			applyQa(ctx.cwd, state, rows);
			deriveRelease(ctx.cwd, state);
			persist(ctx.cwd, state);
			const summary = rows.map((r) => `${r.id}=${r.exitCode}`).join(" ") || "no-commands";
			orchestrate(pi, `QA ${state.qa.status}`, summary);
		},
	});

	pi.registerCommand("release-check", {
		description: "Derived release gate (never sticky)",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			recountTickets(state);
			const ready = deriveRelease(ctx.cwd, state);
			if (ready) state.phase = "release";
			persist(ctx.cwd, state);
			const report = [
				`${productOk(state) ? "✓" : "✗"} PRODUCT`,
				`${state.master_plan.status === "locked" ? "✓" : "✗"} PLAN locked`,
				`${!state.design.required || state.design.status === "locked" || state.design.status === "not_required" ? "✓" : "✗"} DESIGN`,
				`${state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0 ? "✓" : "✗"} AATP complete`,
				`${state.qa.status === "pass" ? "✓" : "✗"} QA pass @ ${state.qa.tree_sha || "no-sha"}`,
			].join("\n");
			orchestrate(pi, ready ? "RELEASE_READY=true (derived)." : "Release blocked (derived, not sticky).", report);
		},
	});

}

function productOk(state: CompanyState): boolean {
	return state.product.status === "approved" || state.product.status === "locked";
}
