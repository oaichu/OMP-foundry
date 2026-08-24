import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { aatpManifestHash } from "./aatp";
import { designAllowsUi, planLocked, productReady, recountTickets } from "./state-machine";
import { safeRepoPath } from "./paths";
import type { CompanyState } from "./types";
import { gitCall } from "./git-runtime";
import { dependencyScopeHash, ticketScopeHash } from "./provenance";

function sha256File(cwd: string, rel: string): string {
	const file = safeRepoPath(cwd, rel);
	if (!file) return "";
	try {
		const stat = lstatSync(file);
		// Locked evidence is intentionally bounded.  A malformed repository
		// must not make every gate read an unbounded artifact into memory.
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 4 * 1024 * 1024) return "";
		return createHash("sha256").update(readFileSync(file)).digest("hex");
	} catch {
		return "";
	}
}

export function gitHead(cwd: string): string {
	const result = gitCall(cwd, ["rev-parse", "HEAD"], { encoding: "utf8" });
	return result.status === 0 ? result.stdout.trim() : "";
}

const FOUNDRY_OWNED = [/^\.omp\/(?:foundry|company)-state\.ya?ml$/i, /^\.omp\/(?:foundry|company)-state\.ya?ml(?:\..+\.tmp|\.pre-v\d+\.bak)$/i, /^docs\/reports\/qa\.md$/i];
function isFoundryOwned(rel: string): boolean {
	const normalized = rel.trim().replace(/\\/g, "/").replace(/^"|"$/g, "");
	return FOUNDRY_OWNED.some((re) => re.test(normalized));
}

function safeOwnedArtifact(cwd: string, rel: string): boolean {
	if (!isFoundryOwned(rel)) return false;
	const file = safeRepoPath(cwd, rel);
	if (!file) return false;
	try { return lstatSync(file).isFile(); } catch { return false; }
}

export function workingTreeClean(cwd: string): boolean {
	const result = gitCall(cwd, ["status", "--porcelain", "-uall"], { encoding: "utf8", maxBuffer: 512 * 1024 });
	if (result.status !== 0) return false;
	for (const line of result.stdout.split("\n")) {
		if (line.length < 4) continue;
		const rest = line.slice(3).replace(/^"|"$/g, "");
		const rel = (rest.split(" -> ").pop() ?? rest).trim();
		if (rel && !safeOwnedArtifact(cwd, rel)) return false;
	}
	return true;
}

export type ArtifactKey = "product" | "master_plan" | "design";
export function lockArtifactHash(cwd: string, state: CompanyState, which: ArtifactKey): boolean {
	const rel = which === "product" ? "docs/PRODUCT.md" : which === "master_plan" ? "docs/MASTER_PLAN.md" : "docs/DESIGN.md";
	const sha = sha256File(cwd, rel);
	if (!sha) return false;
	if (which === "product") state.product.sha256 = sha;
	else if (which === "master_plan") state.master_plan.sha256 = sha;
	else state.design.sha256 = sha;
	return true;
}

export function artifactsMatch(cwd: string, state: CompanyState): boolean {
	if (!productReady(state) || !state.product.sha256 || sha256File(cwd, "docs/PRODUCT.md") !== state.product.sha256) return false;
	if (!planLocked(state) || !state.master_plan.sha256 || sha256File(cwd, "docs/MASTER_PLAN.md") !== state.master_plan.sha256) return false;
	if (state.design.status === "locked" && (!state.design.sha256 || sha256File(cwd, "docs/DESIGN.md") !== state.design.sha256)) return false;
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") return false;
	if (!state.aatp.manifest_sha256 || aatpManifestHash(cwd) !== state.aatp.manifest_sha256) return false;
	return true;
}

