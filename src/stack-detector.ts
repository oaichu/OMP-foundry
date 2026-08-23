import { detectRepo } from "./skills/detector";
import type { UiConfidence, VerifyStep } from "./skills/detector";

export type StackId = "web" | "saas" | "android" | "windows" | "cloudflare" | "unknown";
export interface DetectedStack { ids: StackId[]; ui: boolean; uiConfidence: UiConfidence; verify: VerifyStep[]; }

/** Compatibility adapter. RepoFacts is the single detector/verification source. */
export function detectStack(cwd: string): DetectedStack {
	const facts = detectRepo(cwd);
	const ids = facts.stacks.filter((id): id is Exclude<StackId, "unknown"> => ["web", "saas", "android", "windows", "cloudflare"].includes(id));
	return { ids: ids.length ? ids : ["unknown"], ui: facts.ui, uiConfidence: facts.uiConfidence, verify: facts.verify };
}
