import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { safeRepoPath } from "./paths";
import { gitHead } from "./release";
import type { VerifyStep } from "./skills/detector";

export type SecurityToolId = "semgrep" | "gitleaks" | "trivy" | "codeql";
export type SecurityMode = "status" | "diff" | "full" | "codeql";
export type SecurityResultStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export type SecurityPolicy = "optional" | "release-required" | "required";

export const ALL_SECURITY_TOOLS: SecurityToolId[] = ["semgrep", "gitleaks", "trivy", "codeql"];
export const DEFAULT_SECURITY_TOOLS: SecurityToolId[] = ["semgrep", "gitleaks", "trivy"];
export const VALID_POLICIES: Record<SecurityPolicy, true> = {
	optional: true,
	"release-required": true,
	required: true,
};

export const MAX_CONFIG_BYTES = 512 * 1024;
export const MAX_LICENSE_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface SecurityConfig {
	policy: SecurityPolicy;
	tools: SecurityToolId[];
	timeoutMs?: number;
	semgrep?: {
		configs?: string[];
	};
	codeql?: {
		database?: string;
		suite?: string;
	};
	error?: string;
}

export interface SecurityToolResult {
	tool: SecurityToolId;
	status: SecurityResultStatus;
	exitCode?: number;
	version?: string;
	argv: string[];
	outputPath?: string;
	findings?: number;
	reason?: string;
}

export interface SecurityRunManifest {
	runId: string;
	mode: Exclude<SecurityMode, "status">;
	policy: SecurityPolicy;
	head: string;
	startedAt: string;
	completedAt: string;
	tools: SecurityToolResult[];
	coverage: { requested: number; completed: number; blocked: number; notRun: number };
	status: SecurityResultStatus;
	mergedSarifPath?: string;
}

export interface PlannedToolStep {
	tool: SecurityToolId;
	status: "PLANNED" | "BLOCKED" | "NOT_RUN";
	step?: VerifyStep;
	outputPath?: string;
	reason?: string;
}

export interface SecurityPlan {
	runId: string;
	runDir: string;
	mode: Exclude<SecurityMode, "status">;
	policy: SecurityPolicy;
	steps: PlannedToolStep[];
	blocked: Array<{ tool: SecurityToolId; reason: string }>;
}

export interface SecurityReleaseReadyResult {
	ready: boolean;
	policy: SecurityPolicy;
	status: "PASS" | "FAIL" | "BLOCKED" | "NOT_REQUIRED";
	reason?: string;
	manifest?: SecurityRunManifest;
}

export const OSI_APPROVED_SPDX_LICENSES = new Set<string>([
	"0BSD",
	"AFL-1.1",
	"AFL-1.2",
	"AFL-2.0",
	"AFL-2.1",
	"AFL-3.0",
	"AGPL-3.0",
	"AGPL-3.0-only",
	"AGPL-3.0-or-later",
	"Apache-1.0",
	"Apache-1.1",
	"Apache-2.0",
	"Artistic-1.0",
	"Artistic-1.0-cl8",
	"Artistic-1.0-Perl",
	"Artistic-2.0",
	"BSD-1-Clause",
	"BSD-2-Clause",
	"BSD-2-Clause-Patent",
	"BSD-3-Clause",
	"BSD-3-Clause-Clear",
	"BSL-1.0",
	"CC0-1.0",
	"CDDL-1.0",
	"CDDL-1.1",
	"CPL-1.0",
	"EPL-1.0",
	"EPL-2.0",
	"EUPL-1.1",
	"EUPL-1.2",
	"GPL-2.0",
	"GPL-2.0-only",
	"GPL-2.0-or-later",
	"GPL-3.0",
	"GPL-3.0-only",
	"GPL-3.0-or-later",
	"ISC",
	"LGPL-2.0",
	"LGPL-2.0-only",
	"LGPL-2.0-or-later",
	"LGPL-2.1",
	"LGPL-2.1-only",
	"LGPL-2.1-or-later",
	"LGPL-3.0",
	"LGPL-3.0-only",
	"LGPL-3.0-or-later",
	"LPPL-1.3c",
	"MIT",
	"MIT-0",
	"MPL-1.0",
	"MPL-1.1",
	"MPL-2.0",
	"MS-PL",
	"MS-RL",
	"NCSA",
	"ODbL-1.0",
	"OFL-1.1",
	"OSL-1.0",
	"OSL-2.0",
	"OSL-3.0",
	"PostgreSQL",
	"Python-2.0",
	"QPL-1.0",
	"RPL-1.5",
	"UPL-1.0",
	"Unlicense",
	"Vim",
	"W3C",
	"WTFPL",
	"Zlib",
]);

