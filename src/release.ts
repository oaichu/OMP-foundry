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

export function workingTreeClean(cwd: string): boolean {
	const result = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
	return result.status === 0 && result.stdout.trim() === "";
}

export function refreshArtifactHashes(cwd: string, state: CompanyState): void {
	state.product.sha256 = sha256File(cwd, "docs/PRODUCT.md");
	state.master_plan.sha256 = sha256File(cwd, "docs/MASTER_PLAN.md");
	state.design.sha256 = sha256File(cwd, "docs/DESIGN.md");
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
	if (!clean || (state.qa.tree_sha && state.qa.tree_sha !== head)) {
		state.qa.status = state.qa.status === "pass" && !clean ? "pending" : state.qa.status;
		if (!clean && state.qa.status === "pass") state.qa.status = "pending";
	}
	return ready;
}

export function invalidateQa(state: CompanyState): void {
	state.qa.status = "pending";
	state.qa.tree_sha = "";
	state.release.ready = false;
	state.release.tree_sha = "";
}
