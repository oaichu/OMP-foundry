import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aatpManifestHash, beginTicket, completeTicket, hydrateAatp, readyIndependent, reviewTicket, routeAgent, validateAatpSpecs } from "../src/aatp";
import { defaultState } from "../src/types";
const spec = (id: string, deps: string[] = []) => ({ id, objective: "x", dependencies: deps, allowed_files: [`src/${id.toLowerCase()}`], forbidden_files: [], risk: "normal", path: `docs/AATP/${id}.md` });

describe("aatp authority and sealing", () => {
	test("routes risk to governed workers", () => { expect(routeAgent("low")).toBe("smol-implementer"); expect(routeAgent("hard")).toBe("hard-implementer"); expect(routeAgent("normal")).toBe("implementer"); });
	test("status comes from state, not markdown", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(join(dir, "docs", "AATP", "AATP-001.md"), "---\nid: AATP-001\nobjective: x\nstatus: ready\nrisk: low\ndependencies:\n  - none\nallowed_files:\n  - src/a\n---\n");
		const state = defaultState(); state.tickets["AATP-001"] = { id: "AATP-001", status: "completed", allowed_files: ["src/a"], forbidden_files: [], risk: "low", review: "APPROVE" };
		expect(hydrateAatp(dir, state)[0]?.status).toBe("completed"); expect(readyIndependent(hydrateAatp(dir, state))).toHaveLength(0);
	});
	test("manifest hash changes with spec", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true }); const file = join(dir, "docs", "AATP", "AATP-001.md");
		writeFileSync(file, "---\nid: AATP-001\nobjective: x\ndependencies:\n  - none\nallowed_files:\n  - src/a\n---\n"); const first = aatpManifestHash(dir);
		writeFileSync(file, "---\nid: AATP-001\nobjective: changed\ndependencies:\n  - none\nallowed_files:\n  - src/a\n---\n"); expect(aatpManifestHash(dir)).not.toBe(first);
	});
	test("spec validation requires scope and valid acyclic dependencies", () => {
		expect(validateAatpSpecs([{ ...spec("AATP-1"), allowed_files: [] }]).join(" ")).toContain("allowed_files");
		expect(validateAatpSpecs([spec("AATP-2", ["AATP-404"])]).join(" ")).toContain("unknown dependency");
		expect(validateAatpSpecs([spec("AATP-1", ["AATP-1"])]).join(" ")).toContain("self dependency");
		const cycle = validateAatpSpecs([spec("AATP-1", ["AATP-2"]), spec("AATP-2", ["AATP-3"]), spec("AATP-3", ["AATP-1"])]).join(" ");
		expect(cycle).toContain("dependency cycle");
	});
});

describe("parent-owned transitions", () => {
	test("begin rejects unknown and incomplete dependency", () => {
		const state = defaultState(); expect(beginTicket(state, undefined, "AATP-9").ok).toBe(false);
		state.tickets["AATP-1"] = { id: "AATP-1", status: "ready", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		state.tickets["AATP-2"] = { id: "AATP-2", status: "ready", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(beginTicket(state, spec("AATP-2", ["AATP-1"]), "AATP-2").ok).toBe(false);
	});
	test("ready -> active -> completed -> independently reviewed", () => {
		const state = defaultState(); expect(beginTicket(state, spec("AATP-1"), "AATP-1", "implementer").ok).toBe(true); expect(completeTicket(state, "AATP-1", "impl-sha").ok).toBe(true); expect(reviewTicket(state, "AATP-1", "APPROVE", "reviewer", "review-sha").ok).toBe(true);
		expect(state.tickets["AATP-1"]?.review_by).toBe("reviewer"); expect(state.tickets["AATP-1"]?.review_evidence_sha256).toBe("review-sha");
	});
	test("review rejects active; request changes returns ready", () => {
		const state = defaultState(); state.tickets["AATP-1"] = { id: "AATP-1", status: "active", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(reviewTicket(state, "AATP-1", "APPROVE").ok).toBe(false);
		const completed = defaultState(); completed.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: [], forbidden_files: [], risk: "normal", review: "none" };
		expect(reviewTicket(completed, "AATP-1", "REQUEST_CHANGES", "reviewer", "r").ok).toBe(true); expect(completed.tickets["AATP-1"]?.status).toBe("ready");
	});
});