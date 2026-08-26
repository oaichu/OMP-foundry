import { lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, fstatSync, writeSync, closeSync, constants as fsConstants } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	aatpManifestHash,
	archiveAatpSpecs,
	beginTicket,
	blockTicket,
	completeTicket,
	hydrateAatp,
	listAatpSpecs,
	readyIndependent,
	reviewAgentForRisk,
	resetAatp,
	resetTicket,
	reviewTicket,
	routeAgent,
	seedTickets,
	summarizeAatp,
	validateAatpSpecs,
	validateAatpCoverage,
	writeAatpIndex,
	type AatpSpec,
	type ImplementationProvenance,
	type ReviewProvenance,
} from "./aatp";
import { approvePlan, approveProduct, type ApproveDeps } from "./approve";
import { bootstrapFoundryProject } from "./bootstrap";
import { CONTEXT_POLICY, phasePrompt } from "./context-policy";
import { requireDesignIfUi, requirePlan, requireProduct } from "./gates";
import { checkFoundryProjectRoles, checkIsolationContract, ensureGlobalFoundryRoles } from "./omp-runtime";
import { denyToolCall, forceIsolatedTaskInput, type ToolInput } from "./permissions";
import {
	applyPatchArtifact,
	commitAppliedPatch,
	extractTaskResults,
	gitChangedPaths,
	governedTask,
	hashEvidence,
	IMPLEMENTER_AGENTS,
	parseConflict,
	parseReviewVerdict,
	prepareImplementationBaseline,
	REVIEW_AGENTS,
	restoreCleanHead,
	taskBindings,
	taskItems,
	type TaskBinding,
	validatePatchArtifact,
} from "./patch-gate";
import { canonicalRepoPath, safeRepoPath } from "./paths";
import {
	abortPlan,
	completePlanStage,
	enterPlan,
	expectedPlanAgent,
	hashPlanArtifact,
	planInstruction,
	planStatus,
	PLAN_ARTIFACTS,
} from "./plan";
import { artifactsMatch, deriveRelease, gitHead, governedCommitLedgerFresh, invalidateQa, lockArtifactHash, workingTreeClean } from "./release";
import { dependencyScopeHash, ticketScopeHash } from "./provenance";
import { roleOf } from "./skills/phase-filter";
import { loadRegistry } from "./skills/registry";
import { resolveSkillManifests, skillPackPrompt } from "./skills/resolver";
import { detectStack } from "./stack-detector";
import { loadState, loadStateResult, recountTickets, saveState, stateFileExists, productReady, planLocked, designAllowsUi } from "./state-machine";
import { type CompanyState, type ConflictKind, type PlanStage, defaultState } from "./types";
import { checkForUpdate, versionReport } from "./update-check";
import { applyQa, executeVerifyStep, runDeclaredVerification, runVerify } from "./verify-runner";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CUSTOM = "com.omp.foundry.state";
const MARKER = "docs/.foundry-governed";
const LIFECYCLE_TOOLS = new Set(["aatp_begin", "aatp_complete", "aatp_block", "aatp_review"]);
const PLAN_AGENTS = new Set(["plan-drafter", "plan-redteam", "plan-synth"]);
const AATP_COMPILER = "aatp-compiler";
const TASK_AGENTS = new Set([
	"product-analyst", "design-foundation", ...PLAN_AGENTS, AATP_COMPILER,
	"implementer", "hard-implementer", "smol-implementer", "reviewer", "security-reviewer",
]);
const MUTATING_TASK_TOOLS = new Set(["task", "write", "edit", "ast_edit", "apply_patch", "foundry_init", "foundry_exec"]);
const CAPABILITY_FAILURE_LIMIT = 3;
const CAPABILITY_TTL_MS = 30 * 60 * 1000;
const DEFAULT_STAGE_TIMEOUT_MS = 20 * 60 * 1000;
const MIN_STAGE_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_STAGE_TIMEOUT_MS = 30 * 60 * 1000;
const CAPABILITY_BROKER_SYMBOL = Symbol.for("omp-foundry.capability-broker");

type PendingRun = { bindings: TaskBinding[]; startedClean: boolean; headAtDispatch: string; timer?: unknown };
type ActivePlanStage = Exclude<PlanStage, "idle" | "awaiting_lock">;
type CapabilityRun = { epoch: string; index: number; cwd: string; capability: string; createdAt: number; sessionId?: string; invalidAttempts: number; revoked: boolean; timedOut?: boolean; writeHashes?: Map<string, string> };
type PendingPlanRun = CapabilityRun & { stage: ActivePlanStage; agent: string; beforeHash?: string };
type PendingAatpRun = CapabilityRun & { agent: typeof AATP_COMPILER };
type ManagedStageContext = { setTimeout(callback: () => void, ms: number): unknown; clearTimer(timer: unknown): void; abort?: () => void };
type StageWatchdog = { context: ManagedStageContext; timer: unknown };
type CapabilityGuard = { attempts: number; tripped: boolean; updatedAt: number };
type CapabilityBroker = {
	pendingPlan: Map<string, PendingPlanRun>;
	pendingAatp: Map<string, PendingAatpRun>;
	failures: Map<string, CapabilityGuard>;
};
type SafeState = { state: CompanyState; broken?: string; missing: boolean };

function capabilityBroker(): CapabilityBroker {
	const globals = globalThis as unknown as Record<PropertyKey, unknown>;
	const existing = globals[CAPABILITY_BROKER_SYMBOL];
	if (existing && typeof existing === "object" && "pendingPlan" in existing && "pendingAatp" in existing && "failures" in existing) return existing as CapabilityBroker;
	const created: CapabilityBroker = { pendingPlan: new Map(), pendingAatp: new Map(), failures: new Map() };
	globals[CAPABILITY_BROKER_SYMBOL] = created;
	return created;
}

function stageTimeoutMs(): number {
	const configured = Number(process.env.FOUNDRY_STAGE_TIMEOUT_MS ?? "");
	if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_STAGE_TIMEOUT_MS;
	return Math.min(MAX_STAGE_TIMEOUT_MS, Math.max(MIN_STAGE_TIMEOUT_MS, Math.trunc(configured)));
}

function capabilitySessionId(ctx: unknown): string | undefined {
	try {
		const manager = (ctx as { sessionManager?: { getSessionId?: () => unknown } } | undefined)?.sessionManager;
		const id = manager?.getSessionId?.();
		return typeof id === "string" && id.trim() ? id : undefined;
	} catch { return undefined; }
}

function capabilityAgentName(event: unknown, ctx: unknown): string {
	const value = event as { agent?: { name?: unknown }; agentName?: unknown } | undefined;
	const explicit = value?.agent?.name ?? value?.agentName;
	if (typeof explicit === "string" && explicit.trim()) return explicit.trim().toLowerCase();
	try {
		const manager = (ctx as { sessionManager?: { getEntries?: () => unknown[] } } | undefined)?.sessionManager;
		const entries = manager?.getEntries?.() ?? [];
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index] as { type?: unknown; agent?: unknown } | undefined;
			if (entry?.type === "session_init" && typeof entry.agent === "string" && entry.agent.trim()) return entry.agent.trim().toLowerCase();
		}
	} catch { /* older OMP hosts may not expose session entries */ }
	return "";
}

function capabilityKey(kind: "PLAN" | "AATP", cwd: string, epoch: string, stage = ""): string {
	return `${kind}\u0000${cwd}\u0000${epoch}\u0000${stage}`;
}

function capabilityAttemptKey(base: string, sessionId?: string): string {
	return `${base}\u0000${sessionId ?? "unknown"}`;
}

