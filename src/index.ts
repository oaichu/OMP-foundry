import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	aatpManifestHash,
	beginTicket,
	blockTicket,
	completeTicket,
	hydrateAatp,
	listAatpSpecs,
	readyIndependent,
	resetAatp,
	resetTicket,
	reviewTicket,
	routeAgent,
	seedTickets,
	summarizeAatp,
	validateAatpSpecs,
	writeAatpIndex,
} from "./aatp";
import { CONTEXT_POLICY, phasePrompt } from "./context-policy";
import { requireDesignIfUi, requirePlan, requireProduct } from "./gates";
import { checkFoundryProjectRoles, checkIsolationContract, ensureProjectFoundryConfig, narrowFoundryGitignore } from "./omp-runtime";
import { denyToolCall, forceIsolatedTaskInput, type ToolInput } from "./permissions";
import {
	applyPatchArtifact,
	commitAppliedPatch,
	extractTaskResults,
	governedTask,
	hashEvidence,
	parseConflict,
	parseReviewVerdict,
	prepareImplementationBaseline,
	restoreCleanHead,
	taskBindings,
	taskItems,
	type TaskBinding,
	validatePatchArtifact,
} from "./patch-gate";
import { canonicalRepoPath } from "./paths";
import {
	abortPlan3,
	completePlan3Stage,
	enterPlan3,
	expectedPlan3Agent,
	hashPlan3Artifact,
	plan3ArtifactsMatch,
	plan3Instruction,
	plan3Status,
} from "./plan3";
import { deriveRelease, invalidateQa, lockArtifactHash, workingTreeClean } from "./release";
import { loadRegistry } from "./skills/registry";
import type { SkillRole } from "./skills/manifest-schema";
import { resolveSkillManifests, skillPackPrompt } from "./skills/resolver";
import { detectStack } from "./stack-detector";
import { loadState, loadStateResult, recountTickets, saveState, stateFileExists } from "./state-machine";
import { type CompanyState, type Plan3Stage, defaultState } from "./types";
import { checkForUpdate, versionReport } from "./update-check";
import { applyQa, runVerify } from "./verify-runner";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUSTOM = "com.omp.company-workflow.state";
const MARKER = "docs/.foundry-governed";
const LIFECYCLE_TOOLS = new Set(["aatp_begin", "aatp_complete", "aatp_block", "aatp_review"]);
const PLAN_AGENTS = new Set(["plan-drafter", "plan-redteam", "plan-synth", "plan-critic", "plan-finalizer"]);

type PendingRun = { bindings: TaskBinding[]; startedClean: boolean };
type ActivePlanStage = Exclude<Plan3Stage, "idle" | "awaiting_lock">;
type PendingPlanRun = { stage: ActivePlanStage; agent: string; index: number };

function token(): string { return randomBytes(16).toString("hex"); }
function copyTemplate(cwd: string, name: string): void {
	const dest = join(cwd, "docs", name);
	if (existsSync(dest)) return;
	mkdirSync(dirname(dest), { recursive: true });
	const src = join(ROOT, "templates", name);
	if (existsSync(src)) writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
}
function persist(cwd: string, state: CompanyState): CompanyState { saveState(cwd, state); return state; }
function orchestrate(pi: ExtensionAPI, title: string, body: string): void { pi.sendUserMessage([title, "", body, "", CONTEXT_POLICY].join("\n")); }
function productOk(state: CompanyState): boolean { return state.product.status === "approved" || state.product.status === "locked"; }
function statusOf(state: CompanyState): string { return state.mode === "plan3" ? `${plan3Status(state)} plan=${state.master_plan.status}` : `${state.phase} plan=${state.master_plan.status} design=${state.design.status}`; }
function commitGovernanceBaseline(cwd: string): string | undefined { const result = prepareImplementationBaseline(cwd); return result.ok ? undefined : result.reason; }
function safeState(cwd: string): { state: CompanyState; broken?: string; missing: boolean } {
	let missing = false;
	try { missing = !stateFileExists(cwd); }
	catch (error) { return { state: defaultState(), broken: error instanceof Error ? error.message : String(error), missing: false }; }
	const loaded = loadStateResult(cwd);
	if (!loaded.ok) return { state: defaultState(), broken: loaded.reason, missing };
	return { state: loaded.state, missing };
}
function taskKey(event: { toolCallId?: string }, cwd: string): string { return event.toolCallId ?? cwd; }
function plan3ModelsReady(cwd: string): string | undefined {
	const roles = checkFoundryProjectRoles(cwd);
	return roles.ok ? undefined : roles.reason ?? "FOUNDRY_MODEL_ROLES_REQUIRED";
}
function plan3PriorEvidenceMatches(cwd: string, state: CompanyState): boolean {
	if (state.planning.stage === "draft") return true;
	if (!state.planning.draft_sha256 || hashPlan3Artifact(cwd, "draft") !== state.planning.draft_sha256) return false;
	if (state.planning.stage === "redteam") return true;
	if (!state.planning.review_sha256 || hashPlan3Artifact(cwd, "redteam") !== state.planning.review_sha256) return false;
	return true;
}
function enterOrResumePlan3(pi: ExtensionAPI, cwd: string, state: CompanyState, restart = false): void {
	const modelGate = plan3ModelsReady(cwd);
	if (modelGate) { orchestrate(pi, "Plan3 model roles are not ready.", `${modelGate}\nOpen /model → Roles in this project and assign the foundry_* roles.`); return; }
	enterPlan3(state, restart);
	persist(cwd, state);
	orchestrate(pi, plan3Status(state), plan3Instruction(state));
}

