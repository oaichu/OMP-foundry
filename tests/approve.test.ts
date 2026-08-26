import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveProduct, approvePlan, type ApproveDeps } from "../src/approve";
import { hashPlanArtifact } from "../src/plan";
import { defaultState, type FoundryMode } from "../src/types";
import { saveState } from "../src/state-machine";

const PLAN_MODE: FoundryMode = "plan";

function deps(log: string[]): ApproveDeps {
	return {
		persist: (state) => log.push(`persist:${state.phase}:${state.master_plan.status}`),
		orchestrate: (title) => log.push(`orchestrate:${title}`),
		enterOrResumePlan: () => log.push("enterOrResumePlan"),
		requestAatpCompile: () => log.push("requestAatpCompile"),
		advanceFoundry: () => log.push("advanceFoundry"),
	};
}

function repo(): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-approve-"));
	mkdirSync(join(dir, "docs"), { recursive: true });
	return dir;
}

describe("approveProduct", () => {
	test("locks a non-empty PRODUCT.md and starts Plan", () => {
		const dir = repo(), log: string[] = [];
		writeFileSync(join(dir, "docs", "PRODUCT.md"), "product\n");
		const state = defaultState();
		const result = approveProduct(dir, state, deps(log));
		expect(result.ok).toBe(true);
		expect(state.product.status).toBe("approved");
		expect(state.phase).toBe("planning");
		expect(state.mode).toBe("plan");
		expect(log).toContain("enterOrResumePlan");
	});

	test("fails closed on missing PRODUCT.md", () => {
		const dir = repo(), log: string[] = [];
		const result = approveProduct(dir, defaultState(), deps(log));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("PRODUCT_GATE");
		expect(log).not.toContain("enterOrResumePlan");
	});
});

describe("approvePlan", () => {
	test("rejects approval before the cycle completes", () => {
		const dir = repo(), log: string[] = [];
		const state = defaultState();
		state.mode = PLAN_MODE;
		state.planning.stage = "synth";
		const result = approvePlan(dir, state, deps(log));
		expect(result.ok).toBe(false);
		expect(result.message).toContain("PLAN_GATE");
	});

	test("locks at awaiting_lock when planning artifacts match", () => {
		const dir = repo(), log: string[] = [];
		mkdirSync(join(dir, "docs", "planning"), { recursive: true });
		writeFileSync(join(dir, "docs", "planning", "MASTER_PLAN_DRAFT.md"), "draft\n");
		writeFileSync(join(dir, "docs", "planning", "PLAN_REVIEW.md"), "review\n");
		writeFileSync(join(dir, "docs", "MASTER_PLAN.md"), "plan\n");
		const state = defaultState();
		state.product = { status: "approved", sha256: "x" };
		state.mode = PLAN_MODE;
		state.phase = "planning";
		state.planning = { stage: "awaiting_lock", epoch: "e1", draft_sha256: "", review_sha256: "", final_sha256: "" };
		state.planning.draft_sha256 = hashPlanArtifact(dir, "draft")!;
		state.planning.review_sha256 = hashPlanArtifact(dir, "redteam")!;
		state.planning.final_sha256 = hashPlanArtifact(dir, "synth")!;
		const result = approvePlan(dir, state, deps(log));
		expect(result.ok).toBe(true);
		expect(state.master_plan.status).toBe("locked");
		expect(state.mode as string).toBe("normal");
		saveState(dir, state);
	});
});
