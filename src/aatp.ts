import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CompanyState, TicketStatus } from "./types";

export interface AatpSpec {
	id: string;
	objective: string;
	dependencies: string[];
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	recommended_agent: string;
	path: string;
}

export interface AatpTask extends AatpSpec {
	status: TicketStatus;
	review: "none" | "APPROVE" | "REQUEST_CHANGES" | "BLOCK";
}

function parseList(block: string, key: string): string[] {
	const match = block.match(new RegExp(`${key}:\\n((?:\\s+-\\s+.+\n?)+)`));
	if (!match) return [];
	return match[1]
		.split("\n")
		.map((line) => line.replace(/^\s+-\s+/, "").trim())
		.filter(Boolean);
}

function parseField(block: string, key: string): string {
	const match = block.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+)`));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

export function aatpDir(cwd: string): string {
	return join(cwd, "docs", "AATP");
}

export function listAatpSpecs(cwd: string): AatpSpec[] {
	const dir = aatpDir(cwd);
	if (!existsSync(dir)) return [];
	const tasks: AatpSpec[] = [];
	for (const file of readdirSync(dir)) {
		if (!/^AATP-.*\.md$/i.test(file) || file.toUpperCase() === "INDEX.MD") continue;
		const path = join(dir, file);
		const text = readFileSync(path, "utf8");
		const fm = text.match(/^---\n([\s\S]*?)\n---/);
		const body = fm?.[1] ?? text;
		const id = parseField(body, "id") || file.replace(/\.md$/i, "");
		tasks.push({
			id,
			objective: parseField(body, "objective"),
			dependencies: parseList(body, "dependencies"),
			allowed_files: parseList(body, "allowed_files"),
			forbidden_files: parseList(body, "forbidden_files"),
			risk: parseField(body, "risk") || "normal",
			recommended_agent: parseField(body, "recommended_agent") || parseField(body, "recommended_worker") || "implementer",
			path,
		});
	}
	return tasks;
}

export function hydrateAatp(cwd: string, state: CompanyState): AatpTask[] {
	return listAatpSpecs(cwd).map((spec) => {
		const ticket = state.tickets[spec.id];
		return {
			...spec,
			status: ticket?.status ?? "ready",
			review: ticket?.review ?? "none",
		};
	});
}

export function readyIndependent(tasks: AatpTask[]): AatpTask[] {
	const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
	return tasks.filter((task) => {
		if (task.status !== "ready") return false;
		return task.dependencies.every((dep) => done.has(dep) || dep === "none" || dep === "");
	});
}

export function summarizeAatp(tasks: AatpTask[]): {
	total: number;
	ready: number;
	active: number;
	completed: number;
	blocked: number;
} {
	return {
		total: tasks.length,
		ready: tasks.filter((t) => t.status === "ready").length,
		active: tasks.filter((t) => t.status === "active").length,
		completed: tasks.filter((t) => t.status === "completed").length,
		blocked: tasks.filter((t) => t.status === "blocked").length,
	};
}

export function writeAatpIndex(cwd: string, tasks: AatpTask[]): void {
	const dir = aatpDir(cwd);
	mkdirSync(dir, { recursive: true });
	const lines = [
		"# AATP index",
		"",
		"| id | status | review | risk | agent | deps | objective |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...tasks.map(
			(t) =>
				`| ${t.id} | ${t.status} | ${t.review} | ${t.risk} | ${t.recommended_agent} | ${t.dependencies.join(", ") || "none"} | ${t.objective.replace(/\|/g, "/")} |`,
		),
		"",
	];
	writeFileSync(join(dir, "INDEX.md"), lines.join("\n"), "utf8");
}

export function routeAgent(risk: string): string {
	const r = risk.toLowerCase();
	if (r === "trivial" || r === "low") return "smol-implementer";
	if (r === "difficult" || r === "hard") return "hard-implementer";
	return "implementer";
}

export function seedTickets(state: CompanyState, specs: AatpSpec[]): void {
	for (const spec of specs) {
		if (state.tickets[spec.id]) continue;
		state.tickets[spec.id] = {
			id: spec.id,
			status: "ready",
			allowed_files: spec.allowed_files,
			forbidden_files: spec.forbidden_files,
			risk: spec.risk,
			review: "none",
		};
	}
}
