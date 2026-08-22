export type Phase =
	| "discovery"
	| "planning"
	| "design"
	| "aatp"
	| "implementation"
	| "review"
	| "qa"
	| "release";

export type ArtifactStatus = "missing" | "draft" | "approved" | "locked" | "not_required";
export type QaStatus = "pending" | "pass" | "fail";
export type TicketStatus = "ready" | "active" | "completed" | "blocked";
export type ConflictKind =
	| "none"
	| "PLAN_CONFLICT"
	| "DESIGN_CONFLICT"
	| "DEPENDENCY_CONFLICT"
	| "SCOPE_INSUFFICIENT";

export type HumanCap = "product_approve" | "plan_lock" | "design_lock" | "design_skip";

export interface AatpTicket {
	id: string;
	status: TicketStatus;
	allowed_files: string[];
	forbidden_files: string[];
	risk: string;
	agent?: string;
	review?: "none" | "APPROVE" | "REQUEST_CHANGES" | "BLOCK";
}

export interface CompanyState {
	phase: Phase;
	product: { status: ArtifactStatus; sha256: string };
	master_plan: { version: string; status: ArtifactStatus; sha256: string };
	design: { required: boolean; version: string; status: ArtifactStatus; sha256: string };
	tickets: Record<string, AatpTicket>;
	aatp: { total: number; ready: number; active: number; completed: number; blocked: number };
	qa: { status: QaStatus; tree_sha: string };
	release: { ready: boolean; tree_sha: string };
	unlock_token: string;
	conflict: { kind: ConflictKind; reason: string };
	capabilities: Partial<Record<HumanCap, number>>;
}

export const STATE_REL = ".omp/foundry-state.yml";

export const PHASES: Phase[] = [
	"discovery",
	"planning",
	"design",
	"aatp",
	"implementation",
	"review",
	"qa",
	"release",
];

export const ARTIFACT_STATUSES: ArtifactStatus[] = [
	"missing",
	"draft",
	"approved",
	"locked",
	"not_required",
];

export const QA_STATUSES: QaStatus[] = ["pending", "pass", "fail"];

export const TICKET_STATUSES: TicketStatus[] = ["ready", "active", "completed", "blocked"];

export const CONFLICT_KINDS: ConflictKind[] = [
	"none",
	"PLAN_CONFLICT",
	"DESIGN_CONFLICT",
	"DEPENDENCY_CONFLICT",
	"SCOPE_INSUFFICIENT",
];

export function defaultState(): CompanyState {
	return {
		phase: "discovery",
		product: { status: "missing", sha256: "" },
		master_plan: { version: "0", status: "missing", sha256: "" },
		design: { required: false, version: "0", status: "missing", sha256: "" },
		tickets: {},
		aatp: { total: 0, ready: 0, active: 0, completed: 0, blocked: 0 },
		qa: { status: "pending", tree_sha: "" },
		release: { ready: false, tree_sha: "" },
		unlock_token: "",
		conflict: { kind: "none", reason: "" },
		capabilities: {},
	};
}

export const LOCKED_PLAN_PATHS = [
	"docs/master_plan.md",
	"docs/planning/master_plan_draft.md",
	"docs/planning/plan_review.md",
];

export const LOCKED_PRODUCT_PATHS = ["docs/product.md"];

export const LOCKED_DESIGN_PATHS = ["docs/design.md", "src/design-system/", "src/designsystem/"];

export const STATE_PATHS = [
	".omp/foundry-state.yml",
	".omp/foundry-state.yaml",
	".omp/company-state.yml",
	".omp/company-state.yaml",
];

export const PRIVILEGED_TOOLS = new Set([
	"company_init",
	"company_status",
	"aatp_begin",
	"aatp_complete",
	"aatp_block",
	"aatp_review",
	"report_conflict",
	"foundry_skill_read",
]);

export const CAP_TTL_MS = 10 * 60 * 1000;
