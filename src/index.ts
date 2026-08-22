import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { listAatp, readyIndependent, routeAgent, summarizeAatp, writeAatpIndex } from "./aatp";
import { CONTEXT_POLICY, phasePrompt } from "./context-policy";
import { requireDesignIfUi, requirePlan, requireProduct } from "./gates";
import { denyToolCall, type ToolInput } from "./permissions";
import { detectStack } from "./stack-detector";
import { loadState, saveState } from "./state-machine";
import { type CompanyState, defaultState } from "./types";

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
	pi.setLabel("Company Workflow");

	const statusOf = (state: CompanyState): string =>
		`${state.phase} plan=${state.master_plan.status} design=${state.design.status}`;

	pi.on("session_start", async (_e, ctx) => {
		const state = loadState(ctx.cwd);
		ctx.ui.setStatus("company", statusOf(state));
	});

	pi.on("before_agent_start", async (_e, ctx) => {
		const state = loadState(ctx.cwd);
		return {
			message: {
				customType: CUSTOM,
				content: `${phasePrompt(state.phase)} ${statusOf(state)}.`,
				display: true,
				details: { ...state, unlock_token: undefined },
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (String(event.toolName).startsWith("company_") || event.toolName.startsWith("plan_") || event.toolName === "report_conflict") {
			return;
		}
		const state = loadState(ctx.cwd);
		return denyToolCall(event.toolName, (event.input ?? {}) as ToolInput, state);
	});

	pi.registerTool({
		name: "company_status",
		label: "Company Status",
		description: "Read .omp/company-state.yml and AATP counters.",
		loadMode: "essential",
		approval: "read",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const tasks = listAatp(ctx.cwd);
			const counts = summarizeAatp(tasks);
			const next = persist(ctx.cwd, { ...state, aatp: counts });
			const stack = detectStack(ctx.cwd);
			return {
				content: [{ type: "text", text: JSON.stringify({ ...next, unlock_token: undefined, stack }, null, 2) }],
				details: next,
			};
		},
	});

	pi.registerTool({
		name: "company_init",
		label: "Company Init",
		description: "Create docs templates and .omp/company-state.yml if missing.",
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
			const existing = existsSync(join(ctx.cwd, ".omp", "company-state.yml")) ? loadState(ctx.cwd) : defaultState();
			const stack = detectStack(ctx.cwd);
			existing.design.required = stack.ui;
			existing.phase = "discovery";
			persist(ctx.cwd, existing);
			ctx.ui.setStatus("company", statusOf(existing));
			return {
				content: [
					{
						type: "text",
						text: `Initialized company workflow in ${ctx.cwd}. stack=${stack.ids.join(",")} ui=${stack.ui} name=${params.name ?? ""}`,
					},
				],
				details: existing,
			};
		},
	});

	pi.registerTool({
		name: "product_approve",
		label: "Product Approve",
		description: "Mark docs/PRODUCT.md approved so /plan3 may run.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			if (!existsSync(join(ctx.cwd, "docs", "PRODUCT.md"))) {
				return { content: [{ type: "text", text: "docs/PRODUCT.md missing." }], isError: true };
			}
			const state = loadState(ctx.cwd);
			state.product.status = "approved";
			state.phase = "planning";
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: "PRODUCT approved." }], details: state };
		},
	});

	pi.registerTool({
		name: "plan_commit",
		label: "Plan Commit",
		description: "Lock docs/MASTER_PLAN.md after plan-finalizer. unlockToken required when revising.",
		loadMode: "essential",
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
			if (state.master_plan.status === "locked") {
				return { content: [{ type: "text", text: "Already locked. /plan3 after revise needs unlockToken." }], isError: true };
			}
			if (state.unlock_token && params.unlockToken !== state.unlock_token) {
				return { content: [{ type: "text", text: "unlockToken mismatch." }], isError: true };
			}
			state.master_plan.status = "locked";
			state.master_plan.version = params.version || (state.master_plan.version === "0" ? "1.0" : state.master_plan.version);
			state.unlock_token = "";
			state.conflict = { kind: "none", reason: "" };
			state.phase = state.design.required ? "design" : "aatp";
			persist(ctx.cwd, state);
			ctx.ui.setStatus("company", statusOf(state));
			return { content: [{ type: "text", text: `PLAN LOCKED v${state.master_plan.version}` }], details: state };
		},
	});

	pi.registerTool({
		name: "design_skip",
		label: "Design Skip",
		description: "Mark design not required (backend-only).",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({}),
		async execute(_id, _p, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
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
		description: "Lock design after user approval (/design approve).",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ version: z.string().optional() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const gate = requirePlan(state);
			if (gate) return { content: [{ type: "text", text: gate }], isError: true };
			state.design.status = "locked";
			state.design.required = true;
			state.design.version = params.version || "1.0";
			state.phase = "aatp";
			persist(ctx.cwd, state);
			ctx.ui.setStatus("company", statusOf(state));
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

	pi.registerCommand("company", {
		description: "Next company step (non-coder: only command you need)",
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
			const sub = args.trim().toLowerCase();
			if (sub === "approve") {
				orchestrate(pi, "User approved design.", "Call design_lock. Then /aatp.");
				return;
			}
			if (sub === "skip") {
				orchestrate(pi, "Backend-only.", "Call design_skip. Then /aatp.");
				return;
			}
			const stack = detectStack(ctx.cwd);
			if (!stack.ui && !state.design.required) {
				orchestrate(pi, "No UI stack detected.", "Call design_skip unless the user wants UI anyway.");
				return;
			}
			orchestrate(
				pi,
				"Run /design. Read skill://design-foundation.",
				"Spawn blocking design-foundation. Preview must actually build. Do not design_lock until the user says approve.",
			);
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
			orchestrate(
				pi,
				"Generate AATP. Read docs/AATP.md template.",
				[
					"Read PRODUCT, MASTER_PLAN, DESIGN (if required).",
					"Write docs/AATP/AATP-*.md with required YAML and docs/AATP/INDEX.md.",
					"Do not implement.",
					"Set phase to implementation via company_status after files exist.",
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
			const lines = ready.map((t) => `- ${t.id} agent=${routeAgent(t.risk)} file=${t.path} :: ${t.objective}`);
			orchestrate(
				pi,
				"Run /build on the ready DAG layer only.",
				[
					`Ready (${ready.length}):`,
					lines.join("\n") || "(none — generate /aatp or finish dependencies)",
					"Batch-spawn implementer/hard-implementer/sonic. No plan/design edits.",
					"Conflicts → report_conflict. Then /review each completed id.",
				].join("\n"),
			);
		},
	});

	pi.registerCommand("review", {
		description: "Independent AATP review (Grok; Sol if security-critical)",
		handler: async (args, ctx) => {
			orchestrate(
				pi,
				"Review AATP. Reviewer must not implement.",
				`Spawn blocking aatp-reviewer (or reviewer). If security-critical, then security-reviewer. Write docs/reports/REVIEW-<id>.md. Target: ${args.trim() || "(latest completed)"}`,
			);
		},
	});

	pi.registerCommand("verify", {
		description: "Deterministic QA for detected stack",
		handler: async (_args, ctx) => {
			const stack = detectStack(ctx.cwd);
			const lines = stack.verify.map((v) => `- ${v.id}: \`${v.command}\``);
			orchestrate(
				pi,
				"Run /verify. Real exit codes only. Read skill://verification-before-completion.",
				[
					`stack=${stack.ids.join(",")}`,
					"Run these if present, record stdout/stderr/exit:",
					lines.join("\n") || "- (no detector commands — run the repo's documented test/build)",
					"Write docs/reports/QA.md. Do not claim pass without the command output.",
				].join("\n"),
			);
		},
	});

	pi.registerCommand("release-check", {
		description: "Release gate over locked artifacts + QA",
		handler: async (_args, ctx) => {
			const state = loadState(ctx.cwd);
			const tasks = listAatp(ctx.cwd);
			const counts = summarizeAatp(tasks);
			const checks = [
				["PRODUCT approved", productOk(state)],
				["PLAN locked", state.master_plan.status === "locked"],
				["DESIGN locked or n/a", !state.design.required || state.design.status === "locked" || state.design.status === "not_required"],
				["AATP complete", counts.total > 0 && counts.completed === counts.total && counts.blocked === 0],
				["QA pass", state.qa.status === "pass"],
			] as const;
			const all = checks.every(([, ok]) => ok);
			if (all) {
				state.release.ready = true;
				state.phase = "release";
				persist(ctx.cwd, state);
			}
			const report = checks.map(([name, ok]) => `${ok ? "✓" : "✗"} ${name}`).join("\n");
			orchestrate(pi, all ? "RELEASE_READY=true. commit role may write notes only." : "Release blocked.", report);
		},
	});
}

function productOk(state: CompanyState): boolean {
	return state.product.status === "approved" || state.product.status === "locked";
}
