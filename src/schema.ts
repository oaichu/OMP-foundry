import { copyFileSync, existsSync } from "node:fs";
import { CURRENT_STATE_SCHEMA, FOUNDRY_VERSION, StateError, type CompanyState } from "./types";
import { parseState, serializeState } from "./state-machine";

export class SchemaTooNewError extends StateError {
	constructor(found: number, supported: number) {
		super(`STATE_SCHEMA_TOO_NEW: This project uses Foundry state schema ${found}. Installed Foundry supports up to ${supported}. Update OMP Foundry.`);
		this.name = "SchemaTooNewError";
	}
}
function pickTop(yaml: string, key: string): string | undefined {
	const match = yaml.match(new RegExp(`(?:^|\\n)${key}:\\s*(\\S+)`));
	return match?.[1]?.trim().replace(/^["']|["']$/g, "");
}
export function detectSchemaVersion(yaml: string): number {
	if (!yaml.trim()) throw new StateError("empty state");
	const raw = pickTop(yaml, "schema_version");
	if (raw === undefined || raw === "") return 0;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 0) throw new StateError("invalid schema_version");
	return n;
}
function migrateV0ToV1(yaml: string): string {
	const state = parseState(yaml, { allowLegacy: true });
	state.schema_version = 1;
	state.created_by = state.created_by || FOUNDRY_VERSION;
	state.last_written_by = FOUNDRY_VERSION;
	return serializeState(state);
}
function migrateV1ToV2(yaml: string): string {
	const state = parseState(yaml);
	state.schema_version = 2;
	state.aatp.manifest_sha256 ||= "";
	for (const ticket of Object.values(state.tickets)) {
		ticket.review_by ||= undefined;
		ticket.review_evidence_sha256 ||= undefined;
		ticket.implementation_evidence_sha256 ||= undefined;
	}
	state.last_written_by = FOUNDRY_VERSION;
	return serializeState(state);
}
function migrateV2ToV3(yaml: string): string {
	const state = parseState(yaml);
	state.schema_version = 3;
	state.mode = "normal";
	state.planning = { stage: "idle", draft_sha256: "", review_sha256: "", final_sha256: "" };
	state.last_written_by = FOUNDRY_VERSION;
	return serializeState(state);
}
const MIGRATIONS: Record<number, (yaml: string) => string> = { 0: migrateV0ToV1, 1: migrateV1ToV2, 2: migrateV2ToV3 };
export function migrateToCurrent(yaml: string): { yaml: string; state: CompanyState; from: number; didMigrate: boolean } {
	const from = detectSchemaVersion(yaml);
	if (from > CURRENT_STATE_SCHEMA) throw new SchemaTooNewError(from, CURRENT_STATE_SCHEMA);
	let text = yaml, version = from;
	while (version < CURRENT_STATE_SCHEMA) {
		const step = MIGRATIONS[version];
		if (!step) throw new StateError(`no migration from schema ${version}`);
		text = step(text);
		version += 1;
	}
	const state = parseState(text);
	if (state.schema_version !== CURRENT_STATE_SCHEMA) throw new StateError(`migration produced schema ${state.schema_version}`);
	return { yaml: text, state, from, didMigrate: from < CURRENT_STATE_SCHEMA };
}
export function backupPath(file: string, from: number): string { return `${file}.pre-v${from + 1}.bak`; }
export function backupOnce(file: string, from: number): string | undefined {
	const dest = backupPath(file, from);
	if (existsSync(dest)) return dest;
	copyFileSync(file, dest);
	return dest;
}
