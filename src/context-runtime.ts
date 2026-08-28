import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contentAddressedEvidence } from "./evidence-cache";
import { loadRegistry } from "./skills/registry";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export default function registerFoundryContextRuntime(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.registerTool({
		name: "foundry_skill_read_cached",
		label: "Foundry Cached Skill Read",
		description: "Load 1–3 Foundry skill bodies with SHA-256 evidence reuse. Pass known digests to avoid retransmitting unchanged bodies.",
		loadMode: "essential",
		approval: "read",
		parameters: z.object({
			ids: z.array(z.string()),
			known: z.array(z.object({ id: z.string(), sha256: z.string() })).optional(),
		}),
		async execute(_id, params) {
			const registry = loadRegistry(join(ROOT, "skills"));
			const wanted = params.ids.slice(0, 3);
			const known = new Map((params.known ?? []).map((entry) => [entry.id, entry.sha256]));
			const responses = wanted.map((id) => {
				const hit = registry.find((skill) => skill.id === id);
				if (!hit) return { id, sha256: "", cacheHit: false, text: `# ${id}\n(not found)` };
				const content = `# ${hit.id}\n${hit.description}\n\n${hit.body}`;
				return contentAddressedEvidence(hit.id, content, known.get(hit.id));
			});
			return {
				content: [{ type: "text" as const, text: responses.map((response) => response.text).join("\n\n") }],
				details: {
					ids: wanted,
					evidence: responses.map(({ id, sha256, cacheHit }) => ({ id, sha256, cache_hit: cacheHit })),
				},
			};
		},
	});
}