function extractListValues(line: string, subsequentLines: string[]): { values: string[]; consumed: number } {
	const inlineMatch = line.match(/:\s*\[(.*?)\]/);
	if (inlineMatch) {
		const rawItems = inlineMatch[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
		return { values: rawItems, consumed: 0 };
	}
	const values: string[] = [];
	let consumed = 0;
	for (const subLine of subsequentLines) {
		const match = subLine.match(/^\s*-\s+(.+)$/);
		if (match) {
			values.push(match[1].trim().replace(/^["']|["']$/g, ""));
			consumed++;
		} else {
			break;
		}
	}
	return { values, consumed };
}

export function parseSecurityConfig(text: string): SecurityConfig {
	if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
		return { policy: "optional", tools: [], error: `security config exceeds the ${MAX_CONFIG_BYTES}-byte (512 KiB) limit` };
	}

	if (!text.trim()) {
		return {
			policy: "optional",
			tools: [...DEFAULT_SECURITY_TOOLS],
			timeoutMs: DEFAULT_TIMEOUT_MS,
			semgrep: { configs: ["p/security-audit"] },
		};
	}

	// Reject forbidden executable/command overrides anywhere in configuration
	if (/(?:^|\n)\s*(?:executable|command|exec|sh|bash|cmd|script)\s*:/i.test(text)) {
		return { policy: "optional", tools: [], error: "security config: executable and command overrides are forbidden" };
	}

	const rawLines = text.replace(/\r\n/g, "\n").split("\n");
	// Check shell metacharacters in non-comment portions
	for (const line of rawLines) {
		const codePart = line.replace(/#.*$/, "");
		if (/[\x00-\x1f\x7f;&|`$<>]/.test(codePart)) {
			return { policy: "optional", tools: [], error: "security config contains forbidden shell characters or control characters" };
		}
	}

	const securityStart = rawLines.findIndex((l) => /^\s*security:\s*$/.test(l.replace(/#.*$/, "")) && !/^\s{2,}/.test(l));
	if (securityStart === -1) {
		return {
			policy: "optional",
			tools: [...DEFAULT_SECURITY_TOOLS],
			timeoutMs: DEFAULT_TIMEOUT_MS,
			semgrep: { configs: ["p/security-audit"] },
		};
	}

	const blockLines: string[] = [];
	const headerIndent = rawLines[securityStart].match(/^\s*/)?.[0].length ?? 0;
	for (let i = securityStart + 1; i < rawLines.length; i++) {
		const line = rawLines[i];
		const codePart = line.replace(/#.*$/, "");
		if (!codePart.trim()) continue;
		const lineIndent = line.match(/^\s*/)?.[0].length ?? 0;
		if (lineIndent <= headerIndent && /^[a-zA-Z0-9_.-]+:/.test(codePart.trim())) break;
		blockLines.push(line);
	}

	let policy: SecurityPolicy = "optional";
	let tools: SecurityToolId[] = [...DEFAULT_SECURITY_TOOLS];
	let timeoutMs: number = DEFAULT_TIMEOUT_MS;
	let semgrepConfigs: string[] = ["p/security-audit"];
	let codeqlDb: string | undefined;
	let codeqlSuite: string | undefined;

	let i = 0;
	while (i < blockLines.length) {
		const rawLine = blockLines[i];
		const line = rawLine.replace(/#.*$/, "");
		const trimmed = line.trim();
		if (!trimmed) {
			i++;
			continue;
		}
		const currentIndent = rawLine.match(/^\s*/)?.[0].length ?? 0;

		if (/^policy:\s*/i.test(trimmed)) {
			const val = trimmed.replace(/^policy:\s*/i, "").trim().replace(/^["']|["']$/g, "").toLowerCase() as SecurityPolicy;
			if (!VALID_POLICIES[val]) {
				return { policy: "optional", tools: [], error: `unknown policy: ${val}` };
			}
			policy = val;
			i++;
		} else if (/^tools:\s*/i.test(trimmed)) {
			const { values, consumed } = extractListValues(trimmed, blockLines.slice(i + 1).map((l) => l.replace(/#.*$/, "")));
			const parsedTools: SecurityToolId[] = [];
			for (const item of values) {
				const toolName = item.toLowerCase() as SecurityToolId;
				if (!ALL_SECURITY_TOOLS.includes(toolName)) {
					return { policy: "optional", tools: [], error: `unknown tool: ${item}` };
				}
				if (!parsedTools.includes(toolName)) {
					parsedTools.push(toolName);
				}
			}
			tools = parsedTools;
			i += 1 + consumed;
		} else if (/^(?:timeout_ms|timeoutMs):\s*/i.test(trimmed)) {
			const val = Number(trimmed.replace(/^(?:timeout_ms|timeoutMs):\s*/i, "").trim());
			if (!Number.isFinite(val) || val < 1000 || val > 1800000) {
				return { policy: "optional", tools: [], error: `invalid timeout_ms: ${val}` };
			}
			timeoutMs = val;
			i++;
		} else if (/^semgrep:\s*$/i.test(trimmed)) {
			i++;
			while (i < blockLines.length) {
				const rawSub = blockLines[i];
				const sub = rawSub.replace(/#.*$/, "");
				if (!sub.trim()) {
					i++;
					continue;
				}
				const subIndent = rawSub.match(/^\s*/)?.[0].length ?? 0;
				if (subIndent <= currentIndent) break;

				if (/^\s*configs:\s*/i.test(sub)) {
					const { values, consumed } = extractListValues(sub, blockLines.slice(i + 1).map((l) => l.replace(/#.*$/, "")));
					for (const cfg of values) {
						if (!cfg || cfg === "auto" || cfg === "p/auto" || /\bauto\b/i.test(cfg)) {
							return { policy: "optional", tools: [], error: `semgrep configs must be explicit approved configs; 'auto' and 'p/auto' are forbidden (${cfg})` };
						}
					}
					semgrepConfigs = values;
					i += 1 + consumed;
				} else {
					i++;
				}
			}
		} else if (/^codeql:\s*$/i.test(trimmed)) {
			i++;
			while (i < blockLines.length) {
				const rawSub = blockLines[i];
				const sub = rawSub.replace(/#.*$/, "");
				if (!sub.trim()) {
					i++;
					continue;
				}
				const subIndent = rawSub.match(/^\s*/)?.[0].length ?? 0;
				if (subIndent <= currentIndent) break;

				if (/^\s*database:\s*/i.test(sub)) {
					codeqlDb = sub.replace(/^\s*database:\s*/i, "").trim().replace(/^["']|["']$/g, "");
					i++;
				} else if (/^\s*suite:\s*/i.test(sub)) {
					codeqlSuite = sub.replace(/^\s*suite:\s*/i, "").trim().replace(/^["']|["']$/g, "");
					i++;
				} else {
					i++;
				}
			}
		} else {
			const unknownKey = trimmed.split(":")[0];
			return { policy: "optional", tools: [], error: `unknown security configuration key: ${unknownKey}` };
		}
	}

	return {
		policy,
		tools,
		timeoutMs,
		semgrep: {
			configs: semgrepConfigs,
		},
		...(codeqlDb || codeqlSuite ? { codeql: { database: codeqlDb, suite: codeqlSuite } } : {}),
	};
}

export function detectProjectLicense(cwd: string): { eligible: boolean; license?: string; reason?: string } {
	// 1. Check package.json
	try {
		const pkgPath = safeRepoPath(cwd, "package.json");
		if (pkgPath) {
			const stat = lstatSync(pkgPath);
			if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CONFIG_BYTES) {
				const text = readFileSync(pkgPath, "utf8");
				const json = JSON.parse(text) as Record<string, unknown>;
				const rawLicense = typeof json.license === "string" ? json.license.trim() : "";
				if (rawLicense) {
					for (const approved of OSI_APPROVED_SPDX_LICENSES) {
						if (approved.toLowerCase() === rawLicense.toLowerCase()) {
							return { eligible: true, license: approved };
						}
					}
					return { eligible: false, license: rawLicense, reason: `License '${rawLicense}' in package.json is not an OSI-approved SPDX license` };
				}
			}
		}
	} catch {
		// Ignore json parse / filesystem error
	}

	// 2. Check root LICENSE files
	const licenseCandidates = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "LICENSE-MIT", "LICENSE-APACHE"];
	for (const fileName of licenseCandidates) {
		try {
			const filePath = safeRepoPath(cwd, fileName);
			if (!filePath) continue;
			const stat = lstatSync(filePath);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LICENSE_BYTES) continue;
			const text = readFileSync(filePath, "utf8");

			if (/The MIT License|MIT License/i.test(text)) return { eligible: true, license: "MIT" };
			if (/Apache License(?:,\s*Version\s*2\.0|\s*2\.0)/i.test(text)) return { eligible: true, license: "Apache-2.0" };
			if (/BSD 2-Clause/i.test(text) || /Redistribution and use in source and binary forms[\s\S]+?2-clause/i.test(text)) return { eligible: true, license: "BSD-2-Clause" };
			if (/BSD 3-Clause/i.test(text) || /Redistribution and use in source and binary forms[\s\S]+?3-clause/i.test(text)) return { eligible: true, license: "BSD-3-Clause" };
			if (/ISC License|Permission to use, copy, modify, and\/or distribute this software/i.test(text)) return { eligible: true, license: "ISC" };
			if (/Mozilla Public License,?\s*v(?:ersion)?\.?\s*2\.0/i.test(text)) return { eligible: true, license: "MPL-2.0" };
			if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "GPL-3.0-only" };
			if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(text)) return { eligible: true, license: "GPL-2.0-only" };
			if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i.test(text)) return { eligible: true, license: "LGPL-2.1-only" };
			if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "LGPL-3.0-only" };
			if (/GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "AGPL-3.0-only" };
			if (/Boost Software License - Version 1\.0/i.test(text)) return { eligible: true, license: "BSL-1.0" };
			if (/Zero-Clause BSD|0BSD/i.test(text)) return { eligible: true, license: "0BSD" };
			if (/The Unlicense|released into the public domain/i.test(text)) return { eligible: true, license: "Unlicense" };
			if (/CC0 1\.0 Universal|Public Domain Dedication/i.test(text)) return { eligible: true, license: "CC0-1.0" };
		} catch {
			// Continue
		}
	}

	return { eligible: false, reason: "No recognized OSI-approved license found in package.json or root LICENSE" };
}

export function planSecurityTools(
	cwd: string,
	mode: Exclude<SecurityMode, "status">,
	config: SecurityConfig,
	runDir?: string,
	options?: { baseRef?: string; headRef?: string; runId?: string }
): SecurityPlan {
	const runId = options?.runId || `${Date.now()}-${randomUUID().slice(0, 8)}`;
	const effectiveRunDir = runDir || resolve(cwd, ".omp/security/runs", runId);

	const targetTools: SecurityToolId[] = mode === "codeql" ? ["codeql"] : (config.tools && config.tools.length > 0 ? config.tools : DEFAULT_SECURITY_TOOLS);
	const steps: PlannedToolStep[] = [];
	const blocked: Array<{ tool: SecurityToolId; reason: string }> = [];

	for (const tool of targetTools) {
		if (tool === "semgrep") {
			const outputPath = join(effectiveRunDir, "semgrep.sarif");
			const configs = config.semgrep?.configs && config.semgrep.configs.length > 0 ? config.semgrep.configs : ["p/security-audit"];
			const configArgs = configs.flatMap((c) => ["--config", c]);
			const args = ["scan", "--metrics=off", ...configArgs, "--sarif", "--output", outputPath, "."];
			const step: VerifyStep = {
				id: "security-semgrep",
				command: ["semgrep", ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "),
				executable: "semgrep",
				args,
				cwd,
			};
			steps.push({
				tool: "semgrep",
				status: "PLANNED",
				step,
				outputPath,
			});
		} else if (tool === "gitleaks") {
			const outputPath = join(effectiveRunDir, "gitleaks.sarif");
			let args: string[];
			if (mode === "diff") {
				const baseRef = options?.baseRef || "HEAD~1";
				const headRef = options?.headRef || "HEAD";
				const range = `${baseRef}...${headRef}`;
				args = ["git", "--redact", "--report-format", "sarif", "--report-path", outputPath, "--log-opts", range, "."];
			} else {
				args = ["git", "--redact", "--report-format", "sarif", "--report-path", outputPath, "."];
			}
			const step: VerifyStep = {
				id: "security-gitleaks",
				command: ["gitleaks", ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "),
				executable: "gitleaks",
				args,
				cwd,
			};
			steps.push({
				tool: "gitleaks",
				status: "PLANNED",
				step,
				outputPath,
			});
		} else if (tool === "trivy") {
			const outputPath = join(effectiveRunDir, "trivy.sarif");
			const args = ["fs", "--scanners", "vuln,misconfig,secret", "--format", "sarif", "--output", outputPath, "."];
			const step: VerifyStep = {
				id: "security-trivy",
				command: ["trivy", ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "),
				executable: "trivy",
				args,
				cwd,
			};
			steps.push({
				tool: "trivy",
				status: "PLANNED",
				step,
				outputPath,
			});
		} else if (tool === "codeql") {
			const outputPath = join(effectiveRunDir, "codeql.sarif");
			const license = detectProjectLicense(cwd);
			if (!license.eligible) {
				const reason = `CodeQL requires an OSI-approved open-source project license (${license.reason || "ineligible license"})`;
				steps.push({
					tool: "codeql",
					status: "BLOCKED",
					outputPath,
					reason,
				});
				blocked.push({ tool: "codeql", reason });
			} else if (!config.codeql?.database || !config.codeql?.suite) {
				const reason = "CodeQL requires configured database and suite in .omp/config.yml";
				steps.push({
					tool: "codeql",
					status: "BLOCKED",
					outputPath,
					reason,
				});
				blocked.push({ tool: "codeql", reason });
			} else {
				const db = config.codeql.database;
				const suite = config.codeql.suite;
				const args = ["database", "analyze", db, "--format", "sarifv2.1.0", "--output", outputPath, suite];
				const step: VerifyStep = {
					id: "security-codeql",
					command: ["codeql", ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" "),
					executable: "codeql",
					args,
					cwd,
				};
				steps.push({
					tool: "codeql",
					status: "PLANNED",
					step,
					outputPath,
				});
			}
		}
	}

	return {
		runId,
		runDir: effectiveRunDir,
		mode,
		policy: config.policy,
		steps,
		blocked,
	};
}

export function securityReleaseReady(
	cwd: string,
	options?: { head?: string; config?: SecurityConfig; manifest?: SecurityRunManifest }
): SecurityReleaseReadyResult {
	let config = options?.config;
	if (!config) {
		try {
			const configPath = safeRepoPath(cwd, ".omp/config.yml") || safeRepoPath(cwd, ".omp/config.yaml");
			if (configPath) {
				const stat = lstatSync(configPath);
				if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CONFIG_BYTES) {
					const text = readFileSync(configPath, "utf8");
					config = parseSecurityConfig(text);
				}
			}
		} catch {
			// Fallback to default
		}
		if (!config) {
			config = parseSecurityConfig("");
		}
	}

	if (config.error) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Invalid security configuration: ${config.error}`,
		};
	}

	if (config.policy === "optional") {
		return {
			ready: true,
			policy: "optional",
			status: "NOT_REQUIRED",
		};
	}

	const expectedHead = options?.head || gitHead(cwd);

	let manifest = options?.manifest;
	if (!manifest) {
		try {
			const manifestPath = safeRepoPath(cwd, ".omp/security/latest.json");
			if (manifestPath) {
				const stat = lstatSync(manifestPath);
				if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_CONFIG_BYTES) {
					manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SecurityRunManifest;
				}
			}
		} catch {
			// Manifest read failure
		}
	}

	if (!manifest) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: "No security scan manifest found under .omp/security/latest.json",
		};
	}

	if (!manifest.head || (expectedHead && manifest.head !== expectedHead)) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Security scan manifest is stale (manifest HEAD '${manifest.head || "none"}' does not match current HEAD '${expectedHead}')`,
			manifest,
		};
	}

	if (manifest.status === "FAIL") {
		return {
			ready: false,
			policy: config.policy,
			status: "FAIL",
			reason: "Security scan failed with findings",
			manifest,
		};
	}

	if (manifest.status === "BLOCKED") {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: "Security scan was blocked or encountered an error",
			manifest,
		};
	}

	if (manifest.status !== "PASS") {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Security scan status is ${manifest.status}`,
			manifest,
		};
	}

	if (manifest.coverage.blocked > 0 || manifest.coverage.notRun > 0) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Security scan has blocked (${manifest.coverage.blocked}) or unrun (${manifest.coverage.notRun}) tools`,
			manifest,
		};
	}

	const requiredTools = config.tools && config.tools.length > 0 ? config.tools : DEFAULT_SECURITY_TOOLS;
	for (const tool of requiredTools) {
		const toolRes = manifest.tools.find((t) => t.tool === tool);
		if (!toolRes || toolRes.status !== "PASS") {
			return {
				ready: false,
				policy: config.policy,
				status: "BLOCKED",
				reason: `Configured security tool '${tool}' did not PASS in latest manifest (status: ${toolRes?.status || "MISSING"})`,
				manifest,
			};
		}
	}

	return {
		ready: true,
		policy: config.policy,
		status: "PASS",
		manifest,
	};
}