function advanceFoundry(pi: ExtensionAPI, cwd: string, args: string): void {
	const loaded = safeState(cwd);
	if (loaded.broken) { orchestrate(pi, "Foundry state blocked.", loaded.broken); return; }
	const state = loaded.state;
	const idea = args.trim();
	if (loaded.missing) {
		orchestrate(pi, "Start the foundry.", ["Call company_init.", idea ? `User idea: ${idea}` : "If the user has not described the product, ask one short question then spawn product-analyst.", "Then wait for /foundry-approve product."].join("\n"));
		return;
	}
	if (!productOk(state)) { orchestrate(pi, "Finish the product.", "Spawn blocking product-analyst. Wait for /foundry-approve product. Do not plan or code."); return; }
	if (state.master_plan.status !== "locked") { enterOrResumePlan3(pi, cwd, state); return; }
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") { orchestrate(pi, "Design is required.", "Spawn blocking design-foundation, build a real preview, then wait for /design approve or /design skip."); return; }
	const tasks = hydrateAatp(cwd, state);
	if (tasks.length === 0) { orchestrate(pi, "Generate AATP.", "Run /aatp. Write docs/AATP/AATP-*.md from the locked plan; do not implement."); return; }
	const ready = readyIndependent(tasks), counts = summarizeAatp(tasks);
	if (ready.length > 0) { orchestrate(pi, "Build the next independent AATP layer.", "Run /build. Foundry will seal specs, isolate workers, validate patches, then apply+commit only valid deltas."); return; }
	if (counts.completed === counts.total && counts.total > 0 && state.qa.status !== "pass") {
		const unreviewed = tasks.filter((t) => t.status === "completed" && t.review !== "APPROVE");
		if (unreviewed.length > 0) { orchestrate(pi, "Review before QA.", `Run /review <AATP-ID>. Unreviewed: ${unreviewed.map((t) => t.id).join(", ")}.`); return; }
		orchestrate(pi, "All AATP done. Run /verify.", "Foundry runs deterministic verification against a clean committed tree.");
		return;
	}
	orchestrate(pi, "Run /release-check.", "Release is derived from locked artifacts, sealed AATP specs, independent review evidence, QA SHA, and a clean tree.");
}

function resultForBinding(results: ReturnType<typeof extractTaskResults>, binding: TaskBinding) {
	const indexed = results.find((r) => (r.index ?? 0) === binding.index);
	if (!indexed || (indexed.agent && indexed.agent !== binding.agent)) return undefined;
	return indexed;
}
function resultForPlan(results: ReturnType<typeof extractTaskResults>, pending: PendingPlanRun) {
	const indexed = results.find((r) => (r.index ?? 0) === pending.index);
	if (!indexed || (indexed.agent && indexed.agent !== pending.agent)) return undefined;
	return indexed;
}

