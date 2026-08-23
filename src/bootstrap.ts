import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ensureProjectFoundryConfig, narrowFoundryGitignore } from "./omp-runtime";
import { detectStack } from "./stack-detector";
import { loadState, saveState, stateFileExists } from "./state-machine";
import { type CompanyState, defaultState } from "./types";

const MARKER = "docs/.foundry-governed";
const TEMPLATES = ["PRODUCT.md", "MASTER_PLAN.md", "DESIGN.md", "SECURITY.md", "ARCHITECTURE.md", "AATP.md", "RELEASE_REPORT.md"] as const;

function copyTemplate(cwd: string, root: string, name: string): void {
	const dest = join(cwd, "docs", name);
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
	mkdirSync(join(cwd, "docs", "planning"), { recursive: true });
	mkdirSync(join(cwd, "docs", "AATP"), { recursive: true });
	mkdirSync(join(cwd, "docs", "reports"), { recursive: true });
	for (const name of TEMPLATES) copyTemplate(cwd, root, name);
	if (!existsSync(join(cwd, MARKER))) writeFileSync(join(cwd, MARKER), "OMP Foundry governed repository.\n", "utf8");

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