function capabilityContentHash(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

function recordCapabilityWrite(run: CapabilityRun, rel: string, content: string): void {
	(run.writeHashes ??= new Map()).set(rel.toLowerCase(), capabilityContentHash(content));
}

function canonicalCapabilityPath(cwd: string, raw: string): string | null {
	const direct = canonicalRepoPath(cwd, raw);
	if (direct) return direct;
	if (!isAbsolute(raw)) return null;
	const root = safeRepoPath(cwd, ".");
	if (!root) return null;
	const rel = relative(root, raw);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return canonicalRepoPath(cwd, rel);
}

/** Prove that a terminal artifact is the exact bytes written through this run's capability. */
function capabilityWriteMatches(cwd: string, run: CapabilityRun, rel: string): boolean {
	const canonical = canonicalCapabilityPath(cwd, rel);
	const expected = run.writeHashes?.get((canonical ?? rel).toLowerCase());
	if (!expected) return false;
	const target = canonical ? safeRepoPath(cwd, canonical) : null;
	if (!target) return false;
	try {
		const stat = lstatSync(target);
		return stat.isFile() && !stat.isSymbolicLink() && capabilityContentHash(readFileSync(target, "utf8")) === expected;
	} catch { return false; }
}

function abortAfterTerminalCapabilityWrite(ctx: unknown): void {
	try { (ctx as { abort?: () => void } | undefined)?.abort?.(); } catch { /* best effort; the writer evidence remains authoritative */ }
}

function persist(cwd: string, state: CompanyState): CompanyState { saveState(cwd, state); return state; }
function orchestrate(pi: ExtensionAPI, title: string, body: string): void { pi.sendUserMessage([title, "", body, "", CONTEXT_POLICY].join("\n")); }
function statusOf(state: CompanyState): string { return state.mode === "plan" ? `${planStatus(state)} plan=${state.master_plan.status}` : `${state.phase} plan=${state.master_plan.status} design=${state.design.status}`; }
function commitGovernanceBaseline(cwd: string): string | undefined { const result = prepareImplementationBaseline(cwd); return result.ok ? undefined : result.reason; }
function safeState(cwd: string): SafeState {
	let missing = false;
	try { missing = !stateFileExists(cwd); }
	catch (error) { return { state: defaultState(), broken: error instanceof Error ? error.message : String(error), missing: false }; }
	const loaded = loadStateResult(cwd);
	if (!loaded.ok) return { state: defaultState(), broken: loaded.reason, missing };
	return { state: loaded.state, missing };
}
function governedProject(cwd: string, loaded: SafeState): boolean {
	if (!loaded.missing) return true;
	try {
		const marker = safeRepoPath(cwd, MARKER);
		if (!marker) return false;
		const stat = lstatSync(marker);
		return stat.isFile() && !stat.isSymbolicLink();
	} catch { return false; }
}
function taskKey(event: { toolCallId?: string }, cwd: string): string | undefined {
	const id = event.toolCallId?.trim();
	return id ? `${cwd}\u0000${id}` : undefined;
}
function compilerActiveFor(pending: Map<string, PendingAatpRun>, cwd: string): boolean { return [...pending.values()].some((run) => run.cwd === cwd); }
function planActiveFor(pending: Map<string, PendingPlanRun>, cwd: string): boolean { return [...pending.values()].some((run) => run.cwd === cwd); }
function planModelsReady(cwd: string): string | undefined {
	const roles = checkFoundryProjectRoles(cwd);
	return roles.ok ? undefined : roles.reason ?? "FOUNDRY_MODEL_ROLES_REQUIRED";
}
function planPriorEvidenceMatches(cwd: string, state: CompanyState): boolean {
	if (state.planning.stage === "draft") return true;
	if (!state.planning.draft_sha256 || hashPlanArtifact(cwd, "draft") !== state.planning.draft_sha256) return false;
	if (state.planning.stage === "redteam") return true;
	if (!state.planning.review_sha256 || hashPlanArtifact(cwd, "redteam") !== state.planning.review_sha256) return false;
	return true;
}
function enterOrResumePlan(pi: ExtensionAPI, cwd: string, state: CompanyState, restart = false): void {
	const modelGate = planModelsReady(cwd);
	if (modelGate) { orchestrate(pi, "Plan model roles are not ready.", `${modelGate}\nConfigure modelRoles in ~/.omp/agent/config.yml or this project's .omp/config.yml.`); return; }
	enterPlan(state, restart);
	persist(cwd, state);
	orchestrate(pi, planStatus(state), planInstruction(state));
}

/** Start the post-lock AATP compiler using the same synthesis capability as Plan. */
function requestAatpCompile(pi: ExtensionAPI, cwd: string, state: CompanyState, reset = true): void {
	const gate = requireDesignIfUi(state);
	if (gate) {
		orchestrate(pi, "AATP compiler is waiting for the human gates.", gate);
		return;
	}
	if (reset) {
		try { archiveAatpSpecs(cwd); }
		catch (error) { persist(cwd, state); orchestrate(pi, "AATP compiler could not reset the previous DAG.", `${error instanceof Error ? error.message : String(error)}\nResolve the AATP artifact permissions, then retry /aatp.`); return; }
		resetAatp(state);
	}
	state.phase = "aatp";
	state.aatp.manifest_sha256 = "";
	state.aatp.epoch = randomUUID();
	persist(cwd, state);
	const modelGate = planModelsReady(cwd);
	if (modelGate) { orchestrate(pi, "AATP compiler model role is not ready.", `${modelGate}\nConfigure foundry_synth in ~/.omp/agent/config.yml or this project's .omp/config.yml.`); return; }
	orchestrate(pi, "Compile the project-wide AATP DAG.", [
		"Spawn exactly one blocking aatp-compiler using @foundry_synth. It MUST write all AATP-*.md work orders FIRST. It MUST write docs/AATP/INDEX.md ABSOLUTELY LAST as the terminal artifact.",
		"Run the compiler in the parent governance context (do not set isolated=true); generated implementation workers are isolated later.",
		"It may write only docs/AATP/AATP-*.md and docs/AATP/INDEX.md; use exact repository-relative paths, never globs or ..; do not implement.",
		"Foundry will validate dependencies, scope, risk, security_sensitive, acceptance, and executable verification IDs, then seal the manifest before workers run.",
	].join("\n"));
}

function aatpCompilerError(cwd: string, message: string) {
	let text = message;
	try { const archived = archiveAatpSpecs(cwd); if (archived > 0) text += ` Partial output archived (${archived} files); the next compile starts clean.`; }
	catch (error) { text += ` Partial-output archival failed: ${error instanceof Error ? error.message : String(error)}`; }
	return { isError: true, content: [{ type: "text" as const, text }] };
}

function atomicGovernedWrite(target: string, content: string): string | undefined {
	try {
		const stat = lstatSync(target);
		if (stat.isSymbolicLink() || !stat.isFile()) return "target is not a regular file";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return error instanceof Error ? error.message : String(error);
	}
	mkdirSync(dirname(target), { recursive: true });
	const temp = `${target}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
		try { renameSync(temp, target); }
		catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== "EEXIST" && code !== "EPERM" && code !== "ENOTEMPTY") throw error;
			let fd: number | undefined;
			try {
				fd = openSync(target, fsConstants.O_WRONLY | fsConstants.O_TRUNC | (fsConstants.O_NOFOLLOW || 0));
				const current = fstatSync(fd);
				if (!current.isFile()) throw new Error("target changed to a non-regular file");
				writeSync(fd, content, null, "utf8");
				unlinkSync(temp);
			} finally {
				if (fd !== undefined) closeSync(fd);
			}
		}
		return undefined;
	} catch (error) {
		try { unlinkSync(temp); } catch { /* best effort cleanup */ }
		return error instanceof Error ? error.message : String(error);
	}
}

function advanceFoundry(pi: ExtensionAPI, cwd: string, args: string): void {
	const loaded = safeState(cwd);
	if (loaded.broken) { orchestrate(pi, "Foundry state blocked.", loaded.broken); return; }
	const idea = args.trim();
	if (loaded.missing) {
		const boot = bootstrapFoundryProject(cwd, ROOT);
		orchestrate(pi, "Foundry enabled for this project.", [
			`stack=${boot.stackIds.join(",") || "unknown"} ui=${boot.ui} ui_confidence=${boot.uiConfidence}`,
			idea ? `User idea: ${idea}` : "If the user has not described the product, ask one short question.",
			"Spawn blocking product-analyst. Then wait for /foundry-approve product.",
		].join("\n"));
		return;
	}
	const state = loaded.state;
	if (!productReady(state)) { orchestrate(pi, "Finish the product.", "Spawn blocking product-analyst. Wait for /foundry-approve product. Do not plan or code."); return; }
	if (state.master_plan.status !== "locked") { enterOrResumePlan(pi, cwd, state); return; }
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") { orchestrate(pi, "Design is required.", "Spawn blocking design-foundation, build a real preview, then wait for /design approve or /design skip."); return; }
	if (!state.aatp.manifest_sha256) { requestAatpCompile(pi, cwd, state, false); return; }
	const tasks = hydrateAatp(cwd, state);
	if (tasks.length === 0) { requestAatpCompile(pi, cwd, state); return; }
	const ready = readyIndependent(tasks), counts = summarizeAatp(tasks);
	if (ready.length > 0) { orchestrate(pi, "Build the next independent AATP layer.", "Run /build. Foundry will use the sealed DAG, isolate workers, validate patches, then apply+commit only valid deltas."); return; }
	const unreviewed = tasks.filter((t) => t.status === "completed" && t.review !== "APPROVE");
	if (unreviewed.length > 0) { orchestrate(pi, "Review before downstream work.", `Run /review <AATP-ID>. Dependencies unlock only after APPROVE. Unreviewed: ${unreviewed.map((t) => t.id).join(", ")}.`); return; }
	if (counts.completed === counts.total && counts.total > 0 && state.qa.status !== "pass") {
		orchestrate(pi, "All AATP done. Run /verify.", "Foundry runs deterministic verification against a clean committed tree.");
		return;
	}
	orchestrate(pi, "Run /release-check.", "Release is derived from locked artifacts, sealed AATP specs, independent review evidence, QA SHA, and a clean tree.");
}

function resultForBinding(results: ReturnType<typeof extractTaskResults>, binding: TaskBinding) {
	const indexed = results.find((r) => r.index === binding.index);
	if (!indexed || indexed.agent !== binding.agent) return undefined;
	return indexed;
}
function resultForPlan(results: ReturnType<typeof extractTaskResults>, pending: Pick<PendingPlanRun, "agent" | "index">) {
	const indexed = results.find((r) => r.index === pending.index && r.agent === pending.agent);
	if (!indexed) return undefined;
	return indexed;
}

/** Fingerprint the visible Git worktree so design preview commands cannot
 * smuggle production source changes around the AATP gate. */
function visibleWorktreeFingerprint(cwd: string): string {
	const paths = gitChangedPaths(cwd).sort();
	let totalBytes = 0;
	const MAX_FINGERPRINT_TOTAL = 32 * 1024 * 1024; // 32 MiB
	return hashEvidence(...paths.flatMap((path) => {
		const file = safeRepoPath(cwd, path);
		if (!file) return [path, "<path-gate>"];
		try {
			const stat = lstatSync(file);
			if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4 * 1024 * 1024) return [path, `<unhashed:${stat.size}>`];
			if (totalBytes + stat.size > MAX_FINGERPRINT_TOTAL) return [path, "<size-limit-reached>"];
			totalBytes += stat.size;
			return [path, readFileSync(file, "base64")];
		}
		catch { return [path, "<missing>"]; }
	}));
}

function processGovernedResults(cwd: string, state: CompanyState, bindings: TaskBinding[], details: unknown, specs: AatpSpec[], initialHead: string): string[] {
	const messages: string[] = [], results = extractTaskResults(details), specById = new Map(specs.map((spec) => [spec.id, spec]));
	let expectedHead = initialHead;
	for (const binding of bindings) {
		const ticket = state.tickets[binding.ticketId];
		if (!ticket) { messages.push(`${binding.ticketId}: missing parent ticket state`); continue; }
		const expectedStatus = binding.kind === "implementation" ? "active" : "completed";
		if (ticket.status !== expectedStatus) {
			messages.push(`${binding.ticketId}: stale result rejected; expected ticket status ${expectedStatus}, got ${ticket.status}`);
			continue;
		}
		const result = resultForBinding(results, binding);
		if (!result || result.exitCode !== 0 || result.error || result.aborted) {
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: worker failed; no patch applied${result?.error ? ` (${result.error})` : ""}`);
			continue;
		}
		const output = result.output ?? "", conflict = parseConflict(output);
		if (conflict && binding.kind === "implementation") {
			const conflictKind = (["PLAN_CONFLICT", "DESIGN_CONFLICT", "DEPENDENCY_CONFLICT", "SCOPE_INSUFFICIENT"] as string[]).includes(conflict.kind) ? conflict.kind as ConflictKind : "SCOPE_INSUFFICIENT";
			blockTicket(state, binding.ticketId, `${conflict.kind}: ${conflict.reason}`, conflictKind);
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
		const applied = applyPatchArtifact(cwd, result.patchPath, checked.patch, checked.paths);
		if (!applied.ok) {
			restoreCleanHead(cwd);
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: ${applied.reason}`);
			continue;
		}
		if (gitHead(cwd) !== expectedHead) {
			restoreCleanHead(cwd);
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: PROVENANCE_GATE repository HEAD changed while applying the worker result`);
			continue;
		}
		let verificationSha = "";
		if (binding.kind === "implementation") {
			const spec = specById.get(binding.ticketId);
			const verification = runDeclaredVerification(cwd, spec?.verification ?? []);
			verificationSha = verification.evidenceSha256;
			const changed = gitChangedPaths(cwd).filter((path) => !path.startsWith("<"));
			const expected = new Set(checked.paths.map((path) => canonicalRepoPath(cwd, path)).filter((path): path is string => path !== null));
			const unexpected = changed.filter((path) => {
				const canonical = canonicalRepoPath(cwd, path);
				return canonical !== null && !expected.has(canonical);
			});
			if (!verification.ok || unexpected.length) {
				restoreCleanHead(cwd);
				resetTicket(state, binding.ticketId);
				messages.push(`${binding.ticketId}: AATP_VERIFY_GATE verification failed${unexpected.length ? ` or changed unexpected paths: ${unexpected.join(", ")}` : ""}`);
				continue;
			}
		}
		const committed = commitAppliedPatch(cwd, binding.ticketId, binding.kind, checked.paths, expectedHead);
		if (!committed.ok) {
			restoreCleanHead(cwd);
			if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			messages.push(`${binding.ticketId}: ${committed.reason}`);
			continue;
		}
		const evidence = hashEvidence(checked.patch, output, result.id, result.agent, expectedHead, committed.commitSha, verificationSha);
		expectedHead = committed.commitSha ?? expectedHead;
		if (binding.kind === "implementation") {
			const ticketScope = ticketScopeHash(cwd, ticket);
			const provenance: ImplementationProvenance = { parentSha: committed.parentSha, commitSha: committed.commitSha, scopeSha: ticketScope, verificationSha };
			const done = completeTicket(state, binding.ticketId, evidence, provenance);
			messages.push(done.ok ? `${binding.ticketId}: validated, applied, committed, completed` : `${binding.ticketId}: ${done.reason}`);
		} else {
			const provenance: ReviewProvenance = { parentSha: committed.parentSha, commitSha: committed.commitSha, scopeSha: ticketScopeHash(cwd, ticket), dependencySha: dependencyScopeHash(state, ticket), manifestSha: state.aatp.manifest_sha256 };
			const reviewed = reviewTicket(state, binding.ticketId, reviewVerdict!, binding.agent, evidence, provenance);
			messages.push(reviewed.ok ? `${binding.ticketId}: review=${reviewVerdict} recorded with evidence` : `${binding.ticketId}: ${reviewed.reason}`);
		}
	}
	recountTickets(state); invalidateQa(state); return messages;
}

