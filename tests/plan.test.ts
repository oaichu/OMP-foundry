import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denyToolCall } from "../src/permissions";
import { abortPlan, completePlanStage, enterPlan, expectedPlanAgent, planArtifactsMatch, planStatus } from "../src/plan";
import { defaultState } from "../src/types";

function project(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-plan-"));
	mkdirSync(join(dir, "docs", "planning"), { recursive: true });
	return dir;
}

describe("Plan governed mode", () => {
	test("persists exact Draft -> Redteam -> Synth -> human-lock sequence", () => {
		const cwd = project(), state = defaultState();
		state.product.status = "approved";
		enterPlan(state);
		expect(state.mode).toBe("plan");
		expect(state.planning.stage).toBe("draft");
		expect(expectedPlanAgent(state)).toBe("plan-drafter");
		expect(planStatus(state)).toContain("PLAN 1/3");

		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n");
		expect(completePlanStage(cwd, state, "draft").ok).toBe(true);
		expect(state.planning.stage).toBe("redteam");
		expect(expectedPlanAgent(state)).toBe("plan-redteam");

		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "review\n");
		expect(completePlanStage(cwd, state, "redteam").ok).toBe(true);
		expect(state.planning.stage).toBe("synth");
		expect(expectedPlanAgent(state)).toBe("plan-synth");

		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "final\n");
		expect(completePlanStage(cwd, state, "synth").ok).toBe(true);
		expect(state.planning.stage).toBe("awaiting_lock");
		expect(planArtifactsMatch(cwd, state)).toBe(true);
	});

	test("artifact drift invalidates human-lock evidence", () => {
		const cwd = project(), state = defaultState();
		enterPlan(state);
		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n"); completePlanStage(cwd, state, "draft");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "review\n"); completePlanStage(cwd, state, "redteam");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "final\n"); completePlanStage(cwd, state, "synth");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "tampered\n");
		expect(planArtifactsMatch(cwd, state)).toBe(false);
	});

	test("stage completion rechecks the artifact hash at the lock boundary", () => {
		const cwd = project(), state = defaultState(); enterPlan(state);
		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n");
		expect(completePlanStage(cwd, state, "draft", "stale-hash").ok).toBe(false);
		expect(state.planning.stage).toBe("draft");
	});

	test("abort clears stale stage evidence", () => {
		const state = defaultState();
		enterPlan(state);
		state.planning.draft_sha256 = "draft";
		state.planning.review_sha256 = "review";
		abortPlan(state);
		expect(state.mode).toBe("normal");
		expect(state.planning.stage).toBe("idle");
		expect(state.planning.epoch).not.toBe("");
		expect(state.planning.draft_sha256).toBe("");
		expect(state.planning.review_sha256).toBe("");
		expect(state.planning.final_sha256).toBe("");
	});

	test("write authority follows only the active planning artifact", () => {
		const state = defaultState(); state.product.status = "approved"; enterPlan(state);
		const canonicalize = (raw: string) => raw.toLowerCase();
		expect(denyToolCall("write", { path: "docs/planning/MASTER_PLAN_DRAFT.md" }, state, { canonicalize })?.reason).toContain("foundry_plan_write");
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })?.reason).toContain("foundry_plan_write");
		state.planning.stage = "redteam";
		expect(denyToolCall("write", { path: "docs/planning/PLAN_REVIEW.md" }, state, { canonicalize })?.reason).toContain("foundry_plan_write");
		state.planning.stage = "synth";
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })?.reason).toContain("foundry_plan_write");
		state.planning.stage = "awaiting_lock";
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })?.reason).toContain("PLAN_GATE");
	});
});

describe("awaiting_lock is resume-only", () => {
	test("enterPlan preserves a completed awaiting_lock cycle", () => {
		const state = defaultState();
		state.mode = "plan";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "a", review_sha256: "b", final_sha256: "c" };
		enterPlan(state);
		expect(state.planning.stage).toBe("awaiting_lock");
		expect(state.planning.epoch).toBe("e1");
		expect(state.planning.final_sha256).toBe("c");
	});

	test("enterPlan(restart) still resets awaiting_lock", () => {
		const state = defaultState();
		state.mode = "plan";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "a", review_sha256: "b", final_sha256: "c" };
		enterPlan(state, true);
		expect(state.planning.stage).toBe("draft");
		expect(state.planning.final_sha256).toBe("");
		expect(state.planning.epoch).not.toBe("e1");
	});
});
