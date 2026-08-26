import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")) as { version?: unknown };

/** Single source of truth: the package version. Never hardcode this elsewhere. */
export const FOUNDRY_VERSION: string = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.0.0";
