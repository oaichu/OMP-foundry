import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	type SecurityConfig,
	type SecurityResultStatus,
	type SecurityRunManifest,
	OSI_APPROVED_SPDX_LICENSES,
	detectProjectLicense,
	parseSecurityConfig,
	planSecurityTools,
	securityReleaseReady,
	normalizeToolResult,
	mergeSarifResults,
	writeSecurityRunManifest,
	readSecurityRunManifest,
	readLatestSecurityManifest,
	runSecurityScan,
	securityStatus,
} from "../src/security-runner";

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

describe("Security Runner - Task 3 Execution, SARIF, and Run Manifests", () => {
	const sampleEmptySarif = JSON.stringify({
		$schema: "https://json.schemastore.org/sarif-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: { driver: { name: "semgrep", version: "1.0.0" } },
				results: [],
			},
		],
	});

	const sampleSarifWithFindings = JSON.stringify({
		$schema: "https://json.schemastore.org/sarif-2.1.0.json",
		version: "2.1.0",
		runs: [
			{
				tool: { driver: { name: "semgrep", version: "1.0.0" } },
				results: [
					{
						ruleId: "rules.security.eval",
						message: { text: "Use of eval is dangerous" },
						locations: [
							{
								physicalLocation: {
									artifactLocation: { uri: "src/unsafe.js" },
									region: { startLine: 12, startColumn: 5 },
								},
							},
						],
					},
				],
			},
		],
	});

	describe("1. Tool Outcome Normalization (normalizeToolResult)", () => {
		test("returns PASS for exitCode 0 with valid 0-finding SARIF", () => {
			const res = normalizeToolResult({ exitCode: 0, sarif: sampleEmptySarif });
			expect(res).toMatchObject({ status: "PASS", findings: 0 });
		});

		test("returns FAIL with findings count for exitCode 1 with findings in SARIF", () => {
			const res = normalizeToolResult({ exitCode: 1, sarif: sampleSarifWithFindings });
			expect(res).toMatchObject({ status: "FAIL", findings: 1 });
		});

		test("returns FAIL with findings count for exitCode 0 when SARIF has findings", () => {
			const res = normalizeToolResult({ exitCode: 0, sarif: sampleSarifWithFindings });
			expect(res).toMatchObject({ status: "FAIL", findings: 1 });
		});

		test("returns BLOCKED for exitCode 1 with empty SARIF", () => {
			const res = normalizeToolResult({ exitCode: 1, sarif: "" });
			expect(res.status).toBe("BLOCKED");
		});

		test("returns BLOCKED when error is provided (e.g. ENOENT)", () => {
			const res = normalizeToolResult({ error: "ENOENT" });
			expect(res.status).toBe("BLOCKED");
		});

		test("returns BLOCKED when timedOut is true", () => {
			const res = normalizeToolResult({ timedOut: true });
			expect(res.status).toBe("BLOCKED");
		});

		test("returns BLOCKED for exitCode 0 with unparseable SARIF JSON", () => {
			const res = normalizeToolResult({ exitCode: 0, sarif: "not-json" });
			expect(res.status).toBe("BLOCKED");
		});

		test("returns BLOCKED for exitCode 0 with invalid SARIF structure (missing runs)", () => {
			const res = normalizeToolResult({ exitCode: 0, sarif: JSON.stringify({ version: "2.1.0" }) });
			expect(res.status).toBe("BLOCKED");
		});

		test("returns BLOCKED for fatal non-zero exit codes like exitCode 2", () => {
			const res = normalizeToolResult({ exitCode: 2, sarif: sampleSarifWithFindings });
			expect(res.status).toBe("BLOCKED");
		});

		test("accepts object SARIF directly", () => {
			const sarifObj = {
				version: "2.1.0",
				runs: [{ tool: { driver: { name: "trivy" } }, results: [{ ruleId: "CVE-2026-1" }] }],
			};
			const res = normalizeToolResult({ exitCode: 1, sarif: sarifObj });
			expect(res).toMatchObject({ status: "FAIL", findings: 1 });
		});

		test("preserves tool, argv, and bounded reason", () => {
			const res = normalizeToolResult({
				tool: "gitleaks",
				argv: ["gitleaks", "git", "--redact"],
				error: "Command failed: fatal gitleaks error with sensitive text: secret12345",
			});
			expect(res.tool).toBe("gitleaks");
			expect(res.argv).toEqual(["gitleaks", "git", "--redact"]);
			expect(res.status).toBe("BLOCKED");
			expect(res.reason).toBeDefined();
			expect(res.reason!.length).toBeLessThanOrEqual(500);
		});
	});

	describe("2. Deterministic SARIF Merging (mergeSarifResults)", () => {
		test("produces standard SARIF 2.1.0 document with schema and version", () => {
			const merged = mergeSarifResults([sampleEmptySarif]);
			expect(merged.$schema).toBe("https://json.schemastore.org/sarif-2.1.0.json");
			expect(merged.version).toBe("2.1.0");
			expect(Array.isArray(merged.runs)).toBe(true);
		});

		test("handles empty inputs returning empty runs array", () => {
			const merged = mergeSarifResults([]);
			expect(merged.runs).toEqual([]);
		});

		test("skips malformed or invalid SARIF inputs safely", () => {
			const merged = mergeSarifResults(["invalid-json", null, undefined, sampleEmptySarif]);
			const runs = Array.isArray(merged.runs) ? merged.runs : [];
			expect(runs.length).toBe(1);
		});

		test("sorts runs deterministically by tool driver name", () => {
			const trivySarif = {
				version: "2.1.0",
				runs: [{ tool: { driver: { name: "trivy", version: "0.50.0" } }, results: [] }],
			};
			const gitleaksSarif = {
				version: "2.1.0",
				runs: [{ tool: { driver: { name: "gitleaks", version: "8.18.0" } }, results: [] }],
			};
			const semgrepSarif = {
				version: "2.1.0",
				runs: [{ tool: { driver: { name: "semgrep", version: "1.60.0" } }, results: [] }],
			};

			const merged = mergeSarifResults([trivySarif, gitleaksSarif, semgrepSarif]);
			const runs = Array.isArray(merged.runs) ? (merged.runs as Array<{ tool: { driver: { name: string } } }>) : [];
			const runNames = runs.map((r) => r.tool.driver.name);
			expect(runNames).toEqual(["gitleaks", "semgrep", "trivy"]);
		});

		test("sorts results within a run deterministically by ruleId, file URI, line, and column", () => {
			const sarifWithMultipleResults = {
				version: "2.1.0",
				runs: [
					{
						tool: { driver: { name: "semgrep" } },
						results: [
							{
								ruleId: "b-rule",
								locations: [{ physicalLocation: { artifactLocation: { uri: "src/b.ts" }, region: { startLine: 10, startColumn: 1 } } }],
							},
							{
								ruleId: "a-rule",
								locations: [{ physicalLocation: { artifactLocation: { uri: "src/z.ts" }, region: { startLine: 5, startColumn: 1 } } }],
							},
							{
								ruleId: "b-rule",
								locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 20, startColumn: 1 } } }],
							},
							{
								ruleId: "b-rule",
								locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 5, startColumn: 10 } } }],
							},
							{
								ruleId: "b-rule",
								locations: [{ physicalLocation: { artifactLocation: { uri: "src/a.ts" }, region: { startLine: 5, startColumn: 2 } } }],
							},
						],
					},
				],
			};

			const merged = mergeSarifResults([sarifWithMultipleResults]);
			const runs = Array.isArray(merged.runs) ? (merged.runs as Array<{ results: Array<{ ruleId: string; locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number; startColumn: number } } }> }> }>) : [];
			const results = runs[0].results;

			expect(results[0].ruleId).toBe("a-rule");
			expect(results[1].ruleId).toBe("b-rule");
			expect(results[1].locations[0].physicalLocation.artifactLocation.uri).toBe("src/a.ts");
			expect(results[1].locations[0].physicalLocation.region.startLine).toBe(5);
			expect(results[1].locations[0].physicalLocation.region.startColumn).toBe(2);

			expect(results[2].locations[0].physicalLocation.region.startLine).toBe(5);
			expect(results[2].locations[0].physicalLocation.region.startColumn).toBe(10);

			expect(results[3].locations[0].physicalLocation.region.startLine).toBe(20);
			expect(results[4].locations[0].physicalLocation.artifactLocation.uri).toBe("src/b.ts");
		});
	});

	describe("3. Manifest Persistence & Reading", () => {
		let tempDir: string;

		const createSampleManifest = (runId = "run-12345"): SecurityRunManifest => ({
			runId,
			mode: "full",
			policy: "required",
			head: "abcdef0123456789",
			startedAt: "2026-08-29T12:00:00.000Z",
			completedAt: "2026-08-29T12:01:00.000Z",
			tools: [
				{ tool: "semgrep", status: "PASS", argv: ["semgrep", "scan"], findings: 0 },
				{ tool: "gitleaks", status: "PASS", argv: ["gitleaks", "git"], findings: 0 },
				{ tool: "trivy", status: "PASS", argv: ["trivy", "fs"], findings: 0 },
			],
			coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
			status: "PASS",
			mergedSarifPath: `.omp/security/runs/${runId}/merged.sarif`,
		});

		test("writes manifest atomically to run path and updates latest.json", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-write-"));
			const manifest = createSampleManifest("test-run-001");
			const res = writeSecurityRunManifest(tempDir, manifest);

			expect(res.ok).toBe(true);
			expect(res.manifestPath).toBeDefined();
			expect(res.latestPath).toBeDefined();

			const readByRun = readSecurityRunManifest(tempDir, "test-run-001");
			expect(readByRun.ok).toBe(true);
			expect(readByRun.manifest).toEqual(manifest);

			const readLatest = readLatestSecurityManifest(tempDir);
			expect(readLatest.ok).toBe(true);
			expect(readLatest.manifest).toEqual(manifest);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects invalid manifest before writing", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-inv-"));
			const invalidManifest = {
				...createSampleManifest("invalid-01"),
				status: "INVALID_STATUS" as unknown as SecurityResultStatus,
			};
			const res = writeSecurityRunManifest(tempDir, invalidManifest);
			expect(res.ok).toBe(false);
			expect(res.error).toMatch(/validation|invalid/i);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("rejects runId with directory traversal or illegal characters", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-trav-"));
			const manifest = createSampleManifest("run-safe");
			manifest.runId = "../escaped-run";
			const res = writeSecurityRunManifest(tempDir, manifest);
			expect(res.ok).toBe(false);

			const readRes = readSecurityRunManifest(tempDir, "../../etc/passwd");
			expect(readRes.ok).toBe(false);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("returns error when manifest does not exist", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-noent-"));
			const readRes = readSecurityRunManifest(tempDir, "nonexistent");
			expect(readRes.ok).toBe(false);
			expect(readRes.error).toBeDefined();

			const readLatest = readLatestSecurityManifest(tempDir);
			expect(readLatest.ok).toBe(false);
			expect(readLatest.error).toBeDefined();

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("refuses symlink target when reading run manifest", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-sym-"));
			const targetDir = join(tempDir, ".omp", "security", "runs", "sym-run");
			mkdirSync(targetDir, { recursive: true });
			const targetFile = join(tempDir, "external.json");
			writeFileSync(targetFile, JSON.stringify(createSampleManifest("sym-run")), "utf8");

			try {
				symlinkSync(targetFile, join(targetDir, "manifest.json"));
				const readRes = readSecurityRunManifest(tempDir, "sym-run");
				expect(readRes.ok).toBe(false);
				expect(readRes.error).toMatch(/symlink/i);
			} catch {
				// On Windows unprivileged symlink creation might fail; skip if symlink cannot be created
			}

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("refuses oversized manifest file", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-mf-oversized-"));
			const targetDir = join(tempDir, ".omp", "security", "runs", "big-run");
			mkdirSync(targetDir, { recursive: true });
			const bigFile = join(targetDir, "manifest.json");
			const bigManifest = {
				...createSampleManifest("big-run"),
				extraPadding: "x".repeat(600 * 1024),
			};
			writeFileSync(bigFile, JSON.stringify(bigManifest), "utf8");

			const readRes = readSecurityRunManifest(tempDir, "big-run");
			expect(readRes.ok).toBe(false);
			expect(readRes.error).toMatch(/exceeds/i);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("refuses symlink latest.json when reading latest manifest", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-latest-sym-"));
			const secDir = join(tempDir, ".omp", "security");
			mkdirSync(secDir, { recursive: true });
			const targetFile = join(tempDir, "external-latest.json");
			writeFileSync(targetFile, JSON.stringify(createSampleManifest("run-1")), "utf8");

			try {
				symlinkSync(targetFile, join(secDir, "latest.json"));
				const readRes = readLatestSecurityManifest(tempDir);
				expect(readRes.ok).toBe(false);
				expect(readRes.error).toMatch(/symlink/i);
			} catch {
				// Skip if symlink not allowed
			}

			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("4. End-to-End Scan Execution (runSecurityScan)", () => {
		let tempDir: string;

		test("full scan with all tools PASS produces PASS manifest and writes merged SARIF", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-pass-"));
			const config: SecurityConfig = {
				policy: "required",
				tools: ["semgrep", "gitleaks", "trivy"],
			};

			const fakeExecutor = (_cwd: string, step: { id: string; command: string; executable: string; args: string[] }) => {
				const outputPath = step.args[step.args.indexOf("--output") !== -1 ? step.args.indexOf("--output") + 1 : step.args.indexOf("--report-path") + 1];
				if (outputPath) {
					writeFileSync(
						outputPath,
						JSON.stringify({
							version: "2.1.0",
							runs: [{ tool: { driver: { name: step.executable } }, results: [] }],
						})
					);
				}
				return {
					id: step.id,
					command: step.command,
					exitCode: 0,
					output: "Scan clean",
				};
			};

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				executeStep: fakeExecutor,
				resolveExecutable: (_cwd, exe) => `C:\\tools\\${exe}.exe`,
			});

			expect(result.manifest.status).toBe("PASS");
			expect(result.manifest.coverage).toEqual({ requested: 3, completed: 3, blocked: 0, notRun: 0 });
			expect(result.manifest.tools.every((t) => t.status === "PASS")).toBe(true);
			expect(result.mergedSarif).toBeDefined();
			expect(result.mergedSarifPath).toBeDefined();

			const latest = readLatestSecurityManifest(tempDir);
			expect(latest.ok).toBe(true);
			expect(latest.manifest?.status).toBe("PASS");

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("scan with findings produces FAIL manifest with finding counts", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-fail-"));
			const config: SecurityConfig = {
				policy: "required",
				tools: ["semgrep"],
			};

			const fakeExecutor = (_cwd: string, step: { id: string; command: string; executable: string; args: string[] }) => {
				const outputPath = step.args[step.args.indexOf("--output") + 1];
				if (outputPath) {
					writeFileSync(
						outputPath,
						JSON.stringify({
							version: "2.1.0",
							runs: [
								{
									tool: { driver: { name: "semgrep" } },
									results: [{ ruleId: "security.leak", message: { text: "finding" } }],
								},
							],
						})
					);
				}
				return {
					id: step.id,
					command: step.command,
					exitCode: 1,
					output: "1 finding found",
				};
			};

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				executeStep: fakeExecutor,
				resolveExecutable: () => "C:\\tools\\semgrep.exe",
			});

			expect(result.manifest.status).toBe("FAIL");
			expect(result.manifest.tools[0].status).toBe("FAIL");
			expect(result.manifest.tools[0].findings).toBe(1);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("scan with missing tool under optional policy marks NOT_RUN and does not block", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-opt-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["semgrep"],
			};

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				resolveExecutable: () => undefined, // tool absent
			});

			expect(result.manifest.status).toBe("NOT_RUN");
			expect(result.manifest.coverage.notRun).toBe(1);
			expect(result.manifest.tools[0].status).toBe("NOT_RUN");

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("scan with missing tool under required policy marks BLOCKED and blocks aggregate", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-req-"));
			const config: SecurityConfig = {
				policy: "required",
				tools: ["semgrep"],
			};

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				resolveExecutable: () => undefined, // tool absent
			});

			expect(result.manifest.status).toBe("BLOCKED");
			expect(result.manifest.coverage.blocked).toBe(1);
			expect(result.manifest.tools[0].status).toBe("BLOCKED");

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("scan timeout marks tool and aggregate as BLOCKED", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-timeout-"));
			const config: SecurityConfig = {
				policy: "required",
				tools: ["semgrep"],
			};

			const fakeExecutor = (_cwd: string, step: { id: string; command: string }) => ({
				id: step.id,
				command: step.command,
				exitCode: 1,
				output: "VERIFY_RUNTIME_GATE: ETIMEDOUT execution timed out",
			});

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				executeStep: fakeExecutor,
				resolveExecutable: () => "C:\\tools\\semgrep.exe",
			});

			expect(result.manifest.status).toBe("BLOCKED");
			expect(result.manifest.tools[0].status).toBe("BLOCKED");
			expect(result.manifest.tools[0].reason).toMatch(/timed out|timeout|gate/i);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("redacts secret patterns and limits reason length in gitleaks tool results", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-redact-"));
			const config: SecurityConfig = {
				policy: "required",
				tools: ["gitleaks"],
			};

			const sensitiveToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
			const fakeExecutor = (_cwd: string, step: { id: string; command: string }) => ({
				id: step.id,
				command: step.command,
				exitCode: 2,
				output: `Error found secret token: ${sensitiveToken} with some extra details`.repeat(20),
			});

			const result = runSecurityScan(tempDir, "full", {
				config,
				head: "1122334455667788",
				executeStep: fakeExecutor,
				resolveExecutable: () => "C:\\tools\\gitleaks.exe",
			});

			expect(result.manifest.tools[0].status).toBe("BLOCKED");
			expect(result.manifest.tools[0].reason).toBeDefined();
			expect(result.manifest.tools[0].reason).not.toContain(sensitiveToken);
			expect(result.manifest.tools[0].reason!.length).toBeLessThanOrEqual(500);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("diff mode passes git range to gitleaks", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-scan-diff-"));
			const config: SecurityConfig = {
				policy: "optional",
				tools: ["gitleaks"],
			};

			let capturedArgs: string[] = [];
			const fakeExecutor = (_cwd: string, step: { id: string; command: string; args: string[] }) => {
				capturedArgs = step.args;
				return {
					id: step.id,
					command: step.command,
					exitCode: 0,
					output: "Clean",
				};
			};

			runSecurityScan(tempDir, "diff", {
				config,
				head: "1122334455667788",
				baseRef: "HEAD~1",
				headRef: "HEAD",
				executeStep: fakeExecutor,
				resolveExecutable: () => "C:\\tools\\gitleaks.exe",
			});

			expect(capturedArgs).toContain("--log-opts");
			expect(capturedArgs).toContain("HEAD~1...HEAD");

			rmSync(tempDir, { recursive: true, force: true });
		});
	});
});

