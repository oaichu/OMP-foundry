import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function realCwd(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return cwd;
	}
}

export function comparablePath(value: string): string {
	const normalized = process.platform === "win32" ? value.replace(/\\/g, "/") : value;
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** Reject lexical paths that traverse a symlink, including not-yet-created leaves. */
function hasSymlinkComponent(root: string, abs: string): boolean {
	const rel = relative(root, abs);
	if (!rel) return false;
	if (rel.startsWith("..") || isAbsolute(rel)) return true;
	let probe = root;
	for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
		probe = join(probe, part);
		try {
			if (lstatSync(probe).isSymbolicLink()) return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") break;
			return true;
		}
	}
	return false;
}

/** Return a write/read path only when it stays in the real repository tree. */
export function safeRepoPath(cwd: string, raw: string): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	// OMP tools use repository-relative paths, not URI targets. Keep Windows
	// drive paths in the absolute-path check below, while rejecting file://,
	// agent://, local:// and other schemes before path.resolve can reinterpret
	// them as ordinary in-repo filenames.
	if (!trimmed || /^(?![a-z]:[\\/])[a-z][a-z0-9+.-]*:/i.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
	if (process.platform !== "win32" && trimmed.includes("\\")) return null;
	if (process.platform === "win32") {
		// Normalize harmless dot segments before applying Win32 filename rules.
		// A literal `.` is a path component, not a filename ending in a dot;
		// parent components are rejected explicitly so callers cannot smuggle a
		// traversal through a later resolve().
		const parts = trimmed.replace(/\\/g, "/").split("/").filter(Boolean);
		if (parts.some((part) => part === "..")) return null;
		if (parts.filter((part) => part !== ".").some((part) => /[<>:"|]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) return null;
	}
	const root = realCwd(cwd);
	const abs = resolve(root, trimmed);
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel) || hasSymlinkComponent(root, abs)) return null;
	// Resolve existing aliases (including Win32 8.3 short names) before
	// authorization. For a new leaf, canonicalize the existing parent only.
	try { return realpathSync(abs); }
	catch {
		try { return join(realpathSync(dirname(abs)), basename(abs)); }
		catch { return abs; }
	}
}

export function canonicalRepoPath(cwd: string, raw: string): string | null {
	const abs = safeRepoPath(cwd, raw);
	if (!abs) return null;
	const rel = relative(realCwd(cwd), abs);
	if (!rel) return null;
	return comparablePath(rel);
}

export function underPrefix(rel: string, prefix: string): boolean {
	const p = comparablePath(prefix).replace(/\/+$/, ""), candidate = comparablePath(rel);
	return candidate === p || candidate.startsWith(`${p}/`);
}
