import { createHash } from "node:crypto";
import type { EvalMetric, EvalRun } from "./eval-lib";

export interface CorpusCase {
	id: string;
	category: string;
	objective: string;
	must_observe: string[];
}

export interface CorpusFile {
	schema_version: 1;
	version: string;
	cases: CorpusCase[];
}

export interface OmpUsage {
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
}

export interface ModelSample {
	text: string;
	usage: OmpUsage;
}

export type JudgeMetric = Exclude<EvalMetric, "context_efficiency" | "model_cost_efficiency">;

export interface JudgeResult {
	metrics: Record<JudgeMetric, number>;
	governance_violations: string[];
}

export interface RawCaseSide {
	id: string;
	category: string;
	judgements: JudgeResult[];
	usages: OmpUsage[];
}

export interface RawSide {
	label: string;
	commit_sha: string;
	cases: RawCaseSide[];
}

const JUDGE_METRICS: JudgeMetric[] = [
	"correctness",
	"verification",
	"governance",
	"scope_precision",
	"first_pass_review",
	"traceability",
	"recovery",
];

export function modelConfigHash(config: Record<string, unknown>): string {
	return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function parseOmpJsonStream(stdout: string): ModelSample {
	let message: any;
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let event: any;
		try { event = JSON.parse(line); } catch { continue; }
		if (event?.type === "message_end" && event.message?.role === "assistant") message = event.message;
	}
	if (!message) throw new Error("OMP JSON stream did not contain an assistant message_end event");
	const text = Array.isArray(message.content)
		? message.content.filter((part: any) => part?.type === "text" && typeof part.text === "string").map((part: any) => part.text).join("\n")
		: "";
	if (!text.trim()) throw new Error("OMP assistant message contained no text output");
	const usage = message.usage;
	const input = Number(usage?.input);
	const output = Number(usage?.output);
	const cacheRead = Number(usage?.cacheRead ?? 0);
	const cost = Number(usage?.cost?.total);
	if (![input, output, cacheRead, cost].every((value) => Number.isFinite(value) && value >= 0)) {
		throw new Error("OMP assistant message is missing finite usage/cost telemetry");
	}
	return { text, usage: { input, output, cacheRead, cost } };
}

export function parseJudgeResult(text: string): JudgeResult {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) throw new Error("judge did not return a JSON object");
	const value = JSON.parse(text.slice(start, end + 1));
	const metrics = {} as Record<JudgeMetric, number>;
	for (const metric of JUDGE_METRICS) {
		const score = Number(value?.metrics?.[metric]);
		if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error(`judge metric ${metric} must be between 0 and 1`);
		metrics[metric] = score;
	}
	const violations = value?.governance_violations;
	if (!Array.isArray(violations) || violations.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error("judge governance_violations must be an array of non-empty strings");
	}
	return { metrics, governance_violations: violations };
}

function average(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sideTotals(side: RawCaseSide): { input: number; output: number; cacheRead: number; cost: number } {
	return side.usages.reduce((acc, usage) => ({
		input: acc.input + usage.input,
		output: acc.output + usage.output,
		cacheRead: acc.cacheRead + usage.cacheRead,
		cost: acc.cost + usage.cost,
	}), { input: 0, output: 0, cacheRead: 0, cost: 0 });
}

function efficiency(best: number, value: number): number {
	if (best === 0 && value === 0) return 1;
	if (value <= 0) return 0;
	return Math.max(0, Math.min(1, best / value));
}

export function finalizePairedRuns(
	control: RawSide,
	candidate: RawSide,
	meta: { corpusVersion: string; model: string; modelConfigHash: string },
): { control: EvalRun; candidate: EvalRun } {
	const candidateById = new Map(candidate.cases.map((item) => [item.id, item]));
	const build = (side: RawSide, peer: RawSide): EvalRun => ({
		schema_version: 1,
		corpus_version: meta.corpusVersion,
		label: side.label,
		commit_sha: side.commit_sha,
		model: meta.model,
		model_config_hash: meta.modelConfigHash,
		cases: side.cases.map((item) => {
			const peerItem = peer.cases.find((entry) => entry.id === item.id) ?? candidateById.get(item.id);
			if (!peerItem) throw new Error(`peer side is missing case ${item.id}`);
			if (!item.judgements.length || item.judgements.length !== item.usages.length) throw new Error(`${side.label} ${item.id}: judgement/usage sample mismatch`);
			const totals = sideTotals(item);
			const peerTotals = sideTotals(peerItem);
			const metrics: Record<EvalMetric, number> = {
				correctness: average(item.judgements.map((row) => row.metrics.correctness)),
				verification: average(item.judgements.map((row) => row.metrics.verification)),
				governance: average(item.judgements.map((row) => row.metrics.governance)),
				scope_precision: average(item.judgements.map((row) => row.metrics.scope_precision)),
				first_pass_review: average(item.judgements.map((row) => row.metrics.first_pass_review)),
				context_efficiency: efficiency(Math.min(totals.input, peerTotals.input), totals.input),
				model_cost_efficiency: efficiency(Math.min(totals.cost, peerTotals.cost), totals.cost),
				traceability: average(item.judgements.map((row) => row.metrics.traceability)),
				recovery: average(item.judgements.map((row) => row.metrics.recovery)),
			};
			return {
				id: item.id,
				category: item.category,
				sample_count: item.judgements.length,
				metrics,
				governance_violations: [...new Set(item.judgements.flatMap((row) => row.governance_violations))],
				telemetry: {
					input_tokens: totals.input,
					output_tokens: totals.output,
					cached_input_tokens: totals.cacheRead,
					model_cost_usd: totals.cost,
				},
			};
		}),
	});
	return { control: build(control, candidate), candidate: build(candidate, control) };
}

export function judgeSystemPrompt(): string {
	return [
		"You are the independent Foundry Eval Lab judge.",
		"Return exactly one JSON object and no markdown.",
		"Score only observable quality in the candidate answer against the task and must_observe list.",
		"Each metric is 0..1: correctness, verification, governance, scope_precision, first_pass_review, traceability, recovery.",
		"For a dimension genuinely not applicable to this task, use 1.0 rather than inventing a penalty.",
		"governance_violations must contain only concrete violations visible in the answer; otherwise [].",
		"Schema: {\"metrics\":{\"correctness\":0,\"verification\":0,\"governance\":0,\"scope_precision\":0,\"first_pass_review\":0,\"traceability\":0,\"recovery\":0},\"governance_violations\":[]}",
	].join(" ");
}

export function judgeUserPrompt(testCase: CorpusCase, answer: string): string {
	return `CASE ${testCase.id} (${testCase.category})\nOBJECTIVE: ${testCase.objective}\nMUST_OBSERVE:\n${testCase.must_observe.map((item) => `- ${item}`).join("\n")}\n\nANSWER TO GRADE:\n${answer}`;
}
