export const CONTEXT_POLICY = [
	"Foundry context policy:",
	"1. grep/glob first.",
	"2. grep query= for semantic when keywords fail.",
	"3. LSP for symbols/references/rename.",
	"4. read ranges, not whole files.",
	"5. Full file only when the range is the file.",
	"6. Context7 only for version-sensitive public SDKs.",
	"7. Skills never change architecture. Conflicts → report_conflict.",
].join(" ");

export function phasePrompt(phase: string): string {
	return `Foundry phase=${phase}. Obey .omp/foundry-state.yml. Workers never edit locked PRODUCT/MASTER_PLAN/DESIGN.`;
}
