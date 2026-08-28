import type { SkillManifest } from "./skills/manifest-schema";

export type ContextBudgetTier = "lean" | "standard" | "deep" | "critical";

export interface ContextBudget {
	tier: ContextBudgetTier;
	inlineBodies: number;
	bodyChars: number;
	maxSkillReads: number;
	reason: string;
}

const BUDGETS: Record<ContextBudgetTier, Omit<ContextBudget, "tier" | "reason">> = {
	lean: { inlineBodies: 1, bodyChars: 420, maxSkillReads: 1 },
	standard: { inlineBodies: 2, bodyChars: 650, maxSkillReads: 2 },
	deep: { inlineBodies: 3, bodyChars: 900, maxSkillReads: 3 },
	critical: { inlineBodies: 3, bodyChars: 1200, maxSkillReads: 3 },
};

function budget(tier: ContextBudgetTier, reason: string): ContextBudget {
	return { tier, ...BUDGETS[tier], reason };
}

function securityRelevant(skills: SkillManifest[]): boolean {
	return skills.some((skill) => skill.id.includes("security") || skill.domain.some((domain) => domain.toLowerCase() === "security"));
}

/**
 * Context budget changes only prompt/read volume. It never widens AATP scope,
 * write permissions, patch limits, or governance gates.
 */
export function adaptiveContextBudget(phase: string, skills: SkillManifest[]): ContextBudget {
	if (securityRelevant(skills)) return budget("critical", "security-relevant skill pack");
	if (phase === "planning" || phase === "design" || phase === "aatp") return budget("deep", `${phase} synthesis phase`);
	if (skills.length <= 3) return budget("lean", `small routed pack (${skills.length})`);
	if (skills.length >= 8) return budget("deep", `dense routed pack (${skills.length})`);
	return budget("standard", `normal routed pack (${skills.length})`);
}

export function clampContextBudget(input: ContextBudget): ContextBudget {
	return {
		...input,
		inlineBodies: Math.max(0, Math.min(3, Math.trunc(input.inlineBodies))),
		bodyChars: Math.max(200, Math.min(1600, Math.trunc(input.bodyChars))),
		maxSkillReads: Math.max(1, Math.min(3, Math.trunc(input.maxSkillReads))),
	};
}
