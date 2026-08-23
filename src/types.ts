export type Phase =
	| "discovery"
	| "planning"
	| "design"
	| "aatp"
	| "implementation"
	| "review"
	| "qa"
	| "release";

export type FoundryMode = "normal" | "plan3";
export type Plan3Stage = "idle" | "draft" | "redteam" | "synth" | "awaiting_lock";
export type ArtifactStatus = "missing" | "draft" | "approved" | "locked" | "not_required";
export type QaStatus = "pending" | "pass" | "fail";
export type TicketStatus = "ready" | "active" | "completed" | "blocked";
export type ReviewVerdict = "none" | "APPROVE" | "REQUEST_CHANGES" | "BLOCK";
export type ConflictKind = "none" | "PLAN_CONFLICT" | "DESIGN_CONFLICT" | "DEPENDENCY_CONFLICT" | "SCOPE_INSUFFICIENT";

export const CURRENT_STATE_SCHEMA = 3;
export const FOUNDRY_VERSION = "0.5.0";

export class StateError extends Error {
	constructor(message: string) { super(message); this.name = "StateError"; }
}

export interface AatpTicket {
	id: string;
	status: TicketStatus;
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	agent?: string;
	review?: ReviewVerdict;
	review_by?: string;
	review_evidence_sha256?: string;
	implementation_evidence_sha256?: string;
}

export interface CompanyState {
	schema_version: number;
	created_by: string;
	last_written_by: string;
	mode: FoundryMode;
	phase: Phase;
	planning: { stage: Plan3Stage; draft_sha256: string; review_sha256: string; final_sha256: string };
	product: { status: ArtifactStatus; sha256: string };
	master_plan: { version: string; status: ArtifactStatus; sha256: string };
	design: { required: boolean; version: string; status: ArtifactStatus; sha256: string };
	tickets: Record<string, AatpTicket>;
	aatp: { total: number; ready: number; active: number; completed: number; blocked: number; manifest_sha256: string };
	qa: { status: QaStatus; tree_sha: string };
	release: { ready: boolean; tree_sha: string };
	unlock_token: string;
	conflict: { kind: ConflictKind; reason: string };
}

export const STATE_REL = ".omp/foundry-state.yml";
export const PHASES: Phase[] = ["discovery", "planning", "design", "aatp", "implementation", "review", "qa", "release"];
export const FOUNDRY_MODES: FoundryMode[] = ["normal", "plan3"];
export const PLAN3_STAGES: Plan3Stage[] = ["idle", "draft", "redteam", "synth", "awaiting_lock"];
export const ARTIFACT_STATUSES: ArtifactStatus[] = ["missing", "draft", "approved", "locked", "not_required"];
export const QA_STATUSES: QaStatus[] = ["pending", "pass", "fail"];
export const TICKET_STATUSES: TicketStatus[] = ["ready", "active", "completed", "blocked"];
export const REVIEW_VERDICTS: ReviewVerdict[] = ["none", "APPROVE", "REQUEST_CHANGES", "BLOCK"];
export const CONFLICT_KINDS: ConflictKind[] = ["none", "PLAN_CONFLICT", "DESIGN_CONFLICT", "DEPENDENCY_CONFLICT", "SCOPE_INSUFFICIENT"];

export function defaultState(): CompanyState {
	return {
		schema_version: CURRENT_STATE_SCHEMA,
		created_by: FOUNDRY_VERSION,
		last_written_by: FOUNDRY_VERSION,
		mode: "normal",
		phase: "discovery",
		planning: { stage: "idle", draft_sha256: "", review_sha256: "", final_sha256: "" },
		product: { status: "missing", sha256: "" },
		master_plan: { version: "0", status: "missing", sha256: "" },
		design: { required: false, version: "0", status: "missing", sha256: "" },
		tickets: {},
		aatp: { total: 0, ready: 0, active: 0, completed: 0, blocked: 0, manifest_sha256: "" },
		qa: { status: "pending", tree_sha: "" },
		release: { ready: false, tree_sha: "" },
		unlock_token: "",
		conflict: { kind: "none", reason: "" },
	};
}

export const LOCKED_PLAN_PATHS = ["docs/master_plan.md", "docs/planning/master_plan_draft.md", "docs/planning/plan_review.md"];
export const LOCKED_PRODUCT_PATHS = ["docs/product.md"];
export const LOCKED_DESIGN_PATHS = ["docs/design.md", "src/design-system/", "src/designsystem/"];
export const LOCKED_AATP_PATHS = ["docs/aatp/"];
export const STATE_PATHS = [".omp/foundry-state.yml", ".omp/foundry-state.yaml", ".omp/company-state.yml", ".omp/company-state.yaml"];
export const PRIVILEGED_TOOLS = new Set(["foundry_init", "foundry_status", "foundry_skill_read"]);
