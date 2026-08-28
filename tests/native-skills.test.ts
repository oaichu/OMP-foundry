import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function skillFiles(root = join(import.meta.dir, "..", "skills")): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name === "SKILL.md") out.push(path);
    }
  };
  walk(root);
  return out;
}

describe("native skill catalog", () => {
  const files = skillFiles();

  test("ships a substantial self-contained catalog", () => {
    expect(files.length).toBeGreaterThanOrEqual(39);
  });

  test("does not delegate capability to external skill:// pointers", () => {
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      expect(body).not.toContain("skill://");
    }
  });

  test("engineering skills are capability-grade rather than one-line stubs", () => {
    const exempt = new Set([
      join("design", "design-intelligence", "SKILL.md"),
      join("design", "design-quality", "SKILL.md"),
      join("design", "design-system-contract", "SKILL.md"),
      join("design-foundation", "SKILL.md"),
      join("master-plan-method", "SKILL.md"),
    ]);
    for (const file of files) {
      const rel = file.split(`${join("skills", "")}`)[1];
      if (exempt.has(rel)) continue;
      const body = readFileSync(file, "utf8");
      expect(body.length).toBeGreaterThan(900);
      expect(body).toContain("version: 2");
    }
  });
});
