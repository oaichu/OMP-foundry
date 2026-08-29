import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSkillRouting, resolveSkills } from "../src/skills/resolver";
import { defaultState } from "../src/types";

const skillsRoot = join(import.meta.dir, "..", "skills");

function fullStackApp(options: { componentsJson?: boolean } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "foundry-router-"));
	writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0", typescript: "5.0.0", "@supabase/supabase-js": "2.0.0" } }));
	writeFileSync(join(dir, "tsconfig.json"), "{}");
	writeFileSync(join(dir, "next.config.ts"), "export default {}");
	if (options.componentsJson) {
		writeFileSync(join(dir, "components.json"), "{}");
	}
	return dir;
}

describe("Skill Router v2", () => {
	test("preserves repository-only routing when no task context exists", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const ids = resolveSkills(fullStackApp(), state, { skillsRoot, role: "implementer" });
		expect(ids).toContain("nextjs-engineering");
		expect(ids).toContain("react-engineering");
	});

	test("strong AATP context suppresses unrelated repo-only frontend adapters", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const result = resolveSkillRouting(fullStackApp({ componentsJson: true }), state, {
			skillsRoot,
			role: "implementer",
			context: {
				objective: "Fix the Supabase Postgres tenant RLS policy and ownership leak.",
				files: ["supabase/migrations/20260828_rls.sql"],
				concerns: ["SEC-TENANT-RLS"],
				securitySensitive: true,
			},
		});
		const ids = result.skills.map((item) => item.id);
		expect(ids).toContain("postgres-engineering");
		expect(ids).toContain("supabase-engineering");
		expect(ids).not.toContain("nextjs-engineering");
		expect(ids).not.toContain("react-engineering");
		expect(ids).not.toContain("web-engineering");
		expect(ids).not.toContain("shadcn-ui");
		const postgres = result.scores.find((row) => row.id === "postgres-engineering");
		expect(postgres?.selected).toBe(true);
		expect(postgres?.contextEvidence).toBeGreaterThanOrEqual(14);
		expect(postgres?.reasons.some((reason) => reason.includes("task-id:postgres"))).toBe(true);
	});

	test("L1 web-interface-guidelines remains active across eligible web reviews with and without backend context", () => {
		const state = { ...defaultState(), phase: "review" as const };
		const appDir = fullStackApp({ componentsJson: true });

		const baseline = resolveSkillRouting(appDir, state, { skillsRoot, role: "reviewer" });
		expect(baseline.skills.map((s) => s.id)).toContain("web-interface-guidelines");
		expect(baseline.skills.map((s) => s.id)).toContain("design-quality");

		const withBackendContext = resolveSkillRouting(appDir, state, {
			skillsRoot,
			role: "reviewer",
			context: {
				objective: "Fix the Supabase Postgres tenant RLS policy and ownership leak.",
				files: ["supabase/migrations/20260828_rls.sql"],
				concerns: ["SEC-TENANT-RLS"],
				securitySensitive: true,
			},
		});
		expect(withBackendContext.skills.map((s) => s.id)).toContain("web-interface-guidelines");
		expect(withBackendContext.skills.map((s) => s.id)).toContain("design-quality");
	});

	test("security-sensitive evidence is routed in the phases where security skills are authorized", () => {
		const state = { ...defaultState(), phase: "review" as const };
		const result = resolveSkillRouting(fullStackApp(), state, { skillsRoot, role: "reviewer", context: { objective: "Review tenant RLS authorization", concerns: ["SEC-TENANT-RLS"], securitySensitive: true } });
		const ids = result.skills.map((item) => item.id);
		expect(ids).toContain("security");
		expect(result.scores.find((row) => row.id === "security")?.contextEvidence).toBeGreaterThanOrEqual(40);
	});

	test("routing is deterministic and stably ordered in implementation with components.json", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const appDir = fullStackApp({ componentsJson: true });
		const options = {
			skillsRoot,
			role: "implementer" as const,
			context: { objective: "Implement user profile dialog using shadcn primitives", files: ["components/user-profile.tsx"] },
		};
		const first = resolveSkillRouting(appDir, state, options);
		const second = resolveSkillRouting(appDir, state, options);
		expect(first.skills.map((item) => item.id)).toEqual(second.skills.map((item) => item.id));
		expect(first.scores).toEqual(second.scores);
		const shadcnScore = first.scores.find((row) => row.id === "shadcn-ui");
		expect(shadcnScore).toBeDefined();
		expect(shadcnScore?.selected).toBe(true);
	});

	test("routing is deterministic and stably ordered in review with web interface guidelines", () => {
		const state = { ...defaultState(), phase: "review" as const };
		const appDir = fullStackApp({ componentsJson: true });
		const options = {
			skillsRoot,
			role: "reviewer" as const,
			context: { objective: "Review navigation bar accessibility and dialog focus traps", files: ["components/navbar.tsx"] },
		};
		const first = resolveSkillRouting(appDir, state, options);
		const second = resolveSkillRouting(appDir, state, options);
		expect(first.skills.map((item) => item.id)).toEqual(second.skills.map((item) => item.id));
		expect(first.scores).toEqual(second.scores);
		const wigScore = first.scores.find((row) => row.id === "web-interface-guidelines");
		expect(wigScore).toBeDefined();
		expect(wigScore?.selected).toBe(true);
		const dqScore = first.scores.find((row) => row.id === "design-quality");
		expect(dqScore).toBeDefined();
		expect(dqScore?.selected).toBe(true);
	});

	test("explanation exposes repo evidence, task evidence, and context cost", () => {
		const state = { ...defaultState(), phase: "implementation" as const };
		const result = resolveSkillRouting(fullStackApp(), state, { skillsRoot, role: "implementer", context: { objective: "Change a Next route handler", files: ["app/api/user/route.ts"] } });
		const next = result.scores.find((row) => row.id === "nextjs-engineering");
		expect(next).toBeDefined();
		expect(next!.repoEvidence).toBeGreaterThan(0);
		expect(next!.contextEvidence).toBeGreaterThan(0);
		expect(next!.contextCost).toBeGreaterThan(0);
		expect(next!.reasons.length).toBeGreaterThan(2);
	});
});
