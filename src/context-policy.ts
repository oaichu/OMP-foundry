export const CONTEXT_POLICY = [
	"Company context policy:",
	"1. grep/glob first.",
	"2. grep query= for semantic when keywords fail.",
	"3. LSP for symbols/references/rename.",
	"4. read ranges, not whole files.",
	"5. Full file only when the range is the file.",
	"6. Context7 only for version-sensitive public SDKs.",
	"7. Do not dump skill catalogs or rewrite locked artifacts.",
].join(" ");

export function phasePrompt(phase: string): string {
	return `Company phase=${phase}. Obey .omp/company-state.yml. Workers never edit locked PRODUCT/MASTER_PLAN/DESIGN.`;
}
