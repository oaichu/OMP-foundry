import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";

/**
 * Keep repository operations anchored to the supplied cwd. Ambient Git
 * redirectors (GIT_DIR, alternate object stores, external diff/editor hooks)
 * are not part of Foundry's authority boundary and are stripped.
 */
const stripped = [
	"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR", "GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL",
	"GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_EXTERNAL_DIFF", "GIT_DIFF_OPTS", "GIT_PAGER",
	"GIT_EDITOR", "GIT_SEQUENCE_EDITOR", "GIT_CEILING_DIRECTORIES",
];
const noHooks = join(tmpdir(), `omp-foundry-hooks-${process.pid}`);
const SAFE_GIT_OVERRIDES = new Set(["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]);
export const FOUNDRY_GIT_ENV: NodeJS.ProcessEnv = (() => {
	const env = { ...process.env };
	for (const key of stripped) delete env[key];
	for (const key of Object.keys(env)) if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key) || key === "GIT_CONFIG_PARAMETERS") delete env[key];
	env.GIT_CONFIG_NOSYSTEM = "1";
	env.GIT_TERMINAL_PROMPT = "0";
	// Inject a non-existent hooks path without trusting repository config.
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = "core.hooksPath";
	env.GIT_CONFIG_VALUE_0 = noHooks;
	env.GIT_PAGER = "cat";
	return Object.freeze(env) as NodeJS.ProcessEnv;
})();

function gitEnv(overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
	const env = { ...FOUNDRY_GIT_ENV };
	// Only the fixed commit identity is caller-controlled.  Never allow an
	// extension call (or a future caller) to reintroduce Git redirectors,
	// config includes, hooks, editors, or alternate object stores.
	for (const key of SAFE_GIT_OVERRIDES) {
		if (overrides?.[key] !== undefined) env[key] = overrides[key];
	}
	return env;
}

export function gitCall<T extends string | Buffer = string>(cwd: string, args: string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<T> {
	return spawnSync("git", args, { ...options, cwd, shell: false, maxBuffer: options.maxBuffer ?? 2 * 1024 * 1024, env: gitEnv(options.env) }) as SpawnSyncReturns<T>;
}
