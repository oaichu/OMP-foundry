import { describe, expect, test } from "bun:test";
import { contentAddressedEvidence, evidenceDigest } from "../src/evidence-cache";

describe("content-addressed evidence", () => {
	test("full evidence carries a stable digest", () => {
		const content = "# security\ntrusted body";
		const first = contentAddressedEvidence("security", content);
		const second = contentAddressedEvidence("security", content);
		expect(first.cacheHit).toBe(false);
		expect(first.sha256).toBe(evidenceDigest(content));
		expect(second.sha256).toBe(first.sha256);
		expect(first.text).toContain(content);
		expect(first.text).toContain(`EVIDENCE_SHA256=${first.sha256}`);
	});

	test("exact caller proof returns a compact cache hit", () => {
		const content = "# postgres\nunchanged body";
		const sha = evidenceDigest(content);
		const response = contentAddressedEvidence("postgres", content, sha);
		expect(response.cacheHit).toBe(true);
		expect(response.text).toContain("EVIDENCE_CACHE_HIT");
		expect(response.text).not.toContain("unchanged body");
	});

	test("stale or incorrect proof fails open to full evidence, never to stale cache", () => {
		const content = "# react\ncurrent body";
		const response = contentAddressedEvidence("react", content, "0".repeat(64));
		expect(response.cacheHit).toBe(false);
		expect(response.text).toContain("current body");
	});
});
