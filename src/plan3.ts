import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyState, Plan3Stage } from "./types";

export const PLAN3_AGENTS: Record<Exclude<Plan3Stage, "idle" | "awaiting_lock">, string> = {
	draft: "plan-drafter",
	redteam: "plan-redteam",
	synth: "plan-synth",
};

export const PLAN3_ARTIFACTS: Record<Exclude<Plan3Stage, "idle" | "awaiting_lock">, string> = {
	draft: "docs/planning/MASTER_PLAN_DRAFT.md",
	redteam: "docs/planning/PLAN_REVIEW.md",
	synth: "docs/MASTER_PLAN.md",
};

export const PLAN3_ROLE_LABELS: Record<Exclude<Plan3Stage, "idle" | "awaiting_lock">, string> = {
	draft: "@foundry_plan",
	redteam: "@foundry_redteam",
	synth: "@foundry_synth",
};

export function plan3Status(state: CompanyState): string {
	if (state.mode !== "plan3") return "NORMAL";
	const stage = state.planning.stage;
	if (stage === "awaiting_lock") return "PLAN3 · HUMAN LOCK REQUIRED";
	if (stage === "idle") return "PLAN3 · IDLE";
	const n = stage === "draft" ? 1 : stage === "redteam" ? 2 : 3;
	return `PLAN3 ${n}/3 · ${stage.toUpperCase()} · ${PLAN3_ROLE_LABELS[stage]}`;
}

export function enterPlan3(state: CompanyState, restart = false): void {
	state.mode = "plan3";
	state.phase = "planning";
	if (restart || state.planning.stage === "idle" || state.planning.stage === "awaiting_lock") {
		state.planning = { stage: "draft", draft_sha256: "", review_sha256: "", final_sha256: "" };
	}
}

export function abortPlan3(state: CompanyState): void {
	state.mode = "normal";
	state.planning = { stage: "idle", draft_sha256: "", review_sha256: "", final_sha256: "" };
	state.phase = state.master_plan.status === "locked" ? "aatp" : "planning";
}

export function expectedPlan3Agent(state: CompanyState): string | undefined {
	const stage = state.planning.stage;
	return stage === "draft" || stage === "redteam" || stage === "synth" ? PLAN3_AGENTS[stage] : undefined;
}

export function plan3Instruction(state: CompanyState): string {
	const stage = state.planning.stage;
	if (stage === "awaiting_lock") return "Plan3 synthesis is complete. Do not edit planning artifacts. Human must run /foundry-approve plan.";
	if (stage === "idle") return "Plan3 is idle. Run /plan3 to start.";
	const agent = PLAN3_AGENTS[stage];
	const artifact = PLAN3_ARTIFACTS[stage];
	return `Spawn exactly one blocking ${agent}. It owns only ${artifact}. Read skill://master-plan-method. Do not spawn another Plan3 stage until this task settles.`;
}

export function hashPlan3Artifact(cwd: string, stage: Exclude<Plan3Stage, "idle" | "awaiting_lock">): string | undefined {
	const file = join(cwd, PLAN3_ARTIFACTS[stage]);
	if (!existsSync(file)) return undefined;
	const text = readFileSync(file, "utf8");
	if (!text.trim()) return undefined;
	return createHash("sha256").update(text).digest("hex");
}

export function completePlan3Stage(cwd: string, state: CompanyState, stage: Exclude<Plan3Stage, "idle" | "awaiting_lock">): { ok: boolean; reason?: string } {
	if (state.mode !== "plan3" || state.planning.stage !== stage) return { ok: false, reason: `PLAN3_STAGE_GATE: expected ${state.planning.stage}, got ${stage}.` };
	const hash = hashPlan3Artifact(cwd, stage);
	if (!hash) return { ok: false, reason: `PLAN3_ARTIFACT_GATE: ${PLAN3_ARTIFACTS[stage]} is missing or empty.` };
	if (stage === "draft") { state.planning.draft_sha256 = hash; state.planning.stage = "redteam"; }
	else if (stage === "redteam") { state.planning.review_sha256 = hash; state.planning.stage = "synth"; }
	else { state.planning.final_sha256 = hash; state.planning.stage = "awaiting_lock"; }
	return { ok: true };
}

export function plan3ArtifactsMatch(cwd: string, state: CompanyState): boolean {
	if (!state.planning.draft_sha256 || !state.planning.review_sha256 || !state.planning.final_sha256) return false;
	return hashPlan3Artifact(cwd, "draft") === state.planning.draft_sha256 && hashPlan3Artifact(cwd, "redteam") === state.planning.review_sha256 && hashPlan3Artifact(cwd, "synth") === state.planning.final_sha256;
}
