import { designAllowsUi, planLocked, productReady } from "./state-machine";
import type { CompanyState } from "./types";

export function requireProduct(state: CompanyState): string | undefined {
	if (!productReady(state)) return "PRODUCT not approved. Run /foundry, finish docs/PRODUCT.md, then approve product.";
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
	if (!designAllowsUi(state)) return "DESIGN not locked. Run /design then /design approve (or /design skip if design is not required).";
	return undefined;
}
