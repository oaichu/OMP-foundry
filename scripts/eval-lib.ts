export const EVAL_WEIGHTS = {
	correctness: 25,
	verification: 10,
	governance: 20,
	scope_precision: 10,
	first_pass_review: 10,
	context_efficiency: 10,
	model_cost_efficiency: 5,
	traceability: 5,
	recovery: 5,
} as const;

export type EvalMetric = keyof typeof EVAL_WEIGHTS;
export const EVAL_METRICS = Object.keys(EVAL_WEIGHTS) as EvalMetric[];

export interface EvalTelemetry {
	input_tokens?: number;
	output_tokens?: number;
	cached_input_tokens?: number;
	model_cost_usd?: number;
}

export interface EvalCaseResult {
	id: string;
	category: string;
	sample_count: number;
	metrics: Record<EvalMetric, number>;
	governance_violations?: string[];
	telemetry?: EvalTelemetry;
}

export interface EvalRun {
	schema_version: 1;
	corpus_version: string;
	label: string;
	commit_sha: string;
	model: string;
	model_config_hash: string;
	cases: EvalCaseResult[];
}

export interface EvalPolicy {
	schema_version: 1;
	control_commit: string;
	min_sample_count: number;
	min_score_delta: number;
	metric_regression_tolerance: number;
	governance_regression: "forbid";
}

export interface EvalScore {
	weighted_score: number;
	metric_averages: Record<EvalMetric, number>;
	governance_pass: boolean;
	governance_violations: string[];
	telemetry: Required<EvalTelemetry>;
}

export interface EvalComparison {
	pass: boolean;
	reasons: string[];
	control: EvalScore;
	candidate: EvalScore;
	delta: number;
}

function emptyMetrics(): Record<EvalMetric, number> {
	return Object.fromEntries(EVAL_METRICS.map((metric) => [metric, 0])) as Record<EvalMetric, number>;
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateRun(run: EvalRun): string[] {
	const errors: string[] = [];
	if (run.schema_version !== 1) errors.push("schema_version must be 1");
	if (!run.corpus_version.trim()) errors.push("corpus_version missing");
	if (!run.label.trim()) errors.push("label missing");
	if (!/^[a-f0-9]{7,128}$/i.test(run.commit_sha)) errors.push("commit_sha must be a git-like hexadecimal SHA");
	if (!run.model.trim()) errors.push("model missing");
	if (!run.model_config_hash.trim()) errors.push("model_config_hash missing");
	if (!run.cases.length) errors.push("at least one eval case is required");

	const ids = new Set<string>();
	for (const item of run.cases) {
		if (!item.id.trim()) errors.push("case id missing");
		if (ids.has(item.id)) errors.push(`duplicate case id ${item.id}`);
		ids.add(item.id);
		if (!item.category.trim()) errors.push(`${item.id}: category missing`);
		if (!Number.isInteger(item.sample_count) || item.sample_count < 1) errors.push(`${item.id}: sample_count must be a positive integer`);
		for (const metric of EVAL_METRICS) {
			const value = item.metrics?.[metric];
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) errors.push(`${item.id}: ${metric} must be between 0 and 1`);
		}
		for (const violation of item.governance_violations ?? []) if (!violation.trim()) errors.push(`${item.id}: empty governance violation`);
		for (const [key, value] of Object.entries(item.telemetry ?? {})) if (!finiteNonNegative(value)) errors.push(`${item.id}: telemetry ${key} must be finite and non-negative`);
	}
	return errors;
}

