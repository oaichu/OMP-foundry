import type { CompanyState } from "./types";
import { enterPlan, planArtifactsMatch } from "./plan";
import { resetAatp } from "./aatp";
import { invalidateQa, lockArtifactHash } from "./release";

export interface ApproveDeps {
	persist: (state: CompanyState) => void;
	orchestrate: (title: string, body: string) => void;
	enterOrResumePlan: () => void;
	requestAatpCompile: () => void;
	advanceFoundry: () => void;
}

export type ApproveResult = { ok: true; message: string } | { ok: false; message: string };

export function approveProduct(cwd: string, state: CompanyState, deps: ApproveDeps): ApproveResult {
	if (!lockArtifactHash(cwd, state, "product")) return { ok: false, message: "PRODUCT_GATE: docs/PRODUCT.md must exist and be non-empty before approval." };
	state.product.status = "approved";
	state.phase = "planning";
	enterPlan(state);
	invalidateQa(state);
	deps.persist(state);
	deps.orchestrate("PRODUCT approved.", "Product approved. Running Plan...");
	deps.enterOrResumePlan();
	return { ok: true, message: "Product phase approved successfully." };
}

export function approvePlan(cwd: string, state: CompanyState, deps: ApproveDeps): ApproveResult {
	if (state.mode === "plan" && state.planning.stage !== "awaiting_lock") return { ok: false, message: "PLAN_GATE: plan approval requires a completed Draft → Redteam → Synth cycle." };
	if (!planArtifactsMatch(cwd, state)) return { ok: false, message: "PLAN_EVIDENCE_GATE: planning artifacts changed after their stage completed. Restart Plan or restore the accepted artifacts." };
	if (!lockArtifactHash(cwd, state, "master_plan")) return { ok: false, message: "PLAN_GATE: docs/MASTER_PLAN.md must exist and be non-empty before lock." };
	state.master_plan.status = "locked";
	state.master_plan.version = state.master_plan.version === "0" ? "1.0" : state.master_plan.version;
	state.conflict = { kind: "none", reason: "" };
	state.mode = "normal";
	invalidateQa(state);
	deps.persist(state);
	if (state.design.required && state.design.status !== "locked" && state.design.status !== "not_required") {
		state.phase = "design";
		resetAatp(state);
		deps.persist(state);
		deps.orchestrate("PLAN LOCKED by user.", "Plan evidence accepted. Continue with /design; after the design gate Foundry compiles the AATP DAG.");
	} else {
		if (state.aatp.manifest_sha256) deps.advanceFoundry();
		else deps.requestAatpCompile();
	}
	return { ok: true, message: "Plan phase approved successfully." };
}
