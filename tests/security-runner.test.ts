import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	type SecurityConfig,
	type SecurityMode,
	type SecurityPolicy,
	type SecurityResultStatus,
	type SecurityRunManifest,
	type SecurityToolId,
	type SecurityToolResult,
	detectProjectLicense,
	parseSecurityConfig,
	planSecurityTools,
	securityReleaseReady,
} from "../src/security-runner";

describe("Security Runner - Task 2: Config and Planning", () => {
	describe("parseSecurityConfig", () => {
		test("empty config returns optional default with standard tools", () => {
			const parsed = parseSecurityConfig("");
			expect(parsed).toMatchObject({
				policy: "optional",
				tools: ["semgrep", "gitleaks", "trivy"],
			});
			expect(parsed.error).toBeUndefined();
		});

		test("valid security block with policy and tools", () => {
			const yaml = "security:\n  policy: release-required\n  tools: [semgrep, gitleaks]\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed).toMatchObject({
				policy: "release-required",
				tools: ["semgrep", "gitleaks"],
			});
			expect(parsed.error).toBeUndefined();
		});

		test("parses semgrep configs and codeql settings", () => {
			const yaml = [
				"security:",
				"  policy: required",
				"  tools: [semgrep, gitleaks, trivy, codeql]",
				"  timeout_ms: 120000",
				"  semgrep:",
				"    configs: [p/security-audit, p/secrets]",
				"  codeql:",
				"    database: .omp/security/codeql.db",
				"    suite: .omp/security/security.qls",
			].join("\n");

			const parsed = parseSecurityConfig(yaml);
			expect(parsed).toMatchObject({
				policy: "required",
				tools: ["semgrep", "gitleaks", "trivy", "codeql"],
				timeoutMs: 120000,
				semgrep: {
					configs: ["p/security-audit", "p/secrets"],
				},
				codeql: {
					database: ".omp/security/codeql.db",
					suite: ".omp/security/security.qls",
				},
			});
			expect(parsed.error).toBeUndefined();
		});

		test("rejects unknown tool", () => {
			const parsed = parseSecurityConfig("security:\n  tools: [evil]\n");
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toContain("unknown tool");
		});

		test("rejects unknown policy", () => {
			const parsed = parseSecurityConfig("security:\n  policy: maybe\n");
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toContain("unknown policy");
		});

		test("rejects executable overrides", () => {
			const parsed = parseSecurityConfig("security:\n  executable: sh -c evil\n");
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toContain("executable");
		});

		test("rejects command overrides", () => {
			const parsed = parseSecurityConfig("security:\n  command: rm -rf /\n");
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/command|executable|forbidden/i);
		});

		test("rejects semgrep auto configs", () => {
			const parsed1 = parseSecurityConfig("security:\n  semgrep:\n    configs: [auto]\n");
			expect(parsed1.error).toBeDefined();
			expect(parsed1.error).toContain("auto");

			const parsed2 = parseSecurityConfig("security:\n  semgrep:\n    configs: [p/auto]\n");
			expect(parsed2.error).toBeDefined();
			expect(parsed2.error).toContain("auto");
		});

		test("rejects shell metacharacters in labels and paths", () => {
			const parsed = parseSecurityConfig("security:\n  codeql:\n    database: .omp/db; rm -rf /\n");
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/shell|invalid|forbidden/i);
		});

		test("rejects config exceeding 512 KiB limit", () => {
			const huge = "security:\n  # " + "A".repeat(513 * 1024);
			const parsed = parseSecurityConfig(huge);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/512|limit|exceed/i);
		});
	});

	describe("detectProjectLicense", () => {
		let tempDir: string;

		test("detects OSI license from package.json", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-license-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test", license: "MIT" }), "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(true);
			expect(result.license).toBe("MIT");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("detects Apache-2.0 from package.json", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-license-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test", license: "Apache-2.0" }), "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(true);
			expect(result.license).toBe("Apache-2.0");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects UNLICENSED / proprietary license", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-license-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test", license: "UNLICENSED" }), "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("detects license from root LICENSE file", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-license-"));
			writeFileSync(join(tempDir, "LICENSE"), "MIT License\n\nCopyright (c) 2026", "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(true);
			expect(result.license).toBe("MIT");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("ineligible when no license is present", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-license-"));
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("planSecurityTools", () => {
		let tempDir: string;

		test("plans semgrep with --metrics=off, explicit config, sarif output, and target", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["semgrep"],
				semgrep: { configs: ["p/security-audit"] },
			};
			const plan = planSecurityTools(tempDir, "full", config);
			expect(plan.steps).toHaveLength(1);
			const step = plan.steps[0];
			expect(step.tool).toBe("semgrep");
			expect(step.status).toBe("PLANNED");
			expect(step.step).toBeDefined();
			expect(step.step?.executable).toBe("semgrep");
			expect(step.step?.args).toContain("--metrics=off");
			expect(step.step?.args).toContain("--config");
			expect(step.step?.args).toContain("p/security-audit");
			expect(step.step?.args).toContain("--sarif");
			expect(step.step?.args).toContain("--output");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("plans gitleaks diff mode with --redact and SARIF output", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["gitleaks"],
			};
			const plan = planSecurityTools(tempDir, "diff", config, undefined, { baseRef: "HEAD~1", headRef: "HEAD" });
			expect(plan.steps).toHaveLength(1);
			const step = plan.steps[0];
			expect(step.tool).toBe("gitleaks");
			expect(step.status).toBe("PLANNED");
			expect(step.step?.executable).toBe("gitleaks");
			expect(step.step?.args).toContain("git");
			expect(step.step?.args).toContain("--redact");
			expect(step.step?.args).toContain("--report-format");
			expect(step.step?.args).toContain("sarif");
			expect(step.step?.args).toContain("--report-path");
			expect(step.step?.args).toContain("--log-opts");
			expect(step.step?.args).toContain("HEAD~1...HEAD");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("plans trivy with fs and exact scanner set", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["trivy"],
			};
			const plan = planSecurityTools(tempDir, "full", config);
			expect(plan.steps).toHaveLength(1);
			const step = plan.steps[0];
			expect(step.tool).toBe("trivy");
			expect(step.status).toBe("PLANNED");
			expect(step.step?.executable).toBe("trivy");
			expect(step.step?.args).toEqual(["fs", "--scanners", "vuln,misconfig,secret", "--format", "sarif", "--output", step.outputPath!, "."]);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks codeql without OSI license", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			// No license in tempDir
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/db", suite: ".omp/suite.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/license|osi/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks codeql without configured database and suite", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/database|suite/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("plans codeql when OSI license, database, and suite are present", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/security/codeql.db", suite: ".omp/security/security.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("PLANNED");
			expect(plan.steps[0].step?.executable).toBe("codeql");
			expect(plan.steps[0].step?.args).toEqual([
				"database",
				"analyze",
				".omp/security/codeql.db",
				"--format",
				"sarifv2.1.0",
				"--output",
				plan.steps[0].outputPath!,
				".omp/security/security.qls",
			]);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("securityReleaseReady", () => {
		let tempDir: string;

		test("returns NOT_REQUIRED for optional policy", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: optional\n", { encoding: "utf8" });
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(true);
			expect(result.status).toBe("NOT_REQUIRED");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks release-required policy when manifest is missing", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/manifest|scan/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when manifest head is stale", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-1",
				mode: "full",
				policy: "release-required",
				head: "old-commit-sha",
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "new-commit-sha" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/stale|head|mismatch/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("passes when manifest matches HEAD, policy, and all tools PASS", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n  tools: [semgrep, trivy]\n", "utf8");
			const head = "current-sha-123456";
			const manifest: SecurityRunManifest = {
				runId: "run-2",
				mode: "full",
				policy: "release-required",
				head,
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 2, completed: 2, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head });
			expect(result.ready).toBe(true);
			expect(result.status).toBe("PASS");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("fails when manifest status is FAIL", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const head = "current-sha";
			const manifest: SecurityRunManifest = {
				runId: "run-3",
				mode: "full",
				policy: "release-required",
				head,
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				tools: [
					{ tool: "semgrep", status: "FAIL", findings: 2, argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "FAIL",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("FAIL");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when required policy has incomplete tool coverage", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: required\n  tools: [semgrep, gitleaks, trivy]\n", "utf8");
			const head = "current-sha";
			const manifest: SecurityRunManifest = {
				runId: "run-4",
				mode: "full",
				policy: "required",
				head,
				startedAt: new Date().toISOString(),
				completedAt: new Date().toISOString(),
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "BLOCKED", reason: "missing binary", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 2, blocked: 1, notRun: 0 },
				status: "BLOCKED",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			rmSync(tempDir, { recursive: true, force: true });
		});
	});
});
