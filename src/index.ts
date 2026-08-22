import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	beginTicket,
	completeTicket,
	hydrateAatp,
	listAatpSpecs,
	readyIndependent,
	reviewTicket,
	routeAgent,
	seedTickets,
	summarizeAatp,
	writeAatpIndex,
} from "./aatp";
import { CONTEXT_POLICY, phasePrompt } from "./context-policy";
import { requireDesignIfUi, requirePlan, requireProduct } from "./gates";
import { denyToolCall, forceIsolatedTaskInput, type ToolInput } from "./permissions";
import {
	contentTextOf,
	governedTask,
	reviewTaskDelta,
	snapshotBaseline,
	ticketIdsFromText,
	type TreeBaseline,
} from "./patch-gate";
import { canonicalRepoPath } from "./paths";
import { deriveRelease, invalidateQa, lockArtifactHash } from "./release";
import { loadRegistry } from "./skills/registry";
import { resolveSkillManifests, skillPackPrompt } from "./skills/resolver";
import { detectStack } from "./stack-detector";
import { loadState, loadStateResult, recountTickets, saveState, stateFileExists } from "./state-machine";
import { type CompanyState, defaultState } from "./types";
import { checkForUpdate, versionReport } from "./update-check";
import { applyQa, runVerify } from "./verify-runner";



const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUSTOM = "com.omp.company-workflow.state";
const PLAN3 =
	"Spawn blocking, sequential: plan-drafter → plan-critic → plan-finalizer. Artifacts: docs/planning/MASTER_PLAN_DRAFT.md, docs/planning/PLAN_REVIEW.md, docs/MASTER_PLAN.md. Finalizer writes MASTER_PLAN only. Human locks with /foundry-approve plan. Do not implement.";

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

function productOk(state: CompanyState): boolean {
	return state.product.status === "approved" || state.product.status === "locked";
}

function advanceFoundry(pi: ExtensionAPI, cwd: string, args: string): void {
	const state = loadState(cwd);
	const idea = args.trim();
	if (!stateFileExists(cwd)) {
		orchestrate(
			pi,
			"Start the foundry.",
			[
				"Call company_init.",
				idea ? `User idea: ${idea}` : "If the user has not described the product, ask in one short question then spawn product-analyst.",
				"Spawn blocking product-analyst. Then wait for the user to run /foundry-approve product.",
			].join("\n"),
		);
		return;
	}
	if (!productOk(state)) {
		orchestrate(pi, "Finish the product.", "Spawn blocking product-analyst. Wait for /foundry-approve product. Do not plan or code.");
		return;
	}
	if (state.master_plan.status !== "locked") {
		orchestrate(pi, "Run /plan3 automatically.", PLAN3);
		return;
	}
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") {
		orchestrate(
			pi,
			"Design is required.",
			"Spawn blocking design-foundation and show a real preview. Wait for the user to run /design approve or /design skip. Do not implement features.",
		);
		return;
	}
	const tasks = hydrateAatp(cwd, state);
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
		const unreviewed = tasks.filter((t) => t.status === "completed" && t.review !== "APPROVE");
		if (unreviewed.length > 0) {
			orchestrate(
				pi,
				"Review before QA.",
				`Run /review on completed tickets first (review invalidates QA anyway). Unreviewed: ${unreviewed.map((t) => t.id).join(", ")}.`,
			);
			return;
		}
		orchestrate(pi, "All AATP done. Run /verify.", "Foundry runs real test/build commands. Write docs/reports/QA.md.");
		return;
	}
	orchestrate(pi, "Run /release-check.", "Compare gates and report what is still red.");
}

