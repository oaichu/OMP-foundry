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
export type ConflictKind =
	| "none"
	| "PLAN_CONFLICT"
	| "DESIGN_CONFLICT"
	| "DEPENDENCY_CONFLICT"
	| "SCOPE_INSUFFICIENT";

export interface CompanyState {
	phase: Phase;
	product: { status: ArtifactStatus };
	master_plan: { version: string; status: ArtifactStatus };
	design: { required: boolean; version: string; status: ArtifactStatus };
	aatp: { total: number; ready: number; active: number; completed: number; blocked: number };
	qa: { status: QaStatus };
	release: { ready: boolean };
	unlock_token: string;
	conflict: { kind: ConflictKind; reason: string };
}

export const STATE_REL = ".omp/foundry-state.yml";

export function defaultState(): CompanyState {
	return {
		phase: "discovery",
		product: { status: "missing" },
		master_plan: { version: "0", status: "missing" },
		design: { required: false, version: "0", status: "missing" },
		aatp: { total: 0, ready: 0, active: 0, completed: 0, blocked: 0 },
		qa: { status: "pending" },
		release: { ready: false },
		unlock_token: "",
		conflict: { kind: "none", reason: "" },
	};
}

export const LOCKED_PLAN_PATHS = [
	"docs/master_plan.md",
	"docs/planning/master_plan_draft.md",
	"docs/planning/plan_review.md",
];

export const LOCKED_PRODUCT_PATHS = ["docs/product.md"];

export const LOCKED_DESIGN_PATHS = ["docs/design.md", "src/design-system/", "src/designsystem/"];

export const STATE_PATHS = [".omp/foundry-state.yml", ".omp/foundry-state.yaml", ".omp/company-state.yml", ".omp/company-state.yaml"];
