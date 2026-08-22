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

function readTextIfVisible(file: string): string {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

// Gradle alone is a build system, not an Android app: require real Android
// markers before treating the repo as (UI-bearing) android.
function looksAndroid(cwd: string): boolean {
	if (!hasAny(cwd, ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "app/build.gradle.kts"])) {
		return false;
	}
	if (existsSync(join(cwd, "app", "src", "main", "AndroidManifest.xml"))) return true;
	for (const name of ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "app/build.gradle.kts"]) {
		if (readTextIfVisible(join(cwd, name)).includes("com.android.")) return true;
	}
	return false;
}

// A .sln can be a pure backend service; only UI project types require design.
function looksWindowsUi(cwd: string, entries: string[]): boolean {
	const uiMarker = /Use(?:WPF|WinUI|Maui|MAUI)|<UseWindowsForms>/;
	for (const name of entries) {
		if (!name.endsWith(".csproj")) continue;
		if (uiMarker.test(readTextIfVisible(join(cwd, name)))) return true;
	}
	for (const dir of [join(cwd, "app"), join(cwd, "src"), cwd]) {
		try {
			if (readdirSync(dir).some((name) => name.endsWith(".xaml"))) return true;
		} catch {
			continue;
		}
	}
	return false;
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
	if (looksAndroid(cwd)) ids.add("android");
	const entries = existsSync(cwd) ? readdirSync(cwd) : [];
	const windows = entries.some((name) => name.endsWith(".sln") || name.endsWith(".csproj"));
	if (windows) ids.add("windows");

	if (ids.size === 0) ids.add("unknown");
	const list = [...ids];
	const ui = list.some((id) => id === "web" || id === "android") || (windows && looksWindowsUi(cwd, entries));

	const verify: DetectedStack["verify"] = [];
	const seen = new Set<string>();
	const step = (id: string, command: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		verify.push({ id, command });
	};
	if (pkg) {
		const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
		if (existsSync(join(cwd, "biome.json")) || existsSync(join(cwd, "biome.jsonc"))) {
			step("lint", "npx --yes biome check .");
		}
		if (existsSync(join(cwd, "tsconfig.json"))) step("typecheck", "npx --yes tsc --noEmit");
		if (scripts.test) step("unit", "npm test --silent");
		if (scripts.build) step("build", "npm run build");
	}
	if (ids.has("android")) {
		const gradlew = existsSync(join(cwd, "gradlew.bat")) ? "gradlew.bat" : existsSync(join(cwd, "gradlew")) ? "./gradlew" : "";
		if (gradlew) {
			step("lint", `${gradlew} lint`);
			step("unit", `${gradlew} test`);
			step("build", `${gradlew} assembleDebug`);
		}
	}
	if (existsSync(join(cwd, "go.mod"))) step("unit", "go test ./...");
	if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
		step("unit", "python -m pytest -q");
	}
	if (existsSync(join(cwd, "Cargo.toml"))) step("unit", "cargo test");
	if (windows) {
		step("test", "dotnet test --nologo");
		step("build", "dotnet build --nologo");
	}
	return { ids: list, ui, verify };
}
