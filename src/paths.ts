import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function canonicalRepoPath(cwd: string, raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith("local:")) return null;
	const abs = resolve(cwd, trimmed);
	let real = abs;
	if (existsSync(abs)) {
		try {
			real = realpathSync(abs);
		} catch {
			real = abs;
		}
	}
	const rel = relative(cwd, real);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return rel.replace(/\\/g, "/").toLowerCase();
}

export function underPrefix(rel: string, prefix: string): boolean {
	const p = prefix.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	return rel === p || rel.startsWith(`${p}/`);
}
