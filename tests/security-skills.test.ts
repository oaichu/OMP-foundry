import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadRegistry } from "../src/skills/registry";

const root = join(import.meta.dir, "..");
const registry = loadRegistry(join(root, "skills"));
const byId = new Map(registry.map((skill) => [skill.id, skill]));

describe("native security control-plane skills", () => {
	test("security-review covers context, differential, insecure defaults, static patterns, auth, and business logic", () => {
		const secReview = byId.get("security-review");
		expect(secReview).toBeDefined();
		expect(secReview?.body).toContain("context");
		expect(secReview?.body).toContain("differential");
		expect(secReview?.body).toContain("insecure-default");
		expect(secReview?.body).toContain("static-pattern");
		expect(secReview?.body).toContain("auth");
		expect(secReview?.body).toContain("business logic");
	});

	test("finding verification, supply chain, and scanner manifests match routing contracts", () => {
		expect(byId.get("security-finding-verification")).toMatchObject({
			phases: ["review", "qa"],
			roles: ["reviewer", "qa"],
		});
		expect(byId.get("security-supply-chain")).toMatchObject({
			phases: ["planning", "review", "qa"],
			roles: ["planner", "reviewer", "qa"],
		});
		expect(byId.get("security-scanners")).toMatchObject({
			phases: ["review", "qa"],
			roles: ["reviewer", "qa"],
		});
	});

	test("manifest metadata and activation conditions are well-formed", () => {
		const findingVerif = byId.get("security-finding-verification");
		expect(findingVerif?.layer).toBe("L2");
		expect(findingVerif?.priority).toBe(90);
		expect(findingVerif?.domain).toEqual(["security", "triage"]);
		expect(findingVerif?.activate_when.stacks).toEqual([
			"web",
			"backend",
			"android",
			"windows",
			"cloud",
			"systems",
			"mobile",
		]);

		const supplyChain = byId.get("security-supply-chain");
		expect(supplyChain?.layer).toBe("L2");
		expect(supplyChain?.priority).toBe(89);
		expect(supplyChain?.domain).toEqual(["security", "supply-chain"]);
		expect(supplyChain?.activate_when.files).toEqual([
			"package.json",
			"package-lock.json",
			"requirements.txt",
			"pyproject.toml",
			"go.mod",
			"Cargo.toml",
		]);

		const scanners = byId.get("security-scanners");
		expect(scanners?.layer).toBe("L2");
		expect(scanners?.priority).toBe(88);
		expect(scanners?.domain).toEqual(["security", "tooling"]);
		expect(scanners?.activate_when.stacks).toEqual([
			"web",
			"backend",
			"android",
			"windows",
			"cloud",
			"systems",
			"mobile",
		]);
	});

	test("provenance records external security research without vendoring and notes license limits", () => {
		const sources = readFileSync(join(root, "skills", "SOURCES.md"), "utf8");
		expect(sources).toContain("trailofbits/skills");
		expect(sources).toContain("JeremyMorgan/code-review-skills");
		expect(sources).toContain("sabakan0123/claude-security-skills");
		expect(sources).toContain("CC-BY-SA-4.0");
		expect(sources).toContain("CC0-1.0");
		expect(sources.toLowerCase()).toContain("unresolved");
		expect(sources.toLowerCase()).toContain("vendoring");
		expect(sources).toContain("Semgrep");
		expect(sources).toContain("Gitleaks");
		expect(sources).toContain("Trivy");
		expect(sources).toContain("CodeQL");
	});

	test("finding verification enforces proof thresholds and strict disposition mappings", () => {
		const findingVerif = byId.get("security-finding-verification");
		expect(findingVerif).toBeDefined();
		const body = findingVerif?.body ?? "";
		expect(body).toContain("TRUE_POSITIVE");
		expect(body).toContain("FALSE_POSITIVE");
		expect(body).toContain("NEEDS-MORE-INFO");
		expect(body).toContain("ACCEPT");
		expect(body).toContain("DISMISS");
		expect(body).toContain("proof threshold");
		expect(body).toContain("False positives must never be accepted");
		expect(body).toContain("never be silently dismissed");
	});

	test("scanners skill enforces evidence adjudication, non-pass states, and accurate tool boundaries", () => {
		const scanners = byId.get("security-scanners");
		expect(scanners).toBeDefined();
		const body = scanners?.body ?? "";
		expect(body).toContain("adjudicate");
		expect(body).toContain("/security");
		expect(body).toContain("UNASSESSED");
		expect(body).toContain("PARTIAL_COVERAGE");
		expect(body).toContain("TOOL_ERROR");
		expect(body).toContain("extracted database");
		expect(body).toContain("no-build");
	});
});