export default function ompCompanyWorkflow(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.setLabel("OMP Foundry");
	const baselines = new Map<string, TreeBaseline>();

	const statusOf = (state: CompanyState): string =>
		`${state.phase} plan=${state.master_plan.status} design=${state.design.status}`;

	const safeState = (cwd: string): { state: CompanyState; broken?: string } => {
		const loaded = loadStateResult(cwd);
		if (!loaded.ok) return { state: defaultState(), broken: loaded.reason };
		return { state: loaded.state };
	};

	const taskKey = (event: { toolCallId?: string }, cwd: string): string => event.toolCallId ?? cwd;

	pi.on("session_start", async (_e, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		ctx.ui.setStatus("foundry", broken ? "STATE_CORRUPT" : statusOf(state));
		ctx.setTimeout(() => {
			void checkForUpdate().then((result) => {
				if (result.notify) ctx.ui.notify(result.notify, "info");
			});
		}, 0);
	});


	pi.on("before_agent_start", async (_e, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		const pack = broken ? [] : resolveSkillManifests(ctx.cwd, state);
		return {
			message: {
				customType: CUSTOM,
				content: broken
					? `Foundry state corrupt: ${broken}`
					: `${phasePrompt(state.phase)} ${statusOf(state)}.\n${skillPackPrompt(pack, state.phase)}`,
				display: true,
				details: { ...state, unlock_token: undefined, skills: pack.map((s) => s.id) },
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "task") {
			const raw = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
			if (governedTask(raw)) baselines.set(taskKey(event, ctx.cwd), snapshotBaseline(ctx.cwd));
			const isolated = forceIsolatedTaskInput(raw);
			if (isolated) return { input: isolated };
		}
		if (
			String(event.toolName).startsWith("company_") ||
			event.toolName.startsWith("aatp_") ||
			event.toolName === "foundry_skill_read" ||
			event.toolName === "report_conflict"
		) {
			return;
		}
		const { state, broken } = safeState(ctx.cwd);
		const activeTickets = Object.values(state.tickets).filter((t) => t.status === "active");
		return denyToolCall(event.toolName, (event.input ?? {}) as ToolInput, state, {
			stateBroken: broken,
			activeTickets,
			canonicalize: (raw) => canonicalRepoPath(ctx.cwd, raw),
		});
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "task") return;
		const input = event.input && typeof event.input === "object" ? (event.input as Record<string, unknown>) : {};
		if (!governedTask(input)) return;
		const { state } = safeState(ctx.cwd);
		const key = taskKey(event, ctx.cwd);
		const baseline = baselines.get(key) ?? { paths: new Set<string>(), files: new Map<string, string | null>() };
		baselines.delete(key);
		// Bind the task to the ticket named in its prompt; an ambiguous or
		// missing binding with several active tickets fails closed (no scope).
		const mentioned = ticketIdsFromText(JSON.stringify(input ?? {}));
		const active = Object.values(state.tickets).filter((t) => t.status === "active");
		const bound = mentioned.filter((id) => active.some((t) => t.id === id));
		const tickets = bound.length === 1 ? [state.tickets[bound[0]]] : bound.length > 1 ? [] : active;
		const reviewed = reviewTaskDelta(ctx.cwd, baseline, tickets, event.details, contentTextOf(event.content));
		if (reviewed.escaped.length === 0 && reviewed.rejected.length === 0) return;
		invalidateQa(state);
		persist(ctx.cwd, state);
		const lines = [
			...(reviewed.escaped.length
				? [`PATH_ESCAPE: writes outside the repository detected (reported, NOT reverted): ${reviewed.escaped.join(", ")}`]
				: []),
			...(reviewed.rejected.length
				? [`AATP_SCOPE: reverted out-of-scope writes: ${reviewed.reverted.join(", ") || reviewed.rejected.join(", ")}`]
				: []),
		];
		return {
			isError: true,
			content: [{ type: "text" as const, text: lines.join("\n") }],
		};
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
			const tasks = hydrateAatp(ctx.cwd, state);
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
		parameters: z.object({ name: z.string().optional() }),
		async execute(_id, params, _s, _u, ctx) {
			mkdirSync(join(ctx.cwd, "docs", "planning"), { recursive: true });
			mkdirSync(join(ctx.cwd, "docs", "AATP"), { recursive: true });
			mkdirSync(join(ctx.cwd, "docs", "reports"), { recursive: true });
		for (const name of ["PRODUCT.md", "MASTER_PLAN.md", "DESIGN.md", "SECURITY.md", "ARCHITECTURE.md", "AATP.md", "RELEASE_REPORT.md"]) {
			copyTemplate(ctx.cwd, name);
		}
		// Foundry runtime state must not dirty the user's tree; ignore it on init.
		const gitignorePath = join(ctx.cwd, ".gitignore");
		let ignoreText = "";
		try {
			ignoreText = readFileSync(gitignorePath, "utf8");
		} catch {
			/* absent */
		}
		if (!/^\.omp\/?\s*$/m.test(ignoreText)) {
			writeFileSync(gitignorePath, `${ignoreText}${ignoreText && !ignoreText.endsWith("\n") ? "\n" : ""}.omp/\n`, "utf8");
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
		name: "report_conflict",
		label: "Report Conflict",
		description: "Worker escape hatch. Does not unlock locked artifacts.",
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
						text: `BLOCKED: ${params.kind}\n${params.reason}\n${params.evidence}\nDo not edit locked artifacts. User revises via /plan-revise or /design.`,
					},
				],
				details: state,
			};
		},
	});

	pi.registerTool({
		name: "aatp_begin",
		label: "AATP Begin",
		description: "Mark a ticket active. Status lives in foundry-state, not the markdown spec.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ id: z.string() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const spec = listAatpSpecs(ctx.cwd).find((t) => t.id === params.id);
			const result = beginTicket(state, spec, params.id);
			if (!result.ok) return { content: [{ type: "text", text: result.reason }], isError: true };
			state.phase = "implementation";
			recountTickets(state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `ACTIVE ${params.id}` }], details: result.ticket };
		},
	});

	pi.registerTool({
		name: "aatp_complete",
		label: "AATP Complete",
		description: "Mark a ticket completed in foundry-state. Does not rewrite the spec markdown.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({ id: z.string(), evidence: z.string() }),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const result = completeTicket(state, params.id);
			if (!result.ok) return { content: [{ type: "text", text: result.reason }], isError: true };
			recountTickets(state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `COMPLETED ${params.id}: ${params.evidence}` }], details: result.ticket };
		},
	});

	pi.registerTool({
		name: "aatp_block",
		label: "AATP Block",
		description: "Mark a ticket blocked in foundry-state.",
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
		name: "aatp_review",
		label: "AATP Review",
		description: "Record independent review verdict on a completed ticket.",
		loadMode: "essential",
		approval: "write",
		parameters: z.object({
			id: z.string(),
			verdict: z.enum(["APPROVE", "REQUEST_CHANGES", "BLOCK"]),
		}),
		async execute(_id, params, _s, _u, ctx) {
			const state = loadState(ctx.cwd);
			const result = reviewTicket(state, params.id, params.verdict);
			if (!result.ok) return { content: [{ type: "text", text: result.reason }], isError: true };
			recountTickets(state);
			invalidateQa(state);
			persist(ctx.cwd, state);
			return { content: [{ type: "text", text: `${params.id} review=${params.verdict}` }], details: result.ticket };
		},
	});

	pi.registerTool({
		name: "foundry_skill_read",
		label: "Foundry Skill Read",
		description: "Load 1–3 Foundry skill bodies on demand.",
		loadMode: "essential",
		approval: "read",
		parameters: z.object({ ids: z.array(z.string()) }),
		async execute(_id, params) {
			const registry = loadRegistry(join(ROOT, "skills"));
			const wanted = params.ids.slice(0, 3);
			const bodies = wanted.map((id: string) => {
				const hit = registry.find((s) => s.id === id);
				return hit ? `# ${hit.id}\n${hit.description}\n\n${hit.body}` : `# ${id}\n(not found)`;
			});
			return { content: [{ type: "text", text: bodies.join("\n\n") }], details: { ids: wanted } };
		},
	});

	pi.registerCommand("foundry", {
		description: "Next foundry step — the only command a non-coder needs",
		handler: async (args, ctx) => advanceFoundry(pi, ctx.cwd, args),
	});

	pi.registerCommand("company", {
		description: "Alias of /foundry",
		handler: async (args, ctx) => advanceFoundry(pi, ctx.cwd, args),
	});

	const initHandler = async (args: string, ctx: { cwd: string; waitForIdle: () => Promise<void> }) => {
		await ctx.waitForIdle();
		orchestrate(
			pi,
			"Bootstrap Foundry.",
			[
				"Call company_init.",
				"If docs/PRODUCT.md is still a stub, spawn blocking product-analyst.",
				"Then wait for /foundry-approve product.",
				args.trim() ? `Project: ${args.trim()}` : "",
			]
				.filter(Boolean)
				.join("\n"),
		);
	};

	pi.registerCommand("foundry-init", {
		description: "Bootstrap PRODUCT/docs + foundry state",
		handler: initHandler,
	});

	pi.registerCommand("foundry-version", {
		description: "Show Foundry/OMP versions and latest stable tag",
		handler: async (_args, ctx) => {
			const result = await checkForUpdate({ force: true });
			if (result.notify) ctx.ui.notify(result.notify, "info");
			orchestrate(pi, "Foundry version", versionReport(result));
		},
	});


	pi.registerCommand("company-init", {
		description: "Alias of /foundry-init",
		handler: initHandler,
	});

	pi.registerCommand("plan3", {
		description: "GLM draft → Grok critique → Sol write; human locks",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			const missing = requireProduct(state);
			if (missing) {
				ctx.ui.notify(missing, "warning");
				orchestrate(pi, "Product first.", "Spawn product-analyst, then wait for /foundry-approve product, then /plan3 again.");
				return;
			}
			orchestrate(pi, "Run /plan3. Read skill://three-stage-plan.", [PLAN3, args.trim()].filter(Boolean).join("\n"));
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
			orchestrate(pi, "Alias /plan3", `${PLAN3}\n${args}`);
		},
	});

	pi.registerCommand("plan-revise", {
		description: "Human-only: reopen a locked plan for a new PLAN3 cycle",
		handler: async (args, ctx) => {
			const state = loadState(ctx.cwd);
			state.master_plan.status = "draft";
			state.unlock_token = token();
			state.phase = "planning";
			state.conflict = { kind: "PLAN_CONFLICT", reason: args.trim() || "user revise" };
			invalidateQa(state);
			persist(ctx.cwd, state);
			orchestrate(pi, "PLAN reopened by user.", "Run /plan3. Then /foundry-approve plan.");
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
				state.design.status = "locked";
				state.design.required = true;
				state.design.version = state.design.version === "0" ? "1.0" : state.design.version;
				state.phase = "aatp";
				lockArtifactHash(ctx.cwd, state, "design");
				invalidateQa(state);
				persist(ctx.cwd, state);
				orchestrate(pi, "DESIGN LOCKED by user.", "Continue with /aatp.");
				return;
			}
			if (sub === "skip") {
				state.design.required = false;
				state.design.status = "not_required";
				state.phase = "aatp";
				invalidateQa(state);
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
		description: "Human gate: product | plan — performs the transition directly",
		handler: async (args, ctx) => {
			const which = args.trim().toLowerCase();
			const state = loadState(ctx.cwd);
			if (which === "product" || which === "approve-product") {
				state.product.status = "approved";
				state.phase = "planning";
				lockArtifactHash(ctx.cwd, state, "product");
				invalidateQa(state);
				persist(ctx.cwd, state);
				orchestrate(pi, "PRODUCT approved by user.", "Run /plan3.");
				return;
			}
			if (which === "plan" || which === "approve-plan") {
				state.master_plan.status = "locked";
				state.master_plan.version = state.master_plan.version === "0" ? "1.0" : state.master_plan.version;
				state.unlock_token = "";
				state.conflict = { kind: "none", reason: "" };
				state.phase = state.design.required ? "design" : "aatp";
				lockArtifactHash(ctx.cwd, state, "master_plan");
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
				"Write docs/AATP/AATP-*.md then call aatp_begin only when implementing. Do not implement in this turn.",
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
			seedTickets(state, listAatpSpecs(ctx.cwd));
			const tasks = hydrateAatp(ctx.cwd, state);
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
					"Spawn implementer / hard-implementer / smol-implementer with isolated:true.",
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
				`Spawn blocking reviewer. Call aatp_review. Target: ${args.trim() || "(latest completed)"}`,
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
				`${Object.values(state.tickets).every((t) => t.review === "APPROVE") && Object.keys(state.tickets).length > 0 ? "✓" : "✗"} reviews APPROVE`,
				`${state.qa.status === "pass" ? "✓" : "✗"} QA pass @ ${state.qa.tree_sha || "no-sha"} (clean tree)`,
			].join("\n");
			orchestrate(pi, ready ? "RELEASE_READY=true (derived)." : "Release blocked (derived, not sticky).", report);
		},
	});
}
