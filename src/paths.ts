import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

// Resolve the nearest existing ancestor so a new file under a symlinked
// directory still maps to its real location instead of the lexical path.
function realPathNearest(abs: string): string {
	let probe = abs;
	const suffix: string[] = [];
	while (!existsSync(probe)) {
		const parent = dirname(probe);
		if (parent === probe) return abs;
		suffix.unshift(probe.slice(parent.length));
		probe = parent;
	}
	try {
		return realpathSync(probe) + suffix.join("");
	} catch {
		return abs;
	}
}

function realCwd(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return cwd;
	}
}

export function canonicalRepoPath(cwd: string, raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("local:")) return null;
	const abs = resolve(cwd, trimmed);
	const rel = relative(realCwd(cwd), realPathNearest(abs));
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return rel.replace(/\\/g, "/").toLowerCase();
}

export function underPrefix(rel: string, prefix: string): boolean {
	const p = prefix.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return rel === p || rel.startsWith(`${p}/`);
}
