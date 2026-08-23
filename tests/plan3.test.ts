import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { denyToolCall } from "../src/permissions";
import { abortPlan3, completePlan3Stage, enterPlan3, expectedPlan3Agent, plan3ArtifactsMatch, plan3Status } from "../src/plan3";
import { defaultState } from "../src/types";

function project(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-plan3-"));
	mkdirSync(join(dir, "docs", "planning"), { recursive: true });
	return dir;
}

describe("Plan3 governed mode", () => {
	test("persists exact Draft -> Redteam -> Synth -> human-lock sequence", () => {
		const cwd = project(), state = defaultState();
		state.product.status = "approved";
		enterPlan3(state);
		expect(state.mode).toBe("plan3");
		expect(state.planning.stage).toBe("draft");
		expect(expectedPlan3Agent(state)).toBe("plan-drafter");
		expect(plan3Status(state)).toContain("PLAN3 1/3");

		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n");
		expect(completePlan3Stage(cwd, state, "draft").ok).toBe(true);
		expect(state.planning.stage).toBe("redteam");
		expect(expectedPlan3Agent(state)).toBe("plan-redteam");

		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "review\n");
		expect(completePlan3Stage(cwd, state, "redteam").ok).toBe(true);
		expect(state.planning.stage).toBe("synth");
		expect(expectedPlan3Agent(state)).toBe("plan-synth");

		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "final\n");
		expect(completePlan3Stage(cwd, state, "synth").ok).toBe(true);
		expect(state.planning.stage).toBe("awaiting_lock");
		expect(plan3ArtifactsMatch(cwd, state)).toBe(true);
	});

	test("artifact drift invalidates human-lock evidence", () => {
		const cwd = project(), state = defaultState();
		enterPlan3(state);
		writeFileSync(join(cwd, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n"); completePlan3Stage(cwd, state, "draft");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "review\n"); completePlan3Stage(cwd, state, "redteam");
		writeFileSync(join(cwd, "docs", "MASTER_PLAN.md"), "final\n"); completePlan3Stage(cwd, state, "synth");
		writeFileSync(join(cwd, "docs", "planning", "PLAN_REVIEW.md"), "tampered\n");
		expect(plan3ArtifactsMatch(cwd, state)).toBe(false);
	});

	test("abort clears stale stage evidence", () => {
		const state = defaultState();
		enterPlan3(state);
		state.planning.draft_sha256 = "draft";
		state.planning.review_sha256 = "review";
		abortPlan3(state);
		expect(state.mode).toBe("normal");
		expect(state.planning).toEqual({ stage: "idle", draft_sha256: "", review_sha256: "", final_sha256: "" });
	});

	test("write authority follows only the active planning artifact", () => {
		const state = defaultState(); state.product.status = "approved"; enterPlan3(state);
		const canonicalize = (raw: string) => raw.toLowerCase();
		expect(denyToolCall("write", { path: "docs/planning/MASTER_PLAN_DRAFT.md" }, state, { canonicalize })).toBeUndefined();
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })?.reason).toContain("PLAN_GATE");
		state.planning.stage = "redteam";
		expect(denyToolCall("write", { path: "docs/planning/PLAN_REVIEW.md" }, state, { canonicalize })).toBeUndefined();
		state.planning.stage = "synth";
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })).toBeUndefined();
		state.planning.stage = "awaiting_lock";
		expect(denyToolCall("write", { path: "docs/MASTER_PLAN.md" }, state, { canonicalize })?.reason).toContain("PLAN_GATE");
	});
});