function processGovernedResults(cwd: string, state: CompanyState, bindings: TaskBinding[], details: unknown): string[] {
	const messages: string[] = [], results = extractTaskResults(details);
	for (const binding of bindings) {
		const ticket = state.tickets[binding.ticketId];
		if (!ticket) { messages.push(`${binding.ticketId}: missing parent ticket state`); continue; }
		const result = resultForBinding(results, binding);
		if (!result || result.exitCode !== 0 || result.error || result.aborted) {
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: worker failed; no patch applied${result?.error ? ` (${result.error})` : ""}`);
			continue;
		}
		const output = result.output ?? "", conflict = parseConflict(output);
		if (conflict && binding.kind === "implementation") {
			blockTicket(state, binding.ticketId, `${conflict.kind}: ${conflict.reason}`);
			messages.push(`${binding.ticketId}: blocked by worker conflict ${conflict.kind}`);
			continue;
		}
		const reviewVerdict = binding.kind === "review" ? parseReviewVerdict(output, binding.ticketId) : undefined;
		if (binding.kind === "review" && !reviewVerdict) { messages.push(`${binding.ticketId}: REVIEW_GATE missing FOUNDRY_REVIEW marker; no review patch applied`); continue; }
		const checked = validatePatchArtifact(cwd, result.patchPath, ticket, binding.kind);
		if (!checked.ok) {
			if (binding.kind === "implementation") blockTicket(state, binding.ticketId, checked.reason);
			messages.push(`${binding.ticketId}: ${checked.reason}`);
			continue;
		}
		if (binding.kind === "review") {
			const reportVerdict = parseReviewVerdict(checked.patch, binding.ticketId);
			if (!reportVerdict || reportVerdict !== reviewVerdict) { messages.push(`${binding.ticketId}: REVIEW_GATE report marker must match final-output verdict; no review patch applied`); continue; }
		}
		const applied = applyPatchArtifact(cwd, result.patchPath);
		if (!applied.ok) {
			restoreCleanHead(cwd);
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: ${applied.reason}`);
			continue;
		}
		const committed = commitAppliedPatch(cwd, binding.ticketId, binding.kind);
		if (!committed.ok) {
			restoreCleanHead(cwd);
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: ${committed.reason}`);
			continue;
		}
		const evidence = hashEvidence(checked.patch, output, result.id, result.agent);
		if (binding.kind === "implementation") {
			const done = completeTicket(state, binding.ticketId, evidence);
			messages.push(done.ok ? `${binding.ticketId}: validated, applied, committed, completed` : `${binding.ticketId}: ${done.reason}`);
		} else {
			const reviewed = reviewTicket(state, binding.ticketId, reviewVerdict!, binding.agent, evidence);
			messages.push(reviewed.ok ? `${binding.ticketId}: review=${reviewVerdict} recorded with evidence` : `${binding.ticketId}: ${reviewed.reason}`);
		}
	}
	recountTickets(state); invalidateQa(state); return messages;
}

export default function ompCompanyWorkflow(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.setLabel("OMP Foundry");
	const pending = new Map<string, PendingRun>();
	const pendingPlan = new Map<string, PendingPlanRun>();

	pi.on("session_start", async (_event, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		ctx.ui.setStatus("foundry", broken ? "STATE_CORRUPT" : statusOf(state));
		ctx.setTimeout(() => { void checkForUpdate().then((result) => { if (result.notify) ctx.ui.notify(result.notify, "info"); }).catch(() => undefined); }, 0);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const { state, broken } = safeState(ctx.cwd);
		const agentName = String((event as { agent?: { name?: string }; agentName?: string }).agent?.name ?? (event as { agentName?: string }).agentName ?? "").toLowerCase();
		const role: SkillRole | undefined = agentName.includes("plan") ? "planner" : agentName.includes("design") ? "designer" : agentName.includes("review") ? "reviewer" : agentName.includes("implement") ? "implementer" : undefined;
		const pack = broken ? [] : resolveSkillManifests(ctx.cwd, state, role ? { role } : undefined);
		return { message: { customType: CUSTOM, content: broken ? `Foundry state corrupt: ${broken}` : `${phasePrompt(state)} ${statusOf(state)}.\n${skillPackPrompt(pack, state.phase)}`, display: true, details: { ...state, unlock_token: undefined, skills: pack.map((s) => s.id) } } };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (LIFECYCLE_TOOLS.has(event.toolName)) return { block: true, reason: "LIFECYCLE_GATE: AATP lifecycle is parent-extension-owned; agents cannot transition tickets directly." };
		if (event.toolName === "task") {
			const raw = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
			const loaded = safeState(ctx.cwd);
			if (loaded.broken) return { block: true, reason: `STATE_CORRUPT: ${loaded.broken}` };
			if (loaded.state.mode === "plan3") {
				const items = taskItems(raw), planItems = items.filter((item) => PLAN_AGENTS.has(item.agent));
				if (planItems.length > 0) {
					const expected = expectedPlan3Agent(loaded.state);
					if (!expected) return { block: true, reason: `PLAN3_GATE: no planning agent is allowed at stage ${loaded.state.planning.stage}.` };
					if (items.length !== 1 || planItems.length !== 1 || planItems[0].agent !== expected) return { block: true, reason: `PLAN3_GATE: stage ${loaded.state.planning.stage} requires exactly one blocking ${expected}; no other Plan3 stage may run.` };
					if (!plan3PriorEvidenceMatches(ctx.cwd, loaded.state)) return { block: true, reason: "PLAN3_EVIDENCE_GATE: a prior stage artifact changed after it was accepted. Restart /plan3 or restore the artifact." };
					pendingPlan.set(taskKey(event, ctx.cwd), { stage: loaded.state.planning.stage as ActivePlanStage, agent: expected, index: planItems[0].index });
				}
			}
			if (governedTask(raw)) {
				const contract = checkIsolationContract(ctx.cwd);
				if (!contract.ok) return { block: true, reason: contract.reason ?? "Foundry isolation contract failed." };
				const parsed = taskBindings(raw);
				if (parsed.errors.length) return { block: true, reason: `AATP_BINDING_GATE: ${parsed.errors.join("; ")}` };
				if (parsed.bindings.length === 0) return { block: true, reason: "AATP_BINDING_GATE: governed task has no exact ticket binding." };
				if (!workingTreeClean(ctx.cwd)) return { block: true, reason: "WORKTREE_GATE: governed task requires a clean parent tree." };
				const state = loadState(ctx.cwd), specs = listAatpSpecs(ctx.cwd);
				if (!state.aatp.manifest_sha256 || state.aatp.manifest_sha256 !== aatpManifestHash(ctx.cwd)) return { block: true, reason: "AATP_SPEC_GATE: specs are not sealed or changed since seal." };
				for (const binding of parsed.bindings) {
					const spec = specs.find((s) => s.id === binding.ticketId);
					if (!spec) return { block: true, reason: `AATP_BINDING_GATE: unknown ${binding.ticketId}.` };
					if (binding.kind === "implementation") {
						const begun = beginTicket(state, spec, binding.ticketId, binding.agent);
						if (!begun.ok) return { block: true, reason: begun.reason };
					} else {
						const ticket = state.tickets[binding.ticketId];
						if (!ticket || ticket.status !== "completed") return { block: true, reason: `REVIEW_GATE: ${binding.ticketId} must be completed before review.` };
					}
				}
				recountTickets(state); invalidateQa(state); persist(ctx.cwd, state);
				pending.set(taskKey(event, ctx.cwd), { bindings: parsed.bindings, startedClean: true });
			}
			const isolated = forceIsolatedTaskInput(raw);
			if (isolated) return { input: isolated };
		}
		if (String(event.toolName).startsWith("company_") || event.toolName === "foundry_skill_read" || event.toolName === "foundry_exec") return;
		const loaded = safeState(ctx.cwd), activeTickets = Object.values(loaded.state.tickets).filter((t) => t.status === "active"), isolatedWithoutState = loaded.missing && existsSync(join(ctx.cwd, MARKER));
		return denyToolCall(event.toolName, (event.input ?? {}) as ToolInput, loaded.state, { stateBroken: loaded.broken, activeTickets, cwd: ctx.cwd, isolatedWithoutState, canonicalize: (raw) => canonicalRepoPath(ctx.cwd, raw) });
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "task") return;
		const key = taskKey(event, ctx.cwd);
		const planRun = pendingPlan.get(key);
		if (planRun) {
			pendingPlan.delete(key);
			const result = resultForPlan(extractTaskResults(event.details), planRun);
			if (!result || result.exitCode !== 0 || result.error || result.aborted) return { isError: true, content: [{ type: "text" as const, text: `PLAN3_STAGE_FAILED: ${planRun.stage} did not complete; stage remains unchanged.` }] };
			const state = loadState(ctx.cwd), completed = completePlan3Stage(ctx.cwd, state, planRun.stage);
			if (!completed.ok) return { isError: true, content: [{ type: "text" as const, text: completed.reason ?? "PLAN3_STAGE_GATE" }] };
			persist(ctx.cwd, state); ctx.ui.setStatus("foundry", statusOf(state));
			return { content: [{ type: "text" as const, text: `${plan3Status(state)}\n${plan3Instruction(state)}` }] };
		}
		const run = pending.get(key);
		if (!run) return;
		pending.delete(key);
		if (run.startedClean && !workingTreeClean(ctx.cwd)) {
			const state = loadState(ctx.cwd);
			for (const binding of run.bindings) if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			recountTickets(state); persist(ctx.cwd, state);
			return { isError: true, content: [{ type: "text" as const, text: "ISOLATION_GATE: parent tree changed while worker ran. Worker patch was not applied; parent changes were preserved." }] };
		}
		const state = loadState(ctx.cwd), messages = processGovernedResults(ctx.cwd, state, run.bindings, event.details);
		persist(ctx.cwd, state);
		return { isError: messages.some((m) => /failed|blocked|GATE|rejected/i.test(m)), content: [{ type: "text" as const, text: messages.join("\n") }] };
	});

	pi.registerTool({ name: "company_status", label: "Foundry Status", description: "Read Foundry state, mode, and AATP counters.", loadMode: "essential", approval: "read", parameters: z.object({}), async execute(_id, _params, _session, _user, ctx) {
		const loaded = safeState(ctx.cwd); if (loaded.broken) return { content: [{ type: "text", text: loaded.broken }], isError: true };
		const tasks = hydrateAatp(ctx.cwd, loaded.state), stack = detectStack(ctx.cwd), publicState = { ...loaded.state, aatp: { ...loaded.state.aatp, ...summarizeAatp(tasks) }, unlock_token: undefined, stack, display_mode: statusOf(loaded.state) };
		return { content: [{ type: "text", text: JSON.stringify(publicState, null, 2) }], details: publicState };
	} });

	pi.registerTool({ name: "company_init", label: "Foundry Init", description: "Create Foundry docs/state and project-scoped OMP defaults without mutating global OMP configuration.", loadMode: "essential", approval: "write", parameters: z.object({ name: z.string().optional() }), async execute(_id, params, _session, _user, ctx) {
		mkdirSync(join(ctx.cwd, "docs", "planning"), { recursive: true }); mkdirSync(join(ctx.cwd, "docs", "AATP"), { recursive: true }); mkdirSync(join(ctx.cwd, "docs", "reports"), { recursive: true });
		for (const name of ["PRODUCT.md", "MASTER_PLAN.md", "DESIGN.md", "SECURITY.md", "ARCHITECTURE.md", "AATP.md", "RELEASE_REPORT.md"]) copyTemplate(ctx.cwd, name);
		if (!existsSync(join(ctx.cwd, MARKER))) writeFileSync(join(ctx.cwd, MARKER), "OMP Foundry governed repository.\n", "utf8");
		narrowFoundryGitignore(ctx.cwd); const config = ensureProjectFoundryConfig(ctx.cwd);
		const existed = stateFileExists(ctx.cwd), state = existed ? loadState(ctx.cwd) : defaultState(), stack = detectStack(ctx.cwd);
		if (!existed) { state.design.required = stack.ui; state.phase = "discovery"; persist(ctx.cwd, state); }
		ctx.ui.setStatus("foundry", statusOf(state));
		return { content: [{ type: "text", text: `${existed ? "Kept" : "Initialized"} Foundry. stack=${stack.ids.join(",")} ui=${stack.ui} project_config=${config.created ? "created" : "updated-without-global-mutation"} foundry_roles=${config.rolesBootstrapped.length} name=${params.name ?? ""}` }], details: state };
	} });

	pi.registerTool({ name: "foundry_exec", label: "Foundry Design Verify", description: "Run one detected verification command during unlocked design only; no arbitrary command input.", loadMode: "essential", approval: "write", parameters: z.object({ id: z.string() }), async execute(_id, params, _session, _user, ctx) {
		const state = loadState(ctx.cwd);
		if (state.phase !== "design" || state.master_plan.status !== "locked" || state.design.status === "locked") return { content: [{ type: "text", text: "FOUNDRY_EXEC_GATE: verification tool is available only while design is unlocked after plan lock." }], isError: true };
		const steps = detectStack(ctx.cwd).verify, step = steps.find((s) => s.id === params.id);
		if (!step) return { content: [{ type: "text", text: `Unknown verify id ${params.id}. Available: ${steps.map((s) => s.id).join(", ") || "none"}` }], isError: true };
		const result = spawnSync(step.command, { cwd: step.cwd ? join(ctx.cwd, step.cwd) : ctx.cwd, shell: true, encoding: "utf8", timeout: 120_000 });
		return { content: [{ type: "text", text: `${step.id} exit=${result.status ?? -1}\n${result.stdout}\n${result.stderr}` }], isError: result.status !== 0 };
	} });

	pi.registerTool({ name: "foundry_skill_read", label: "Foundry Skill Read", description: "Load 1–3 Foundry skill bodies on demand.", loadMode: "essential", approval: "read", parameters: z.object({ ids: z.array(z.string()) }), async execute(_id, params) {
		const registry = loadRegistry(join(ROOT, "skills")), wanted = params.ids.slice(0, 3), bodies = wanted.map((id: string) => { const hit = registry.find((s) => s.id === id); return hit ? `# ${hit.id}\n${hit.description}\n\n${hit.body}` : `# ${id}\n(not found)`; });
		return { content: [{ type: "text", text: bodies.join("\n\n") }], details: { ids: wanted } };
	} });

	pi.registerCommand("foundry", { description: "Next legal Foundry step", handler: async (args, ctx) => advanceFoundry(pi, ctx.cwd, args) });
	pi.registerCommand("company", { description: "Alias of /foundry", handler: async (args, ctx) => advanceFoundry(pi, ctx.cwd, args) });
	const initHandler = async (args: string, ctx: { cwd: string; waitForIdle: () => Promise<void> }) => { await ctx.waitForIdle(); orchestrate(pi, "Bootstrap Foundry.", ["Call company_init.", "Then run /foundry-doctor. Foundry model roles are project-scoped and may be adjusted in /model → Roles.", "If docs/PRODUCT.md is still a stub, spawn blocking product-analyst.", "Then wait for /foundry-approve product.", args.trim() ? `Project: ${args.trim()}` : ""].filter(Boolean).join("\n")); };
	pi.registerCommand("foundry-init", { description: "Bootstrap PRODUCT/docs + Foundry project config/state", handler: initHandler });
	pi.registerCommand("company-init", { description: "Alias of /foundry-init", handler: initHandler });
	pi.registerCommand("foundry-doctor", { description: "Check OMP isolation and project-scoped Foundry model roles", handler: async (_args, ctx) => {
		const isolation = checkIsolationContract(ctx.cwd), roles = checkFoundryProjectRoles(ctx.cwd);
		const ok = isolation.ok && roles.ok;
		orchestrate(pi, ok ? "Foundry runtime contract OK." : "Foundry runtime contract BLOCKED.", [isolation.ok ? `isolation=${isolation.mode} apply=${isolation.apply}` : isolation.reason, roles.ok ? "modelRoleStorage=project; all foundry_* roles mapped" : roles.reason].filter(Boolean).join("\n"));
	} });
	pi.registerCommand("foundry-version", { description: "Show Foundry/OMP versions and latest stable tag", handler: async (_args, ctx) => { const result = await checkForUpdate({ force: true }); if (result.notify) ctx.ui.notify(result.notify, "info"); orchestrate(pi, "Foundry version", versionReport(result)); } });

	const plan3Handler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: string) => void } }) => {
		const state = loadState(ctx.cwd), missing = requireProduct(state);
		if (missing) { ctx.ui.notify(missing, "warning"); return; }
		const sub = args.trim().toLowerCase();
		if (sub === "status") { orchestrate(pi, plan3Status(state), state.mode === "plan3" ? plan3Instruction(state) : "Plan3 is not active."); return; }
		if (sub === "abort") { abortPlan3(state); persist(ctx.cwd, state); orchestrate(pi, "Plan3 aborted by user.", "Planning stage authority is cleared. The plan remains unlocked unless it was already locked."); return; }
		if (state.master_plan.status === "locked") { ctx.ui.notify("PLAN_GATE: master plan is locked. Use /plan-revise before starting a new Plan3 cycle.", "warning"); return; }
		enterOrResumePlan3(pi, ctx.cwd, state, sub === "restart");
	};
	pi.registerCommand("plan3", { description: "Enter/resume governed Draft → Redteam → Synth planning mode", handler: plan3Handler });
	pi.registerCommand("3-stage-plan", { description: "Alias of /plan3", handler: plan3Handler });
	pi.registerCommand("plan-revise", { description: "Human-only: reopen locked plan and restart Plan3", handler: async (args, ctx) => {
		const state = loadState(ctx.cwd); state.master_plan.status = "draft"; state.unlock_token = token(); state.conflict = { kind: "PLAN_CONFLICT", reason: args.trim() || "user revise" }; resetAatp(state); invalidateQa(state); enterPlan3(state, true); persist(ctx.cwd, state); orchestrate(pi, "PLAN reopened by user.", `${plan3Status(state)}\n${plan3Instruction(state)}\nDownstream AATP/reviews/QA were invalidated.`);
	} });

	pi.registerCommand("design", { description: "Design foundation after plan lock", handler: async (args, ctx) => {
		const state = loadState(ctx.cwd), gate = requirePlan(state); if (gate) { ctx.ui.notify(gate, "warning"); return; }
		const sub = args.trim().toLowerCase();
		if (sub === "approve") { state.design.status = "locked"; state.design.required = true; state.design.version = state.design.version === "0" ? "1.0" : state.design.version; state.phase = "aatp"; lockArtifactHash(ctx.cwd, state, "design"); resetAatp(state); invalidateQa(state); persist(ctx.cwd, state); orchestrate(pi, "DESIGN LOCKED by user.", "Continue with /aatp."); return; }
		if (sub === "skip") { state.design.required = false; state.design.status = "not_required"; state.phase = "aatp"; resetAatp(state); invalidateQa(state); persist(ctx.cwd, state); orchestrate(pi, "DESIGN skipped by user.", "Continue with /aatp."); return; }
		orchestrate(pi, "Run /design. Read skill://design-foundation.", "Spawn blocking design-foundation. Build/verification is available only through foundry_exec. Human locks with /design approve.");
	} });
	pi.registerCommand("foundry-approve", { description: "Human gate: product | plan", handler: async (args, ctx) => {
		const which = args.trim().toLowerCase(), state = loadState(ctx.cwd);
		if (which === "product" || which === "approve-product") { state.product.status = "approved"; state.phase = "planning"; lockArtifactHash(ctx.cwd, state, "product"); invalidateQa(state); persist(ctx.cwd, state); orchestrate(pi, "PRODUCT approved by user.", "Run /plan3 or /foundry. Plan3 uses project-scoped @foundry_plan/@foundry_redteam/@foundry_synth roles."); return; }
		if (which === "plan" || which === "approve-plan") {
			if (state.mode !== "plan3" || state.planning.stage !== "awaiting_lock") { ctx.ui.notify("PLAN3_GATE: plan approval requires a completed Draft → Redteam → Synth cycle.", "warning"); return; }
			if (!plan3ArtifactsMatch(ctx.cwd, state)) { ctx.ui.notify("PLAN3_EVIDENCE_GATE: planning artifacts changed after their stage completed. Restart Plan3 or restore the accepted artifacts.", "error"); return; }
			state.master_plan.status = "locked"; state.master_plan.version = state.master_plan.version === "0" ? "1.0" : state.master_plan.version; state.unlock_token = ""; state.conflict = { kind: "none", reason: "" }; state.mode = "normal"; state.phase = state.design.required ? "design" : "aatp"; lockArtifactHash(ctx.cwd, state, "master_plan"); resetAatp(state); invalidateQa(state); persist(ctx.cwd, state); orchestrate(pi, "PLAN LOCKED by user.", "Plan3 evidence accepted. Continue /foundry."); return;
		}
		ctx.ui.notify("Usage: /foundry-approve product|plan", "warning");
	} });
	pi.registerCommand("aatp", { description: "Generate AATP DAG from locked plan+design", handler: async (_args, ctx) => { const state = loadState(ctx.cwd), gate = requireDesignIfUi(state); if (gate) { ctx.ui.notify(gate, "warning"); return; } state.phase = "aatp"; state.aatp.manifest_sha256 = ""; persist(ctx.cwd, state); orchestrate(pi, "Generate AATP. Read docs/AATP.md template.", "Write docs/AATP/AATP-*.md with explicit allowed_files and valid dependencies. Do not implement. /build will validate and seal the manifest."); } });
	pi.registerCommand("build", { description: "Seal AATP specs and spawn ready isolated workers", handler: async (_args, ctx) => {
		const state = loadState(ctx.cwd), gate = requireDesignIfUi(state); if (gate) { ctx.ui.notify(gate, "warning"); return; }
		const contract = checkIsolationContract(ctx.cwd); if (!contract.ok) { ctx.ui.notify(contract.reason ?? "Foundry isolation contract failed", "error"); return; }
		const specs = listAatpSpecs(ctx.cwd), errors = validateAatpSpecs(specs); if (errors.length) { ctx.ui.notify(`AATP invalid: ${errors.join("; ")}`, "error"); return; }
		if (!state.aatp.manifest_sha256) {
			state.aatp.manifest_sha256 = aatpManifestHash(ctx.cwd); seedTickets(state, specs); writeAatpIndex(ctx.cwd, hydrateAatp(ctx.cwd, state)); persist(ctx.cwd, state);
			const baselineError = commitGovernanceBaseline(ctx.cwd); if (baselineError) { ctx.ui.notify(baselineError, "error"); return; }
		} else if (state.aatp.manifest_sha256 !== aatpManifestHash(ctx.cwd)) { ctx.ui.notify("AATP_SPEC_GATE: sealed AATP specs changed. Re-run /aatp after an explicit plan/design revision.", "error"); return; }
		seedTickets(state, specs); const tasks = hydrateAatp(ctx.cwd, state), ready = readyIndependent(tasks); state.phase = "implementation"; recountTickets(state); persist(ctx.cwd, state);
		const lines = ready.map((t) => `- ${t.id} agent=${routeAgent(t.risk)} :: ${t.objective}`);
		orchestrate(pi, "Run the ready AATP layer.", [`Ready (${ready.length}):`, lines.join("\n") || "(none)", "Spawn one blocking task item per line with the exact AATP id in each task text.", "Do NOT call aatp_begin/complete. Foundry owns lifecycle, patch validation, apply, and commit.", "Worker conflicts must end with: FOUNDRY_CONFLICT <KIND> <reason>."].join("\n"));
	} });
	pi.registerCommand("review", { description: "Independent AATP review with parent-owned verdict transition", handler: async (args, ctx) => {
		const state = loadState(ctx.cwd), completed = Object.values(state.tickets).filter((t) => t.status === "completed" && t.review !== "APPROVE"), requested = args.trim().toUpperCase(), target = requested ? state.tickets[requested] : completed[0];
		if (!target || target.status !== "completed") { ctx.ui.notify("REVIEW_GATE: specify a completed AATP id.", "warning"); return; }
		state.phase = "review"; persist(ctx.cwd, state);
		const agent = /critical|security/i.test(target.risk) ? "security-reviewer" : "reviewer";
		orchestrate(pi, "Independent review.", `Spawn blocking ${agent} for ${target.id}. The review report and final output must contain the same exact marker: FOUNDRY_REVIEW ${target.id} APPROVE|REQUEST_CHANGES|BLOCK. Reviewer cannot call lifecycle tools or modify product code.`);
	} });
	pi.registerCommand("verify", { description: "Deterministic QA", handler: async (_args, ctx) => { const state = loadState(ctx.cwd), rows = runVerify(ctx.cwd); applyQa(ctx.cwd, state, rows); deriveRelease(ctx.cwd, state); persist(ctx.cwd, state); orchestrate(pi, `QA ${state.qa.status}`, rows.map((r) => `${r.id}=${r.exitCode}`).join(" ") || "no-commands"); } });
	pi.registerCommand("release-check", { description: "Derived release gate; agent release commands remain denied", handler: async (_args, ctx) => {
		const state = loadState(ctx.cwd); recountTickets(state); const ready = deriveRelease(ctx.cwd, state); if (ready) state.phase = "release"; persist(ctx.cwd, state);
		const report = [
			`${productOk(state) ? "✓" : "✗"} PRODUCT`, `${state.master_plan.status === "locked" ? "✓" : "✗"} PLAN locked`, `${!state.design.required || state.design.status === "locked" || state.design.status === "not_required" ? "✓" : "✗"} DESIGN`,
			`${state.aatp.manifest_sha256 && state.aatp.manifest_sha256 === aatpManifestHash(ctx.cwd) ? "✓" : "✗"} AATP specs sealed`, `${state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0 ? "✓" : "✗"} AATP complete`,
			`${Object.values(state.tickets).every((t) => t.review === "APPROVE" && (t.review_by === "reviewer" || t.review_by === "security-reviewer") && t.review_evidence_sha256) && Object.keys(state.tickets).length > 0 ? "✓" : "✗"} independent reviews`, `${state.qa.status === "pass" ? "✓" : "✗"} QA pass @ ${state.qa.tree_sha || "no-sha"}`, `${workingTreeClean(ctx.cwd) ? "✓" : "✗"} clean tree`,
		].join("\n");
		orchestrate(pi, ready ? "RELEASE_READY=true (derived)." : "Release blocked.", `${report}\n\nAgent push/publish/deploy remains denied. Release from a human shell after this gate is green.`);
	} });
}
