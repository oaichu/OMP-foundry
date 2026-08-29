import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? process.env.OMP_SOURCE ?? "/tmp/oh-my-pi");
const checks: Array<{ file: string; needles: string[] }> = [
	{
		file: "packages/coding-agent/src/config/settings-schema.ts",
		needles: ['"task.isolation.mode"', '"task.isolation.apply"'],
	},
	{
		file: "packages/coding-agent/src/task/structured-subagent.ts",
		needles: ["isolation?.requested", "applyChanges", "mergeIsolatedChanges"],
	},
	{
		file: "docs/tools/task.md",
		needles: ["`isolated`", "`patchPath?`", "task.isolation.mode"],
	},
	{
		file: "docs/tools/lsp.md",
		needles: ["`rename_file`", "`code_actions`", "`request`", "apply `WorkspaceEdit`"],
	},
];

if (!existsSync(root)) {
	console.log(`OMP source root not found at ${root}; skipping contract check.`);
	process.exit(0);
}

const failures: string[] = [];
for (const check of checks) {
	const file = join(root, check.file);
	if (!existsSync(file)) {
		failures.push(`missing ${check.file}`);
		continue;
	}
	const text = readFileSync(file, "utf8");
	for (const needle of check.needles) {
		if (!text.includes(needle)) failures.push(`${check.file}: missing contract token ${JSON.stringify(needle)}`);
	}
}
if (failures.length) {
	console.error(`OMP contract drift detected:\n${failures.map((x) => `- ${x}`).join("\n")}`);
	process.exit(1);
}
console.log("OMP contract smoke check passed.");
