import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { safeRepoPath } from "./paths";
import { gitHead } from "./release";
import { trustedExecutable } from "./verify-runner";
import { gitCall } from "./git-runtime";
import type { VerifyStep } from "./skills/detector";

export type SecurityToolId = "semgrep" | "gitleaks" | "trivy" | "codeql";
export type SecurityMode = "status" | "diff" | "full" | "codeql";
export type SecurityResultStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";
export type SecurityPolicy = "optional" | "release-required" | "required";

export const ALL_SECURITY_TOOLS: readonly SecurityToolId[] = Object.freeze(["semgrep", "gitleaks", "trivy", "codeql"]);
export const DEFAULT_SECURITY_TOOLS: readonly SecurityToolId[] = Object.freeze(["semgrep", "gitleaks", "trivy"]);
export const VALID_POLICIES: Readonly<Record<SecurityPolicy, true>> = Object.freeze({
	optional: true,
	"release-required": true,
	required: true,
});

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

const OSI_APPROVED_LIST: string[] = [
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
	"Zlib",
];
export const OSI_APPROVED_SPDX_LICENSES: ReadonlySet<string> = Object.freeze(new Set<string>(OSI_APPROVED_LIST));

function parseListValues(headerLine: string, subsequentLines: string[], maxCount: number): { values?: string[]; error?: string; consumed: number } {
	const inlineMatch = headerLine.match(/:\s*\[(.*?)\](\s*.*)$/);
	if (inlineMatch) {
		const trailing = inlineMatch[2].replace(/#.*$/, "").trim();
		if (trailing) {
			return { error: `malformed list with trailing tokens: '${trailing}'`, consumed: 0 };
		}
		const rawItems = inlineMatch[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
		if (rawItems.length > maxCount) {
			return { error: `list count exceeds maximum ${maxCount} items`, consumed: 0 };
		}
		return { values: rawItems, consumed: 0 };
	}

	const scalarMatch = headerLine.match(/:\s*(\S+.*)$/);
	if (scalarMatch && !scalarMatch[1].startsWith("#")) {
		return { error: `expected a list, got scalar '${scalarMatch[1].trim()}'`, consumed: 0 };
	}

	const values: string[] = [];
	let consumed = 0;
	for (const subLine of subsequentLines) {
		const match = subLine.match(/^\s*-\s+(.+)$/);
		if (match) {
			values.push(match[1].replace(/#.*$/, "").trim().replace(/^["']|["']$/g, ""));
			consumed++;
			if (values.length > maxCount) {
				return { error: `list count exceeds maximum ${maxCount} items`, consumed };
			}
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

	const rawLines = text.replace(/\r\n/g, "\n").split("\n");

	// Top-level security: must start at column 0
	const securityStart = rawLines.findIndex((l) => /^security:\s*(?:#.*)?$/.test(l));
	if (securityStart === -1) {
		return {
			policy: "optional",
			tools: [...DEFAULT_SECURITY_TOOLS],
			timeoutMs: DEFAULT_TIMEOUT_MS,
			semgrep: { configs: ["p/security-audit"] },
		};
	}

	const blockLines: string[] = [];
	for (let i = securityStart + 1; i < rawLines.length; i++) {
		const line = rawLines[i];
		const codePart = line.replace(/#.*$/, "");
		if (!codePart.trim()) continue;
		if (/^[a-zA-Z0-9_.-]+:/.test(codePart.trim()) && !/^\s/.test(line)) break;
		blockLines.push(line);
	}

	// Reject forbidden overrides and shell characters within the security block
	for (const line of blockLines) {
		const codePart = line.replace(/#.*$/, "");
		if (/(?:^|\s)(?:executable|command|exec|sh|bash|cmd|script)\s*:/i.test(codePart)) {
			return { policy: "optional", tools: [], error: "security config: executable and command overrides are forbidden" };
		}
		if (/[\x00-\x1f\x7f;&|`$<>]/.test(codePart)) {
			return { policy: "optional", tools: [], error: "security config contains forbidden shell characters or control characters" };
		}
	}

	let policy: SecurityPolicy = "optional";
	let tools: SecurityToolId[] = [...DEFAULT_SECURITY_TOOLS];
	let timeoutMs: number = DEFAULT_TIMEOUT_MS;
	let semgrepConfigs: string[] = ["p/security-audit"];
	let codeqlDb: string | undefined;
	let codeqlSuite: string | undefined;

	const seenKeys = new Set<string>();
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

		const keyMatch = trimmed.match(/^([a-zA-Z0-9_.-]+):/);
		if (!keyMatch) {
			return { policy: "optional", tools: [], error: `malformed line in security configuration: '${trimmed}'` };
		}
		const key = keyMatch[1];
		if (seenKeys.has(key)) {
			return { policy: "optional", tools: [], error: `duplicate key in security config: '${key}'` };
		}
		seenKeys.add(key);

		if (key === "policy") {
			const val = trimmed.replace(/^policy:\s*/i, "").trim().replace(/^["']|["']$/g, "").toLowerCase() as SecurityPolicy;
			if (!VALID_POLICIES[val]) {
				return { policy: "optional", tools: [], error: `unknown policy: ${val}` };
			}
			policy = val;
			i++;
		} else if (key === "tools") {
			const { values, error, consumed } = parseListValues(trimmed, blockLines.slice(i + 1).map((l) => l.replace(/#.*$/, "")), 16);
			if (error || !values) {
				return { policy: "optional", tools: [], error: `invalid tools list: ${error || "missing list"}` };
			}
			const parsedTools: SecurityToolId[] = [];
			for (const item of values) {
				if (item.length > 64) {
					return { policy: "optional", tools: [], error: `tool name exceeds 64 characters: '${item}'` };
				}
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
		} else if (key === "timeout_ms" || key === "timeoutMs") {
			const val = Number(trimmed.replace(/^(?:timeout_ms|timeoutMs):\s*/i, "").trim());
			if (!Number.isFinite(val) || val < 1000 || val > 1800000) {
				return { policy: "optional", tools: [], error: `invalid timeout_ms: ${val}` };
			}
			timeoutMs = val;
			i++;
		} else if (key === "semgrep") {
			i++;
			const seenSemgrepKeys = new Set<string>();
			while (i < blockLines.length) {
				const rawSub = blockLines[i];
				const sub = rawSub.replace(/#.*$/, "");
				if (!sub.trim()) {
					i++;
					continue;
				}
				const subIndent = rawSub.match(/^\s*/)?.[0].length ?? 0;
				if (subIndent <= currentIndent) break;

				const subKeyMatch = sub.trim().match(/^([a-zA-Z0-9_.-]+):/);
				if (!subKeyMatch) {
					return { policy: "optional", tools: [], error: `malformed semgrep configuration line: '${sub.trim()}'` };
				}
				const subKey = subKeyMatch[1];
				if (seenSemgrepKeys.has(subKey)) {
					return { policy: "optional", tools: [], error: `duplicate key in semgrep config: '${subKey}'` };
				}
				seenSemgrepKeys.add(subKey);

				if (subKey === "configs") {
					const { values, error, consumed } = parseListValues(sub.trim(), blockLines.slice(i + 1).map((l) => l.replace(/#.*$/, "")), 32);
					if (error || !values) {
						return { policy: "optional", tools: [], error: `invalid semgrep configs list: ${error || "missing list"}` };
					}
					for (const cfg of values) {
						if (cfg.length > 256) {
							return { policy: "optional", tools: [], error: `semgrep config label exceeds 256 characters: '${cfg}'` };
						}
						if (!cfg || cfg === "auto" || cfg === "p/auto" || /\bauto\b/i.test(cfg)) {
							return { policy: "optional", tools: [], error: `semgrep configs must be explicit approved configs; 'auto' and 'p/auto' are forbidden (${cfg})` };
						}
					}
					semgrepConfigs = values;
					i += 1 + consumed;
				} else {
					return { policy: "optional", tools: [], error: `unknown semgrep configuration key: '${subKey}'` };
				}
			}
		} else if (key === "codeql") {
			i++;
			const seenCodeqlKeys = new Set<string>();
			while (i < blockLines.length) {
				const rawSub = blockLines[i];
				const sub = rawSub.replace(/#.*$/, "");
				if (!sub.trim()) {
					i++;
					continue;
				}
				const subIndent = rawSub.match(/^\s*/)?.[0].length ?? 0;
				if (subIndent <= currentIndent) break;

				const subKeyMatch = sub.trim().match(/^([a-zA-Z0-9_.-]+):/);
				if (!subKeyMatch) {
					return { policy: "optional", tools: [], error: `malformed codeql configuration line: '${sub.trim()}'` };
				}
				const subKey = subKeyMatch[1];
				if (seenCodeqlKeys.has(subKey)) {
					return { policy: "optional", tools: [], error: `duplicate key in codeql config: '${subKey}'` };
				}
				seenCodeqlKeys.add(subKey);

				if (subKey === "database") {
					const val = sub.trim().replace(/^database:\s*/i, "").trim().replace(/^["']|["']$/g, "");
					if (val.length > 256) return { policy: "optional", tools: [], error: "codeql database path exceeds 256 characters" };
					codeqlDb = val;
					i++;
				} else if (subKey === "suite") {
					const val = sub.trim().replace(/^suite:\s*/i, "").trim().replace(/^["']|["']$/g, "");
					if (val.length > 256) return { policy: "optional", tools: [], error: "codeql suite path exceeds 256 characters" };
					codeqlSuite = val;
					i++;
				} else {
					return { policy: "optional", tools: [], error: `unknown codeql configuration key: '${subKey}'` };
				}
			}
		} else {
			return { policy: "optional", tools: [], error: `unknown security configuration key: ${key}` };
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
					if (OSI_APPROVED_SPDX_LICENSES.has(rawLicense)) {
						return { eligible: true, license: rawLicense };
					}
					return { eligible: false, license: rawLicense, reason: `License '${rawLicense}' in package.json is not an OSI-approved SPDX license` };
				}
			}
		}
	} catch {
		// Continue
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

			// Reject negation notices
			if (/(?:not|never|neither)\s+(?:be\s+)?(?:licensed|distributed|available|provided|released)\s+under/i.test(text) || /NOT\s+(?:LICENSED|DISTRIBUTED)\s+UNDER/i.test(text)) {
				continue;
			}
			if (/(?:All rights reserved|Proprietary Commercial Software|Proprietary and confidential)/i.test(text) && !/Permission is hereby granted|Redistribution and use/i.test(text)) {
				continue;
			}

			if (/Permission is hereby granted, free of charge, to any person obtaining a copy of this software/i.test(text) || /^[\s\S]*?(?:The MIT License\s*\(MIT\)|MIT License\b)[\s\S]*?Permission is hereby granted/i.test(text)) {
				return { eligible: true, license: "MIT" };
			}
			if (/Apache License\s+Version 2\.0,\s+January 2004/i.test(text) || /http:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0/i.test(text)) {
				return { eligible: true, license: "Apache-2.0" };
			}
			if (/Redistribution and use in source and binary forms[\s\S]+?Neither the name of[\s\S]+?nor the names of its contributors/i.test(text)) {
				return { eligible: true, license: "BSD-3-Clause" };
			}
			if (/Redistribution and use in source and binary forms[\s\S]+?THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS/i.test(text)) {
				return { eligible: true, license: "BSD-2-Clause" };
			}
			if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee is hereby granted/i.test(text)) {
				return { eligible: true, license: "ISC" };
			}
			if (/Mozilla Public License\s*,\s*v(?:ersion)?\s*2\.0/i.test(text) || /This Source Code Form is subject to the terms of the Mozilla Public License/i.test(text)) {
				return { eligible: true, license: "MPL-2.0" };
			}
			if (/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "GPL-3.0-only" };
			if (/GNU GENERAL PUBLIC LICENSE\s+Version 2/i.test(text)) return { eligible: true, license: "GPL-2.0-only" };
			if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i.test(text)) return { eligible: true, license: "LGPL-2.1-only" };
			if (/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "LGPL-3.0-only" };
			if (/GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i.test(text)) return { eligible: true, license: "AGPL-3.0-only" };
			if (/Boost Software License\s*-\s*Version 1\.0/i.test(text)) return { eligible: true, license: "BSL-1.0" };
			if (/Zero-Clause BSD|0BSD/i.test(text)) return { eligible: true, license: "0BSD" };
			if (/This is free and unencumbered software released into the public domain/i.test(text)) return { eligible: true, license: "Unlicense" };
		} catch {
			// Continue
		}
	}

	return { eligible: false, reason: "No recognized OSI-approved license found in package.json or root LICENSE" };
}

export function validateGitRange(cwd: string, baseRef?: string, headRef?: string): { valid: boolean; range?: string; reason?: string } {
	const base = (baseRef || "HEAD~1").trim();
	const head = (headRef || "HEAD").trim();

	if (base.length > 64 || head.length > 64) {
		return { valid: false, reason: "Git revision length exceeds maximum 64 characters" };
	}
	if (base.startsWith("-") || head.startsWith("-")) {
		return { valid: false, reason: "Git revision must not start with option syntax '-'" };
	}
	if (!/^[a-zA-Z0-9_./@~^ -]+$/.test(base) || !/^[a-zA-Z0-9_./@~^ -]+$/.test(head) || /[\x00-\x1f\x7f;&|`$<>\s]/.test(base) || /[\x00-\x1f\x7f;&|`$<>\s]/.test(head)) {
		return { valid: false, reason: "Git revision contains invalid characters or whitespace" };
	}

	// Verify revision existence if running within a git repo
	const headRes = gitCall(cwd, ["rev-parse", "--verify", "--end-of-options", head]);
	if (headRes.status === 0) {
		const baseRes = gitCall(cwd, ["rev-parse", "--verify", "--end-of-options", base]);
		if (baseRes.status !== 0) {
			return { valid: false, reason: `Git revision '${base}' does not exist` };
		}
		const countRes = gitCall(cwd, ["rev-list", "--count", "--end-of-options", `${base}...${head}`]);
		if (countRes.status !== 0) {
			return { valid: false, reason: `Git revision range '${base}...${head}' is invalid or has unrelated histories` };
		}
		const count = Number(countRes.stdout.trim());
		if (Number.isFinite(count) && count > 10000) {
			return { valid: false, reason: `Git revision range contains ${count} commits exceeding maximum 10000 limit` };
		}
	}

	return { valid: true, range: `${base}...${head}` };
}

function resolveSafeRunDir(cwd: string, runDir?: string, runId?: string): { valid: boolean; runDir?: string; runId?: string; reason?: string } {
	const effectiveId = runId || `${Date.now()}-${randomUUID().slice(0, 8)}`;
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(effectiveId)) {
		return { valid: false, reason: `Invalid runId '${effectiveId}': must match [a-zA-Z0-9_-]{1,64}` };
	}

	if (runDir) {
		if (!isAbsolute(runDir)) {
			return { valid: false, reason: `Injected runDir '${runDir}' must be an absolute path` };
		}
		return { valid: true, runDir, runId: effectiveId };
	}

	const targetPath = resolve(cwd, ".omp", "security", "runs", effectiveId);
	return { valid: true, runDir: targetPath, runId: effectiveId };
}

export function planSecurityTools(
	cwd: string,
	mode: Exclude<SecurityMode, "status">,
	config: SecurityConfig,
	runDir?: string,
	options?: { baseRef?: string; headRef?: string; runId?: string; resolveExecutable?: (cwd: string, executable: string) => string | undefined }
): SecurityPlan {
	const runDirRes = resolveSafeRunDir(cwd, runDir, options?.runId);
	const effectiveRunId = runDirRes.runId || "invalid-run";
	const effectiveRunDir = runDirRes.runDir || resolve(cwd, ".omp/security/runs", effectiveRunId);
	if (config.error || !runDirRes.valid) {
		const reason = config.error ? `Invalid security configuration: ${config.error}` : runDirRes.reason!;
		const fallbackTools: SecurityToolId[] = ["semgrep", "gitleaks", "trivy"];
		const blockedSteps: PlannedToolStep[] = fallbackTools.map((t) => ({
			tool: t,
			status: "BLOCKED",
			outputPath: join(effectiveRunDir, `${t}.sarif`),
			reason,
		}));
		return {
			runId: effectiveRunId,
			runDir: effectiveRunDir,
			mode,
			policy: config.policy || "optional",
			steps: blockedSteps,
			blocked: fallbackTools.map((t) => ({ tool: t, reason })),
		};
	}

	const rawTools: SecurityToolId[] = mode === "codeql" ? ["codeql"] : (config.tools && config.tools.length > 0 ? config.tools : [...DEFAULT_SECURITY_TOOLS]);
	const targetTools: SecurityToolId[] = [];
	for (const t of rawTools) {
		if (ALL_SECURITY_TOOLS.includes(t) && !targetTools.includes(t)) targetTools.push(t);
	}

	const steps: PlannedToolStep[] = [];
	const blocked: Array<{ tool: SecurityToolId; reason: string }> = [];

	for (const tool of targetTools) {
		const outputPath = join(effectiveRunDir, `${tool}.sarif`);
		const execResolver = options?.resolveExecutable || trustedExecutable;
		const execPath = execResolver(cwd, tool);
		const available = execPath !== undefined;
		if (tool === "semgrep") {
			const configs = config.semgrep?.configs && config.semgrep.configs.length > 0 ? config.semgrep.configs : ["p/security-audit"];
			const hasAuto = configs.some((c) => !c || c === "auto" || c === "p/auto" || /\bauto\b/i.test(c));
			if (hasAuto) {
				const reason = "Semgrep --config auto is forbidden";
				steps.push({ tool: "semgrep", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "semgrep", reason });
				continue;
			}
			if (!available) {
				const status: "BLOCKED" | "NOT_RUN" = config.policy === "required" ? "BLOCKED" : "NOT_RUN";
				const reason = `Executable 'semgrep' is not available on PATH`;
				steps.push({ tool: "semgrep", status, outputPath, reason });
				if (status === "BLOCKED") blocked.push({ tool: "semgrep", reason });
				continue;
			}
			const configArgs = configs.flatMap((c) => ["--config", c]);
			const args = ["scan", "--metrics=off", ...configArgs, "--sarif", "--output", outputPath, "."];
			const step: VerifyStep = {
				id: "security-semgrep",
				command: ["semgrep", ...args].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" "),
				executable: "semgrep",
				args,
			};
			steps.push({ tool: "semgrep", status: "PLANNED", step, outputPath });
		} else if (tool === "gitleaks") {
			let rangeArg: string | undefined;
			if (mode === "diff") {
				const rangeVal = validateGitRange(cwd, options?.baseRef, options?.headRef);
				if (!rangeVal.valid) {
					const reason = `Invalid git range for Gitleaks diff: ${rangeVal.reason}`;
					steps.push({ tool: "gitleaks", status: "BLOCKED", outputPath, reason });
					blocked.push({ tool: "gitleaks", reason });
					continue;
				}
				rangeArg = rangeVal.range;
			}
			if (!available) {
				const status: "BLOCKED" | "NOT_RUN" = config.policy === "required" ? "BLOCKED" : "NOT_RUN";
				const reason = `Executable 'gitleaks' is not available on PATH`;
				steps.push({ tool: "gitleaks", status, outputPath, reason });
				if (status === "BLOCKED") blocked.push({ tool: "gitleaks", reason });
				continue;
			}
			const args = mode === "diff"
				? ["git", "--redact", "--report-format", "sarif", "--report-path", outputPath, "--log-opts", rangeArg!, "."]
				: ["git", "--redact", "--report-format", "sarif", "--report-path", outputPath, "."];
			const step: VerifyStep = {
				id: "security-gitleaks",
				command: ["gitleaks", ...args].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" "),
				executable: "gitleaks",
				args,
			};
			steps.push({ tool: "gitleaks", status: "PLANNED", step, outputPath });
		} else if (tool === "trivy") {
			if (!available) {
				const status: "BLOCKED" | "NOT_RUN" = config.policy === "required" ? "BLOCKED" : "NOT_RUN";
				const reason = `Executable 'trivy' is not available on PATH`;
				steps.push({ tool: "trivy", status, outputPath, reason });
				if (status === "BLOCKED") blocked.push({ tool: "trivy", reason });
				continue;
			}
			const args = ["fs", "--scanners", "vuln,misconfig,secret", "--format", "sarif", "--output", outputPath, "."];
			const step: VerifyStep = {
				id: "security-trivy",
				command: ["trivy", ...args].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" "),
				executable: "trivy",
				args,
			};
			steps.push({ tool: "trivy", status: "PLANNED", step, outputPath });
		} else if (tool === "codeql") {
			const license = detectProjectLicense(cwd);
			if (!license.eligible) {
				const reason = `CodeQL requires an OSI-approved open-source project license (${license.reason || "ineligible license"})`;
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}
			if (!config.codeql?.database || !config.codeql?.suite) {
				const reason = "CodeQL requires configured database and suite in .omp/config.yml";
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}
			const dbPath = safeRepoPath(cwd, config.codeql.database);
			if (!dbPath) {
				const reason = `CodeQL database path '${config.codeql.database}' is not a safe path inside the repository`;
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}
			try {
				const dbStat = lstatSync(dbPath);
				if (!dbStat.isDirectory() || dbStat.isSymbolicLink()) {
					const reason = `CodeQL database path '${config.codeql.database}' must be an existing non-symlink directory`;
					steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
					blocked.push({ tool: "codeql", reason });
					continue;
				}
			} catch {
				const reason = `CodeQL database path '${config.codeql.database}' does not exist`;
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}

			const suitePath = safeRepoPath(cwd, config.codeql.suite);
			if (!suitePath) {
				const reason = `CodeQL suite path '${config.codeql.suite}' is not a safe path inside the repository`;
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}
			try {
				const suiteStat = lstatSync(suitePath);
				if (!suiteStat.isFile() || suiteStat.isSymbolicLink()) {
					const reason = `CodeQL suite path '${config.codeql.suite}' must be an existing non-symlink regular file`;
					steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
					blocked.push({ tool: "codeql", reason });
					continue;
				}
			} catch {
				const reason = `CodeQL suite path '${config.codeql.suite}' does not exist`;
				steps.push({ tool: "codeql", status: "BLOCKED", outputPath, reason });
				blocked.push({ tool: "codeql", reason });
				continue;
			}

			if (!available) {
				const status: "BLOCKED" | "NOT_RUN" = config.policy === "required" || mode === "codeql" ? "BLOCKED" : "NOT_RUN";
				const reason = `Executable 'codeql' is not available on PATH`;
				steps.push({ tool: "codeql", status, outputPath, reason });
				if (status === "BLOCKED") blocked.push({ tool: "codeql", reason });
				continue;
			}

			const args = ["database", "analyze", config.codeql.database, "--format", "sarifv2.1.0", "--output", outputPath, config.codeql.suite];
			const step: VerifyStep = {
				id: "security-codeql",
				command: ["codeql", ...args].map((p) => (/\s/.test(p) ? JSON.stringify(p) : p)).join(" "),
				executable: "codeql",
				args,
			};
			steps.push({ tool: "codeql", status: "PLANNED", step, outputPath });
		}
	}

	return {
		runId: effectiveRunId,
		runDir: effectiveRunDir,
		mode,
		policy: config.policy,
		steps,
		blocked,
	};
}

export function validateSecurityRunManifest(raw: unknown): { valid: boolean; manifest?: SecurityRunManifest; reason?: string } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { valid: false, reason: "Manifest must be a non-null object" };
	}
	const m = raw as Record<string, unknown>;

	if (typeof m.runId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(m.runId)) {
		return { valid: false, reason: "Manifest runId is missing or invalid" };
	}
	if (m.mode !== "full" && m.mode !== "diff" && m.mode !== "codeql") {
		return { valid: false, reason: `Manifest mode '${String(m.mode)}' is invalid` };
	}
	if (m.policy !== "optional" && m.policy !== "release-required" && m.policy !== "required") {
		return { valid: false, reason: `Manifest policy '${String(m.policy)}' is invalid` };
	}
	if (typeof m.head !== "string" || !/^[a-zA-Z0-9_.-]{7,64}$/.test(m.head)) {
		return { valid: false, reason: "Manifest head commit is missing or invalid" };
	}
	if (typeof m.startedAt !== "string" || typeof m.completedAt !== "string") {
		return { valid: false, reason: "Manifest timestamps must be strings" };
	}
	const startTs = Date.parse(m.startedAt);
	const endTs = Date.parse(m.completedAt);
	if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) {
		return { valid: false, reason: "Manifest timestamp interval is invalid or completedAt is before startedAt" };
	}
	if (m.status !== "PASS" && m.status !== "FAIL" && m.status !== "BLOCKED" && m.status !== "NOT_RUN") {
		return { valid: false, reason: `Manifest status '${String(m.status)}' is invalid` };
	}

	if (!m.coverage || typeof m.coverage !== "object" || Array.isArray(m.coverage)) {
		return { valid: false, reason: "Manifest coverage is missing or not an object" };
	}
	const cov = m.coverage as Record<string, unknown>;
	const requested = Number(cov.requested);
	const completed = Number(cov.completed);
	const blocked = Number(cov.blocked);
	const notRun = Number(cov.notRun);
	if (!Number.isInteger(requested) || requested < 0 || !Number.isInteger(completed) || completed < 0 || !Number.isInteger(blocked) || blocked < 0 || !Number.isInteger(notRun) || notRun < 0) {
		return { valid: false, reason: "Manifest coverage counters must be non-negative integers" };
	}
	if (requested !== completed + blocked + notRun) {
		return { valid: false, reason: `Manifest coverage arithmetic mismatch: requested (${requested}) != completed (${completed}) + blocked (${blocked}) + notRun (${notRun})` };
	}

	if (!Array.isArray(m.tools)) {
		return { valid: false, reason: "Manifest tools must be an array" };
	}
	if (m.tools.length !== requested) {
		return { valid: false, reason: `Manifest tools count (${m.tools.length}) does not match coverage requested (${requested})` };
	}

	const seenTools = new Set<string>();
	let calcCompleted = 0;
	let calcBlocked = 0;
	let calcNotRun = 0;

	for (const item of m.tools) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			return { valid: false, reason: "Manifest tool entry must be an object" };
		}
		const t = item as Record<string, unknown>;
		if (typeof t.tool !== "string" || !ALL_SECURITY_TOOLS.includes(t.tool as SecurityToolId)) {
			return { valid: false, reason: `Manifest tool entry contains unknown tool ID: '${String(t.tool)}'` };
		}
		if (seenTools.has(t.tool)) {
			return { valid: false, reason: `Manifest contains duplicate tool entry for '${t.tool}'` };
		}
		seenTools.add(t.tool);

		if (t.status !== "PASS" && t.status !== "FAIL" && t.status !== "BLOCKED" && t.status !== "NOT_RUN") {
			return { valid: false, reason: `Manifest tool '${t.tool}' status is invalid: '${String(t.status)}'` };
		}
		if (!Array.isArray(t.argv) || t.argv.some((a) => typeof a !== "string")) {
			return { valid: false, reason: `Manifest tool '${t.tool}' argv must be an array of strings` };
		}

		if (t.status === "PASS" || t.status === "FAIL") calcCompleted++;
		else if (t.status === "BLOCKED") calcBlocked++;
		else if (t.status === "NOT_RUN") calcNotRun++;
	}

	if (completed !== calcCompleted || blocked !== calcBlocked || notRun !== calcNotRun) {
		return { valid: false, reason: "Manifest coverage counters do not agree with tool records" };
	}

	if (m.status === "PASS") {
		if (blocked > 0 || notRun > 0 || (m.tools as Array<{ status?: unknown }>).some((t) => t.status !== "PASS")) {
			return { valid: false, reason: "Manifest aggregate PASS requires all tools to have PASS status" };
		}
	}

	return {
		valid: true,
		manifest: raw as SecurityRunManifest,
	};
}

export function securityReleaseReady(
	cwd: string,
	options?: { head?: string; config?: SecurityConfig; manifest?: SecurityRunManifest }
): SecurityReleaseReadyResult {
	let config = options?.config;
	if (!config) {
		const ymlRel = safeRepoPath(cwd, ".omp/config.yml");
		const yamlRel = safeRepoPath(cwd, ".omp/config.yaml");

		const ymlExists = existsSync(resolve(cwd, ".omp", "config.yml"));
		const yamlExists = existsSync(resolve(cwd, ".omp", "config.yaml"));

		if (ymlExists || yamlExists) {
			const activePath = ymlExists ? ymlRel : yamlRel;
			if (!activePath) {
				return {
					ready: false,
					policy: "optional",
					status: "BLOCKED",
					reason: "Config file path crosses symlink or leaves repository",
				};
			}
			try {
				const stat = lstatSync(activePath);
				if (stat.isSymbolicLink() || !stat.isFile()) {
					return {
						ready: false,
						policy: "optional",
						status: "BLOCKED",
						reason: `Config file '${activePath}' is not a regular file or is a symlink`,
					};
				}
				if (stat.size > MAX_CONFIG_BYTES) {
					return {
						ready: false,
						policy: "optional",
						status: "BLOCKED",
						reason: `Config file '${activePath}' exceeds ${MAX_CONFIG_BYTES}-byte limit`,
					};
				}
				const text = readFileSync(activePath, "utf8");
				config = parseSecurityConfig(text);
			} catch (error) {
				return {
					ready: false,
					policy: "optional",
					status: "BLOCKED",
					reason: `Failed to read config file: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		} else {
			// Proven ENOENT for config
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

	const expectedHead = (options?.head ?? gitHead(cwd)).trim();
	if (!expectedHead || expectedHead.length < 7) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: "Current Git HEAD is empty or unresolvable",
		};
	}

	let rawManifest = options?.manifest as unknown;
	if (!rawManifest) {
		const manifestRel = safeRepoPath(cwd, ".omp/security/latest.json");
		const manifestExists = existsSync(resolve(cwd, ".omp", "security", "latest.json"));
		if (!manifestExists || !manifestRel) {
			return {
				ready: false,
				policy: config.policy,
				status: "BLOCKED",
				reason: "No security scan manifest found under .omp/security/latest.json",
			};
		}
		try {
			const stat = lstatSync(manifestRel);
			if (stat.isSymbolicLink() || !stat.isFile()) {
				return {
					ready: false,
					policy: config.policy,
					status: "BLOCKED",
					reason: "Security manifest is not a regular file or is a symlink",
				};
			}
			if (stat.size > MAX_CONFIG_BYTES) {
				return {
					ready: false,
					policy: config.policy,
					status: "BLOCKED",
					reason: "Security manifest exceeds 512 KiB limit",
				};
			}
			rawManifest = JSON.parse(readFileSync(manifestRel, "utf8"));
		} catch (error) {
			return {
				ready: false,
				policy: config.policy,
				status: "BLOCKED",
				reason: `Failed to load or parse security manifest: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}

	const valResult = validateSecurityRunManifest(rawManifest);
	if (!valResult.valid || !valResult.manifest) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Security manifest validation failed: ${valResult.reason}`,
		};
	}
	const manifest = valResult.manifest;

	if (manifest.policy !== config.policy) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Manifest policy '${manifest.policy}' does not match configured policy '${config.policy}'`,
			manifest,
		};
	}

	if (manifest.mode !== "full" && manifest.mode !== "diff") {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Manifest mode '${manifest.mode}' is not valid for release readiness (must be 'full' or 'diff')`,
			manifest,
		};
	}

	if (manifest.head !== expectedHead) {
		return {
			ready: false,
			policy: config.policy,
			status: "BLOCKED",
			reason: `Security scan manifest is stale (manifest HEAD '${manifest.head}' does not match current HEAD '${expectedHead}')`,
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

	const requiredTools = config.tools && config.tools.length > 0 ? config.tools : [...DEFAULT_SECURITY_TOOLS];
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