describe("Security Runner - Task 4 Status and Release Ready Helper", () => {
	describe("1. securityStatus helper", () => {
		let tempDir: string;

		test("reads config, resolved tool availability, and latest manifest", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-status-full-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: release-required\n  tools: [semgrep, trivy]\n",
				"utf8"
			);

			const manifest: SecurityRunManifest = {
				runId: "run-status-001",
				mode: "full",
				policy: "release-required",
				head: "1122334455667788",
				startedAt: "2026-08-29T12:00:00Z",
				completedAt: "2026-08-29T12:01:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 2, completed: 2, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const status = securityStatus(tempDir, {
				resolveExecutable: (_c, tool) => (tool === "semgrep" ? "/bin/semgrep" : undefined),
			});

			expect(status.config.policy).toBe("release-required");
			expect(status.config.tools).toEqual(["semgrep", "trivy"]);
			expect(status.latest).toBeDefined();
			expect(status.latest?.runId).toBe("run-status-001");

			const semgrepTool = status.tools.find((t) => t.tool === "semgrep");
			expect(semgrepTool?.available).toBe(true);
			expect(semgrepTool?.path).toBe("/bin/semgrep");
			expect(semgrepTool?.configured).toBe(true);

			const trivyTool = status.tools.find((t) => t.tool === "trivy");
			expect(trivyTool?.available).toBe(false);
			expect(trivyTool?.configured).toBe(true);

			const gitleaksTool = status.tools.find((t) => t.tool === "gitleaks");
			expect(gitleaksTool?.configured).toBe(false);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("returns default optional config and unrun tools when no config or runs exist", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-status-empty-"));
			const status = securityStatus(tempDir, {
				resolveExecutable: () => undefined,
			});

			expect(status.config.policy).toBe("optional");
			expect(status.latest).toBeUndefined();
			expect(status.tools.every((t) => !t.available)).toBe(true);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("captures config parse error safely without throwing", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-status-err-"));
			mkdirSync(join(tempDir, ".omp"), { recursive: true });
			writeFileSync(join(tempDir, ".omp", "config.yml"), "security:\n  policy: invalid-pol\n", "utf8");

			const status = securityStatus(tempDir);
			expect(status.config.error).toBeDefined();
			expect(status.config.error).toMatch(/policy/i);

			rmSync(tempDir, { recursive: true, force: true });
		});
	});

	describe("2. securityReleaseReady comprehensive manifest cases", () => {
		let tempDir: string;

		test("fresh complete manifest with all passing tools passes release-ready", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-fresh-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: release-required\n  tools: [semgrep, gitleaks, trivy]\n",
				"utf8"
			);

			const headSha = "abcdef1234567890abcdef1234567890abcdef12";
			const manifest: SecurityRunManifest = {
				runId: "run-fresh-pass",
				mode: "full",
				policy: "release-required",
				head: headSha,
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:02:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "gitleaks", status: "PASS", argv: ["gitleaks"] },
					{ tool: "trivy", status: "PASS", argv: ["trivy"] },
				],
				coverage: { requested: 3, completed: 3, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: headSha });
			expect(result.ready).toBe(true);
			expect(result.status).toBe("PASS");
			expect(result.policy).toBe("release-required");

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("stale manifest (different HEAD) blocks release-ready", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-stale-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: release-required\n  tools: [semgrep]\n",
				"utf8"
			);

			const manifest: SecurityRunManifest = {
				runId: "run-stale",
				mode: "full",
				policy: "release-required",
				head: "1111111111111111",
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:02:00Z",
				tools: [{ tool: "semgrep", status: "PASS", argv: ["semgrep"] }],
				coverage: { requested: 1, completed: 1, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: "2222222222222222" });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/stale/i);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("partial manifest with unrun tool blocks release-ready under required policy", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-partial-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: required\n  tools: [semgrep, trivy]\n",
				"utf8"
			);

			const headSha = "abcdef1234567890abcdef1234567890abcdef12";
			const manifest: SecurityRunManifest = {
				runId: "run-partial",
				mode: "full",
				policy: "required",
				head: headSha,
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:02:00Z",
				tools: [
					{ tool: "semgrep", status: "PASS", argv: ["semgrep"] },
					{ tool: "trivy", status: "NOT_RUN", argv: [] },
				],
				coverage: { requested: 2, completed: 1, blocked: 0, notRun: 1 },
				status: "NOT_RUN",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: headSha });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/blocked|unrun|not_run|not run|coverage|status/i);

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("blocked tool manifest blocks release-ready under release-required policy", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-blocked-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: release-required\n  tools: [semgrep]\n",
				"utf8"
			);

			const headSha = "abcdef1234567890abcdef1234567890abcdef12";
			const manifest: SecurityRunManifest = {
				runId: "run-blocked",
				mode: "full",
				policy: "release-required",
				head: headSha,
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:02:00Z",
				tools: [{ tool: "semgrep", status: "BLOCKED", argv: ["semgrep"], reason: "Crash" }],
				coverage: { requested: 1, completed: 0, blocked: 1, notRun: 0 },
				status: "BLOCKED",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: headSha });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");

			rmSync(tempDir, { recursive: true, force: true });
		});

		test("manifest missing a configured required tool blocks release-ready", () => {
			tempDir = mkdtempSync(join(tmpdir(), "omp-sec-rel-missingtool-"));
			mkdirSync(join(tempDir, ".omp", "security"), { recursive: true });
			writeFileSync(
				join(tempDir, ".omp", "config.yml"),
				"security:\n  policy: release-required\n  tools: [semgrep, gitleaks]\n",
				"utf8"
			);

			const headSha = "abcdef1234567890abcdef1234567890abcdef12";
			// Manifest only ran semgrep, gitleaks was omitted
			const manifest: SecurityRunManifest = {
				runId: "run-missing-tool",
				mode: "full",
				policy: "release-required",
				head: headSha,
				startedAt: "2026-08-29T10:00:00Z",
				completedAt: "2026-08-29T10:02:00Z",
				tools: [{ tool: "semgrep", status: "PASS", argv: ["semgrep"] }],
				coverage: { requested: 1, completed: 1, blocked: 0, notRun: 0 },
				status: "PASS",
			};
			writeFileSync(join(tempDir, ".omp", "security", "latest.json"), JSON.stringify(manifest), "utf8");

			const result = securityReleaseReady(tempDir, { head: headSha });
			expect(result.ready).toBe(false);
			expect(result.status).toBe("BLOCKED");
			expect(result.reason).toMatch(/gitleaks/i);

			rmSync(tempDir, { recursive: true, force: true });
		});
	});
});
