import { describe, expect, test } from "bun:test";
import { compareRuns, EVAL_WEIGHTS, scoreRun, type EvalPolicy, type EvalRun } from "../scripts/eval-lib";

const controlSha = "54c898163024c3e017d914c30fd9490bee27f7b3";
const metrics = { correctness: 0.8, verification: 0.8, governance: 1, scope_precision: 0.8, first_pass_review: 0.8, context_efficiency: 0.8, model_cost_efficiency: 0.8, traceability: 0.8, recovery: 0.8 } as const;

function run(label: string, commit_sha = controlSha): EvalRun {
	return { schema_version: 1, corpus_version: "test-v1", label, commit_sha, model: "same-model", model_config_hash: "same-config", cases: [{ id: "CASE-1", category: "routing", sample_count: 3, metrics: { ...metrics }, governance_violations: [] }] };
}

const policy: EvalPolicy = { schema_version: 1, control_commit: controlSha, min_sample_count: 3, min_score_delta: 0, metric_regression_tolerance: 0, governance_regression: "forbid" };

describe("Foundry Eval Lab", () => {
	test("weights sum to 100", () => expect(Object.values(EVAL_WEIGHTS).reduce((sum, value) => sum + value, 0)).toBe(100));

	test("scores a valid run", () => {
		const score = scoreRun(run("control"));
		expect(score.weighted_score).toBeCloseTo(84, 8);
		expect(score.governance_pass).toBe(true);
	});

	test("passes a fair non-regressing candidate", () => {
		const result = compareRuns(run("control"), run("candidate", "1111111111111111111111111111111111111111"), policy);
		expect(result.pass).toBe(true);
		expect(result.delta).toBeCloseTo(0, 8);
	});

	test("governance violation is an unconditional failure", () => {
		const candidate = run("candidate", "1111111111111111111111111111111111111111");
		candidate.cases[0].governance_violations = ["wrote outside allowed_files"];
		const result = compareRuns(run("control"), candidate, policy);
		expect(result.pass).toBe(false);
		expect(result.reasons.some((reason) => reason.includes("candidate governance violation"))).toBe(true);
	});

	test("rejects unfair model comparisons", () => {
		const candidate = run("candidate", "1111111111111111111111111111111111111111");
		candidate.model = "different-model";
		const result = compareRuns(run("control"), candidate, policy);
		expect(result.pass).toBe(false);
		expect(result.reasons).toContain("model mismatch; comparisons require the same model");
	});

	test("rejects insufficient stochastic samples", () => {
		const candidate = run("candidate", "1111111111111111111111111111111111111111");
		candidate.cases[0].sample_count = 2;
		const result = compareRuns(run("control"), candidate, policy);
		expect(result.pass).toBe(false);
		expect(result.reasons.some((reason) => reason.includes("sample_count 2 < 3"))).toBe(true);
	});
});