export default function registerFoundryExtension(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.setLabel("OMP Foundry");
	const pending = new Map<string, PendingRun>();
	const broker = capabilityBroker();
	const pendingPlan = broker.pendingPlan;
	const pendingAatp = broker.pendingAatp;
	const stageWatchdogs = new Map<CapabilityRun, StageWatchdog>();
	const clearStageWatchdog = (run: CapabilityRun): void => {
		const watchdog = stageWatchdogs.get(run);
		if (!watchdog) return;
		try { watchdog.context.clearTimer(watchdog.timer); } catch { /* the OMP session may already be disposed */ }
		stageWatchdogs.delete(run);
	};
	const armStageWatchdog = (run: CapabilityRun, ctx: unknown): void => {
		if (stageWatchdogs.has(run)) return;
		const context = ctx as ManagedStageContext;
		const timeout = stageTimeoutMs();
		const timer = context.setTimeout(() => {
			run.timedOut = true;
			try { context.abort?.(); } catch { /* the result handler remains authoritative */ }
		}, timeout);
		stageWatchdogs.set(run, { context, timer });
	};
	const capabilityFailure = (key: string, active?: CapabilityRun, revokeActive = true): CapabilityGuard => {
		const now = Date.now();
		const current = broker.failures.get(key) ?? { attempts: 0, tripped: false, updatedAt: now };
		if (!current.tripped) current.attempts += 1;
		current.updatedAt = now;
		if (current.attempts >= CAPABILITY_FAILURE_LIMIT) current.tripped = true;
		broker.failures.set(key, current);
		if (active && revokeActive) {
			active.invalidAttempts = current.attempts;
			if (current.tripped) active.revoked = true;
		}
		return current;
	};
	const capabilityError = (kind: "PLAN" | "AATP", key: string, active?: CapabilityRun, revokeActive = true, ctx?: unknown) => {
		const guard = capabilityFailure(key, active, revokeActive);
		const prefix = kind === "PLAN" ? "PLAN" : "AATP_COMPILER";
		const restart = kind === "PLAN" ? "/plan" : "/aatp";
		if (guard.tripped || active?.revoked) {
			try { (ctx as { abort?: () => void } | undefined)?.abort?.(); } catch { /* abort is best-effort; the terminal result remains authoritative */ }
			return {
				isError: true,
				content: [{ type: "text" as const, text: `${prefix}_CAPABILITY_CIRCUIT_BREAKER: repeated invalid capability attempts detected; this run is revoked. Do not retry or guess. Re-run ${restart} to spawn a fresh stage agent and receive a new capability.` }],
				details: { code: `${prefix}_CAPABILITY_CIRCUIT_BREAKER`, retryable: false, recovery: "respawn_stage_agent", attempts: guard.attempts },
			};
		}
		return {
			isError: true,
			content: [{ type: "text" as const, text: `${prefix}_CAPABILITY_DENIED: capability is a cryptographic token issued only to the spawned stage sub-agent and bound to this run. Orchestrators and other agents cannot write governance artifacts directly. DO NOT GUESS OR BRUTE-FORCE CAPABILITIES. Stop and re-spawn the required stage sub-agent with the task tool; a fresh capability will be injected.` }],
			details: { code: `${prefix}_CAPABILITY_DENIED`, retryable: false, recovery: "respawn_stage_agent", attempts: guard.attempts, remaining: Math.max(0, CAPABILITY_FAILURE_LIMIT - guard.attempts) },
		};
	};
	const capabilityCircuit = (kind: "PLAN" | "AATP") => {
		const prefix = kind === "PLAN" ? "PLAN" : "AATP_COMPILER";
		const restart = kind === "PLAN" ? "/plan" : "/aatp";
		return { isError: true, content: [{ type: "text" as const, text: `${prefix}_CAPABILITY_CIRCUIT_BREAKER: this capability run was revoked after invalid attempts or expiry. Do not retry or guess. Re-run ${restart} to spawn a fresh stage agent and receive a new capability.` }], details: { code: `${prefix}_CAPABILITY_CIRCUIT_BREAKER`, retryable: false, recovery: "respawn_stage_agent" } };
	};
	const resetCapabilityFailure = (key: string): void => {
		for (const failureKey of broker.failures.keys()) if (failureKey === key || failureKey.startsWith(`${key}\u0000`)) broker.failures.delete(failureKey);
	};
	const expired = (run: CapabilityRun): boolean => Date.now() - run.createdAt > CAPABILITY_TTL_MS;
	pi.registerTool({ name: "foundry_aatp_write", label: "Foundry AATP Write", description: "Compiler-only atomic writer for unsealed AATP work orders; explicitly listed only for the spawned aatp-compiler.", hidden: false, loadMode: "essential", approval: "write", parameters: z.object({ path: z.string(), content: z.string(), capability: z.string() }), async execute(_id, params, _session, _user, ctx) {
		const loaded = safeState(ctx.cwd);
		if (loaded.broken || loaded.missing || loaded.state.phase !== "aatp" || loaded.state.aatp.manifest_sha256) return { isError: true, content: [{ type: "text", text: "AATP_COMPILER_GATE: compiler writer is available only during an unsealed AATP phase." }] };
		const baseKey = capabilityKey("AATP", ctx.cwd, loaded.state.aatp.epoch);
		const active = [...pendingAatp.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.epoch === loaded.state.aatp.epoch);
		const run = [...pendingAatp.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.capability === params.capability && candidate.epoch === loaded.state.aatp.epoch);
		const callerSession = capabilitySessionId(ctx);
		const attemptKey = capabilityAttemptKey(baseKey, callerSession);
		const ownerMatches = !active?.sessionId || callerSession === active.sessionId;
		if (run && expired(run)) run.revoked = true;
		if (!run || run.revoked || (run.sessionId !== undefined && callerSession !== run.sessionId)) return capabilityError("AATP", attemptKey, active ?? run, ownerMatches, ctx);
		resetCapabilityFailure(baseKey); run.invalidAttempts = 0;
		const rel = canonicalRepoPath(ctx.cwd, params.path);
		if (!rel || !/^docs\/aatp\/(?:aatp-[^/]+\.md|index\.md)$/i.test(rel)) return { isError: true, content: [{ type: "text", text: "AATP_PATH_GATE: compiler may write only docs/AATP/AATP-*.md or INDEX.md." }] };
		if (typeof params.content !== "string" || Buffer.byteLength(params.content, "utf8") > 256 * 1024) return { isError: true, content: [{ type: "text", text: "AATP_RESOURCE_GATE: one compiler artifact is limited to 256 KiB." }] };
		if (!rel.toLowerCase().endsWith("/index.md")) {
			try {
				const existing = listAatpSpecs(ctx.cwd).reduce((sum, spec) => sum + lstatSync(spec.path).size, 0);
				const old = safeRepoPath(ctx.cwd, rel), oldSize = old ? (() => { try { return lstatSync(old).size; } catch { return 0; } })() : 0;
				if (existing - oldSize + Buffer.byteLength(params.content, "utf8") > 8 * 1024 * 1024) return { isError: true, content: [{ type: "text", text: "AATP_RESOURCE_GATE: active work orders are limited to 8 MiB total." }] };
			} catch (error) { return { isError: true, content: [{ type: "text", text: `AATP_RESOURCE_GATE: ${error instanceof Error ? error.message : String(error)}` }] }; }
		}
		const target = safeRepoPath(ctx.cwd, rel);
		if (!target) return { isError: true, content: [{ type: "text", text: "AATP_PATH_GATE: compiler target crosses a symlink or leaves the repository." }] };
		try {
			const stat = lstatSync(target);
			if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("target is not a regular file");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { isError: true, content: [{ type: "text", text: `AATP_PATH_GATE: ${error instanceof Error ? error.message : String(error)}` }] };
		}
		mkdirSync(dirname(target), { recursive: true });
		const writeError = atomicGovernedWrite(target, params.content);
		if (writeError) return { isError: true, content: [{ type: "text", text: `AATP_WRITE_FAILED: ${writeError}` }] };
		recordCapabilityWrite(run, rel, params.content);
		// INDEX.md is the compiler's terminal artifact.  Once at least one
		// work order and the index are durably written, stop the child agent so
		// provider-specific post-tool loops cannot turn a valid DAG into a task
		// failure.  The parent still validates every byte before sealing.
		const writes = run.writeHashes ?? new Map<string, string>();
		const hasIndex = writes.has("docs/aatp/index.md");
		const hasWorkOrder = [...writes.keys()].some((path) => /^docs\/aatp\/aatp-[^/]+\.md$/i.test(path));
		if (hasIndex && hasWorkOrder) abortAfterTerminalCapabilityWrite(ctx);
		return { content: [{ type: "text", text: `AATP_WRITE_OK: ${rel}` }] };
	} });
	pi.registerTool({ name: "foundry_plan_write", label: "Foundry Plan Write", description: "Active Plan-stage atomic writer; explicitly listed only for the spawned planning stage agent.", hidden: false, loadMode: "essential", approval: "write", parameters: z.object({ path: z.string(), content: z.string(), capability: z.string() }), async execute(_id, params, _session, _user, ctx) {
		const loaded = safeState(ctx.cwd);
		if (loaded.broken || loaded.missing || loaded.state.mode !== "plan" || loaded.state.phase !== "planning") return { isError: true, content: [{ type: "text", text: "PLAN_GATE: plan writer is available only during an active Plan stage." }] };
		const stage = loaded.state.planning.stage as ActivePlanStage;
		const baseKey = capabilityKey("PLAN", ctx.cwd, loaded.state.planning.epoch, stage);
		const active = [...pendingPlan.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.capability !== "" && candidate.epoch === loaded.state.planning.epoch && candidate.stage === stage);
		const run = [...pendingPlan.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.capability === params.capability && candidate.epoch === loaded.state.planning.epoch && candidate.stage === stage);
		const callerSession = capabilitySessionId(ctx);
		const attemptKey = capabilityAttemptKey(baseKey, callerSession);
		const ownerMatches = !active?.sessionId || callerSession === active.sessionId;
		if (run && expired(run)) run.revoked = true;
		if (!run || run.revoked || (run.sessionId !== undefined && callerSession !== run.sessionId)) return capabilityError("PLAN", attemptKey, active ?? run, ownerMatches, ctx);
		resetCapabilityFailure(baseKey); run.invalidAttempts = 0;
		const expected = PLAN_ARTIFACTS[run.stage], rel = canonicalRepoPath(ctx.cwd, params.path);
		const isAatpInSynth = run.stage === "synth" && rel !== null && /^docs\/aatp\/(?:aatp-[^/]+\.md|index\.md)$/i.test(rel);
		if (!rel || (rel.toLowerCase() !== expected.toLowerCase() && !isAatpInSynth)) return { isError: true, content: [{ type: "text", text: `PLAN_PATH_GATE: active stage may write only ${expected}${run.stage === "synth" ? " or docs/AATP/AATP-*.md" : ""}.` }] };
		if (typeof params.content !== "string" || Buffer.byteLength(params.content, "utf8") > 256 * 1024) return { isError: true, content: [{ type: "text", text: "PLAN_RESOURCE_GATE: one planning artifact is limited to 256 KiB." }] };
		const target = safeRepoPath(ctx.cwd, rel);
		if (!target) return { isError: true, content: [{ type: "text", text: "PLAN_PATH_GATE: planning target crosses a symlink or leaves the repository." }] };
		const writeError = atomicGovernedWrite(target, params.content);
		if (writeError) return { isError: true, content: [{ type: "text", text: `PLAN_WRITE_FAILED: ${writeError}` }] };
		recordCapabilityWrite(run, rel, params.content);
		// When the terminal stage artifact (e.g. docs/MASTER_PLAN.md) is written, stop child agent.
		if (rel.toLowerCase() === expected.toLowerCase()) {
			abortAfterTerminalCapabilityWrite(ctx);
		}
		return { content: [{ type: "text", text: `PLAN_WRITE_OK: ${rel}` }] };
	} });

	pi.on("session_start", async (_event, ctx) => {
		const loaded = safeState(ctx.cwd);
		const active = governedProject(ctx.cwd, loaded);
		ctx.ui.setStatus("foundry", loaded.broken ? "STATE_CORRUPT" : active ? statusOf(loaded.state) : "inactive");
		ctx.setTimeout(() => {
			void checkForUpdate().then((result) => { if (result.notify) ctx.ui.notify(result.notify, "info"); }).catch(() => undefined);
			try {
				const registered = ensureGlobalFoundryRoles();
				if (registered.added.length > 0) {
					ctx.ui.notify(`Foundry registered ${registered.added.length} model roles (foundry_*) in ~/.omp/agent/config.yml — assign models there; unset roles follow your OMP roles.`, "info");
				}
			} catch {
				/* config write must never block a session */
			}
		}, 0);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const loaded = safeState(ctx.cwd);
		if (!governedProject(ctx.cwd, loaded)) return;
		const { state, broken } = loaded;
		const agentName = capabilityAgentName(event, ctx);
		const sessionId = capabilitySessionId(ctx);
		const role = roleOf(agentName);
		const skillState = agentName === AATP_COMPILER && state.phase === "aatp" ? { ...state, phase: "planning" as const } : state;
		const pack = broken ? [] : resolveSkillManifests(ctx.cwd, skillState, role ? { role } : undefined);
		const compiler = agentName === AATP_COMPILER ? [...pendingAatp.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.epoch === state.aatp.epoch) : undefined;
		const planRun = PLAN_AGENTS.has(agentName) ? [...pendingPlan.values()].find((candidate) => candidate.cwd === ctx.cwd && candidate.agent === agentName && candidate.epoch === state.planning.epoch && candidate.stage === state.planning.stage) : undefined;
		if (compiler && sessionId) compiler.sessionId ??= sessionId;
		if (planRun && sessionId) planRun.sessionId ??= sessionId;
		if (compiler) armStageWatchdog(compiler, ctx);
		if (planRun) armStageWatchdog(planRun, ctx);
		const capabilityHint = compiler ? `\nCompiler capability (use only with foundry_aatp_write): ${compiler.capability}` : planRun ? `\nPlan capability (use only with foundry_plan_write): ${planRun.capability}` : "";
		return { message: { customType: CUSTOM, content: broken ? `Foundry state corrupt: ${broken}` : `${phasePrompt(state)} ${statusOf(state)}.\n${skillPackPrompt(pack, skillState.phase)}${capabilityHint}`, display: false, details: { ...state, skills: pack.map((s) => s.id) } } };
	});

	pi.on("tool_call", async (event, ctx) => {
		const loaded = safeState(ctx.cwd);
		if (!governedProject(ctx.cwd, loaded)) return;
		if (loaded.broken) return { block: true, reason: `STATE_CORRUPT: ${loaded.broken}` };
		if (loaded.missing && MUTATING_TASK_TOOLS.has(event.toolName)) return { block: true, reason: "STATE_MISSING_GATE: a governed marker without a readable Foundry state is fail-closed; restore the state before mutating the project." };
		if (LIFECYCLE_TOOLS.has(event.toolName)) return { block: true, reason: "LIFECYCLE_GATE: AATP lifecycle is parent-extension-owned; agents cannot transition tickets directly." };
		if (event.toolName === "task") {
			const raw = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : {};
			const items = taskItems(raw);
			const globalKey = taskKey(event, ctx.cwd);
			if (items.length === 0 || items.length > 32) return { block: true, reason: "TASK_GATE: task dispatch must contain 1–32 recognized agent items." };
			const unknown = items.filter((item) => !TASK_AGENTS.has(item.agent));
			if (unknown.length) return { block: true, reason: `TASK_GATE: unknown or unauthorized agent(s): ${unknown.map((item) => item.agent || "(missing)").join(", ")}.` };
			const governedItems = items.filter((item) => IMPLEMENTER_AGENTS.has(item.agent) || REVIEW_AGENTS.has(item.agent));
			if (governedItems.length > 0 && governedItems.length !== items.length) return { block: true, reason: "TASK_GATE: governed worker batches cannot include helper or mixed-role agents." };
			if (loaded.state.phase === "aatp" && !loaded.state.aatp.manifest_sha256) {
				const compilerItems = items.filter((item) => item.agent === AATP_COMPILER);
				if (items.length !== 1 || compilerItems.length !== 1) return { block: true, reason: `AATP_COMPILER_GATE: phase=aatp requires exactly one blocking ${AATP_COMPILER}; implementation workers wait until Foundry seals the manifest.` };
				if (compilerItems[0].isolated === true) return { block: true, reason: "AATP_COMPILER_GATE: aatp-compiler must run in the parent governance context; only generated implementation workers are isolated." };
				const key = taskKey(event, ctx.cwd);
				if (!key) return { block: true, reason: "AATP_COMPILER_GATE: compiler task must expose a unique toolCallId." };
				if (pendingAatp.has(key)) return { block: true, reason: "AATP_COMPILER_GATE: duplicate compiler task id is not replayable." };
				if (compilerActiveFor(pendingAatp, ctx.cwd)) return { block: true, reason: "AATP_COMPILER_GATE: a project-wide compiler is already running for this project." };
				resetCapabilityFailure(capabilityKey("AATP", ctx.cwd, loaded.state.aatp.epoch));
				pendingAatp.set(key, { agent: AATP_COMPILER, index: compilerItems[0].index, cwd: ctx.cwd, epoch: loaded.state.aatp.epoch, capability: randomBytes(32).toString("hex"), createdAt: Date.now(), invalidAttempts: 0, revoked: false, writeHashes: new Map() });
			}
			if (loaded.state.mode === "plan") {
				const planItems = items.filter((item) => PLAN_AGENTS.has(item.agent));
				if (planItems.length > 0) {
					const expected = expectedPlanAgent(loaded.state);
					if (!expected) return { block: true, reason: `PLAN_GATE: no planning agent is allowed at stage ${loaded.state.planning.stage}.` };
					if (items.length !== 1 || planItems.length !== 1 || planItems[0].agent !== expected) return { block: true, reason: `PLAN_GATE: stage ${loaded.state.planning.stage} requires exactly one blocking ${expected}; no other Plan stage may run.` };
					if (!planPriorEvidenceMatches(ctx.cwd, loaded.state)) return { block: true, reason: "PLAN_EVIDENCE_GATE: a prior stage artifact changed after it was accepted. Restart /plan or restore the artifact." };
					const key = taskKey(event, ctx.cwd);
					if (!key) return { block: true, reason: "PLAN_GATE: planning task must expose a unique toolCallId." };
					if (pendingPlan.has(key)) return { block: true, reason: "PLAN_GATE: duplicate planning task id is not replayable." };
					if (planActiveFor(pendingPlan, ctx.cwd)) return { block: true, reason: "PLAN_GATE: one blocking Plan stage task may run per project." };
					const stage = loaded.state.planning.stage as ActivePlanStage;
					resetCapabilityFailure(capabilityKey("PLAN", ctx.cwd, loaded.state.planning.epoch, stage));
					pendingPlan.set(key, { stage, epoch: loaded.state.planning.epoch, agent: expected, index: planItems[0].index, cwd: ctx.cwd, beforeHash: hashPlanArtifact(ctx.cwd, stage), capability: randomBytes(32).toString("hex"), createdAt: Date.now(), invalidAttempts: 0, revoked: false, writeHashes: new Map() });
				}
			}
			if (items.some((item) => item.agent === AATP_COMPILER || PLAN_AGENTS.has(item.agent)) && loaded.state.mode !== "plan" && !(loaded.state.phase === "aatp" && !loaded.state.aatp.manifest_sha256)) return { block: true, reason: "TASK_GATE: planning/compiler agents are only legal in their owning phase." };
			if (items.some((item) => item.agent === "product-analyst") && loaded.state.phase !== "discovery") return { block: true, reason: "TASK_GATE: product-analyst is only legal during discovery." };
			if (items.some((item) => item.agent === "design-foundation") && (loaded.state.phase !== "design" || loaded.state.design.status === "locked")) return { block: true, reason: "TASK_GATE: design-foundation is only legal while design is unlocked." };
			if (governedTask(raw)) {
				const parsed = taskBindings(raw);
				if (parsed.errors.length) return { block: true, reason: `AATP_BINDING_GATE: ${parsed.errors.join("; ")}` };
				if (parsed.bindings.length === 0) return { block: true, reason: "AATP_BINDING_GATE: governed task has no exact ticket binding." };
				if (parsed.bindings.some((binding) => binding.kind === "implementation") && loaded.state.phase !== "implementation") return { block: true, reason: "AATP_EXECUTION_GATE: implementation workers start only after /build transitions the sealed DAG to implementation." };
				if (parsed.bindings.some((binding) => binding.kind === "review") && loaded.state.phase !== "review") return { block: true, reason: "REVIEW_GATE: reviewer tasks require the parent /review phase." };
				const key = taskKey(event, ctx.cwd);
				if (!key) return { block: true, reason: "AATP_BINDING_GATE: governed task must expose a unique toolCallId." };
				if (pending.has(key)) return { block: true, reason: "AATP_BINDING_GATE: duplicate governed task id is not replayable." };
				const contract = checkIsolationContract(ctx.cwd);
				if (!contract.ok) return { block: true, reason: contract.reason ?? "Foundry isolation contract failed." };
				if (!workingTreeClean(ctx.cwd)) return { block: true, reason: "WORKTREE_GATE: governed task requires a clean parent tree." };
				const state = loadState(ctx.cwd), specs = listAatpSpecs(ctx.cwd);
				if (!state.aatp.manifest_sha256 || state.aatp.manifest_sha256 !== aatpManifestHash(ctx.cwd)) return { block: true, reason: "AATP_SPEC_GATE: specs are not sealed or changed since seal." };
				for (const binding of parsed.bindings) {
					const spec = specs.find((s) => s.id === binding.ticketId);
					if (!spec) return { block: true, reason: `AATP_BINDING_GATE: unknown ${binding.ticketId}.` };
					if (binding.kind === "implementation") {
						const expectedAgent = routeAgent(spec.risk, state.tickets[binding.ticketId]?.attempts);
						const rank = (a: string) => a === "smol-implementer" ? 0 : a === "implementer" ? 1 : a === "hard-implementer" ? 2 : -1;
						if (rank(binding.agent) < rank(expectedAgent)) return { block: true, reason: `AATP_ROUTE_GATE: ${binding.ticketId} risk=${spec.risk} requires at least ${expectedAgent}; received ${binding.agent || "(missing)"}. Escalation is allowed, downgrading is not.` };
						const begun = beginTicket(state, spec, binding.ticketId, binding.agent);
						if (!begun.ok) return { block: true, reason: begun.reason };
					} else {
						const ticket = state.tickets[binding.ticketId];
						if (!ticket || ticket.status !== "completed") return { block: true, reason: `REVIEW_GATE: ${binding.ticketId} must be completed before review.` };
						if (!ticket.implementation_commit_sha || !ticket.implementation_scope_sha256 || !ticket.verification_evidence_sha256) return { block: true, reason: `REVIEW_PROVENANCE_GATE: ${binding.ticketId} has no verified implementation provenance.` };
						const expectedAgent = reviewAgentForRisk(ticket.risk, ticket.security_sensitive === true);
						if (binding.agent !== expectedAgent) return { block: true, reason: `REVIEW_ROLE_GATE: ${binding.ticketId} risk=${ticket.risk} requires ${expectedAgent}; received ${binding.agent || "(missing)"}.` };
					}
				}
				recountTickets(state); invalidateQa(state); persist(ctx.cwd, state);
				const headAtDispatch = gitHead(ctx.cwd);
				if (!headAtDispatch) return { block: true, reason: "PROVENANCE_GATE: unable to capture repository HEAD before dispatch." };
				const timer = globalThis.setTimeout(() => {
					pending.delete(key);
					const s = loadState(ctx.cwd);
					let changed = false;
					for (const binding of parsed.bindings) {
						const t = s.tickets[binding.ticketId];
						if (t && t.status === "active") {
							t.status = "ready";
							changed = true;
							ctx.ui.notify(`WATCHDOG: ${binding.ticketId} timed out after 10 minutes and was returned to ready.`, "warning");
						}
					}
					if (changed) persist(ctx.cwd, s);
				}, 10 * 60 * 1000);
				pending.set(key, { bindings: parsed.bindings, startedClean: true, headAtDispatch, timer });
			}
			let modified = raw;
			if (globalKey) {
				const aatpRun = pendingAatp.get(globalKey);
				if (aatpRun) {
					const tasks = Array.isArray(modified.tasks) ? [...modified.tasks] : [];
					const item = tasks[aatpRun.index];
					if (item && typeof item === "object") {
						const ins = typeof item.instructions === "string" ? item.instructions : "";
						tasks[aatpRun.index] = { ...item, instructions: `[AATP_COMPILER_CAPABILITY]: You hold the cryptographic write capability for this run.\nYou MUST use the 'foundry_aatp_write' tool to write unsealed AATP files.\nYour capability token is: ${aatpRun.capability}\nProvide this exact token in the 'capability' argument for every foundry_aatp_write call.\n\n${ins}` };
						modified = { ...modified, tasks };
					}
				}
				const planRun = pendingPlan.get(globalKey);
				if (planRun) {
					const tasks = Array.isArray(modified.tasks) ? [...modified.tasks] : [];
					const item = tasks[planRun.index];
					if (item && typeof item === "object") {
						const ins = typeof item.instructions === "string" ? item.instructions : "";
						tasks[planRun.index] = { ...item, instructions: `[PLAN_CAPABILITY]: You hold the cryptographic write capability for this run.\nYou MUST use the 'foundry_plan_write' tool to write unsealed Plan artifacts.\nYour capability token is: ${planRun.capability}\nProvide this exact token in the 'capability' argument for every foundry_plan_write call.\n\n${ins}` };
						modified = { ...modified, tasks };
					}
				}
			}
			const isolated = forceIsolatedTaskInput(modified);
			if (isolated || modified !== raw) return { input: isolated ?? modified };
		}
		const activeTickets = Object.values(loaded.state.tickets).filter((t) => t.status === "active");
		return denyToolCall(event.toolName, (event.input ?? {}) as ToolInput, loaded.state, { stateBroken: loaded.broken, activeTickets, canonicalize: (raw) => canonicalRepoPath(ctx.cwd, raw) });
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "task") return;
		const key = taskKey(event, ctx.cwd);
		if (!key) return;
		const planRun = pendingPlan.get(key);
		if (planRun) {
			clearStageWatchdog(planRun);
			pendingPlan.delete(key);
			if (planRun.revoked) return capabilityCircuit("PLAN");
			const currentPlanState = loadState(ctx.cwd);
			if (currentPlanState.planning.epoch !== planRun.epoch || currentPlanState.planning.stage !== planRun.stage) return { isError: true, content: [{ type: "text" as const, text: "PLAN_EPOCH_GATE: stale planning capability result rejected; restart the current Plan stage." }] };
			const result = resultForPlan(extractTaskResults(event.details), planRun);
			const taskFailed = !result || result.exitCode !== 0 || Boolean(result.error) || result.aborted === true;
			const terminalWrite = capabilityWriteMatches(ctx.cwd, planRun, PLAN_ARTIFACTS[planRun.stage]);
			if (taskFailed && !terminalWrite) {
				const prefix = planRun.timedOut ? `PLAN_STAGE_TIMEOUT: ${planRun.stage} exceeded ${Math.round(stageTimeoutMs() / 60000)} minutes` : `PLAN_STAGE_FAILED: ${planRun.stage} did not complete`;
				return { isError: true, content: [{ type: "text" as const, text: `${prefix}; stage remains unchanged. Respawn the same stage once with a fresh child context; do not restart completed stages or guess a capability.` }] };
			}
			const artifactHash = hashPlanArtifact(ctx.cwd, planRun.stage);
			if (!artifactHash || artifactHash === planRun.beforeHash) return { isError: true, content: [{ type: "text" as const, text: `PLAN_ARTIFACT_GATE: ${planRun.stage} artifact was not newly produced by the task.` }] };
			const state = loadState(ctx.cwd), completed = completePlanStage(ctx.cwd, state, planRun.stage, artifactHash);
			if (!completed.ok) return { isError: true, content: [{ type: "text" as const, text: completed.reason ?? "PLAN_STAGE_GATE" }] };
			if (planRun.stage === "synth") {
				try {
					const specs = listAatpSpecs(ctx.cwd);
					if (specs.length > 0) {
						const errors = validateAatpSpecs(specs, { strict: false });
						if (errors.length === 0) {
							const manifest = aatpManifestHash(ctx.cwd);
							if (manifest) {
								state.aatp.manifest_sha256 = manifest;
								seedTickets(state, specs);
								writeAatpIndex(ctx.cwd, hydrateAatp(ctx.cwd, state));
								recountTickets(state);
							}
						}
					}
				} catch { /* if no AATP specs were written in synth, manual /aatp remains available */ }
			}
			persist(ctx.cwd, state); ctx.ui.setStatus("foundry", statusOf(state));
			const recovery = taskFailed ? "PLAN_STAGE_RECOVERED: terminal artifact was written through the stage capability before the provider task stopped.\n" : "";
			return { content: [{ type: "text" as const, text: `${recovery}${planStatus(state)}\n${planInstruction(state)}` }] };
		}
		const aatpRun = pendingAatp.get(key);
		if (aatpRun) {
			clearStageWatchdog(aatpRun);
			pendingAatp.delete(key);
			if (aatpRun.revoked) return capabilityCircuit("AATP");
			if (aatpRun.cwd !== ctx.cwd) return { isError: true, content: [{ type: "text" as const, text: "AATP_COMPILER_GATE: compiler result arrived for a different project context." }] };
			if (loadState(ctx.cwd).aatp.epoch !== aatpRun.epoch) return { isError: true, content: [{ type: "text" as const, text: "AATP_EPOCH_GATE: stale compiler result rejected; recompile the current locked plan." }] };
			const result = resultForPlan(extractTaskResults(event.details), { agent: aatpRun.agent, index: aatpRun.index });
			const taskFailed = !result || result.exitCode !== 0 || Boolean(result.error) || result.aborted === true;
			let terminalWrites = false;
			if (taskFailed) {
				try {
					const specs = listAatpSpecs(ctx.cwd), indexWritten = capabilityWriteMatches(ctx.cwd, aatpRun, "docs/AATP/INDEX.md");
					const specsWritten = specs.length > 0 && specs.every((spec) => {
						const rel = canonicalCapabilityPath(ctx.cwd, spec.path);
						return rel ? capabilityWriteMatches(ctx.cwd, aatpRun, rel) : false;
					});
					terminalWrites = indexWritten && specsWritten;
				} catch { terminalWrites = false; }
			}
			if (taskFailed && !terminalWrites) return aatpCompilerError(ctx.cwd, aatpRun.timedOut ? `AATP_COMPILER_TIMEOUT: compiler exceeded ${Math.round(stageTimeoutMs() / 60000)} minutes; the manifest remains unsealed. Respawn the compiler once with a fresh context.` : "AATP_COMPILER_FAILED: compiler did not complete; the manifest remains unsealed. Respawn it once with a fresh context.");
			try {
				const state = loadState(ctx.cwd), specs = listAatpSpecs(ctx.cwd), sourceManifest = aatpManifestHash(ctx.cwd);
				if (state.master_plan.status !== "locked" || (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required")) return aatpCompilerError(ctx.cwd, "AATP_COMPILER_GATE: plan/design must remain locked while compiling AATP.");
				if (specs.length === 0) return aatpCompilerError(ctx.cwd, "AATP_COMPILER_GATE: no docs/AATP/AATP-*.md work orders were produced.");
				const errors = [...validateAatpSpecs(specs, { strict: true }), ...validateAatpCoverage(ctx.cwd, specs)];
				if (errors.length) return aatpCompilerError(ctx.cwd, `AATP_COMPILER_GATE: ${errors.join("; ")}`);
				const manifest = aatpManifestHash(ctx.cwd);
				if (!sourceManifest || manifest !== sourceManifest) return aatpCompilerError(ctx.cwd, "AATP_COMPILER_GATE: AATP sources changed while validating; retry compilation from a clean artifact set.");
				resetAatp(state);
				state.aatp.manifest_sha256 = manifest;
				if (!state.aatp.manifest_sha256 || !artifactsMatch(ctx.cwd, state)) { state.aatp.manifest_sha256 = ""; return aatpCompilerError(ctx.cwd, "AATP_COMPILER_GATE: locked product/plan/design evidence changed while compiling; restart the human gate."); }
				seedTickets(state, specs);
				writeAatpIndex(ctx.cwd, hydrateAatp(ctx.cwd, state));
				recountTickets(state); invalidateQa(state); persist(ctx.cwd, state); ctx.ui.setStatus("foundry", statusOf(state));
				const recovery = taskFailed ? "AATP_COMPILER_RECOVERED: terminal work orders were written through the compiler capability before the provider task stopped.\n" : "";
				return { content: [{ type: "text" as const, text: `${recovery}AATP_COMPILED: ${specs.length} work orders validated and sealed. Run /build for the ready implementation layer.` }] };
			} catch (error) { return aatpCompilerError(ctx.cwd, `AATP_COMPILER_FAILED: ${error instanceof Error ? error.message : String(error)}`); }
		}
		if (!pending.has(key)) return;
		const run = pending.get(key)!;
		if (run.timer) globalThis.clearTimeout(run.timer as any);
		pending.delete(key);
		if (run.startedClean && (!workingTreeClean(ctx.cwd) || gitHead(ctx.cwd) !== run.headAtDispatch)) {
			const state = loadState(ctx.cwd);
			for (const binding of run.bindings) if (binding.kind === "implementation") resetTicket(state, binding.ticketId);
			recountTickets(state); persist(ctx.cwd, state);
			return { isError: true, content: [{ type: "text" as const, text: "ISOLATION_GATE: parent tree or HEAD changed while worker ran. Worker patch was not applied; parent changes were preserved." }] };
		}
		const state = loadState(ctx.cwd), specs = listAatpSpecs(ctx.cwd), messages = processGovernedResults(ctx.cwd, state, run.bindings, event.details, specs, run.headAtDispatch);
		persist(ctx.cwd, state);
		return { isError: messages.some((m) => /failed|blocked|GATE|rejected/i.test(m)), content: [{ type: "text" as const, text: messages.join("\n") }] };
	});

	pi.registerTool({ name: "foundry_status", label: "Foundry Status", description: "Read Foundry state, mode, and AATP counters.", loadMode: "essential", approval: "read", parameters: z.object({}), async execute(_id, _params, _session, _user, ctx) {
		const loaded = safeState(ctx.cwd);
		if (!governedProject(ctx.cwd, loaded)) return { content: [{ type: "text", text: JSON.stringify({ active: false }, null, 2) }], details: { active: false } };
		if (loaded.broken) return { content: [{ type: "text", text: loaded.broken }], isError: true };
		const tasks = hydrateAatp(ctx.cwd, loaded.state), stack = detectStack(ctx.cwd), publicState = { active: true, ...loaded.state, aatp: { ...loaded.state.aatp, ...summarizeAatp(tasks) }, stack, display_mode: statusOf(loaded.state) };
		return { content: [{ type: "text", text: JSON.stringify(publicState, null, 2) }], details: publicState };
	} });

	pi.registerTool({ name: "foundry_init", label: "Foundry Init", description: "Advanced/manual bootstrap. /foundry auto-bootstraps new projects using this same project-local path.", loadMode: "essential", approval: "write", parameters: z.object({ name: z.string().optional() }), async execute(_id, params, _session, _user, ctx) {
		const boot = bootstrapFoundryProject(ctx.cwd, ROOT);
		ctx.ui.setStatus("foundry", statusOf(boot.state));
		return { content: [{ type: "text", text: `${boot.existed ? "Kept" : "Initialized"} Foundry. stack=${boot.stackIds.join(",")} ui=${boot.ui} ui_confidence=${boot.uiConfidence} project_config=${boot.configCreated ? "created" : "updated-without-model-overrides"} name=${params.name ?? ""}` }], details: boot.state };
	} });

	pi.registerTool({ name: "foundry_exec", label: "Foundry Design Verify", description: "Run one detected verification command during unlocked design only; no arbitrary command input.", loadMode: "essential", approval: "write", parameters: z.object({ id: z.string() }), async execute(_id, params, _session, _user, ctx) {
		const state = loadState(ctx.cwd);
		if (state.phase !== "design" || state.master_plan.status !== "locked" || state.design.status === "locked") return { content: [{ type: "text", text: "FOUNDRY_EXEC_GATE: verification tool is available only while design is unlocked after plan lock." }], isError: true };
		const steps = detectStack(ctx.cwd).verify, step = steps.find((s) => s.id === params.id);
		if (!step) return { content: [{ type: "text", text: `Unknown verify id ${params.id}. Available: ${steps.map((s) => s.id).join(", ") || "none"}` }], isError: true };
		const headBefore = gitHead(ctx.cwd), worktreeBefore = visibleWorktreeFingerprint(ctx.cwd);
		const result = executeVerifyStep(ctx.cwd, step, 120_000);
		const headAfter = gitHead(ctx.cwd), worktreeAfter = visibleWorktreeFingerprint(ctx.cwd);
		if (headBefore !== headAfter || worktreeBefore !== worktreeAfter) return { content: [{ type: "text", text: `${step.id} exit=${result.exitCode}\nFOUNDRY_EXEC_MUTATION_GATE: design verification changed the visible repository. Production sources must be implemented through an AATP ticket; inspect and clean the change before continuing.` }], isError: true };
		return { content: [{ type: "text", text: `${step.id} exit=${result.exitCode}\n${result.output}` }], isError: result.exitCode !== 0 };
	} });

	pi.registerTool({ name: "foundry_skill_read", label: "Foundry Skill Read", description: "Load 1–3 Foundry skill bodies on demand.", loadMode: "essential", approval: "read", parameters: z.object({ ids: z.array(z.string()) }), async execute(_id, params) {
		const registry = loadRegistry(join(ROOT, "skills")), wanted = params.ids.slice(0, 3), bodies = wanted.map((id: string) => { const hit = registry.find((s) => s.id === id); return hit ? `# ${hit.id}\n${hit.description}\n\n${hit.body}` : `# ${id}\n(not found)`; });
		return { content: [{ type: "text", text: bodies.join("\n\n") }], details: { ids: wanted } };
	} });

	const deps = (cwd: string): ApproveDeps => ({
		persist: (state) => persist(cwd, state),
		orchestrate: (title, body) => orchestrate(pi, title, body),
		enterOrResumePlan: () => enterOrResumePlan(pi, cwd, loadState(cwd)),
		requestAatpCompile: () => requestAatpCompile(pi, cwd, loadState(cwd)),
		advanceFoundry: () => advanceFoundry(pi, cwd, ""),
	});

	pi.registerTool({ name: "foundry_approve", label: "Foundry Approve", description: "Smart approve: call this tool if the user naturally confirms/approves the product or plan in conversation (e.g., 'ok', 'yes', 'làm đi').", loadMode: "essential", approval: "write", parameters: z.object({ phase: z.string().optional() }), async execute(_id, params, _session, _user, ctx) {
		const which = (params.phase || "").trim().toLowerCase(), state = loadState(ctx.cwd);
		if (which === "product" || (!which && !productReady(state))) {
			const result = approveProduct(ctx.cwd, state, deps(ctx.cwd));
			return { content: [{ type: "text", text: result.message }], isError: !result.ok };
		}
		if (which === "plan" || (!which && productReady(state))) {
			const result = approvePlan(ctx.cwd, state, deps(ctx.cwd));
			return { content: [{ type: "text", text: result.message }], isError: !result.ok };
		}
		return { content: [{ type: "text", text: "Usage: specify phase 'product' or 'plan'." }], isError: true };
	} });

	pi.registerTool({ name: "foundry_step", label: "Foundry Step", description: "Call this tool if the user says 'ok', 'go', or 'run' outside of an approval phase.", loadMode: "essential", approval: "write", parameters: z.object({}), async execute(_id, _params, _session, _user, ctx) {
		const state = loadState(ctx.cwd);
		if (state.mode === "plan" && state.planning.stage === "awaiting_lock") {
			const result = approvePlan(ctx.cwd, state, deps(ctx.cwd));
			return { content: [{ type: "text", text: result.message }], isError: !result.ok };
		}
		advanceFoundry(pi, ctx.cwd, "");
		return { content: [{ type: "text", text: "Foundry step triggered." }] };
	} });


	pi.registerCommand("foundry", { description: "Auto-bootstrap this repo if needed, then run the next legal Foundry step", handler: async (args, ctx) => advanceFoundry(pi, ctx.cwd, args) });
	const initHandler = async (_args: string, ctx: { cwd: string; waitForIdle: () => Promise<void> }) => { await ctx.waitForIdle(); const boot = bootstrapFoundryProject(ctx.cwd, ROOT); orchestrate(pi, boot.existed ? "Foundry already initialized." : "Foundry initialized manually.", "Use /foundry as the normal entrypoint. /foundry-doctor is available for diagnostics."); };
	pi.registerCommand("foundry-init", { description: "Advanced/manual project bootstrap; normal users can just run /foundry", handler: initHandler });
	pi.registerCommand("foundry-doctor", { description: "Check OMP isolation and Foundry model-role availability", handler: async (_args, ctx) => {
		const isolation = checkIsolationContract(ctx.cwd), roles = checkFoundryProjectRoles(ctx.cwd);
		const ok = isolation.ok && roles.ok;
		orchestrate(pi, ok ? "Foundry runtime contract OK." : "Foundry runtime contract BLOCKED.", [isolation.ok ? `isolation=${isolation.mode} apply=${isolation.apply}` : isolation.reason, roles.ok ? "Foundry model roles available (global defaults with optional project overrides)" : roles.reason].filter(Boolean).join("\n"));
	} });
	pi.registerCommand("foundry-version", { description: "Show Foundry/OMP versions and latest stable tag", handler: async (_args, ctx) => { const result = await checkForUpdate({ force: true }); if (result.notify) ctx.ui.notify(result.notify, "info"); orchestrate(pi, "Foundry version", versionReport(result)); } });

	const planHandler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: "error" | "info" | "warning") => void } }) => {
		const state = loadState(ctx.cwd), missing = requireProduct(state);
		if (missing) { ctx.ui.notify(missing, "warning"); return; }
		const sub = args.trim().toLowerCase();
		if (sub === "status") { orchestrate(pi, planStatus(state), state.mode === "plan" ? planInstruction(state) : "Plan is not active."); return; }
		if (sub === "abort") { abortPlan(state); persist(ctx.cwd, state); orchestrate(pi, "Plan aborted by user.", "Planning stage authority is cleared. The plan remains unlocked unless it was already locked."); return; }
		if (state.master_plan.status === "locked") { ctx.ui.notify("PLAN_GATE: master plan is locked. Use /plan-revise before starting a new Plan cycle.", "warning"); return; }
		enterOrResumePlan(pi, ctx.cwd, state, sub === "restart");
	};
	pi.registerCommand("plan", { description: "Enter/resume governed Draft → Redteam → Synth planning mode", handler: planHandler });
	pi.registerCommand("plan-revise", { description: "Human-only: reopen locked plan and restart Plan", handler: async (args, ctx) => {
		if (!stateFileExists(ctx.cwd)) { ctx.ui.notify("FOUNDRY_GATE: this project is not governed by Foundry yet; run /foundry first.", "warning"); return; }
		const state = loadState(ctx.cwd);
		state.master_plan.status = "draft";
		state.master_plan.sha256 = "";
		state.conflict = { kind: "PLAN_CONFLICT", reason: args.trim() || "user revise" };
		// A design is derived from the locked plan. Never carry a v1 design lock
		// across a plan revision; require an explicit approve/skip decision again.
		state.design = { required: true, version: state.design.version, status: "missing", sha256: "" };
		resetAatp(state);
		invalidateQa(state);
		enterPlan(state, true);
		persist(ctx.cwd, state);
		orchestrate(pi, "PLAN reopened by user.", `${planStatus(state)}\n${planInstruction(state)}\nDownstream design/AATP/reviews/QA were invalidated. Run /design approve or /design skip after the new plan is locked.`);
	} });

	pi.registerCommand("design", { description: "Design foundation after plan lock", handler: async (args, ctx) => {
		const state = loadState(ctx.cwd), gate = requirePlan(state); if (gate) { ctx.ui.notify(gate, "warning"); return; }
		const sub = args.trim().toLowerCase();
		if (sub === "approve") { if (!lockArtifactHash(ctx.cwd, state, "design")) { ctx.ui.notify("DESIGN_GATE: docs/DESIGN.md must exist and be non-empty before approval.", "error"); return; } state.design.status = "locked"; state.design.required = true; state.design.version = state.design.version === "0" ? "1.0" : state.design.version; invalidateQa(state); requestAatpCompile(pi, ctx.cwd, state); return; }
		if (sub === "skip") { state.design.required = false; state.design.status = "not_required"; invalidateQa(state); requestAatpCompile(pi, ctx.cwd, state); return; }
		orchestrate(pi, "Run /design. Read skill://design-foundation.", "Spawn blocking design-foundation. Build/verification is available only through foundry_exec. Human locks with /design approve.");
	} });
	const approveHandler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: "error" | "info" | "warning") => void } }) => {
		const which = args.trim().toLowerCase(), state = loadState(ctx.cwd);
		if (which === "product" || which === "approve-product" || (!which && !productReady(state))) {
			const result = approveProduct(ctx.cwd, state, deps(ctx.cwd));
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
			return;
		}
		if (which === "plan" || which === "approve-plan" || (!which && productReady(state))) {
			const result = approvePlan(ctx.cwd, state, deps(ctx.cwd));
			ctx.ui.notify(result.message, result.ok ? "info" : "error");
			return;
		}
		ctx.ui.notify("Usage: /approve [product|plan]", "warning");
	};
	pi.registerCommand("foundry-approve", { description: "Human gate: product | plan", handler: approveHandler });
	pi.registerCommand("approve", { description: "Smart approve: natural shortcut for approving product or plan", handler: approveHandler });
	const okHandler = async (args: string, ctx: { cwd: string; ui: { notify: (message: string, level?: "error" | "info" | "warning") => void } }) => {
		const state = loadState(ctx.cwd);
		// A completed plan cycle waits for the human lock; /ok at that point IS the approval the prompt promised.
		if (state.mode === "plan" && state.planning.stage === "awaiting_lock") return approveHandler("plan", ctx);
		advanceFoundry(pi, ctx.cwd, args);
	};
	pi.registerCommand("ok", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
	pi.registerCommand("run", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
	pi.registerCommand("go", { description: "Natural shortcut: proceed with next ready Foundry step (locks the plan at awaiting_lock)", handler: okHandler });
	pi.registerCommand("debug", { description: "Superpowers 5-Step Systematic Debugging", handler: async (_args, _ctx) => orchestrate(pi, "Superpowers 5-Step Debug Protocol.", ["1. Reproduce: Write minimal failing test.", "2. Isolate: Single function in single file.", "3. Hypothesize: State 1 root cause.", "4. Fix Minimal: Patch <= 80 lines.", "5. Verify: Full verification suite."].join("\n")) });
	
	pi.registerCommand("aatp-seal", { description: "Manually seal AATP specs if generated offline/transplanted", handler: async (_args, ctx) => {
		try {
			const state = loadState(ctx.cwd), specs = listAatpSpecs(ctx.cwd), sourceManifest = aatpManifestHash(ctx.cwd);
			if (state.phase !== "aatp") { ctx.ui.notify("AATP_COMPILER_GATE: phase must be aatp.", "error"); return; }
			if (state.aatp.manifest_sha256) { ctx.ui.notify("AATP_COMPILER_GATE: AATP already sealed.", "info"); return; }
			if (specs.length === 0) { ctx.ui.notify("AATP_COMPILER_GATE: no docs/AATP/AATP-*.md work orders were produced.", "error"); return; }
			const errors = [...validateAatpSpecs(specs, { strict: true }), ...validateAatpCoverage(ctx.cwd, specs)];
			if (errors.length) { ctx.ui.notify(`AATP_COMPILER_GATE: ${errors.join("; ")}`, "error"); return; }
			const manifest = aatpManifestHash(ctx.cwd);
			if (!sourceManifest || manifest !== sourceManifest) { ctx.ui.notify("AATP_COMPILER_GATE: AATP sources changed while validating; retry compilation.", "error"); return; }
			resetAatp(state);
			state.aatp.manifest_sha256 = manifest;
			if (!state.aatp.manifest_sha256 || !artifactsMatch(ctx.cwd, state)) { state.aatp.manifest_sha256 = ""; ctx.ui.notify("AATP_COMPILER_GATE: locked product/plan/design evidence changed while compiling; restart the human gate.", "error"); return; }
			seedTickets(state, specs);
			writeAatpIndex(ctx.cwd, hydrateAatp(ctx.cwd, state));
			recountTickets(state); invalidateQa(state); persist(ctx.cwd, state); ctx.ui.setStatus("foundry", statusOf(state));
			orchestrate(pi, "AATP specs sealed.", `AATP_COMPILED: ${specs.length} work orders validated and sealed. Run /build for the ready implementation layer.`);
		} catch (error) { ctx.ui.notify(`AATP_COMPILER_FAILED: ${error instanceof Error ? error.message : String(error)}`, "error"); }
	} });

	pi.registerCommand("aatp", { description: "Compile the project-wide AATP DAG with the synthesis capability", handler: async (_args, ctx) => { const state = loadState(ctx.cwd), gate = requireDesignIfUi(state); if (gate) { ctx.ui.notify(gate, "warning"); return; } requestAatpCompile(pi, ctx.cwd, state); } });
	pi.registerCommand("build", { description: "Run ready isolated workers from the sealed AATP DAG", handler: async (_args, ctx) => {
		const state = loadState(ctx.cwd), gate = requireDesignIfUi(state); if (gate) { ctx.ui.notify(gate, "warning"); return; }
		const contract = checkIsolationContract(ctx.cwd); if (!contract.ok) { ctx.ui.notify(contract.reason ?? "Foundry isolation contract failed", "error"); return; }
		const specs = listAatpSpecs(ctx.cwd), errors = validateAatpSpecs(specs, { strict: true }); if (errors.length) { ctx.ui.notify(`AATP invalid: ${errors.join("; ")}`, "error"); return; }
		if (!state.aatp.manifest_sha256) { ctx.ui.notify("AATP_COMPILER_GATE: the project-wide DAG is not sealed. Run /aatp and wait for aatp-compiler before /build.", "error"); return; }
		if (state.aatp.manifest_sha256 !== aatpManifestHash(ctx.cwd)) { ctx.ui.notify("AATP_SPEC_GATE: sealed AATP specs changed. Re-run /aatp after an explicit plan/design revision.", "error"); return; }
		if (!artifactsMatch(ctx.cwd, state)) { ctx.ui.notify("AATP_ARTIFACT_GATE: locked product/plan/design evidence changed. Reopen the relevant human gate before building.", "error"); return; }
		const baselineError = commitGovernanceBaseline(ctx.cwd); if (baselineError) { ctx.ui.notify(baselineError, "error"); return; }
		const baselineHead = gitHead(ctx.cwd);
		if (!baselineHead) { ctx.ui.notify("PROVENANCE_GATE: unable to capture the Foundry baseline commit.", "error"); return; }
		if (!state.aatp.baseline_sha) state.aatp.baseline_sha = baselineHead;
		let zombies = 0;
		for (const t of Object.values(state.tickets)) {
			if (t.status === "active") {
				t.status = "ready";
				zombies++;
			}
		}
		if (zombies > 0) ctx.ui.notify(`WATCHDOG: Reset ${zombies} zombie ticket(s) back to ready.`, "warning");
		seedTickets(state, specs); const tasks = hydrateAatp(ctx.cwd, state), ready = readyIndependent(tasks); state.phase = "implementation"; recountTickets(state); persist(ctx.cwd, state);
		const lines = ready.map((t) => `- ${t.id} agent=${routeAgent(t.risk, t.attempts)} :: ${t.objective}`);
		orchestrate(pi, "Run the ready AATP layer.", [`Ready (${ready.length}):`, lines.join("\n") || "(none)", "Call the 'task' tool to spawn one blocking subagent per line using the exact AATP id in the task instructions.", "Do NOT call aatp_begin/complete. Foundry owns lifecycle, patch validation, apply, and commit.", "Worker conflicts must end with: FOUNDRY_CONFLICT <KIND> <reason>."].join("\n"));
	} });
	pi.registerCommand("review", { description: "Independent AATP review with parent-owned verdict transition", handler: async (args, ctx) => {
		const state = loadState(ctx.cwd), completed = Object.values(state.tickets).filter((t) => t.status === "completed" && t.review !== "APPROVE"), requested = args.trim().toUpperCase(), target = requested ? state.tickets[requested] : completed[0];
		if (!target || target.status !== "completed") { ctx.ui.notify("REVIEW_GATE: specify a completed AATP id.", "warning"); return; }
		state.phase = "review"; persist(ctx.cwd, state);
		const agent = reviewAgentForRisk(target.risk, target.security_sensitive === true);
		orchestrate(pi, "Independent review.", `Spawn blocking ${agent} for ${target.id}. The review report and final output must contain the same exact marker: FOUNDRY_REVIEW ${target.id} APPROVE|REQUEST_CHANGES|BLOCK. Reviewer cannot call lifecycle tools or modify product code.`);
	} });
	pi.registerCommand("verify", { description: "Deterministic QA", handler: async (_args, ctx) => {
		if (!stateFileExists(ctx.cwd)) { ctx.ui.notify("FOUNDRY_GATE: this project is not governed by Foundry yet; run /foundry first.", "warning"); return; }
		const state = loadState(ctx.cwd), rows = runVerify(ctx.cwd); applyQa(ctx.cwd, state, rows); deriveRelease(ctx.cwd, state); persist(ctx.cwd, state); orchestrate(pi, `QA ${state.qa.status}`, rows.map((r) => `${r.id}=${r.exitCode}`).join(" ") || "no-commands");
	} });
	pi.registerCommand("release-check", { description: "Derived release gate; agent release commands remain denied", handler: async (_args, ctx) => {
		if (!stateFileExists(ctx.cwd)) { ctx.ui.notify("FOUNDRY_GATE: this project is not governed by Foundry yet; run /foundry first.", "warning"); return; }
		const state = loadState(ctx.cwd); recountTickets(state); const ready = deriveRelease(ctx.cwd, state); if (ready) state.phase = "release"; persist(ctx.cwd, state);
		const report = [
			`${productReady(state) ? "✓" : "✗"} PRODUCT`, `${planLocked(state) ? "✓" : "✗"} PLAN locked`, `${designAllowsUi(state) ? "✓" : "✗"} DESIGN`,
			`${state.aatp.manifest_sha256 && state.aatp.manifest_sha256 === aatpManifestHash(ctx.cwd) ? "✓" : "✗"} AATP specs sealed`, `${state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0 ? "✓" : "✗"} AATP complete`,
			`${Object.values(state.tickets).every((t) => t.review === "APPROVE" && (t.review_by === "reviewer" || t.review_by === "security-reviewer") && t.review_evidence_sha256) && Object.keys(state.tickets).length > 0 ? "✓" : "✗"} independent reviews`, `${governedCommitLedgerFresh(ctx.cwd, state, gitHead(ctx.cwd)) ? "✓" : "✗"} provenance ledger`, `${state.qa.status === "pass" ? "✓" : "✗"} QA pass @ ${state.qa.tree_sha || "no-sha"}`, `${workingTreeClean(ctx.cwd) ? "✓" : "✗"} clean tree`,
		].join("\n");
		orchestrate(pi, ready ? "RELEASE_READY=true (derived)." : "Release blocked.", `${report}\n\nAgent push/publish/deploy remains denied. Release from a human shell after this gate is green.`);
	} });
}
