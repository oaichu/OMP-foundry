import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface AatpTask {
	id: string;
	objective: string;
	dependencies: string[];
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	recommended_agent: string;
	status: string;
	path: string;
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

export function listAatp(cwd: string): AatpTask[] {
	const dir = aatpDir(cwd);
	if (!existsSync(dir)) return [];
	const tasks: AatpTask[] = [];
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
			status: parseField(body, "status") || "ready",
			path,
		});
	}
	return tasks;
}

export function readyIndependent(tasks: AatpTask[]): AatpTask[] {
	const done = new Set(tasks.filter((t) => t.status === "completed" || t.status === "done").map((t) => t.id));
	return tasks.filter((task) => {
		if (task.status !== "ready" && task.status !== "todo" && task.status !== "") return false;
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
		ready: tasks.filter((t) => t.status === "ready" || t.status === "todo" || t.status === "").length,
		active: tasks.filter((t) => t.status === "active" || t.status === "in_progress").length,
		completed: tasks.filter((t) => t.status === "completed" || t.status === "done").length,
		blocked: tasks.filter((t) => t.status === "blocked").length,
	};
}

export function writeAatpIndex(cwd: string, tasks: AatpTask[]): void {
	const dir = aatpDir(cwd);
	mkdirSync(dir, { recursive: true });
	const lines = [
		"# AATP index",
		"",
		"| id | status | risk | agent | deps | objective |",
		"| --- | --- | --- | --- | --- | --- |",
		...tasks.map(
			(t) =>
				`| ${t.id} | ${t.status} | ${t.risk} | ${t.recommended_agent} | ${t.dependencies.join(", ") || "none"} | ${t.objective.replace(/\|/g, "/")} |`,
		),
		"",
	];
	writeFileSync(join(dir, "INDEX.md"), lines.join("\n"), "utf8");
}

export function routeAgent(risk: string): string {
	const r = risk.toLowerCase();
	if (r === "trivial" || r === "low") return "sonic";
	if (r === "difficult" || r === "hard") return "hard-implementer";
	return "implementer";
}
