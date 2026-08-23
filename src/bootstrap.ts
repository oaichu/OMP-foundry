import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureProjectFoundryConfig, narrowFoundryGitignore } from "./omp-runtime";
import { safeRepoPath } from "./paths";
import { detectStack } from "./stack-detector";
import { loadState, saveState, stateFileExists } from "./state-machine";
import { type CompanyState, defaultState } from "./types";

const MARKER = "docs/.foundry-governed";
const TEMPLATES = ["PRODUCT.md", "MASTER_PLAN.md", "DESIGN.md"] as const;

function copyTemplate(cwd: string, root: string, name: string): void {
	const dest = safeRepoPath(cwd, `docs/${name}`);
	if (!dest) throw new Error(`PATH_GATE: refusing template path docs/${name} through a symlink or outside the repository.`);
	if (existsSync(dest)) return;
	mkdirSync(dirname(dest), { recursive: true });
	const src = join(root, "templates", name);
	if (existsSync(src)) writeFileSync(dest, readFileSync(src, "utf8"), "utf8");
}

export interface BootstrapResult {
	existed: boolean;
	state: CompanyState;
	stackIds: string[];
	ui: boolean;
	configCreated: boolean;
}

/** Opt a repository into Foundry without overwriting global model choices. */
export function bootstrapFoundryProject(cwd: string, root: string): BootstrapResult {
	for (const rel of ["docs/planning", "docs/AATP", "docs/reports"]) {
		const dir = safeRepoPath(cwd, rel);
		if (!dir) throw new Error(`PATH_GATE: refusing bootstrap directory ${rel} through a symlink or outside the repository.`);
		mkdirSync(dir, { recursive: true });
	}
	for (const name of TEMPLATES) copyTemplate(cwd, root, name);
	const marker = safeRepoPath(cwd, MARKER);
	if (!marker) throw new Error(`PATH_GATE: refusing governance marker ${MARKER} through a symlink or outside the repository.`);
	if (!existsSync(marker)) writeFileSync(marker, "OMP Foundry governed repository.\n", "utf8");

	narrowFoundryGitignore(cwd);
	const config = ensureProjectFoundryConfig(cwd);
	const existed = stateFileExists(cwd);
	const state = existed ? loadState(cwd) : defaultState();
	const stack = detectStack(cwd);
	if (!existed) {
		state.design.required = stack.ui;
		state.phase = "discovery";
		saveState(cwd, state);
	}

	return { existed, state, stackIds: stack.ids, ui: stack.ui, configCreated: config.created };
}
