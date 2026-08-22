import type { CompanyState } from "../types";
import type { SkillManifest, SkillPhase, SkillRole } from "./manifest-schema";

export function phaseOf(state: CompanyState): SkillPhase {
	if (state.phase === "design") return "design";
	if (state.phase === "review") return "review";
	if (state.phase === "qa" || state.phase === "release") return "qa";
	if (state.phase === "implementation" || state.phase === "aatp") return "implementation";
	return "planning";
}

export function roleOf(agent?: string): SkillRole | undefined {
	if (!agent) return undefined;
	if (agent === "design-foundation") return "designer";
	if (agent === "implementer" || agent === "hard-implementer") return "implementer";
	if (agent === "reviewer" || agent === "security-reviewer") return "reviewer";
	if (agent === "plan-drafter" || agent === "plan-critic" || agent === "plan-finalizer" || agent === "product-analyst") {
		return "planner";
	}
	return undefined;
}

export function filterPhaseRole(items: SkillManifest[], phase: SkillPhase, role?: SkillRole): SkillManifest[] {
	return items.filter((item) => item.phases.includes(phase) && (!role || item.roles.includes(role)));
}
