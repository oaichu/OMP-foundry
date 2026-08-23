import { designAllowsUi, planLocked, productReady } from "./state-machine";
import type { CompanyState } from "./types";

export function requireProduct(state: CompanyState): string | undefined {
	if (!productReady(state)) return "PRODUCT not approved. Run /foundry-init then finish docs/PRODUCT.md.";
	return undefined;
}

export function requirePlan(state: CompanyState): string | undefined {
	const product = requireProduct(state);
	if (product) return product;
	if (!planLocked(state)) return "MASTER_PLAN not locked. Run /plan3.";
	return undefined;
}

export function requireDesignIfUi(state: CompanyState): string | undefined {
	const plan = requirePlan(state);
	if (plan) return plan;
	if (!designAllowsUi(state)) return "DESIGN not locked. Run /design then /design approve (or design_skip if backend-only).";
	return undefined;
}

export function requireRelease(state: CompanyState): string | undefined {
	if (!state.release.ready) return "RELEASE not ready. /verify must pass and AATP must be complete.";
	return undefined;
}
