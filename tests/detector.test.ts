import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepo } from "../src/skills/detector";
import { detectStack } from "../src/stack-detector";
function dir() { return mkdtempSync(join(tmpdir(), "foundry-detect-")); }

describe("unified RepoFacts detector", () => {
	test("plain Gradle is not Android", () => { const cwd = dir(); writeFileSync(join(cwd, "settings.gradle.kts"), "rootProject.name=\"server\"\n"); const facts = detectRepo(cwd); expect(facts.stacks).not.toContain("android"); expect(detectStack(cwd).ui).toBe(false); });
	test("Android manifest makes UI Android and supplies Gradle verification", () => { const cwd = dir(); mkdirSync(join(cwd, "app", "src", "main"), { recursive: true }); writeFileSync(join(cwd, "app", "src", "main", "AndroidManifest.xml"), "<manifest/>\n"); writeFileSync(join(cwd, "settings.gradle.kts"), "\n"); writeFileSync(join(cwd, "gradlew"), "\n"); const facts = detectRepo(cwd); expect(facts.stacks).toContain("android"); expect(facts.ui).toBe(true); expect(facts.verify.some((v) => v.id === "android-build")).toBe(true); });
	test("backend csproj is Windows but not UI", () => { const cwd = dir(); writeFileSync(join(cwd, "Api.csproj"), "<Project><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>"); const facts = detectRepo(cwd); expect(facts.stacks).toContain("windows"); expect(facts.ui).toBe(false); expect(facts.verify.some((v) => v.id === "dotnet-build")).toBe(true); });
	test("WPF marker makes Windows UI", () => { const cwd = dir(); writeFileSync(join(cwd, "App.csproj"), "<Project><PropertyGroup><UseWPF>true</UseWPF></PropertyGroup></Project>"); expect(detectRepo(cwd).ui).toBe(true); });
	test("Python Go Rust verification comes from same facts used by skills", () => { const cwd = dir(); writeFileSync(join(cwd, "pyproject.toml"), "[project]\nname='x'\ndependencies=['ruff','mypy']\n"); writeFileSync(join(cwd, "go.mod"), "module x\n"); writeFileSync(join(cwd, "Cargo.toml"), "[package]\nname='x'\nversion='0.1.0'\n"); const facts = detectRepo(cwd); expect(facts.languages).toEqual(expect.arrayContaining(["python", "go", "rust"])); expect(facts.verify.map((v) => v.id)).toEqual(expect.arrayContaining(["python-test", "go-test", "rust-test"])); });
});