function reviewProvenanceFresh(cwd: string, state: CompanyState, ticket: CompanyState["tickets"][string]): boolean {
	if (!ticket.implementation_commit_sha || !ticket.implementation_parent_sha || !ticket.implementation_scope_sha256 || !ticket.verification_evidence_sha256) return false;
	if (!ticket.review_commit_sha || !ticket.review_parent_sha || !ticket.reviewed_scope_sha256 || !ticket.reviewed_dependency_sha256 || !ticket.reviewed_manifest_sha256) return false;
	if (ticket.reviewed_manifest_sha256 !== state.aatp.manifest_sha256) return false;
	if (ticketScopeHash(cwd, ticket) !== ticket.implementation_scope_sha256 || ticketScopeHash(cwd, ticket) !== ticket.reviewed_scope_sha256) return false;
	for (const dep of ticket.dependencies ?? []) {
		if (!dep || dep === "NONE") continue;
		const dependency = state.tickets[dep.toUpperCase()];
		if (!dependency?.implementation_scope_sha256 || ticketScopeHash(cwd, dependency) !== dependency.implementation_scope_sha256) return false;
	}
	if (dependencyScopeHash(state, ticket) !== ticket.reviewed_dependency_sha256) return false;
	const implementation = gitCall(cwd, ["cat-file", "-e", `${ticket.implementation_commit_sha}^{commit}`], { encoding: "utf8" });
	const review = gitCall(cwd, ["cat-file", "-e", `${ticket.review_commit_sha}^{commit}`], { encoding: "utf8" });
	return implementation.status === 0 && review.status === 0;
}

/**
 * Prove that every commit after the Foundry baseline was recorded by a
 * governed implementation/review transition. This catches a clean external
 * commit that would otherwise look indistinguishable from a Foundry result.
 */
export function governedCommitLedgerFresh(cwd: string, state: CompanyState, head: string): boolean {
	const baseline = state.aatp.baseline_sha;
	const ledger = new Set(state.aatp.governed_commits.map((sha) => sha.toLowerCase()));
	if (!baseline || ledger.size === 0 || !head) return false;
	const baselineExists = gitCall(cwd, ["cat-file", "-e", `${baseline}^{commit}`], { encoding: "utf8" });
	if (baselineExists.status !== 0) return false;
	const ancestor = gitCall(cwd, ["merge-base", "--is-ancestor", baseline, head], { encoding: "utf8" });
	if (ancestor.status !== 0) return false;
	const history = gitCall(cwd, ["rev-list", "--max-count=8192", `${baseline}..${head}`], { encoding: "utf8", maxBuffer: 512 * 1024 });
	if (history.status !== 0) return false;
	const commits = new Set(history.stdout.split(/\r?\n/).map((sha) => sha.trim().toLowerCase()).filter(Boolean));
	if (commits.size === 0 || !commits.has(head.toLowerCase())) return false;
	// The ledger must be exact: no unknown commit may enter the candidate, and
	// no recorded commit may have been rewritten out of the candidate history.
	if ([...commits].some((sha) => !ledger.has(sha)) || [...ledger].some((sha) => !commits.has(sha))) return false;
	return true;
}

export function reviewsApproved(state: CompanyState, cwd?: string): boolean {
	const tickets = Object.values(state.tickets);
	if (tickets.length === 0) return false;
	return tickets.every((t) => t.status === "completed" && t.review === "APPROVE" && (t.review_by === "reviewer" || t.review_by === "security-reviewer") && Boolean(t.review_evidence_sha256) && (!cwd || reviewProvenanceFresh(cwd, state, t)));
}

export function deriveRelease(cwd: string, state: CompanyState): boolean {
	recountTickets(state);
	const clean = workingTreeClean(cwd);
	const head = gitHead(cwd);
	const qaOk = state.qa.status === "pass" && clean && state.qa.tree_sha !== "" && state.qa.tree_sha === head && artifactsMatch(cwd, state);
	const aatpOk = state.aatp.total > 0 && state.aatp.completed === state.aatp.total && state.aatp.blocked === 0;
	const ready = productReady(state) && planLocked(state) && designAllowsUi(state) && aatpOk && reviewsApproved(state, cwd) && governedCommitLedgerFresh(cwd, state, head) && qaOk;
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
