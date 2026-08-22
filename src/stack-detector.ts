import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type StackId = "web" | "saas" | "android" | "windows" | "cloudflare" | "unknown";

export interface DetectedStack {
	ids: StackId[];
	ui: boolean;
	verify: Array<{ id: string; command: string; cwd?: string }>;
}

function hasAny(cwd: string, names: string[]): boolean {
	return names.some((name) => existsSync(join(cwd, name)));
}

function readJson(cwd: string, name: string): Record<string, unknown> | null {
	try {
		return JSON.parse(readFileSync(join(cwd, name), "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export function detectStack(cwd: string): DetectedStack {
	const ids = new Set<StackId>();
	const pkg = readJson(cwd, "package.json");
	const deps = {
		...((pkg?.dependencies as Record<string, string>) ?? {}),
		...((pkg?.devDependencies as Record<string, string>) ?? {}),
	};
	if (pkg) {
		if (deps.next || deps.react || deps.vue || deps.svelte || deps.astro) ids.add("web");
		if (deps["wrangler"] || deps["@cloudflare/workers-types"] || existsSync(join(cwd, "wrangler.toml")) || existsSync(join(cwd, "wrangler.jsonc"))) {
			ids.add("cloudflare");
		}
		if (deps["@supabase/supabase-js"] || deps.stripe) ids.add("saas");
	}
	if (hasAny(cwd, ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "app/build.gradle.kts"])) {
		ids.add("android");
	}
	const entries = existsSync(cwd) ? readdirSync(cwd) : [];
	if (entries.some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) ids.add("windows");

	if (ids.size === 0) ids.add("unknown");
	const list = [...ids];
	const ui = list.some((id) => id === "web" || id === "android" || id === "windows");

	const verify: DetectedStack["verify"] = [];
	if (pkg) {
		const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
		if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) {
			verify.push({ id: "lint", command: "npx --yes biome check ." });
		}
		if (existsSync(join(cwd, "tsconfig.json"))) verify.push({ id: "typecheck", command: "npx --yes tsc --noEmit" });
		if (scripts.test) verify.push({ id: "unit", command: "npm test --silent" });
		if (scripts.build) verify.push({ id: "build", command: "npm run build" });
	}
	if (ids.has("android")) {
		const gradlew = existsSync(join(cwd, "gradlew.bat")) ? "gradlew.bat" : existsSync(join(cwd, "gradlew")) ? "./gradlew" : "";
		if (gradlew) {
			verify.push({ id: "lint", command: `${gradlew} lint` });
			verify.push({ id: "unit", command: `${gradlew} test` });
			verify.push({ id: "build", command: `${gradlew} assembleDebug` });
		}
	}
	if (existsSync(join(cwd, "go.mod"))) verify.push({ id: "unit", command: "go test ./..." });
	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
		verify.push({ id: "unit", command: "python -m pytest -q" });
	}
	if (existsSync(join(cwd, "Cargo.toml"))) verify.push({ id: "unit", command: "cargo test" });
	if (ids.has("windows")) {
		verify.push({ id: "test", command: "dotnet test --nologo" });
		verify.push({ id: "build", command: "dotnet build --nologo" });
	}
	return { ids: list, ui, verify };
}
