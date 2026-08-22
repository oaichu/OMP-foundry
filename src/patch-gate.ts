import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalRepoPath, underPrefix } from "./paths";
import { pathAllowed } from "./permissions";
import { LOCKED_AATP_PATHS, LOCKED_DESIGN_PATHS, LOCKED_PLAN_PATHS, LOCKED_PRODUCT_PATHS, type AatpTicket } from "./types";

export const IMPLEMENTER_AGENTS = new Set(["implementer", "hard-implementer", "smol-implementer"]);
export const REVIEW_AGENTS = new Set(["reviewer", "security-reviewer"]);
export interface TaskItem { index: number; agent: string; task: string; isolated?: boolean; }
export interface TaskBinding extends TaskItem { ticketId: string; kind: "implementation" | "review"; }
export interface TaskResultLike { index?: number; id?: string; agent?: string; task?: string; output?: string; patchPath?: string; exitCode?: number; error?: string; aborted?: boolean; }

export function parsePatchPaths(text: string): string[] {
	const out = new Set<string>();
	for (const match of text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) { if (match[1] && match[1] !== "/dev/null") out.add(match[1]); if (match[2] && match[2] !== "/dev/null") out.add(match[2]); }
	for (const match of text.matchAll(/^(?:---|\+\+\+) [ab]\/(.+)$/gm)) if (match[1] && match[1] !== "/dev/null") out.add(match[1]);
	for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) if (match[1]) out.add(match[1].trim());
	return [...out];
}
export function gitChangedPaths(cwd: string): string[] {
	const result = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return ["<git-status-failed>"];
	const out: string[] = [];
	for (const line of result.stdout.split("\n")) {
		if (line.length < 4) continue;
		const rest = line.slice(3).replace(/^"|"$/g, "");
		const rel = (rest.split(" -> ").pop() ?? rest).trim().replace(/\\/g, "/");
		if (rel) out.push(rel);
	}
	return out;
}
export function prepareImplementationBaseline(cwd: string): { ok: boolean; reason?: string; committed?: boolean } {
	const dirty = gitChangedPaths(cwd);
	if (dirty.length === 0) return { ok: true, committed: false };
	const safe = dirty.every((rel) => {
		const lower = rel.toLowerCase();
		return lower.startsWith("docs/") || lower.startsWith("src/design-system/") || lower.startsWith("src/designsystem/") || lower === ".gitignore" || lower === ".omp/config.yml" || lower === ".omp/config.yaml";
	});
	if (!safe) return { ok: false, reason: `WORKTREE_GATE: commit or stash non-governance changes before /build: ${dirty.join(", ")}` };
	let result = spawnSync("git", ["add", "-A"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `BASELINE_COMMIT_FAILED: ${result.stderr.trim()}` };
	result = spawnSync("git", ["commit", "-m", "foundry: lock approved implementation baseline"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `BASELINE_COMMIT_FAILED: ${result.stderr.trim() || result.stdout.trim()}` };
	return { ok: true, committed: true };
}
export function ticketIdsFromText(text: string): string[] { return [...new Set((text.match(/\bAATP-[A-Za-z0-9_-]+/gi) ?? []).map((id) => id.toUpperCase()))]; }
export function taskItems(input: Record<string, unknown>): TaskItem[] {
	if (Array.isArray(input.tasks)) return input.tasks.flatMap((raw, index) => { if (!raw || typeof raw !== "object") return []; const item = raw as Record<string, unknown>; return [{ index, agent: String(item.agent ?? ""), task: String(item.task ?? ""), isolated: item.isolated === true }]; });
	if (typeof input.agent === "string" || typeof input.task === "string") return [{ index: 0, agent: String(input.agent ?? ""), task: String(input.task ?? ""), isolated: input.isolated === true }];
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
const ALWAYS_LOCKED = [...LOCKED_PLAN_PATHS, ...LOCKED_PRODUCT_PATHS, ...LOCKED_DESIGN_PATHS, ...LOCKED_AATP_PATHS];
export function validatePatchPaths(cwd: string, rawPaths: string[], ticket: AatpTicket, kind: "implementation" | "review"): { escaped: string[]; rejected: string[]; kept: string[] } {
	const escaped: string[] = [], rejected: string[] = [], kept: string[] = [];
	for (const path of [...new Set(rawPaths)]) {
		const rel = canonicalRepoPath(cwd, path);
		if (rel === null) { escaped.push(path); continue; }
		if (kind === "review") {
			const expected = `docs/reports/review-${ticket.id.toLowerCase()}`;
			if (rel === `${expected}.md` || rel === `${expected}-sec.md`) kept.push(path); else rejected.push(path);
			continue;
		}
		if (ALWAYS_LOCKED.some((n) => underPrefix(rel, n)) || !pathAllowed(rel, ticket)) rejected.push(path); else kept.push(path);
	}
	return { escaped, rejected, kept };
}
export function readPatchArtifact(path: string | undefined): string { return !path || !existsSync(path) ? "" : readFileSync(path, "utf8"); }
export function validatePatchArtifact(cwd: string, patchPath: string | undefined, ticket: AatpTicket, kind: "implementation" | "review"): { ok: true; patch: string; paths: string[] } | { ok: false; reason: string; paths: string[] } {
	const patch = readPatchArtifact(patchPath);
	if (!patch.trim()) return { ok: false, reason: `PATCH_GATE: ${kind} produced no patch artifact`, paths: [] };
	const paths = parsePatchPaths(patch);
	if (paths.length === 0) return { ok: false, reason: `PATCH_GATE: unable to extract paths from ${basename(patchPath ?? "patch")}`, paths: [] };
	const checked = validatePatchPaths(cwd, paths, ticket, kind);
	if (checked.escaped.length) return { ok: false, reason: `PATH_GATE: escaped patch paths: ${checked.escaped.join(", ")}`, paths };
	if (checked.rejected.length) return { ok: false, reason: `AATP_SCOPE: patch rejected: ${checked.rejected.join(", ")}`, paths };
	return { ok: true, patch, paths };
}
export function applyPatchArtifact(cwd: string, patchPath: string | undefined): { ok: boolean; reason?: string } {
	if (!patchPath || !existsSync(patchPath) || !readPatchArtifact(patchPath).trim()) return { ok: true };
	const result = spawnSync("git", ["apply", "--whitespace=nowarn", "--", patchPath], { cwd, encoding: "utf8" });
	return result.status === 0 ? { ok: true } : { ok: false, reason: `PATCH_APPLY_FAILED: ${result.stderr.trim() || result.stdout.trim()}` };
}
export function commitAppliedPatch(cwd: string, ticketId: string, kind: "implementation" | "review"): { ok: boolean; reason?: string } {
	let result = spawnSync("git", ["add", "-A"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return { ok: false, reason: `git add failed: ${result.stderr.trim()}` };
	result = spawnSync("git", ["diff", "--cached", "--quiet"], { cwd, encoding: "utf8" });
	if (result.status === 0) return { ok: true };
	const message = kind === "review" ? `foundry: review ${ticketId}` : `foundry: complete ${ticketId}`;
	result = spawnSync("git", ["commit", "-m", message], { cwd, encoding: "utf8" });
	return result.status === 0 ? { ok: true } : { ok: false, reason: `git commit failed: ${result.stderr.trim() || result.stdout.trim()}` };
}
export function restoreCleanHead(cwd: string): void { spawnSync("git", ["reset", "--hard", "HEAD"], { cwd, encoding: "utf8" }); spawnSync("git", ["clean", "-fd"], { cwd, encoding: "utf8" }); }
export function hashEvidence(...parts: Array<string | undefined>): string { const hash = createHash("sha256"); for (const part of parts) { hash.update(part ?? ""); hash.update("\0"); } return hash.digest("hex"); }
export function extractTaskResults(details: unknown): TaskResultLike[] { if (!details || typeof details !== "object") return []; const rec = details as { results?: TaskResultLike[] }; return Array.isArray(rec.results) ? rec.results : []; }
export function parseReviewVerdict(output: string, ticketId: string): "APPROVE" | "REQUEST_CHANGES" | "BLOCK" | undefined {
	const escaped = ticketId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = output.match(new RegExp(`FOUNDRY_REVIEW\\s+${escaped}\\s+(APPROVE|REQUEST_CHANGES|BLOCK)`, "i"));
	return match?.[1]?.toUpperCase() as "APPROVE" | "REQUEST_CHANGES" | "BLOCK" | undefined;
}
export function parseConflict(output: string): { kind: string; reason: string } | undefined {
	const match = output.match(/FOUNDRY_CONFLICT\s+(PLAN_CONFLICT|DESIGN_CONFLICT|DEPENDENCY_CONFLICT|SCOPE_INSUFFICIENT)\s+(.+)/i);
	return match ? { kind: match[1].toUpperCase(), reason: match[2].trim() } : undefined;
}
