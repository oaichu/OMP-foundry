import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalRepoPath, underPrefix } from "./paths";
import { looksLikeImpl, pathAllowed } from "./permissions";
import { LOCKED_DESIGN_PATHS, LOCKED_PLAN_PATHS, LOCKED_PRODUCT_PATHS, type AatpTicket } from "./types";

export function parsePatchPaths(text: string): string[] {
	const out = new Set<string>();
	for (const match of text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) {
		if (match[2]) out.add(match[2]);
	}
	for (const match of text.matchAll(/^\+\+\+ b\/(.+)$/gm)) {
		if (match[1] && match[1] !== "/dev/null") out.add(match[1]);
	}
	for (const match of text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
		if (match[1]) out.add(match[1].trim());
	}
	return [...out];
}

export function gitChangedPaths(cwd: string): string[] {
	const names = new Set<string>();
	const run = (args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
	const porcelain = run(["status", "--porcelain", "-uall"]);
	if (porcelain.status === 0) {
		for (const line of porcelain.stdout.split("\n")) {
			if (line.length < 4) continue;
			const rest = line.slice(3).replace(/^"|"$/g, "");
			const renamed = rest.split(" -> ");
			names.add((renamed[1] ?? renamed[0]).trim());
		}
	}
	for (const args of [
		["diff", "--name-only", "HEAD"],
		["diff", "--cached", "--name-only"],
		["ls-files", "--others", "--exclude-standard"],
	]) {
		const result = run(args);
		if (result.status !== 0) continue;
		for (const line of result.stdout.split("\n")) {
			if (line.trim()) names.add(line.trim());
		}
	}
	return [...names];
}

// A baseline captures the pre-task dirty state so a rejected worker write can
// be reverted to what the user had, not blindly to HEAD. In the files map,
// string = previous content, null = file was untracked before the task.
export interface TreeBaseline {
	paths: Set<string>;
	files: Map<string, string | null>;
}

const BASELINE_MAX_BYTES = 1_000_000;

function readBaselineContent(abs: string): string | undefined {
	let text: string;
	try {
		text = readFileSync(abs, "utf8");
	} catch {
		return undefined;
	}
	if (text.length > BASELINE_MAX_BYTES || text.includes("\0")) return undefined;
	return text;
}

export function snapshotBaseline(cwd: string): TreeBaseline {
	const paths = new Set<string>();
	const files = new Map<string, string | null>();
	const porcelain = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" });
	if (porcelain.status === 0) {
		for (const line of porcelain.stdout.split("\n")) {
			if (line.length < 4) continue;
			const untracked = line.slice(0, 2).includes("?");
			const rest = line.slice(3).replace(/^"|"$/g, "");
			const rel = (rest.split(" -> ").pop() ?? rest).trim();
			if (!rel) continue;
			paths.add(rel);
			if (untracked) {
				files.set(rel, null);
			} else {
				const content = readBaselineContent(join(cwd, rel));
				if (content !== undefined) files.set(rel, content);
			}
		}
		return { paths, files };
	}
	for (const rel of gitChangedPaths(cwd)) paths.add(rel);
	return { paths, files };
}

export function deltaPaths(before: Set<string>, after: Iterable<string>): string[] {
	const out: string[] = [];
	for (const path of after) {
		if (!before.has(path)) out.push(path);
	}
	return out;
}

export function ticketIdsFromText(text: string): string[] {
	return [...new Set((text.match(/\bAATP-[A-Za-z0-9_-]+/g) ?? []).map((id) => id.toUpperCase()))];
}

const ALWAYS_LOCKED = [...LOCKED_PLAN_PATHS, ...LOCKED_PRODUCT_PATHS, ...LOCKED_DESIGN_PATHS];

// Escaped paths (canonicalization failed) are reported but never touched:
// the reverter must not act on raw, untrusted paths.
export function rejectChangedPaths(
	cwd: string,
	rawPaths: string[],
	tickets: AatpTicket[],
): { escaped: string[]; rejected: string[]; kept: string[] } {
	const escaped: string[] = [];
	const rejected: string[] = [];
	const kept: string[] = [];
	for (const path of [...new Set(rawPaths)]) {
		const rel = canonicalRepoPath(cwd, path);
		if (rel === null) {
			escaped.push(path);
			continue;
		}
		if (ALWAYS_LOCKED.some((n) => underPrefix(rel, n))) {
			rejected.push(path);
			continue;
		}
		if (!looksLikeImpl(rel)) {
			kept.push(path);
			continue;
		}
		if (tickets.length === 0 || !tickets.some((t) => pathAllowed(rel, t))) {
			rejected.push(path);
			continue;
		}
		kept.push(path);
	}
	return { escaped, rejected, kept };
}

export function revertPaths(cwd: string, rels: string[], baseline?: Map<string, string | null>): string[] {
	const reverted: string[] = [];
	for (const rel of rels) {
		if (baseline?.has(rel)) {
			const content = baseline.get(rel);
			const abs = join(cwd, rel);
			spawnSync("git", ["reset", "--", rel], { cwd, encoding: "utf8" });
			if (content == null) {
				if (existsSync(abs)) {
					try {
						unlinkSync(abs);
						reverted.push(rel);
					} catch {
						/* leave in place; still reported */
					}
				} else {
					reverted.push(rel);
				}
			} else {
				try {
					writeFileSync(abs, content, "utf8");
					reverted.push(rel);
				} catch {
					/* leave in place; still reported */
				}
			}
			continue;
		}
		const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd, encoding: "utf8" });
		if (tracked.status === 0) {
			const restore = spawnSync("git", ["restore", "--source=HEAD", "--worktree", "--staged", "--", rel], {
				cwd,
				encoding: "utf8",
			});
			if (restore.status !== 0) {
				spawnSync("git", ["checkout", "HEAD", "--", rel], { cwd, encoding: "utf8" });
			}
			reverted.push(rel);
			continue;
		}
		const abs = join(cwd, rel);
		if (existsSync(abs)) {
			try {
				unlinkSync(abs);
				reverted.push(rel);
			} catch {
				/* leave in place; still reported */
			}
		}
	}
	return reverted;
}

