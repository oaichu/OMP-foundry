import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareRuns, type EvalPolicy } from "./eval-lib";
import {
	finalizePairedRuns,
	judgeSystemPrompt,
	judgeUserPrompt,
	modelConfigHash,
	parseJudgeResult,
	parseOmpJsonStream,
	type CorpusCase,
	type CorpusFile,
	type RawCaseSide,
	type RawSide,
} from "./eval-model-lib";

const CASE_SKILLS: Record<string, { phase: string; ids: string[] }> = {
	planning: { phase: "planning", ids: ["master-plan-method", "architecture", "security", "verification"] },
	design: { phase: "design", ids: ["design-foundation", "design-intelligence", "design-system-contract", "design-quality"] },
	routing: { phase: "implementation", ids: ["security", "postgres-engineering", "data-engineering", "verification"] },
	aatp: { phase: "planning", ids: ["architecture", "verification", "testing", "security"] },
	implementation: { phase: "implementation", ids: ["typescript-engineering", "testing", "verification", "security"] },
	review: { phase: "review", ids: ["code-review", "security", "verification", "testing"] },
	security: { phase: "review", ids: ["security-review", "security", "verification", "architecture"] },
	recovery: { phase: "review", ids: ["debugging", "verification", "architecture", "testing"] },
};

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
	const value = arg(name);
	if (!value?.trim()) throw new Error(`Missing required ${name}`);
	return value;
}

async function command(argv: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (exitCode !== 0) throw new Error(`${argv[0]} failed (${exitCode}) in ${cwd}: ${stderr.trim() || stdout.trim()}`);
	return stdout;
}

async function git(args: string[], cwd: string): Promise<string> {
	return (await command(["git", ...args], cwd)).trim();
}

async function prepareWorktree(repo: string, root: string, name: string, ref: string): Promise<{ dir: string; sha: string }> {
	const dir = join(root, name);
	await git(["worktree", "add", "--detach", dir, ref], repo);
	await command(["bun", "install", "--frozen-lockfile"], dir);
	return { dir, sha: await git(["rev-parse", "HEAD"], dir) };
}

async function removeWorktree(repo: string, dir: string): Promise<void> {
	try { await git(["worktree", "remove", "--force", dir], repo); } catch { /* temp cleanup below is still safe */ }
}

async function promptForRevision(subjectDir: string, testCase: CorpusCase): Promise<string> {
	const selection = CASE_SKILLS[testCase.category];
	if (!selection) throw new Error(`No skill mapping for corpus category ${testCase.category}`);
	const registryModule = await import(`${pathToFileURL(join(subjectDir, "src", "skills", "registry.ts")).href}?eval=${Date.now()}-${Math.random()}`) as { loadRegistry(path: string): any[] };
	const resolverModule = await import(`${pathToFileURL(join(subjectDir, "src", "skills", "resolver.ts")).href}?eval=${Date.now()}-${Math.random()}`) as { skillPackPrompt(skills: any[], phase: string): string };
	const registry = registryModule.loadRegistry(join(subjectDir, "skills"));
	const byId = new Map(registry.map((item: any) => [item.id, item]));
	const skills = selection.ids.map((id) => byId.get(id)).filter(Boolean);
	if (!skills.length) throw new Error(`${testCase.id}: revision ${basename(subjectDir)} has none of the mapped skills`);
	return resolverModule.skillPackPrompt(skills, selection.phase);
}

async function invokeOmp(
	omp: string,
	model: string,
	thinking: string,
	systemPrompt: string,
	prompt: string,
	cwd: string,
	mode: "json" | "text",
): Promise<string> {
	const argv = [omp, "-p", "--mode", mode, "--no-session", "--no-tools", "--no-lsp", "--no-extensions", "--no-skills", "--no-rules", "--model", model, "--thinking", thinking, "--system-prompt", systemPrompt, "--max-time", "10m", prompt];
	return command(argv, cwd);
}

