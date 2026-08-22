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

export function gitHead(cwd: string): string {
	const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return "";
	return result.stdout.trim();
}

// Foundry-owned runtime files never count as "dirty": the state file and QA
// report are written by the extension itself during verify/release.
const FOUNDRY_OWNED = [/^\.omp\/(?:foundry|company)-state\.ya?ml$/i, /^\.omp\/(?:foundry|company)-state\.ya?ml\.pre-v\d+\.bak$/i, /^docs\/reports\/qa\.md$/i];

export function isFoundryOwned(rel: string): boolean {
	const normalized = rel.trim().replace(/\\/g, "/").replace(/^"|"$/g, "");
	return FOUNDRY_OWNED.some((re) => re.test(normalized));
}

export function workingTreeClean(cwd: string): boolean {
	// -uall lists untracked files individually; plain porcelain collapses
	// whole directories (?? .omp/) and would bypass the foundry-owned filter.
	const result = spawnSync("git", ["status", "--porcelain", "-uall"], { cwd, encoding: "utf8" });
	if (result.status !== 0) return false;
	for (const line of result.stdout.split("\n")) {
		if (line.length < 4) continue;
		const rest = line.slice(3).replace(/^"|"$/g, "");
		const rel = (rest.split(" -> ").pop() ?? rest).trim();
		if (rel && !isFoundryOwned(rel)) return false;
	}
	return true;
}

export type ArtifactKey = "product" | "master_plan" | "design";

// Each approval gate locks only its own artifact hash so a later gate can
// never silently bless a change to an earlier, already-approved artifact.
export function lockArtifactHash(cwd: string, state: CompanyState, which: ArtifactKey): void {
	const rel = which === "product" ? "docs/PRODUCT.md" : which === "master_plan" ? "docs/MASTER_PLAN.md" : "docs/DESIGN.md";
	const sha = sha256File(cwd, rel);
	if (which === "product") state.product.sha256 = sha;
	else if (which === "master_plan") state.master_plan.sha256 = sha;
	else state.design.sha256 = sha;
}

export function artifactsMatch(cwd: string, state: CompanyState): boolean {
	if (state.product.sha256 && sha256File(cwd, "docs/PRODUCT.md") !== state.product.sha256) return false;
	if (state.master_plan.sha256 && sha256File(cwd, "docs/MASTER_PLAN.md") !== state.master_plan.sha256) return false;
	if (state.design.status === "locked" && state.design.sha256 && sha256File(cwd, "docs/DESIGN.md") !== state.design.sha256) {
		return false;
	}
	return true;
}

export function reviewsApproved(state: CompanyState): boolean {
	const tickets = Object.values(state.tickets);
	if (tickets.length === 0) return false;
	return tickets.every((t) => t.status === "completed" && t.review === "APPROVE");
}

export function deriveRelease(cwd: string, state: CompanyState): boolean {
	recountTickets(state);
	const clean = workingTreeClean(cwd);
	const head = gitHead(cwd);
	const qaOk =
		state.qa.status === "pass" && clean && state.qa.tree_sha !== "" && state.qa.tree_sha === head && artifactsMatch(cwd, state);
	const aatpOk = state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0;
	const ready = productReady(state) && planLocked(state) && designAllowsUi(state) && aatpOk && reviewsApproved(state) && qaOk;
	state.release.ready = ready;
	state.release.tree_sha = ready ? head : "";
	if (!clean && state.qa.status === "pass") state.qa.status = "pending";
	if (state.qa.tree_sha && head && state.qa.tree_sha !== head && state.qa.status === "pass") state.qa.status = "pending";
	return ready;
}

export function invalidateQa(state: CompanyState): void {
	state.qa.status = "pending";
	state.qa.tree_sha = "";
	state.release.ready = false;
	state.release.tree_sha = "";
}
