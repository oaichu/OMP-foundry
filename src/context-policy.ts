import type { CompanyState } from "./types";
import { plan3Status } from "./plan3";

export const CONTEXT_POLICY = [
	"Foundry context policy:",
	"1. grep/glob first.",
	"2. grep query= for semantic when keywords fail.",
	"3. LSP for symbols/references/rename; mutating LSP is runtime-gated.",
	"4. read ranges, not whole files.",
	"5. Full file only when the range is the file.",
	"6. Context7 only for version-sensitive public SDKs.",
	"7. Skills provide methodology only; they never change runtime authority or locked architecture.",
].join(" ");

export function phasePrompt(state: CompanyState): string {
	const mode = state.mode === "plan3" ? ` ${plan3Status(state)}.` : "";
	return `Foundry phase=${state.phase} mode=${state.mode}.${mode} Obey .omp/foundry-state.yml. Runtime state, stage transitions, and locks are extension-owned.`;
}