async function runSide(
	label: string,
	commitSha: string,
	subjectDir: string,
	corpus: CorpusFile,
	samples: number,
	omp: string,
	model: string,
	thinking: string,
	judgeModel: string,
	judgeThinking: string,
): Promise<RawSide> {
	const cases: RawCaseSide[] = [];
	for (const testCase of corpus.cases) {
		const systemPrompt = await promptForRevision(subjectDir, testCase);
		const row: RawCaseSide = { id: testCase.id, category: testCase.category, judgements: [], usages: [] };
		for (let sample = 0; sample < samples; sample += 1) {
			process.stderr.write(`[${label}] ${testCase.id} sample ${sample + 1}/${samples}\n`);
			const subjectPrompt = [
				`You are being evaluated on one Foundry task. Solve it directly and self-containedly.`,
				`Objective: ${testCase.objective}`,
				`Required observable concerns: ${testCase.must_observe.join("; ")}`,
			].join("\n");
			const subject = parseOmpJsonStream(await invokeOmp(omp, model, thinking, systemPrompt, subjectPrompt, subjectDir, "json"));
			const judgeText = await invokeOmp(omp, judgeModel, judgeThinking, judgeSystemPrompt(), judgeUserPrompt(testCase, subject.text), subjectDir, "text");
			row.usages.push(subject.usage);
			row.judgements.push(parseJudgeResult(judgeText));
		}
		cases.push(row);
	}
	return { label, commit_sha: commitSha, cases };
}

const repo = resolve(arg("--repo") ?? process.cwd());
const candidateRef = required("--candidate");
const model = required("--model");
const thinking = arg("--thinking") ?? "high";
const judgeModel = arg("--judge-model") ?? model;
const judgeThinking = arg("--judge-thinking") ?? thinking;
const samples = Number(arg("--samples") ?? "3");
const omp = arg("--omp") ?? "omp";
const corpusPath = resolve(repo, arg("--corpus") ?? "evals/corpus/v1.json");
const policyPath = resolve(repo, arg("--policy") ?? "evals/baselines/control-policy.json");
const outDir = resolve(repo, arg("--out-dir") ?? "evals/results");
if (!Number.isInteger(samples) || samples < 3) throw new Error("--samples must be an integer >= 3");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as CorpusFile;
const policy = JSON.parse(readFileSync(policyPath, "utf8")) as EvalPolicy;
const configHash = modelConfigHash({ model, thinking, judgeModel, judgeThinking, ompFlags: ["-p", "--mode", "json", "--no-session", "--no-tools", "--no-lsp", "--no-extensions", "--no-skills", "--no-rules"], samples });
const temp = mkdtempSync(join(tmpdir(), "omp-foundry-eval-"));
let controlDir = "", candidateDir = "";
try {
	const control = await prepareWorktree(repo, temp, "control", policy.control_commit);
	controlDir = control.dir;
	const candidate = await prepareWorktree(repo, temp, "candidate", candidateRef);
	candidateDir = candidate.dir;
	const controlRaw = await runSide("control", control.sha, control.dir, corpus, samples, omp, model, thinking, judgeModel, judgeThinking);
	const candidateRaw = await runSide("candidate", candidate.sha, candidate.dir, corpus, samples, omp, model, thinking, judgeModel, judgeThinking);
	const runs = finalizePairedRuns(controlRaw, candidateRaw, { corpusVersion: corpus.version, model, modelConfigHash: configHash });
	const comparison = compareRuns(runs.control, runs.candidate, policy);
	mkdirSync(outDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	writeFileSync(join(outDir, `${stamp}-control.json`), JSON.stringify(runs.control, null, 2));
	writeFileSync(join(outDir, `${stamp}-candidate.json`), JSON.stringify(runs.candidate, null, 2));
	writeFileSync(join(outDir, `${stamp}-comparison.json`), JSON.stringify(comparison, null, 2));
	console.log(JSON.stringify(comparison, null, 2));
	if (!comparison.pass) process.exitCode = 1;
} finally {
	if (candidateDir) await removeWorktree(repo, candidateDir);
	if (controlDir) await removeWorktree(repo, controlDir);
	rmSync(temp, { recursive: true, force: true });
}
