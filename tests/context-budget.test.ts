import { describe, expect, test } from "bun:test";
import { adaptiveContextBudget, clampContextBudget } from "../src/context-budget";
import { skillPackPrompt } from "../src/skills/resolver";
import type { SkillManifest } from "../src/skills/manifest-schema";

function skill(id: string, domain: string[] = ["core"], body = "x".repeat(2000)): SkillManifest {
	return {
		id,
		version: 2,
		description: `${id} description`,
		layer: "L2",
		domain,
		requires: [],
		conflicts: [],
		activate_when: {},
		roles: ["implementer"],
		phases: ["implementation"],
		priority: 80,
		body,
		path: `skills/${id}/SKILL.md`,
	};
}

describe("adaptive context budget", () => {
	test("planning and design use deep synthesis context", () => {
		expect(adaptiveContextBudget("planning", [skill("architecture")]).tier).toBe("deep");
		expect(adaptiveContextBudget("design", [skill("design-system", ["design"])]).tier).toBe("deep");
	});

	test("security relevance escalates to critical without widening permissions", () => {
		const budget = adaptiveContextBudget("implementation", [skill("security", ["security"])]);
		expect(budget.tier).toBe("critical");
		expect(budget.inlineBodies).toBeLessThanOrEqual(3);
		expect(budget.maxSkillReads).toBeLessThanOrEqual(3);
	});

	test("small packs are lean and dense packs are deep", () => {
		expect(adaptiveContextBudget("implementation", [skill("one"), skill("two")]).tier).toBe("lean");
		expect(adaptiveContextBudget("implementation", Array.from({ length: 8 }, (_, index) => skill(`s${index}`))).tier).toBe("deep");
	});

	test("clamp prevents budget escalation beyond protocol bounds", () => {
		const clamped = clampContextBudget({ tier: "critical", inlineBodies: 99, bodyChars: 99999, maxSkillReads: 99, reason: "test" });
		expect(clamped.inlineBodies).toBe(3);
		expect(clamped.bodyChars).toBe(1600);
		expect(clamped.maxSkillReads).toBe(3);
	});

	test("skill pack prompt obeys the selected inline and character budget", () => {
		const first = skill("first", ["core"], "A".repeat(800));
		const second = skill("second", ["core"], "B".repeat(800));
		const prompt = skillPackPrompt([first, second], "implementation", { tier: "lean", inlineBodies: 1, bodyChars: 420, maxSkillReads: 1, reason: "fixture" });
		expect(prompt).toContain("Context budget=lean");
		expect(prompt).toContain("### first");
		expect(prompt).not.toContain("### second");
		expect(prompt).toContain("A".repeat(420));
		expect(prompt).not.toContain("A".repeat(421));
		expect(prompt).toContain("foundry_skill_read_cached");
	});
});
