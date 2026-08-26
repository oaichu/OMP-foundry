import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import type { CompanyState, PlanStage } from "./types";
import { safeRepoPath } from "./paths";

export const PLAN_AGENTS: Record<Exclude<PlanStage, "idle" | "awaiting_lock">, string> = {
	draft: "plan-drafter",
	redteam: "plan-redteam",
	synth: "plan-synth",
};

export const PLAN_ARTIFACTS: Record<Exclude<PlanStage, "idle" | "awaiting_lock">, string> = {
	draft: "docs/planning/MASTER_PLAN_DRAFT.md",
	redteam: "docs/planning/PLAN_REVIEW.md",
	synth: "docs/MASTER_PLAN.md",
};

export const PLAN_ROLE_LABELS: Record<Exclude<PlanStage, "idle" | "awaiting_lock">, string> = {
	draft: "@foundry_plan",
	redteam: "@foundry_redteam",
	synth: "@foundry_synth",
};
const MAX_PLAN_ARTIFACT_BYTES = 256 * 1024;

export function planStatus(state: CompanyState): string {
	if (state.mode !== "plan") return "NORMAL";
	const stage = state.planning.stage;
	if (stage === "awaiting_lock") return "PLAN · HUMAN LOCK REQUIRED";
	if (stage === "idle") return "PLAN · IDLE";
	const n = stage === "draft" ? 1 : stage === "redteam" ? 2 : 3;
	return `PLAN ${n}/3 · ${stage.toUpperCase()} · ${PLAN_ROLE_LABELS[stage]}`;
}

export function enterPlan(state: CompanyState, restart = false): void {
	state.mode = "plan";
	state.phase = "planning";
	// awaiting_lock holds a complete Draft→Redteam→Synth cycle awaiting the
	// human lock; a plain resume must never destroy it. Only an explicit
	// restart (or /plan-revise) may reset the stage.
	if (restart || state.planning.stage === "idle") {
		state.planning = { stage: "draft", epoch: randomUUID(), draft_sha256: "", review_sha256: "", final_sha256: "" };
	}
	if (!state.planning.epoch) state.planning.epoch = randomUUID();
}

export function abortPlan(state: CompanyState): void {
	state.mode = "normal";
	state.planning = { stage: "idle", epoch: randomUUID(), draft_sha256: "", review_sha256: "", final_sha256: "" };
	state.phase = state.master_plan.status === "locked" ? "aatp" : "planning";
}

export function expectedPlanAgent(state: CompanyState): string | undefined {
	const stage = state.planning.stage;
	return stage === "draft" || stage === "redteam" || stage === "synth" ? PLAN_AGENTS[stage] : undefined;
}

export function planInstruction(state: CompanyState): string {
	const stage = state.planning.stage;
	if (stage === "awaiting_lock") return "Plan synthesis and task breakdown complete. Review the plan above. To approve, reply naturally ('ok', 'yes', 'approve', 'proceed') or run /approve.";
	if (stage === "idle") return "Plan is idle. Run /plan to start.";
	const agent = PLAN_AGENTS[stage];
	const artifact = PLAN_ARTIFACTS[stage];
	if (stage === "synth") {
		return `Spawn exactly one blocking ${agent}. It synthesizes ${artifact} and writes initial AATP work orders (docs/AATP/AATP-*.md, <=200 lines, <=5 files per task). It MUST write all AATP-*.md work orders FIRST, and write docs/MASTER_PLAN.md ABSOLUTELY LAST as the terminal artifact. Read skill://master-plan-method. Do not spawn another Plan stage until this task settles.`;
	}
	return `Spawn exactly one blocking ${agent}. It owns only ${artifact}. Read skill://master-plan-method. Use grep/glob first, then bounded reads (path:start-end, max 200 lines); do one evidence pass and write the artifact immediately. Do not spawn another Plan stage until this task settles.`;
}

export function hashPlanArtifact(cwd: string, stage: Exclude<PlanStage, "idle" | "awaiting_lock">): string | undefined {
	const file = safeRepoPath(cwd, PLAN_ARTIFACTS[stage]);
	if (!file) return undefined;
	try {
		const stat = lstatSync(file);
		if (stat.isSymbolicLink() || !stat.isFile() || stat.size === 0 || stat.size > MAX_PLAN_ARTIFACT_BYTES) return undefined;
		const text = readFileSync(file, "utf8");
		if (!text.trim() || Buffer.byteLength(text, "utf8") > MAX_PLAN_ARTIFACT_BYTES) return undefined;
		return createHash("sha256").update(text).digest("hex");
	} catch {
		return undefined;
	}
}

export function completePlanStage(cwd: string, state: CompanyState, stage: Exclude<PlanStage, "idle" | "awaiting_lock">, acceptedHash?: string): { ok: boolean; reason?: string } {
	if (state.mode !== "plan" || state.planning.stage !== stage) return { ok: false, reason: `PLAN_STAGE_GATE: expected ${state.planning.stage}, got ${stage}.` };
	// Always re-read the artifact at the authority boundary.  The caller may
	// have hashed it during task-result handling, but accepting that stale hash
	// would leave a small write-between-check-and-lock window.
	const currentHash = hashPlanArtifact(cwd, stage);
	if (acceptedHash && currentHash && acceptedHash !== currentHash) return { ok: false, reason: `PLAN_ARTIFACT_GATE: ${PLAN_ARTIFACTS[stage]} changed before the stage could be locked.` };
	const hash = currentHash;
	if (!hash) return { ok: false, reason: `PLAN_ARTIFACT_GATE: ${PLAN_ARTIFACTS[stage]} is missing or empty.` };
	if (stage === "draft") { state.planning.draft_sha256 = hash; state.planning.stage = "redteam"; }
	else if (stage === "redteam") { state.planning.review_sha256 = hash; state.planning.stage = "synth"; }
	else { state.planning.final_sha256 = hash; state.planning.stage = "awaiting_lock"; }
	return { ok: true };
}

export function planArtifactsMatch(cwd: string, state: CompanyState): boolean {
	if (!state.planning.draft_sha256 || !state.planning.review_sha256 || !state.planning.final_sha256) return false;
	return hashPlanArtifact(cwd, "draft") === state.planning.draft_sha256 && hashPlanArtifact(cwd, "redteam") === state.planning.review_sha256 && hashPlanArtifact(cwd, "synth") === state.planning.final_sha256;
}
