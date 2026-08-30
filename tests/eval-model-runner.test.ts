import { describe, expect, test } from "bun:test";
import { finalizePairedRuns, modelConfigHash, parseJudgeResult, parseOmpJsonStream, type RawSide } from "../scripts/eval-model-lib";

const judgement = {
	metrics: { correctness: 0.9, verification: 0.8, governance: 1, scope_precision: 0.9, first_pass_review: 0.8, traceability: 0.9, recovery: 1 },
	governance_violations: [],
};

function side(label: string, sha: string, input: number, cost: number): RawSide {
	return { label, commit_sha: sha, cases: [{ id: "CASE-1", category: "planning", judgements: [judgement, judgement, judgement], usages: [
		{ input, output: 100, cacheRead: 10, cost }, { input, output: 100, cacheRead: 10, cost }, { input, output: 100, cacheRead: 10, cost },
	] }] };
}

describe("model eval runner", () => {
	test("parses final OMP assistant message and usage", () => {
		const sample = parseOmpJsonStream([
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "answer" }], usage: { input: 120, output: 30, cacheRead: 20, cost: { total: 0.02 } } } }),
		].join("\n"));
		expect(sample.text).toBe("answer");
		expect(sample.usage).toEqual({ input: 120, output: 30, cacheRead: 20, cost: 0.02 });
	});

	test("judge parser rejects missing metrics", () => {
		expect(() => parseJudgeResult('{"metrics":{"correctness":1},"governance_violations":[]}')).toThrow();
	});

	test("paired telemetry makes lower-input/lower-cost candidate more efficient", () => {
		const control = side("control", "54c898163024c3e017d914c30fd9490bee27f7b3", 1000, 0.02);
		const candidate = side("candidate", "1111111111111111111111111111111111111111", 700, 0.01);
		const runs = finalizePairedRuns(control, candidate, { corpusVersion: "v1", model: "same", modelConfigHash: "cfg" });
		expect(runs.candidate.cases[0].metrics.context_efficiency).toBe(1);
		expect(runs.candidate.cases[0].metrics.model_cost_efficiency).toBe(1);
		expect(runs.control.cases[0].metrics.context_efficiency).toBeCloseTo(0.7, 8);
		expect(runs.control.cases[0].metrics.model_cost_efficiency).toBeCloseTo(0.5, 8);
	});

	test("model config hash is deterministic", () => {
		expect(modelConfigHash({ model: "x", thinking: "high" })).toBe(modelConfigHash({ model: "x", thinking: "high" }));
	});
});
