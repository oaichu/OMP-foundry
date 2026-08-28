import { readFileSync } from "node:fs";
import { compareRuns, type EvalPolicy, type EvalRun } from "./eval-lib";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

const controlPath = argument("--control");
const candidatePath = argument("--candidate");
const policyPath = argument("--policy");
if (!controlPath || !candidatePath || !policyPath) {
	console.error("Usage: bun scripts/eval.ts --control <run.json> --candidate <run.json> --policy <policy.json>");
	process.exit(2);
}

const result = compareRuns(loadJson<EvalRun>(controlPath), loadJson<EvalRun>(candidatePath), loadJson<EvalPolicy>(policyPath));
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