export function scoreRun(run: EvalRun): EvalScore {
	const errors = validateRun(run);
	if (errors.length) throw new Error(`Invalid eval run: ${errors.join("; ")}`);
	const metric_averages = emptyMetrics();
	for (const metric of EVAL_METRICS) metric_averages[metric] = run.cases.reduce((sum, item) => sum + item.metrics[metric], 0) / run.cases.length;
	const weighted_score = EVAL_METRICS.reduce((sum, metric) => sum + metric_averages[metric] * EVAL_WEIGHTS[metric], 0);
	const governance_violations = run.cases.flatMap((item) => (item.governance_violations ?? []).map((violation) => `${item.id}: ${violation}`));
	const telemetry = run.cases.reduce<Required<EvalTelemetry>>(
		(acc, item) => ({
			input_tokens: acc.input_tokens + (item.telemetry?.input_tokens ?? 0),
			output_tokens: acc.output_tokens + (item.telemetry?.output_tokens ?? 0),
			cached_input_tokens: acc.cached_input_tokens + (item.telemetry?.cached_input_tokens ?? 0),
			model_cost_usd: acc.model_cost_usd + (item.telemetry?.model_cost_usd ?? 0),
		}),
		{ input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, model_cost_usd: 0 },
	);
	return { weighted_score, metric_averages, governance_pass: governance_violations.length === 0, governance_violations, telemetry };
}

function sortedCaseIds(run: EvalRun): string[] {
	return run.cases.map((item) => item.id).sort();
}

export function compareRuns(controlRun: EvalRun, candidateRun: EvalRun, policy: EvalPolicy): EvalComparison {
	const reasons: string[] = [];
	const controlErrors = validateRun(controlRun);
	const candidateErrors = validateRun(candidateRun);
	if (controlErrors.length) reasons.push(...controlErrors.map((error) => `control: ${error}`));
	if (candidateErrors.length) reasons.push(...candidateErrors.map((error) => `candidate: ${error}`));
	if (controlErrors.length || candidateErrors.length) {
		const empty: EvalScore = { weighted_score: 0, metric_averages: emptyMetrics(), governance_pass: false, governance_violations: [], telemetry: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, model_cost_usd: 0 } };
		return { pass: false, reasons, control: empty, candidate: empty, delta: 0 };
	}

	const control = scoreRun(controlRun);
	const candidate = scoreRun(candidateRun);
	if (policy.schema_version !== 1) reasons.push("policy schema_version must be 1");
	if (controlRun.commit_sha.toLowerCase() !== policy.control_commit.toLowerCase()) reasons.push(`control commit ${controlRun.commit_sha} does not match frozen baseline ${policy.control_commit}`);
	if (controlRun.corpus_version !== candidateRun.corpus_version) reasons.push("corpus_version mismatch");
	if (controlRun.model !== candidateRun.model) reasons.push("model mismatch; comparisons require the same model");
	if (controlRun.model_config_hash !== candidateRun.model_config_hash) reasons.push("model_config_hash mismatch; comparisons require the same model configuration");
	if (sortedCaseIds(controlRun).join("\0") !== sortedCaseIds(candidateRun).join("\0")) reasons.push("case set mismatch");
	for (const [side, run] of [["control", controlRun], ["candidate", candidateRun]] as const) {
		for (const item of run.cases) if (item.sample_count < policy.min_sample_count) reasons.push(`${side} ${item.id}: sample_count ${item.sample_count} < ${policy.min_sample_count}`);
	}
	if (policy.governance_regression === "forbid" && !candidate.governance_pass) reasons.push(`candidate governance violation: ${candidate.governance_violations.join(" | ")}`);
	for (const metric of EVAL_METRICS) {
		if (candidate.metric_averages[metric] + policy.metric_regression_tolerance < control.metric_averages[metric]) reasons.push(`${metric} regressed by ${(control.metric_averages[metric] - candidate.metric_averages[metric]).toFixed(4)}`);
	}
	const delta = candidate.weighted_score - control.weighted_score;
	if (delta + 1e-9 < policy.min_score_delta) reasons.push(`weighted score delta ${delta.toFixed(4)} < required ${policy.min_score_delta.toFixed(4)}`);
	return { pass: reasons.length === 0, reasons, control, candidate, delta };
}
