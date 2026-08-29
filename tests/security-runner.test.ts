import { describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	OSI_APPROVED_SPDX_LICENSES,
	detectProjectLicense,
	parseSecurityConfig,
	planSecurityTools,
	securityReleaseReady,
} from "../src/security-runner";
import { executeVerifyStep } from "../src/verify-runner";

describe("Security Runner - Task 2 Review Hardening", () => {
	describe("1. Config Fail-Open & Strict Loading (Finding 1)", () => {
		let tempDir: string;

		test("returns NOT_REQUIRED only when config file is genuinely absent (ENOENT)", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cfg-enoent-"));
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(true);
			expect(result.status).toBe("NOT_REQUIRED");
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("returns BLOCKED when existing .omp/config.yml exceeds 512 KiB limit", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cfg-huge-"));
			mkdirSync(join(tempDir, ".omp"), { recursive: true });
			const huge = "security:\n  policy: release-required\n  # " + "A".repeat(513 * 1024);
			writeFileSync(join(tempDir, ".omp", "config.yml"), huge, "utf8");
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/512|limit|exceed/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("returns BLOCKED when .omp/config.yml is a directory instead of a regular file", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cfg-dir-"));
			mkdirSync(join(tempDir, ".omp", "config.yml"), { recursive: true });
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/regular file|directory/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("returns BLOCKED when .omp/config.yml has syntax/parse errors", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cfg-err-"));
			mkdirSync(join(tempDir, ".omp"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: invalid-policy\n", "utf8");
			const result = securityReleaseReady(tempDir);
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/invalid|unknown policy/i);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("2. Runtime Manifest Validation (Finding 2)", () => {
		let tempDir: string;

		test("blocks when manifest JSON is malformed", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-badjson-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), "{ invalid json", "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/json|manifest/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when manifest has missing required fields or invalid types", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-partial-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			// Missing runId, mode, policy, coverage
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify({ head: "sha1234567", status: "PASS" }), "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/manifest|invalid|missing/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when manifest coverage arithmetic is inconsistent", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-cov-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-cov-bad",
				mode: "full",
				policy: "release-required",
				head: "sha1234567",
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:01:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 2, blocked: 0, notRun: 0 }, // 2 != 3
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/coverage|arithmetic|inconsistent/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when manifest has duplicate tool entries", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-dup-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-dup-tool",
				mode: "full",
				policy: "release-required",
				head: "sha1234567",
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:01:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/duplicate|unique/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when timestamps are inverted", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-ts-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-inverted-ts",
				mode: "full",
				policy: "release-required",
				head: "sha1234567",
				startedAt: "2026-08-29T10:05:00Z",
				completedAt: "2026-08-29T10:00:00Z", // completed before started!
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/timestamp/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when policy or mode mismatches", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-pol-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-pol-mismatch",
				mode: "full",
				policy: "optional", // mismatch with configured release-required!
				head: "sha1234567",
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:01:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "sha1234567" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/policy|mismatch/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks when current Git HEAD is empty string", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-emptyhead-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: release-required\n", "utf8");
			const manifest: SecurityRunManifest = {
				runId: "run-emptyhead",
				mode: "full",
				policy: "release-required",
				head: "sha1234567",
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:01:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			// Pass empty head explicitly
			const result = securityReleaseReady(tempDir, { head: "" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/head|unresolvable/i);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("3. CodeQL Legal Gate & Exact SPDX Allowlist (Finding 3)", () => {
		let tempDir: string;

		test("removes CC0-1.0 and WTFPL from OSI-approved list", () => {
			expect(OSI_APPROVED_SPDX_LICENSES.has("CC0-1.0")).toBe(false);
			expect(OSI_APPROVED_SPDX_LICENSES.has("WTFPL")).toBe(false);
		});

		test("OSI_APPROVED_SPDX_LICENSES is immutable and frozen", () => {
			expect(Object.isFrozen(OSI_APPROVED_SPDX_LICENSES)).toBe(true);
		});

		test("rejects CC0-1.0 in package.json", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-lic-cc0-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t", license: "CC0-1.0" }), "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			expect(result.reason).toMatch(/not an osi-approved/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects WTFPL in package.json", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-lic-wtfpl-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t", license: "WTFPL" }), "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			expect(result.reason).toMatch(/not an osi-approved/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects negated MIT in root LICENSE (e.g. 'This project is NOT licensed under the MIT License')", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-lic-negmit-"));
			writeFileSync(join(tempDir, "LICENSE"), "This project is NOT licensed under the MIT License.\nAll rights reserved.", "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects proprietary multi-license notice without approved text", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-lic-prop-"));
			writeFileSync(join(tempDir, "LICENSE"), "Proprietary Commercial Software.\nDo not distribute under any open source license.", "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(false);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("detects canonical MIT license text", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-lic-mit-"));
			writeFileSync(join(tempDir, "LICENSE"), "MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction...", "utf8");
			const result = detectProjectLicense(tempDir);
			expect(result.eligible).toBe(true);
			expect(result.license).toBe("MIT");
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("4. CodeQL Database and Suite Artifact Verification (Finding 4)", () => {
		let tempDir: string;

		test("blocks CodeQL when configured database does not exist", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cql-nodb-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			// suite exists but database doesn't
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "security", "security.qls"), "# Suite\n", "utf8");

			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/security/codeql.db", suite: ".omp/security/security.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/database|exist/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks CodeQL when configured database is a regular file instead of a directory", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cql-dbfile-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "security", "codeql.db"), "not a directory", "utf8");
			writeFileSync(join(tempDir, ".omp", "security", "security.qls"), "# Suite\n", "utf8");

			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/security/codeql.db", suite: ".omp/security/security.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/database.*directory/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks CodeQL when configured suite is a directory instead of a regular file", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cql-suitedir-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			mkdirSync(join(tempDir, ".omp", "security", "codeql.db"), { recursive: true });
			mkdirSync(join(tempDir, ".omp", "security", "security.qls"), { recursive: true });

			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/security/codeql.db", suite: ".omp/security/security.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/suite.*file/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocks CodeQL when database or suite path traverses outside repository", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cql-trav-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");

			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: "../outside.db", suite: "../../outside.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/safe path|repository|travers/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("plans CodeQL step when license, database dir, and suite file exist and are safe", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-cql-ok-"));
			writeFileSync(join(tempDir, "package.json"), JSON.stringify({ license: "MIT" }), "utf8");
			mkdirSync(join(tempDir, ".omp", "security", "codeql.db"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "security", "security.qls"), "# Query suite\n", "utf8");

			const config: SecurityConfig = {
				policy: "optional",
				tools: ["codeql"],
				codeql: { database: ".omp/security/codeql.db", suite: ".omp/security/security.qls" },
			};
			const plan = planSecurityTools(tempDir, "codeql", config, undefined, {
				resolveExecutable: () => "C:\\tools\\codeql.exe",
			});
			expect(plan.steps[0].tool).toBe("codeql");
			expect(plan.steps[0].status).toBe("PLANNED");
			expect(plan.steps[0].step?.args).toContain("database");
			expect(plan.steps[0].step?.args).toContain("analyze");
			expect(plan.steps[0].step?.args).toContain(".omp/security/codeql.db");
			expect(plan.steps[0].step?.args).toContain(".omp/security/security.qls");
			rmSync(tempDir, { recursive: true, force: true });
		});
	});
	describe("5. Safe Run Directory and Output Containment (Finding 5)", () => {
		let tempDir: string;

		test("rejects runId with path traversal or invalid characters", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-runid-"));
			const config: SecurityConfig = { policy: "optional", tools: ["semgrep"] };
			const plan = planSecurityTools(tempDir, "full", config, undefined, { runId: "../../escaped" });
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/runid|invalid|safe/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("ensures all planned output paths are absolute and contained inside runDir", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-outpaths-"));
			const config: SecurityConfig = { policy: "optional", tools: ["semgrep", "gitleaks", "trivy"] };
			const plan = planSecurityTools(tempDir, "full", config);
			for (const step of plan.steps) {
				expect(step.outputPath).toBeDefined();
				expect(step.outputPath?.startsWith(plan.runDir)).toBe(true);
			}
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("6. Trusted Executable & Windows Path Handoff (Finding 6)", () => {
		let tempDir: string;

		test("planned steps omit absolute step.cwd so Windows paths do not fail safeRepoPath", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-win-"));
			const config: SecurityConfig = { policy: "optional", tools: ["trivy"] };
			const plan = planSecurityTools(tempDir, "full", config, undefined, {
				resolveExecutable: () => "C:\\tools\\trivy.exe",
			});
			const step = plan.steps[0].step;
			expect(step).toBeDefined();
			expect(step?.cwd === undefined || step?.cwd === ".").toBe(true);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("missing executable produces NOT_RUN when policy is optional", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-missing-opt-"));
			const config: SecurityConfig = { policy: "optional", tools: ["trivy"] };
			const plan = planSecurityTools(tempDir, "full", config, undefined, {
				resolveExecutable: () => undefined,
			});
			expect(plan.steps[0].status).toBe("NOT_RUN");
			expect(plan.steps[0].reason).toMatch(/not available/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("missing executable produces BLOCKED when policy is required", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-missing-req-"));
			const config: SecurityConfig = { policy: "required", tools: ["trivy"] };
			const plan = planSecurityTools(tempDir, "full", config, undefined, {
				resolveExecutable: () => undefined,
			});
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/not available/i);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("7. Strict Parser & Planner Boundary (Finding 7)", () => {
		test("rejects unknown nested keys under semgrep", () => {
			const yaml = "security:\n  semgrep:\n    rules: evil-rules\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/unknown.*semgrep|semgrep.*key/i);
		});

		test("rejects unknown nested keys under codeql", () => {
			const yaml = "security:\n  codeql:\n    queries: evil-queries\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/unknown.*codeql|codeql.*key/i);
		});

		test("rejects scalar where list is expected for tools", () => {
			const yaml = "security:\n  tools: semgrep\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/list|scalar/i);
		});

		test("rejects scalar where list is expected for semgrep configs", () => {
			const yaml = "security:\n  semgrep:\n    configs: p/security-audit\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/list|scalar/i);
		});

		test("rejects trailing tokens after inline list", () => {
			const yaml = "security:\n  tools: [semgrep] trailing_garbage\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/trailing|malformed/i);
		});

		test("rejects duplicate keys under security", () => {
			const yaml = "security:\n  policy: optional\n  policy: required\n";
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/duplicate/i);
		});

		test("rejects oversized list (> 16 tools)", () => {
			const toolItems = Array(20).fill("semgrep").join(", ");
			const yaml = `security:\n  tools: [${toolItems}]\n`;
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeDefined();
			expect(parsed.error).toMatch(/limit|exceed|count/i);
		});

		test("unrelated top-level blocks with shell chars do not break security parsing", () => {
			const yaml = [
				"task:",
				"  command: echo 'hello world; rm -rf /'",
				"security:",
				"  policy: release-required",
				"  tools: [semgrep, gitleaks]",
			].join("\n");
			const parsed = parseSecurityConfig(yaml);
			expect(parsed.error).toBeUndefined();
			expect(parsed.policy).toBe("release-required");
		});

		test("nested security block is not parsed as top-level security block", () => {
			const yaml = [
				"task:",
				"  security:",
				"    policy: required",
			].join("\n");
			const parsed = parseSecurityConfig(yaml);
			// Should return default optional policy because top-level security is absent
			expect(parsed.policy).toBe("optional");
			expect(parsed.error).toBeUndefined();
		});

		test("planSecurityTools blocks tools when config has error instead of defaulting", () => {
			const tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-err-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: [],
				error: "Invalid config",
			};
			const plan = planSecurityTools(tempDir, "full", config);
			expect(plan.steps.every((s) => s.status === "BLOCKED")).toBe(true);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("planSecurityTools blocks semgrep when configs contains auto directly", () => {
			const tempDir = mkdtempSync(join(tmpdir(), "omp-sec-plan-auto-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["semgrep"],
				semgrep: { configs: ["auto"] },
			};
			const plan = planSecurityTools(tempDir, "full", config);
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/auto/i);
			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("8. Bounded Gitleaks Git Range (Finding 8)", () => {
		let tempDir: string;

		test("rejects baseRef with option injection (e.g. '--all')", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-gl-opt-"));
			const config: SecurityConfig = { policy: "optional", tools: ["gitleaks"] };
			const plan = planSecurityTools(tempDir, "diff", config, undefined, { baseRef: "--all", headRef: "HEAD" });
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/range|revision|option/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects baseRef with whitespace or control characters", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-gl-ctrl-"));
			const config: SecurityConfig = { policy: "optional", tools: ["gitleaks"] };
			const plan = planSecurityTools(tempDir, "diff", config, undefined, { baseRef: "HEAD~1; rm -rf /", headRef: "HEAD" });
			expect(plan.steps[0].status).toBe("BLOCKED");
			expect(plan.steps[0].reason).toMatch(/range|revision|invalid/i);
			rmSync(tempDir, { recursive: true, force: true });
		});

		test("emits exact canonical range for valid git revisions", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-gl-ok-"));
			const config: SecurityConfig = { policy: "optional", tools: ["gitleaks"] };
			const plan = planSecurityTools(tempDir, "diff", config, undefined, {
				baseRef: "HEAD~1",
				headRef: "HEAD",
				resolveExecutable: () => "C:\\tools\\gitleaks.exe",
			});
			expect(plan.steps[0].status).toBe("PLANNED");
			expect(plan.steps[0].step?.args).toContain("--log-opts");
			expect(plan.steps[0].step?.args).toContain("HEAD~1...HEAD");
			rmSync(tempDir, { recursive: true, force: true });
		});
	});
});
