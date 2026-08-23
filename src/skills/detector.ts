import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safeRepoPath } from "../paths";

export interface VerifyStep { id: string; command: string; executable: string; args: string[]; cwd?: string; }
export type UiConfidence = "detected" | "not_detected" | "unknown";
export interface RepoFacts {
	languages: string[];
	frameworks: string[];
	stacks: string[];
	dependencies: string[];
	files: string[];
	ui: boolean;
	uiConfidence: UiConfidence;
	verify: VerifyStep[];
}

const MAX_DETECT_FILE_BYTES = 512 * 1024;
const MAX_DIR_ENTRIES = 2048;

function readText(file: string): string {
	try {
		const stat = lstatSync(file);
		if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_DETECT_FILE_BYTES) return "";
		return readFileSync(file, "utf8");
	} catch { return ""; }
}
function repoText(cwd: string, rel: string): string {
	const path = safeRepoPath(cwd, rel);
	return path ? readText(path) : "";
}
function regularFile(cwd: string, rel: string): boolean {
	const path = safeRepoPath(cwd, rel);
	if (!path) return false;
	try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; }
}
function readJson(cwd: string, name: string): Record<string, unknown> | null { const path = safeRepoPath(cwd, name); if (!path) return null; try { return JSON.parse(readText(path)) as Record<string, unknown>; } catch { return null; } }
function present(cwd: string, names: string[]): string[] { return names.filter((name) => regularFile(cwd, name)); }
function pkgDeps(cwd: string): string[] {
	const pkg = readJson(cwd, "package.json");
	return [...Object.keys((pkg?.dependencies as Record<string, string> | undefined) ?? {}), ...Object.keys((pkg?.devDependencies as Record<string, string> | undefined) ?? {})];
}
function rootEntries(cwd: string): string[] {
	const root = safeRepoPath(cwd, ".");
	if (!root) return [];
	try {
		const stat = lstatSync(root);
		return stat.isDirectory() && !stat.isSymbolicLink() ? readdirSync(root).slice(0, MAX_DIR_ENTRIES) : [];
	} catch { return []; }
}
function projectFiles(cwd: string, suffix: string): string[] {
	const out: string[] = [];
	const root = safeRepoPath(cwd, ".");
	if (!root) return out;
	const skip = new Set([".git", ".omp", "node_modules", "vendor", "dist", "build"]);
	const walk = (dir: string, depth: number): void => {
		if (depth > 3 || out.length >= MAX_DIR_ENTRIES) return;
		let entries: import("node:fs").Dirent[] = [];
		try { entries = readdirSync(dir, { withFileTypes: true }).slice(0, MAX_DIR_ENTRIES); } catch { return; }
		for (const entry of entries) {
			if (entry.isSymbolicLink() || skip.has(entry.name)) continue;
			const child = join(dir, entry.name);
			if (entry.isDirectory()) walk(child, depth + 1);
			else if (entry.isFile() && entry.name.toLowerCase().endsWith(suffix)) out.push(child);
			if (out.length >= MAX_DIR_ENTRIES) return;
		}
	};
	walk(root, 0);
	return [...new Set(out)];
}
function looksAndroid(cwd: string): boolean {
	if (projectFiles(cwd, "androidmanifest.xml").some((file) => /[\\/]src[\\/]main[\\/]androidmanifest\.xml$/i.test(file))) return true;
	for (const name of ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "app/build.gradle", "app/build.gradle.kts"]) {
		if (/com\.android\.(application|library)/.test(repoText(cwd, name))) return true;
	}
	return false;
}
function looksWindowsUi(cwd: string, csproj: string[]): boolean {
	const marker = /<(UseWPF|UseWindowsForms|UseWinUI|UseMaui)>\s*true\s*<\//i;
	if (csproj.some((file) => marker.test(readText(file)))) return true;
	return projectFiles(cwd, ".xaml").length > 0;
}