export function extractResultPaths(details: unknown, contentText: string): string[] {
	const out = new Set<string>(parsePatchPaths(contentText));
	if (!details || typeof details !== "object") return [...out];
	const rec = details as { results?: Array<{ patchPath?: string }>; patchPath?: string };
	const patches = [
		...(typeof rec.patchPath === "string" ? [rec.patchPath] : []),
		...((rec.results ?? []).map((r) => r.patchPath).filter((p): p is string => Boolean(p))),
	];
	for (const file of patches) {
		if (!existsSync(file)) continue;
		for (const path of parsePatchPaths(readFileSync(file, "utf8"))) out.add(path);
	}
	return [...out];
}

export function governedTask(input: Record<string, unknown>): boolean {
	const names = new Set<string>();
	if (typeof input.agent === "string") names.add(input.agent);
	if (Array.isArray(input.tasks)) {
		for (const item of input.tasks) {
			if (item && typeof item === "object" && typeof (item as { agent?: string }).agent === "string") {
				names.add((item as { agent: string }).agent);
			}
		}
	}
	return [...names].some((n) => n === "implementer" || n === "hard-implementer" || n === "smol-implementer");
}

export function reviewTaskDelta(
	cwd: string,
	baseline: TreeBaseline,
	tickets: AatpTicket[],
	details: unknown,
	contentText: string,
): { escaped: string[]; rejected: string[]; kept: string[]; reverted: string[] } {
	const raw = [
		...deltaPaths(baseline.paths, gitChangedPaths(cwd)),
		...extractResultPaths(details, contentText),
	];
	// Files the user had already edited stay out of the path delta, so catch
	// worker edits to them by comparing against the captured baseline content.
	for (const [rel, content] of baseline.files) {
		if (content === null || raw.includes(rel)) continue;
		const current = readBaselineContent(join(cwd, rel));
		if (current !== undefined && current !== content) raw.push(rel);
	}
	const { escaped, rejected, kept } = rejectChangedPaths(cwd, raw, tickets);
	const reverted = rejected.length ? revertPaths(cwd, rejected, baseline.files) : [];
	return { escaped, rejected, kept, reverted };
}

export function contentTextOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((chunk) => {
			if (chunk && typeof chunk === "object" && "text" in chunk) return String((chunk as { text: unknown }).text ?? "");
			return "";
		})
		.join("\n");
}
