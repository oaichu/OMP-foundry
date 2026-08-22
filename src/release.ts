import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { designAllowsUi, planLocked, productReady, recountTickets } from "./state-machine";
import type { CompanyState } from "./types";

export function sha256File(cwd: string, rel: string): string {
	const file = join(cwd, rel);
	if (!existsSync(file)) return "";
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function gitTreeSha(cwd: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return "";
	return result.stdout.trim();
}

export function refreshArtifactHashes(cwd: string, state: CompanyState): void {
	state.product.sha256 = sha256File(cwd, "docs/PRODUCT.md");
	state.master_plan.sha256 = sha256File(cwd, "docs/MASTER_PLAN.md");
	state.design.sha256 = sha256File(cwd, "docs/DESIGN.md");
}

export function deriveRelease(cwd: string, state: CompanyState): boolean {
	recountTickets(state);
	const tree = gitTreeSha(cwd);
	const qaOk = state.qa.status === "pass" && state.qa.tree_sha !== "" && state.qa.tree_sha === tree;
	const aatpOk =
		state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0;
	const ready = productReady(state) && planLocked(state) && designAllowsUi(state) && aatpOk && qaOk;
	state.release.ready = ready;
	state.release.tree_sha = ready ? tree : "";
	if (!ready && state.qa.tree_sha && state.qa.tree_sha !== tree) {
		state.qa.status = "pending";
	}
	return ready;
}

export function invalidateQa(state: CompanyState): void {
	state.qa.status = "pending";
	state.qa.tree_sha = "";
	state.release.ready = false;
	state.release.tree_sha = "";
}
