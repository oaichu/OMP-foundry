import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RepoFacts {
	languages: string[];
	frameworks: string[];
	stacks: string[];
	dependencies: string[];
	files: string[];
}

function pkgDeps(cwd: string): string[] {
	try {
		const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
	} catch {
		return [];
	}
}

function present(cwd: string, names: string[]): string[] {
	return names.filter((name) => existsSync(join(cwd, name)));
}

export function detectRepo(cwd: string): RepoFacts {
	const dependencies = pkgDeps(cwd);
	const has = (id: string) => dependencies.includes(id) || dependencies.some((d) => d === id || d.endsWith(`/${id}`));
	const files = present(cwd, [
		"package.json",
		"tsconfig.json",
		"next.config.js",
		"next.config.mjs",
		"next.config.ts",
		"vite.config.ts",
		"nuxt.config.ts",
		"svelte.config.js",
		"wrangler.toml",
		"wrangler.jsonc",
		"pyproject.toml",
		"requirements.txt",
		"go.mod",
		"Cargo.toml",
		"settings.gradle",
		"settings.gradle.kts",
		"pubspec.yaml",
		"Podfile",
		"*.csproj",
	]);
	const entries = existsSync(cwd) ? readdirSync(cwd) : [];
	if (entries.some((e) => e.endsWith(".csproj") || e.endsWith(".sln"))) files.push("*.csproj");

	const languages: string[] = [];
	if (has("typescript") || files.includes("tsconfig.json")) languages.push("typescript");
	if (files.includes("pyproject.toml") || files.includes("requirements.txt")) languages.push("python");
	if (files.includes("go.mod")) languages.push("go");
	if (files.includes("Cargo.toml")) languages.push("rust");
	if (files.includes("settings.gradle") || files.includes("settings.gradle.kts")) languages.push("kotlin");
	if (files.includes("*.csproj")) languages.push("csharp");
	if (files.includes("pubspec.yaml")) languages.push("dart");

	const frameworks: string[] = [];
	if (has("next")) frameworks.push("next");
	if (has("react") || has("react-dom")) frameworks.push("react");
	if (has("vue") || has("nuxt")) frameworks.push("vue");
	if (has("svelte")) frameworks.push("svelte");
	if (has("express") || has("fastify") || has("hono") || has("koa")) frameworks.push("node");
	if (has("@nestjs/core")) frameworks.push("nest");
	if (has("fastapi") || existsSync(join(cwd, "pyproject.toml"))) {
		/* fastapi via reqs text later */
	}

	const stacks: string[] = [];
	if (frameworks.includes("react") || frameworks.includes("next") || frameworks.includes("vue") || frameworks.includes("svelte")) {
		stacks.push("web");
	}
	if (languages.includes("python") || languages.includes("go") || has("express")) stacks.push("backend");
	if (languages.includes("kotlin")) stacks.push("android", "mobile");
	if (languages.includes("csharp")) stacks.push("windows", "desktop");
	if (has("wrangler") || files.includes("wrangler.toml") || files.includes("wrangler.jsonc")) stacks.push("cloudflare", "cloud");
	if (has("stripe")) stacks.push("saas");
	if (has("@supabase/supabase-js")) stacks.push("saas");
	if (files.includes("Cargo.toml") && !stacks.length) stacks.push("systems");

	return { languages, frameworks, stacks, dependencies, files };
}
