import type { CompanyState } from "./types";
import { planStatus } from "./plan";

export const CONTEXT_POLICY = [
	"Superpowers Policy (Three Elements):",
	"1. Context: grep/glob first; read bounded line ranges (max 200 lines).",
	"2. Constraint: working_set <= 5 files, patch <= 80 lines diff, zero-regression, no new dependencies.",
	"3. Criteria: explicit verification commands (typecheck, lint, test).",
	"4. Low-Cost Model Execution: zero hallucination, strict boundary adherence, no unauthorized refactoring.",
	"5. Natural UX: user may approve with natural responses ('ok', 'yes', 'approve', 'proceed').",
].join(" ");

export function phasePrompt(state: CompanyState): string {
	const mode = state.mode === "plan" ? ` ${planStatus(state)}.` : "";
	return `Foundry phase=${state.phase} mode=${state.mode}.${mode} Obey .omp/foundry-state.yml. Runtime state, stage transitions, and locks are extension-owned.`;
}
