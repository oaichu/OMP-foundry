export type FoundryPhase = "planning" | "design" | "implementation" | "review" | "qa";

export interface SkillNode {
	id: string;
	layer: "L1" | "L2" | "L3";
	capabilities: string[];
	requires: string[];
	conflicts: string[];
	activate_when: {
		files?: string[];
		dependencies?: string[];
		stacks?: string[];
	};
	phases: FoundryPhase[];
	priority: number;
}

export const CATALOG: SkillNode[] = [
	{
		id: "architecture",
		layer: "L1",
		capabilities: ["architecture"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["planning", "review"],
		priority: 100,
	},
	{
		id: "systematic-debugging",
		layer: "L1",
		capabilities: ["debugging"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["implementation", "qa"],
		priority: 90,
	},
	{
		id: "verification-before-completion",
		layer: "L1",
		capabilities: ["verification"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["qa", "review"],
		priority: 90,
	},
	{
		id: "security-review",
		layer: "L1",
		capabilities: ["security"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["planning", "review"],
		priority: 85,
	},
	{
		id: "three-stage-plan",
		layer: "L1",
		capabilities: ["planning"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["planning"],
		priority: 95,
	},
	{
		id: "design-foundation",
		layer: "L1",
		capabilities: ["ui-ux"],
		requires: [],
		conflicts: [],
		activate_when: { stacks: ["web", "android", "windows"] },
		phases: ["design"],
		priority: 88,
	},
	{
		id: "ui-ux-pro-max",
		layer: "L2",
		capabilities: ["ui-ux"],
		requires: [],
		conflicts: [],
		activate_when: { stacks: ["web", "android", "windows"] },
		phases: ["design"],
		priority: 70,
	},
	{
		id: "web",
		layer: "L2",
		capabilities: ["web", "frontend"],
		requires: [],
		conflicts: [],
		activate_when: { stacks: ["web"], dependencies: ["react", "next", "vue", "svelte"] },
		phases: ["planning", "implementation", "review"],
		priority: 70,
	},
	{
		id: "android",
		layer: "L2",
		capabilities: ["mobile", "android"],
		requires: [],
		conflicts: [],
		activate_when: { stacks: ["android"], files: ["settings.gradle", "settings.gradle.kts"] },
		phases: ["planning", "implementation", "review"],
		priority: 70,
	},
	{
		id: "windows",
		layer: "L2",
		capabilities: ["desktop", "windows"],
		requires: [],
		conflicts: [],
		activate_when: { stacks: ["windows"] },
		phases: ["planning", "implementation", "review"],
		priority: 70,
	},
	{
		id: "cloudflare",
		layer: "L3",
		capabilities: ["edge", "serverless"],
		requires: ["web"],
		conflicts: [],
		activate_when: { stacks: ["cloudflare"], files: ["wrangler.toml", "wrangler.jsonc"] },
		phases: ["planning", "implementation"],
		priority: 60,
	},
	{
		id: "context7",
		layer: "L3",
		capabilities: ["docs"],
		requires: [],
		conflicts: [],
		activate_when: {},
		phases: ["implementation"],
		priority: 40,
	},
];
