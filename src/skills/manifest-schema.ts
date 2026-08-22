export type SkillLayer = "L1" | "L2" | "L3" | "L4";
export type SkillPhase = "planning" | "design" | "implementation" | "review" | "qa";
export type SkillRole = "planner" | "designer" | "implementer" | "reviewer" | "qa";

export interface SkillManifest {
	id: string;
	version: number;
	description: string;
	layer: SkillLayer;
	domain: string[];
	requires: string[];
	conflicts: string[];
	activate_when: {
		dependencies?: string[];
		files?: string[];
		stacks?: string[];
		languages?: string[];
	};
	roles: SkillRole[];
	phases: SkillPhase[];
	priority: number;
	body: string;
	path: string;
}

export const LAYERS: SkillLayer[] = ["L1", "L2", "L3", "L4"];
export const PHASES: SkillPhase[] = ["planning", "design", "implementation", "review", "qa"];
export const ROLES: SkillRole[] = ["planner", "designer", "implementer", "reviewer", "qa"];
