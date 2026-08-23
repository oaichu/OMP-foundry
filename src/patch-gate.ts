import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { gitCall } from "./git-runtime";
import { canonicalRepoPath, underPrefix } from "./paths";
import { pathAllowed } from "./permissions";
import { LOCKED_AATP_PATHS, LOCKED_DESIGN_PATHS, LOCKED_PLAN_PATHS, LOCKED_PRODUCT_PATHS, STATE_PATHS, type AatpTicket } from "./types";

export const IMPLEMENTER_AGENTS = new Set(["implementer", "hard-implementer", "smol-implementer"]);
export const REVIEW_AGENTS = new Set(["reviewer", "security-reviewer"]);
export interface TaskItem { index: number; agent: string; task: string; isolated?: boolean; }
export interface TaskBinding extends TaskItem { ticketId: string; kind: "implementation" | "review"; }
export interface TaskResultLike { index?: number; id?: string; agent?: string; task?: string; output?: string; patchPath?: string; exitCode?: number; error?: string; aborted?: boolean; }

type AppliedPatch = { text: string; paths: string[]; expectedHashes: Record<string, string | null> };
const LAST_APPLIED_PATCH = new Map<string, AppliedPatch>();
const gitIdentity = { GIT_AUTHOR_NAME: "OMP Foundry", GIT_AUTHOR_EMAIL: "omp-foundry@local", GIT_COMMITTER_NAME: "OMP Foundry", GIT_COMMITTER_EMAIL: "omp-foundry@local" };
const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_PATCH_PATHS = 256;

