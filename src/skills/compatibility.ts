import type { SkillManifest } from "./manifest-schema";

export function respectsConflicts(candidate: SkillManifest, chosen: SkillManifest[]): boolean {
	const ids = new Set(chosen.map((s) => s.id));
	if (candidate.conflicts.some((id) => ids.has(id))) return false;
	if (chosen.some((s) => s.conflicts.includes(candidate.id))) return false;
	return true;
}

export function withRequires(seed: SkillManifest[], registry: SkillManifest[]): SkillManifest[] {
	const byId = new Map(registry.map((s) => [s.id, s]));
	const out: SkillManifest[] = [];
	const have = new Set<string>();
	const expand = (item: SkillManifest, stack: Set<string>): SkillManifest[] | undefined => {
		if (have.has(item.id)) return [];
		if (stack.has(item.id)) return undefined;
		const nextStack = new Set(stack).add(item.id), additions: SkillManifest[] = [];
		for (const req of item.requires) {
			if (have.has(req)) continue;
			const node = byId.get(req);
			// A declared requirement is an invariant. Missing or conflicting
			// dependencies remove the parent from the pack instead of silently
			// presenting a partial methodology as if it were complete.
			if (!node || !respectsConflicts(node, [...out, ...additions])) return undefined;
			const nested = expand(node, nextStack);
			if (!nested) return undefined;
			additions.push(...nested, node);
		}
		return additions;
	};
	for (const item of seed) {
		if (!respectsConflicts(item, out)) continue;
		const additions = expand(item, new Set());
		if (!additions) continue;
		for (const node of [...additions, item]) if (!have.has(node.id)) { have.add(node.id); out.push(node); }
	}
	return out;
}
