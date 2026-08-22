import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	type ArtifactStatus,
	type CompanyState,
	type ConflictKind,
	type Phase,
	type QaStatus,
	STATE_REL,
	STATE_PATHS,
	defaultState,
} from "./types";

function pick(block: string, key: string): string | undefined {
	const match = block.match(new RegExp(`(?:^|\\n)\\s*${key}:\\s*(.+)`));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}

function pickBlock(yaml: string, name: string): string {
	const match = yaml.match(new RegExp(`(?:^|\\n)${name}:\\n([\\s\\S]*?)(?=\\n[a-z_]+:|$)`));
	return match?.[1] ?? "";
}

export function parseState(yaml: string): CompanyState {
	const base = defaultState();
	const phase = pick(yaml, "phase") as Phase | undefined;
	if (phase) base.phase = phase;
	const product = pickBlock(yaml, "product");
	const plan = pickBlock(yaml, "master_plan");
	const design = pickBlock(yaml, "design");
	const aatp = pickBlock(yaml, "aatp");
	const qa = pickBlock(yaml, "qa");
	const release = pickBlock(yaml, "release");
	const conflict = pickBlock(yaml, "conflict");
	const pStatus = pick(product, "status") as ArtifactStatus | undefined;
	if (pStatus) base.product.status = pStatus;
	const planStatus = pick(plan, "status") as ArtifactStatus | undefined;
	if (planStatus) base.master_plan.status = planStatus;
	const planVer = pick(plan, "version");
	if (planVer) base.master_plan.version = planVer;
	const dReq = pick(design, "required");
	if (dReq) base.design.required = dReq === "true";
	const dStatus = pick(design, "status") as ArtifactStatus | undefined;
	if (dStatus) base.design.status = dStatus;
	const dVer = pick(design, "version");
	if (dVer) base.design.version = dVer;
	for (const key of ["total", "ready", "active", "completed", "blocked"] as const) {
		const raw = pick(aatp, key);
		if (raw && Number.isFinite(Number(raw))) base.aatp[key] = Number(raw);
	}
	const qaStatus = pick(qa, "status") as QaStatus | undefined;
	if (qaStatus) base.qa.status = qaStatus;
	const ready = pick(release, "ready");
	if (ready) base.release.ready = ready === "true";
	const token = pick(yaml, "unlock_token");
	if (token !== undefined) base.unlock_token = token;
	const kind = pick(conflict, "kind") as ConflictKind | undefined;
	if (kind) base.conflict.kind = kind;
	const reason = pick(conflict, "reason");
	if (reason) base.conflict.reason = reason;
	return base;
}

export function serializeState(state: CompanyState): string {
	return [
		`phase: ${state.phase}`,
		`product:`,
		`  status: ${state.product.status}`,
		`master_plan:`,
		`  version: "${state.master_plan.version}"`,
		`  status: ${state.master_plan.status}`,
		`design:`,
		`  required: ${state.design.required}`,
		`  version: "${state.design.version}"`,
		`  status: ${state.design.status}`,
		`aatp:`,
		`  total: ${state.aatp.total}`,
		`  ready: ${state.aatp.ready}`,
		`  active: ${state.aatp.active}`,
		`  completed: ${state.aatp.completed}`,
		`  blocked: ${state.aatp.blocked}`,
		`qa:`,
		`  status: ${state.qa.status}`,
		`release:`,
		`  ready: ${state.release.ready}`,
		`unlock_token: "${state.unlock_token}"`,
		`conflict:`,
		`  kind: ${state.conflict.kind}`,
		`  reason: ${JSON.stringify(state.conflict.reason)}`,
		"",
	].join("\n");
}

export function statePath(cwd: string): string {
	return join(cwd, STATE_REL);
}

export function loadState(cwd: string): CompanyState {
	for (const rel of STATE_PATHS) {
		try {
			return parseState(readFileSync(join(cwd, rel), "utf8"));
		} catch {
			/* try next */
		}
	}
	return defaultState();
}

export function saveState(cwd: string, state: CompanyState): void {
	const file = statePath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, serializeState(state), "utf8");
}

export function planLocked(state: CompanyState): boolean {
	return state.master_plan.status === "locked";
}

export function productReady(state: CompanyState): boolean {
	return state.product.status === "approved" || state.product.status === "locked";
}

export function designAllowsUi(state: CompanyState): boolean {
	if (!state.design.required) return true;
	return state.design.status === "locked" || state.design.status === "not_required";
}
