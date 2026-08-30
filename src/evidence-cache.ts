import { createHash } from "node:crypto";

export interface EvidenceResponse {
	id: string;
	sha256: string;
	cacheHit: boolean;
	text: string;
}

export function evidenceDigest(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * A cache hit is returned only when the caller proves it already knows the
 * exact digest of the current bytes. No hidden cross-agent cache is trusted.
 */
export function contentAddressedEvidence(id: string, content: string, knownSha256?: string): EvidenceResponse {
	const sha256 = evidenceDigest(content);
	const normalizedKnown = knownSha256?.trim().toLowerCase();
	if (normalizedKnown && normalizedKnown === sha256) {
		return {
			id,
			sha256,
			cacheHit: true,
			text: `# ${id}\nEVIDENCE_CACHE_HIT sha256=${sha256}\nContent unchanged; reuse the exact evidence already present in this session/context.`,
		};
	}
	return {
		id,
		sha256,
		cacheHit: false,
		text: `${content}\n\nEVIDENCE_SHA256=${sha256}`,
	};
}
