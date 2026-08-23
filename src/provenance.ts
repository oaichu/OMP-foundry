import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { canonicalRepoPath, safeRepoPath } from "./paths";
import { gitCall } from "./git-runtime";
import type { AatpTicket, CompanyState } from "./types";

const MAX_SCOPE_FILES = 1024;
const MAX_SCOPE_BYTES = 16 * 1024 * 1024;

function trackedFiles(cwd: string, paths: string[]): string[] {
	const result = gitCall(cwd, ["ls-files", "-z", "--", ...paths], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
	if (result.status !== 0) return [];
	return result.stdout.split("\0").filter(Boolean);
}

/** Hash the current committed contents covered by an AATP scope. */
export function scopeHash(cwd: string, paths: string[]): string {
	const requested = paths.map((raw) => canonicalRepoPath(cwd, raw)).filter((path): path is string => path !== null);
	if (requested.length === 0) return "";
	const files = new Set<string>(trackedFiles(cwd, requested));
	for (const rel of requested) {
		const absolute = safeRepoPath(cwd, rel);
		if (!absolute) return "";
		try {
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink()) return "";
			if (stat.isFile()) files.add(rel);
		} catch {
			// A deleted file remains part of the digest as a missing marker below.
		}
	}
	const sorted = [...files].map((path) => canonicalRepoPath(cwd, path)).filter((path): path is string => path !== null).sort();
	if (sorted.length > MAX_SCOPE_FILES) return "";
	const hash = createHash("sha256");
	let total = 0;
	for (const rel of sorted) {
		const absolute = safeRepoPath(cwd, rel);
		if (!absolute) return "";
		hash.update(rel);
		hash.update("\0");
		try {
			const stat = lstatSync(absolute);
			if (stat.isSymbolicLink() || !stat.isFile()) return "";
			if (stat.size > MAX_SCOPE_BYTES || (total += stat.size) > MAX_SCOPE_BYTES) return "";
			hash.update(readFileSync(absolute));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "";
			hash.update("<missing>");
		}
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function ticketScopeHash(cwd: string, ticket: Pick<AatpTicket, "allowed_files">): string {
	return scopeHash(cwd, ticket.allowed_files);
}

/** Digest dependency implementation revisions without trusting mutable text. */
export function dependencyScopeHash(state: CompanyState, ticket: Pick<AatpTicket, "dependencies">): string {
	const deps = (ticket.dependencies ?? []).filter((dep) => dep && dep !== "NONE").map((dep) => dep.toUpperCase()).sort();
	if (deps.length === 0) return createHash("sha256").update("NONE").digest("hex");
	const hash = createHash("sha256");
	for (const dep of deps) {
		const item = state.tickets[dep];
		if (!item?.implementation_scope_sha256 || !item.implementation_commit_sha) return "";
		hash.update(dep);
		hash.update("\0");
		hash.update(item.implementation_commit_sha);
		hash.update("\0");
		hash.update(item.implementation_scope_sha256);
		hash.update("\0");
	}
	return hash.digest("hex");
}

export function currentTreeSha(cwd: string): string {
	const result = gitCall(cwd, ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

export function currentHead(cwd: string): string {
	const result = gitCall(cwd, ["rev-parse", "HEAD"], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

export function provenanceEvidence(...parts: Array<string | undefined>): string {
	const hash = createHash("sha256");
	for (const part of parts) {
		hash.update(part ?? "");
		hash.update("\0");
	}
	return hash.digest("hex");
}
