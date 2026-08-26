import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aatpManifestHash, archiveAatpSpecs, beginTicket, completeTicket, hydrateAatp, invalidateDescendants, listAatpSpecs, readyIndependent, reviewAgentForRisk, reviewTicket, routeAgent, validateAatpCoverage, validateAatpSpecs } from "../src/aatp";
import { defaultState } from "../src/types";
const spec = (id: string, deps: string[] = []) => ({ id, objective: "x", dependencies: deps, allowed_files: [`src/${id.toLowerCase()}`], forbidden_files: [], risk: "normal", path: `docs/AATP/${id}.md` });

describe("aatp authority and sealing", () => {
	test("routes risk to governed workers and fails unknown risk closed", () => { expect(routeAgent("low")).toBe("smol-implementer"); expect(routeAgent("hard")).toBe("hard-implementer"); expect(routeAgent("normal")).toBe("implementer"); expect(routeAgent("unknown")).toBe("hard-implementer"); });
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
	test("strict compiler validation requires complete work-order evidence", () => {
		const valid = { ...spec("AATP-100"), forbidden_files: ["docs/MASTER_PLAN.md"], acceptance: ["the change is observable"], verification: ["bun test"] };
		expect(validateAatpSpecs([valid], { strict: true })).toEqual([]);
		expect(validateAatpSpecs([{ ...valid, acceptance: [] }], { strict: true }).join(" ")).toContain("acceptance");
		expect(validateAatpSpecs([{ ...valid, verification: [], risk: "unknown" }], { strict: true }).join(" ")).toContain("verification");
		expect(validateAatpSpecs([{ ...valid, allowed_files: ["../outside"] }], { strict: true }).join(" ")).toContain("repository-relative exact path");
		expect(validateAatpSpecs([{ ...valid, allowed_files: ["src/a", "src/b", "src/c", "src/d", "src/e", "src/f"] }], { strict: true }).join(" ")).toContain("5-file limit");
		expect(validateAatpSpecs([{ ...valid, lineCount: 205 }], { strict: true }).join(" ")).toContain("200-line limit");
		expect(validateAatpSpecs([{ ...valid, allowed_files: [".omp/company-state.yaml"] }], { strict: true }).join(" ")).toContain("allowed_files includes a Foundry governance artifact");
	});
	test("security sensitivity routes independently of implementation difficulty", () => {
		expect(reviewAgentForRisk("normal")).toBe("reviewer");
		expect(reviewAgentForRisk("normal", true)).toBe("security-reviewer");
		expect(reviewAgentForRisk("critical")).toBe("security-reviewer");
	});
	test("locked concern IDs must be covered by the compiled DAG", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-aatp-coverage-")); mkdirSync(join(dir, "docs"), { recursive: true });
		writeFileSync(join(dir, "docs", "MASTER_PLAN.md"), "# Plan\nREQ-1 and SEC-A\n");
		expect(validateAatpCoverage(dir, [spec("AATP-1")]).join(" ")).toContain("REQ-1");
		expect(validateAatpCoverage(dir, [{ ...spec("AATP-1"), covers: ["REQ-1", "SEC-A"] }])).toEqual([]);
	});
	test("covers accepts bounded model annotations while preserving concern IDs", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-aatp-covers-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(join(dir, "docs", "AATP", "AATP-101.md"), "---\nid: AATP-101\nobjective: x\ndependencies:\n  - none\nallowed_files:\n  - src/a\nforbidden_files:\n  - docs/MASTER_PLAN.md\nrisk: normal\nsecurity_sensitive: false\ncovers:\n  - REQ-1: add the command\n  - SEC-A: preserve storage\nacceptance:\n  - works\nverification:\n  - typecheck\n---\n");
		const parsed = listAatpSpecs(dir)[0];
		expect(parsed?.covers).toEqual(["REQ-1", "SEC-A"]);
		expect(validateAatpSpecs([parsed!], { strict: true })).toEqual([]);
	});
	test("malformed inline lists fail closed", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-malformed-list-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(join(dir, "docs", "AATP", "AATP-102.md"), "id: AATP-102\nobjective: x\ndependencies: [AATP-001\nallowed_files:\n  - src/a\n");
		expect(() => listAatpSpecs(dir)).toThrow("malformed inline list");
		writeFileSync(join(dir, "docs", "AATP", "AATP-102.md"), "id: AATP-102\nobjective: x\ndependencies: [1]\nallowed_files:\n  - src/a\n");
		expect(() => listAatpSpecs(dir)).toThrow("invalid or oversized list item");
	});
	test("AATP lists parse on Windows line endings", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-crlf-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(join(dir, "docs", "AATP", "AATP-101.md"), "---\r\nid: AATP-101\r\nobjective: x\r\ndependencies:\r\n  - none\r\nallowed_files:\r\n  - src/a\r\nforbidden_files:\r\n  - docs/MASTER_PLAN.md\r\nrisk: low\r\nacceptance:\r\n  - works\r\nverification:\r\n  - typecheck\r\n---\r\n");
		const parsed = listAatpSpecs(dir)[0];
		expect(parsed?.acceptance).toEqual(["works"]);
		expect(parsed?.verification).toEqual(["typecheck"]);
		expect(validateAatpSpecs([parsed!], { strict: true })).toEqual([]);
	});
	test("recompile archives the previous generated DAG", () => {
		const dir = mkdtempSync(join(tmpdir(), "foundry-aatp-archive-")); mkdirSync(join(dir, "docs", "AATP"), { recursive: true });
		writeFileSync(join(dir, "docs", "AATP", "AATP-001.md"), "old\n");
		writeFileSync(join(dir, "docs", "AATP", "INDEX.md"), "old index\n");
		expect(archiveAatpSpecs(dir)).toBe(2);
		expect(listAatpSpecs(dir)).toEqual([]);
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
	test("dependencies unlock only after approved provenance-bound implementation", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", allowed_files: [], forbidden_files: [], risk: "normal", review: "none", implementation_commit_sha: "c", implementation_scope_sha256: "s" };
		const child = spec("AATP-2", ["AATP-1"]);
		expect(beginTicket(state, child, child.id).ok).toBe(false);
		state.tickets["AATP-1"]!.review = "APPROVE";
		expect(beginTicket(state, child, child.id).ok).toBe(true);
	});
	test("request changes invalidates the complete descendant chain", () => {
		const state = defaultState();
		state.tickets["AATP-1"] = { id: "AATP-1", status: "completed", dependencies: [], allowed_files: [], forbidden_files: [], risk: "normal", review: "APPROVE" };
		state.tickets["AATP-2"] = { id: "AATP-2", status: "completed", dependencies: ["AATP-1"], allowed_files: [], forbidden_files: [], risk: "normal", review: "APPROVE" };
		state.tickets["AATP-3"] = { id: "AATP-3", status: "completed", dependencies: ["AATP-2"], allowed_files: [], forbidden_files: [], risk: "normal", review: "APPROVE" };
		expect(invalidateDescendants(state, "AATP-1")).toEqual(["AATP-2", "AATP-3"]);
		expect(state.tickets["AATP-2"]?.status).toBe("ready");
		expect(state.tickets["AATP-3"]?.review).toBe("none");
	});
});

test("trivial and low risk route to smol-implementer; retries escalate", () => {
	expect(routeAgent("trivial")).toBe("smol-implementer");
	expect(routeAgent("low")).toBe("smol-implementer");
	expect(routeAgent("normal")).toBe("implementer");
	expect(routeAgent("low", 1)).toBe("hard-implementer");
	expect(routeAgent("critical")).toBe("hard-implementer");
});