export function detectRepo(cwd: string): RepoFacts {
	const dependencies = pkgDeps(cwd);
	const has = (id: string) => dependencies.includes(id) || dependencies.some((d) => d.endsWith(`/${id}`));
	const files = present(cwd, ["package.json", "tsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts", "vite.config.ts", "nuxt.config.ts", "svelte.config.js", "wrangler.toml", "wrangler.jsonc", "pyproject.toml", "requirements.txt", "go.mod", "go.work", "Cargo.toml", "settings.gradle", "settings.gradle.kts", "pubspec.yaml", "Podfile"]);
	const csproj = projectFiles(cwd, ".csproj"), sln = rootEntries(cwd).filter((e) => e.toLowerCase().endsWith(".sln"));
	if (csproj.length) files.push("*.csproj");
	if (sln.length) files.push("*.sln");
	const pyText = `${repoText(cwd, "requirements.txt")}\n${repoText(cwd, "pyproject.toml")}`.toLowerCase();
	const goText = repoText(cwd, "go.mod").toLowerCase(), cargoText = repoText(cwd, "Cargo.toml").toLowerCase();
	const android = looksAndroid(cwd), windows = csproj.length > 0 || sln.length > 0, windowsUi = windows && looksWindowsUi(cwd, csproj);
	const workspaceMarkers = rootEntries(cwd).some((entry) => /^(?:apps?|packages?|frontend|web|mobile|workspace|clients?)$/i.test(entry));

	const languages: string[] = [];
	if (has("typescript") || files.includes("tsconfig.json")) languages.push("typescript");
	if (files.includes("pyproject.toml") || files.includes("requirements.txt")) languages.push("python");
	if (files.includes("go.mod") || files.includes("go.work")) languages.push("go");
	if (files.includes("Cargo.toml")) languages.push("rust");
	if (android) languages.push("kotlin");
	if (windows) languages.push("csharp");
	if (files.includes("pubspec.yaml")) languages.push("dart");

	const frameworks: string[] = [];
	if (has("next")) frameworks.push("next");
	if (has("react") || has("react-dom")) frameworks.push("react");
	if (has("vue") || has("nuxt")) frameworks.push("vue");
	if (has("svelte")) frameworks.push("svelte");
	if (has("express") || has("fastify") || has("hono") || has("koa")) frameworks.push("node");
	if (has("@nestjs/core")) frameworks.push("nest");
	if (/\bfastapi\b/.test(pyText)) frameworks.push("fastapi");
	if (/\bdjango\b/.test(pyText)) frameworks.push("django");
	if (/\bflask\b/.test(pyText)) frameworks.push("flask");
	if (/github.com\/gin-gonic\/gin/.test(goText)) frameworks.push("gin");
	if (/github.com\/labstack\/echo/.test(goText)) frameworks.push("echo");
	if (/github.com\/go-chi\/chi/.test(goText)) frameworks.push("chi");
	if (/actix-web|axum|rocket/.test(cargoText)) frameworks.push("rust-web");

	const stacks: string[] = [];
	if (frameworks.some((f) => ["react", "next", "vue", "svelte"].includes(f))) stacks.push("web");
	if (languages.some((l) => ["python", "go", "rust"].includes(l)) || frameworks.some((f) => ["node", "nest", "fastapi", "django", "flask", "gin", "echo", "chi", "rust-web"].includes(f))) stacks.push("backend");
	if (android) stacks.push("android", "mobile");
	if (windows) stacks.push("windows", "desktop");
	if (has("wrangler") || files.includes("wrangler.toml") || files.includes("wrangler.jsonc")) stacks.push("cloudflare", "cloud");
	if (has("stripe") || has("@supabase/supabase-js")) stacks.push("saas");
	if (files.includes("Cargo.toml") && !stacks.includes("backend")) stacks.push("systems");

	const verify: VerifyStep[] = [], seen = new Set<string>();
	const display = (executable: string, args: string[]) => [executable, ...args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ");
	const add = (id: string, executable: string, args: string[] = [], stepCwd?: string) => {
		const command = display(executable, args), key = `${id}:${command}`;
		if (!seen.has(key)) { seen.add(key); verify.push({ id, command, executable, args, ...(stepCwd ? { cwd: stepCwd } : {}) }); }
	};
	const pkg = readJson(cwd, "package.json");
	if (pkg) {
		const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
		if (regularFile(cwd, "biome.json") || regularFile(cwd, "biome.jsonc")) add("lint", "npx", ["--no-install", "biome", "check", "."]);
		if (files.includes("tsconfig.json")) add("typecheck", "npx", ["--no-install", "tsc", "--noEmit"]);
		if (scripts.test) add("unit", "npm", ["test", "--silent"]);
		if (scripts.build) add("build", "npm", ["run", "build"]);
	}
	if (android) {
		const gradlew = regularFile(cwd, "gradlew.bat") ? "gradlew.bat" : regularFile(cwd, "gradlew") ? "./gradlew" : "";
		if (gradlew) { add("android-lint", gradlew, ["lint"]); add("android-unit", gradlew, ["test"]); add("android-build", gradlew, ["assembleDebug"]); }
	}
	if (files.includes("go.mod") || files.includes("go.work")) { add("go-vet", "go", ["vet", "./..."]); add("go-test", "go", ["test", "./..."]); }
	if (languages.includes("python")) { if (/\bruff\b/.test(pyText)) add("python-lint", "python", ["-m", "ruff", "check", "."]); if (/\bmypy\b/.test(pyText)) add("python-typecheck", "python", ["-m", "mypy", "."]); add("python-test", "python", ["-m", "pytest", "-q"]); }
	if (files.includes("Cargo.toml")) { add("rust-fmt", "cargo", ["fmt", "--check"]); add("rust-clippy", "cargo", ["clippy", "--all-targets", "--all-features", "--", "-D", "warnings"]); add("rust-test", "cargo", ["test"]); }
	if (windows) { add("dotnet-test", "dotnet", ["test", "--nologo"]); add("dotnet-build", "dotnet", ["build", "--nologo"]); }
	const ui = stacks.includes("web") || android || windowsUi;
	const uiConfidence = ui ? "detected" : workspaceMarkers ? "unknown" : "not_detected";
	return { languages, frameworks, stacks: [...new Set(stacks)], dependencies, files: [...new Set(files)], ui, uiConfidence, verify };
}
