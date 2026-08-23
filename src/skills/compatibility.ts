import type { SkillManifest } from "./manifest-schema";

export function respectsConflicts(candidate: SkillManifest, chosen: SkillManifest[]): boolean {
	const ids = new Set(chosen.map((s) => s.id));
	if (candidate.conflicts.some((id) => ids.has(id))) return false;
	if (chosen.some((s) => s.conflicts.includes(candidate.id))) return false;
	return true;
}

export function withRequires(seed: SkillManifest[], registry: SkillManifest[]): SkillManifest[] {
	const byId = new Map(registry.map((s) => [s.id, s]));
	const out = [...seed];
	const have = new Set(out.map((s) => s.id));
	let changed = true;
	while (changed) {
		changed = false;
		for (const item of [...out]) {
			for (const req of item.requires) {
				if (have.has(req)) continue;
				const node = byId.get(req);
				if (!node) continue;
				if (!respectsConflicts(node, out)) continue;
				out.push(node);
				have.add(req);
				changed = true;
			}
		}
	}
	return out;
}