export function parsePatchPaths(text: string): string[] {
	if (Buffer.byteLength(text, "utf8") > MAX_PATCH_BYTES) return [];
	const out = new Set<string>();
	for (const match of text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) { if (match[1] && match[1] !== "/dev/null") out.add(match[1]); if (match[2] && match[2] !== "/dev/null") out.add(match[2]); }
	for (const match of text.matchAll(/^(?:---|\+\+\+) [ab]\/(.+)$/gm)) if (match[1] && match[1] !== "/dev/null") out.add(match[1]);
	for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) if (match[1]) out.add(match[1].trim());
	return out.size > MAX_PATCH_PATHS ? [] : [...out];
}
export function gitChangedPaths(cwd: string): string[] {
	const result = gitCall(cwd, ["status", "--porcelain", "-uall"], { encoding: "utf8", maxBuffer: 512 * 1024 });
	if (result.status !== 0) return ["<git-status-failed>"];
	const out: string[] = [];
	for (const line of result.stdout.split("\n")) {
		if (line.length < 4) continue;
		const rest = line.slice(3).replace(/^"|"$/g, "");
		const rel = (rest.split(" -> ").pop() ?? rest).trim().replace(/\\/g, "/");
		if (rel) {
			out.push(rel);
			if (out.length > 1024) return ["<git-status-too-many-paths>"];
		}
	}
	return out;
}
export function prepareImplementationBaseline(cwd: string): { ok: boolean; reason?: string; committed?: boolean } {
	const dirty = gitChangedPaths(cwd);
	if (dirty.length === 0) return { ok: true, committed: false };
	const safe = dirty.every((rel) => {
		const lower = rel.toLowerCase();
		return /^(?:docs\/(?:product|master_plan|design|security|architecture|aatp|release_report)\.md|docs\/planning\/(?:master_plan_draft|plan_review)\.md|docs\/aatp\/(?:aatp-[^/]+|index)\.md|docs\/reports\/(?:qa|review-[^/]+)\.md|\.gitignore|\.omp\/config\.ya?ml)$/.test(lower);
	});
	if (!safe) return { ok: false, reason: `WORKTREE_GATE: commit or stash non-governance changes before /build: ${dirty.join(", ")}` };
	let result = gitCall(cwd, ["diff", "--cached", "--quiet"], { encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: "WORKTREE_GATE: the git index contains pre-staged changes; unstage them before Foundry creates its baseline." };
	result = gitCall(cwd, ["add", "--", ...dirty], { encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `BASELINE_COMMIT_FAILED: ${result.stderr.trim()}` };
	result = gitCall(cwd, ["commit", "-m", "foundry: lock approved implementation baseline"], { encoding: "utf8", env: { ...gitIdentity } });
	if (result.status !== 0) return { ok: false, reason: `BASELINE_COMMIT_FAILED: ${result.stderr.trim() || result.stdout.trim()}` };
	return { ok: true, committed: true };
}
export function ticketIdsFromText(text: string): string[] { return [...new Set((text.match(/\bAATP-[A-Za-z0-9_-]+/gi) ?? []).map((id) => id.toUpperCase()))]; }
export function taskItems(input: Record<string, unknown>): TaskItem[] {
	if (Array.isArray(input.tasks)) return input.tasks.flatMap((raw, index) => { if (!raw || typeof raw !== "object") return []; const item = raw as Record<string, unknown>; return [{ index, agent: String(item.agent ?? "").trim().toLowerCase(), task: String(item.task ?? "").trim(), isolated: item.isolated === true }]; });
	if (typeof input.agent === "string" || typeof input.task === "string") return [{ index: 0, agent: String(input.agent ?? "").trim().toLowerCase(), task: String(input.task ?? "").trim(), isolated: input.isolated === true }];
	return [];
}
export function taskBindings(input: Record<string, unknown>): { bindings: TaskBinding[]; errors: string[] } {
	const bindings: TaskBinding[] = [], errors: string[] = [], seen = new Set<string>();
	for (const item of taskItems(input)) {
		const isImpl = IMPLEMENTER_AGENTS.has(item.agent), isReview = REVIEW_AGENTS.has(item.agent);
		if (!isImpl && !isReview) continue;
		const ids = ticketIdsFromText(item.task);
		if (ids.length !== 1) { errors.push(`task[${item.index}] ${item.agent} must name exactly one AATP id; found ${ids.length}`); continue; }
		const key = `${isImpl ? "impl" : "review"}:${ids[0]}`;
		if (seen.has(key)) { errors.push(`duplicate governed assignment for ${ids[0]}`); continue; }
		seen.add(key); bindings.push({ ...item, ticketId: ids[0], kind: isImpl ? "implementation" : "review" });
	}
	return { bindings, errors };
}
export function governedTask(input: Record<string, unknown>): boolean { return taskItems(input).some((item) => IMPLEMENTER_AGENTS.has(item.agent) || REVIEW_AGENTS.has(item.agent)); }
const ALWAYS_LOCKED = [
	...LOCKED_PLAN_PATHS,
	...LOCKED_PRODUCT_PATHS,
	...LOCKED_DESIGN_PATHS,
	...LOCKED_AATP_PATHS,
	...STATE_PATHS,
	".omp/config.yml",
	".omp/config.yaml",
	"docs/.foundry-governed",
	"docs/reports/qa.md",
	"docs/reports/review-",
];
export function validatePatchPaths(cwd: string, rawPaths: string[], ticket: AatpTicket, kind: "implementation" | "review"): { escaped: string[]; rejected: string[]; kept: string[] } {
	const escaped: string[] = [], rejected: string[] = [], kept: string[] = [];
	for (const path of [...new Set(rawPaths)]) {
		const rel = canonicalRepoPath(cwd, path);
		if (rel === null) { escaped.push(path); continue; }
		if (kind === "review") {
			const expected = `docs/reports/review-${ticket.id.toLowerCase()}`;
			const comparable = rel.toLowerCase();
			if (comparable === `${expected}.md` || comparable === `${expected}-sec.md`) kept.push(path); else rejected.push(path);
			continue;
		}
		const locked = ALWAYS_LOCKED.some((n) => {
			if (n === "docs/reports/review-") return /^docs\/reports\/review-[^/]+(?:-sec)?\.md$/i.test(rel);
			return underPrefix(rel.toLowerCase(), n.toLowerCase());
		});
		if (locked || !pathAllowed(rel, ticket)) rejected.push(path); else kept.push(path);
	}
	return { escaped, rejected, kept };
}
function regularPatchFile(path: string | undefined): path is string {
	if (!path || /[\u0000-\u001f\u007f]/.test(path)) return false;
	try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}
export function readPatchArtifact(path: string | undefined): string {
	if (!regularPatchFile(path)) return "";
	try {
		const stat = lstatSync(path);
		if (stat.size > MAX_PATCH_BYTES) return "";
		const text = readFileSync(path, "utf8");
		return Buffer.byteLength(text, "utf8") <= MAX_PATCH_BYTES ? text : "";
	} catch { return ""; }
}
export function validatePatchArtifact(cwd: string, patchPath: string | undefined, ticket: AatpTicket, kind: "implementation" | "review"): { ok: true; patch: string; paths: string[] } | { ok: false; reason: string; paths: string[] } {
	const patch = readPatchArtifact(patchPath);
	if (!patch.trim()) return { ok: false, reason: `PATCH_GATE: ${kind} produced no patch artifact or it exceeds ${MAX_PATCH_BYTES} bytes`, paths: [] };
	const paths = parsePatchPaths(patch);
	if (paths.length === 0) return { ok: false, reason: `PATCH_GATE: unable to extract paths from ${basename(patchPath ?? "patch")}`, paths: [] };
	const checked = validatePatchPaths(cwd, paths, ticket, kind);
	if (checked.escaped.length) return { ok: false, reason: `PATH_GATE: escaped patch paths: ${checked.escaped.join(", ")}`, paths };
	if (checked.rejected.length) return { ok: false, reason: `AATP_SCOPE: patch rejected: ${checked.rejected.join(", ")}`, paths };
	return { ok: true, patch, paths };
}
function fileHash(path: string): string | null | undefined {
	try {
		const stat = lstatSync(path);
		if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
	}
}
function reversePatch(cwd: string, patchText: string, patchPaths: string[]): boolean {
	gitCall(cwd, ["reset", "--", ...patchPaths], { encoding: "utf8" });
	const reversed = gitCall(cwd, ["apply", "-R", "--whitespace=nowarn"], { input: patchText, encoding: "utf8" });
	return reversed.status === 0;
}
function sameCanonicalPaths(cwd: string, left: string[], right: string[]): boolean {
	const canon = (paths: string[]) => new Set(paths.map((path) => canonicalRepoPath(cwd, path)).filter((path): path is string => path !== null));
	const a = canon(left), b = canon(right);
	return a.size === b.size && [...a].every((path) => b.has(path));
}
export function applyPatchArtifact(cwd: string, patchPath: string | undefined, expectedPatch?: string, expectedPaths?: string[]): { ok: boolean; reason?: string } {
	const patchText = expectedPatch ?? readPatchArtifact(patchPath);
	if (!patchPath || !regularPatchFile(patchPath) || !patchText.trim()) return { ok: false, reason: "PATCH_GATE: patch artifact is missing, unreadable, or a symlink." };
	if (Buffer.byteLength(patchText, "utf8") > MAX_PATCH_BYTES) return { ok: false, reason: `PATCH_RESOURCE_GATE: patch exceeds ${MAX_PATCH_BYTES} bytes.` };
	if (expectedPatch !== undefined && readPatchArtifact(patchPath) !== expectedPatch) return { ok: false, reason: "PATCH_GATE: patch artifact changed after validation; refusing a TOCTOU replacement." };
	const patchPaths = parsePatchPaths(patchText);
	if (patchPaths.length === 0) return { ok: false, reason: "PATCH_GATE: patch artifact contains no file paths." };
	if (expectedPaths && !sameCanonicalPaths(cwd, patchPaths, expectedPaths)) return { ok: false, reason: "PATCH_GATE: patch paths changed after validation." };
	const check = gitCall(cwd, ["apply", "--check", "--whitespace=nowarn"], { input: patchText, encoding: "utf8" });
	if (check.status !== 0) return { ok: false, reason: `PATCH_APPLY_FAILED: ${check.stderr.trim() || check.stdout.trim()}` };
	const result = gitCall(cwd, ["apply", "--whitespace=nowarn"], { input: patchText, encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `PATCH_APPLY_FAILED: ${result.stderr.trim() || result.stdout.trim()}` };
	const patchCanonical = canonicalRepoPath(cwd, relative(cwd, patchPath));
	const changed = gitChangedPaths(cwd).filter((path) => !path.startsWith("<") && canonicalRepoPath(cwd, path) !== patchCanonical);
	const expected = new Set(patchPaths.map((path) => canonicalRepoPath(cwd, path)).filter((path): path is string => path !== null));
	const unexpected = changed.filter((path) => {
		const canonical = canonicalRepoPath(cwd, path);
		return canonical !== null && !expected.has(canonical);
	});
	if (unexpected.length) {
		reversePatch(cwd, patchText, patchPaths);
		return { ok: false, reason: `PATCH_GATE: applying the patch changed unexpected paths: ${unexpected.join(", ")}` };
	}
	for (const path of patchPaths) {
		const canonical = canonicalRepoPath(cwd, path);
		if (!canonical) return { ok: false, reason: `PATH_GATE: escaped patch path after apply: ${path}` };
		const absolute = join(cwd, path);
		try {
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
				reversePatch(cwd, patchText, patchPaths);
				return { ok: false, reason: `PATCH_GATE: symlink or special file created at ${path}` };
			}
		} catch {
			// Deleted paths have no leaf to inspect; git's mode summary check below
			// still rejects symlink/gitlink additions.
		}
	}
	const summary = gitCall(cwd, ["diff", "--summary", "--", ...patchPaths], { encoding: "utf8" });
	if (summary.status === 0 && /(?:mode change|create mode) (?:120000|160000)|Submodule/i.test(summary.stdout)) {
		reversePatch(cwd, patchText, patchPaths);
		return { ok: false, reason: "PATCH_GATE: symlink/gitlink mode changes are not allowed in a governed patch." };
	}
	const diff = gitCall(cwd, ["diff", "--quiet", "--", ...patchPaths], { encoding: "utf8" });
	if (diff.status === 0) {
		reversePatch(cwd, patchText, patchPaths);
		return { ok: false, reason: "PATCH_GATE: patch produced no repository delta." };
	}
	const expectedHashes: Record<string, string | null> = {};
	for (const path of patchPaths) {
		const canonical = canonicalRepoPath(cwd, path);
		const absolute = canonical ? join(cwd, path) : "";
		const hash = absolute ? fileHash(absolute) : undefined;
		if (!canonical || hash === undefined) {
			reversePatch(cwd, patchText, patchPaths);
			return { ok: false, reason: `PATCH_GATE: unable to snapshot patched file ${path}.` };
		}
		expectedHashes[canonical] = hash;
	}
	LAST_APPLIED_PATCH.set(cwd, { text: patchText, paths: patchPaths, expectedHashes });
	return { ok: true };
}
export function commitAppliedPatch(cwd: string, ticketId: string, kind: "implementation" | "review", paths?: string[]): { ok: boolean; reason?: string } {
	let result = gitCall(cwd, ["diff", "--cached", "--quiet"], { encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: "PATCH_GATE: git index contains unrelated staged changes." };
	const applied = LAST_APPLIED_PATCH.get(cwd);
	if (!applied) return { ok: false, reason: "PATCH_GATE: no validated patch is pending for this repository." };
	const candidatePaths = paths?.length ? paths : applied?.paths ?? [];
	const safePaths = [...new Set(candidatePaths.map((path) => path.replace(/\\/g, "/").replace(/^\.\//, "")))];
	if (safePaths.length === 0) return { ok: false, reason: "PATCH_GATE: no validated paths available for commit." };
	if (!sameCanonicalPaths(cwd, safePaths, applied.paths)) return { ok: false, reason: "PATCH_GATE: commit paths differ from the validated patch." };
	for (const path of safePaths) {
		const canonical = canonicalRepoPath(cwd, path);
		if (!canonical || !(canonical in applied.expectedHashes)) return { ok: false, reason: `PATCH_GATE: path ${path} was not part of the validated patch.` };
		const current = fileHash(join(cwd, path));
		if (current === undefined || current !== applied.expectedHashes[canonical]) return { ok: false, reason: `PATCH_GATE: patched file changed before commit: ${path}` };
	}
	result = gitCall(cwd, ["add", "--", ...safePaths], { encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `git add failed: ${result.stderr.trim()}` };
	const staged = gitCall(cwd, ["diff", "--cached", "--name-only"], { encoding: "utf8" });
	const allowed = new Set(safePaths.map((path) => canonicalRepoPath(cwd, path)).filter((path): path is string => path !== null));
	const extras = staged.status === 0 ? staged.stdout.split(/\r?\n/).map((path) => path.trim()).filter(Boolean).filter((path) => !allowed.has(canonicalRepoPath(cwd, path) ?? "")) : ["<git-index-read-failed>"];
	if (extras.length) return { ok: false, reason: `PATCH_GATE: staged diff contains unvalidated paths: ${extras.join(", ")}` };
	for (const path of safePaths) {
		const canonical = canonicalRepoPath(cwd, path);
		const expected = canonical ? applied.expectedHashes[canonical] : undefined;
		const stagedBlob = gitCall<Buffer>(cwd, ["show", `:${path}`], { encoding: "buffer" });
		const actual = stagedBlob.status === 0 ? createHash("sha256").update(stagedBlob.stdout).digest("hex") : null;
		if (actual !== expected) {
			gitCall(cwd, ["reset", "--", ...safePaths], { encoding: "utf8" });
			return { ok: false, reason: `PATCH_GATE: staged content differs from the validated patch: ${path}` };
		}
	}
	result = gitCall(cwd, ["diff", "--cached", "--quiet"], { encoding: "utf8" });
	if (result.status === 0) { LAST_APPLIED_PATCH.delete(cwd); return { ok: true }; }
	const message = kind === "review" ? `foundry: review ${ticketId}` : `foundry: complete ${ticketId}`;
	result = gitCall(cwd, ["commit", "-m", message], { encoding: "utf8", env: { ...gitIdentity } });
	if (result.status === 0) { LAST_APPLIED_PATCH.delete(cwd); return { ok: true }; }
	return { ok: false, reason: `git commit failed: ${result.stderr.trim() || result.stdout.trim()}` };
}
/** Reverse only the last Foundry-applied patch. Never reset/clean unrelated parent work. */
export function restoreCleanHead(cwd: string): void {
	const applied = LAST_APPLIED_PATCH.get(cwd);
	if (!applied) return;
	const { text, paths } = applied;
	if (paths.length === 0) return;
	// Never reverse over a user or concurrent process edit.  The post-apply
	// hashes are the only safe proof that the bytes still belong to Foundry.
	for (const path of paths) {
		const canonical = canonicalRepoPath(cwd, path);
		if (!canonical || fileHash(join(cwd, path)) !== applied.expectedHashes[canonical]) {
			LAST_APPLIED_PATCH.delete(cwd);
			return;
		}
	}
	gitCall(cwd, ["reset", "--", ...paths], { encoding: "utf8" });
	const reversed = gitCall(cwd, ["apply", "-R", "--whitespace=nowarn"], { input: text, encoding: "utf8" });
	if (reversed.status === 0) LAST_APPLIED_PATCH.delete(cwd);
}
export function hashEvidence(...parts: Array<string | undefined>): string { const hash = createHash("sha256"); for (const part of parts) { hash.update(part ?? ""); hash.update("\0"); } return hash.digest("hex"); }
export function extractTaskResults(details: unknown): TaskResultLike[] {
	if (!details || typeof details !== "object") return [];
	const raw = (details as { results?: unknown }).results;
	if (!Array.isArray(raw)) return [];
	return raw.slice(0, 64).flatMap((value) => {
		if (!value || typeof value !== "object") return [];
		const item = value as Record<string, unknown>, out: TaskResultLike = {};
		if (Number.isSafeInteger(item.index)) out.index = item.index as number;
		for (const key of ["id", "agent", "task", "patchPath", "error"] as const) if (typeof item[key] === "string" && (item[key] as string).length <= 4096) out[key] = item[key] as string;
		if (typeof item.output === "string") out.output = item.output.slice(0, 128 * 1024);
		if (Number.isSafeInteger(item.exitCode)) out.exitCode = item.exitCode as number;
		if (typeof item.aborted === "boolean") out.aborted = item.aborted;
		return [out];
	});
}
export function parseReviewVerdict(output: string, ticketId: string): "APPROVE" | "REQUEST_CHANGES" | "BLOCK" | undefined {
	const escaped = ticketId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = output.match(new RegExp(`FOUNDRY_REVIEW\\s+${escaped}\\s+(APPROVE|REQUEST_CHANGES|BLOCK)`, "i"));
	return match?.[1]?.toUpperCase() as "APPROVE" | "REQUEST_CHANGES" | "BLOCK" | undefined;
}
export function parseConflict(output: string): { kind: string; reason: string } | undefined {
	const match = output.match(/FOUNDRY_CONFLICT\s+(PLAN_CONFLICT|DESIGN_CONFLICT|DEPENDENCY_CONFLICT|SCOPE_INSUFFICIENT)\s+(.+)/i);
	return match ? { kind: match[1].toUpperCase(), reason: match[2].trim() } : undefined;
}
