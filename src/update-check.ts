import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { FOUNDRY_VERSION } from "./types";

export const LATEST_RELEASE = "https://github.com/oaichu/omp-foundry/releases/latest";
const TTL_MS = 24 * 60 * 60 * 1000;
// A failed fetch caches too, but for a shorter window so an offline session
// does not refetch every session while still recovering quickly.
const FAIL_TTL_MS = 60 * 60 * 1000;

export interface UpdateCache {
	checkedAt: number;
	latest: string;
	fetchFailed?: boolean;
}

export interface UpdateResult {
	installed: string;
	omp: string;
	latest?: string;
	newer: boolean;
	notify?: string;
}

export interface UpdateCheckDeps {
	now?: () => number;
	installed?: string;
	omp?: string;
	cachePath?: string;
	fetchLatest?: () => Promise<string | undefined>;
	force?: boolean;
}

export function parseTagFromUrl(url: string): string | undefined {
	const match = url.match(/\/(?:tag|releases\/tag)\/v?(\d+\.\d+\.\d+(?:[-.][\w.]+)?)/);
	return match?.[1];
}

function parseSemver(version: string): { core: number[]; pre: string[] | null } {
	const clean = version.replace(/^v/, "").split("+")[0];
	const [corePart, prePart] = clean.split("-");
	const core = corePart.split(".").map((p) => Number.parseInt(p, 10) || 0);
	while (core.length < 3) core.push(0);
	return { core, pre: prePart ? prePart.split(".") : null };
}

function comparePrerelease(a: string[], b: string[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const left = a[i];
		const right = b[i];
		if (left === undefined) return -1;
		if (right === undefined) return 1;
		const leftNum = /^\d+$/.test(left);
		const rightNum = /^\d+$/.test(right);
		if (leftNum && rightNum) {
			const d = Number(left) - Number(right);
			if (d) return d;
		} else if (leftNum) {
			return -1;
		} else if (rightNum) {
			return 1;
		} else if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

export function compareSemver(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	for (let i = 0; i < 3; i++) {
		const d = pa.core[i] - pb.core[i];
		if (d) return d;
	}
	if (pa.pre === null && pb.pre === null) return 0;
	if (pa.pre === null) return 1;
	if (pb.pre === null) return -1;
	return comparePrerelease(pa.pre, pb.pre);
}

export async function resolveOmpVersion(): Promise<string> {
	try {
		const mod = (await import("@oh-my-pi/pi-utils/dirs")) as { VERSION?: string };
		return mod.VERSION ?? "unknown";
	} catch {
		return "unknown";
	}
}

export function defaultCachePath(): string {
	if (process.env.FOUNDRY_UPDATE_CACHE) return process.env.FOUNDRY_UPDATE_CACHE;
	return join(homedir(), ".omp", "cache", "foundry-update.json");
}


async function xdgCachePath(): Promise<string> {
	if (process.env.FOUNDRY_UPDATE_CACHE) return process.env.FOUNDRY_UPDATE_CACHE;
	try {
		const { getFastembedCacheDir } = (await import("@oh-my-pi/pi-utils/dirs")) as {
			getFastembedCacheDir: () => string;
		};
		return join(dirname(getFastembedCacheDir()), "foundry-update.json");
	} catch {
		return defaultCachePath();
	}
}

export function readCache(path: string): UpdateCache | undefined {
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as UpdateCache;
		if (typeof raw.checkedAt !== "number" || typeof raw.latest !== "string") return undefined;
		return raw;
	} catch {
		return undefined;
	}
}

export function writeCache(path: string, cache: UpdateCache): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(cache)}\n`, "utf8");
}

export async function fetchLatestTag(): Promise<string | undefined> {
	const response = await fetch(LATEST_RELEASE, {
		method: "GET",
		redirect: "follow",
		signal: AbortSignal.timeout(4000),
		headers: { Accept: "text/html" },
	});
	return parseTagFromUrl(response.url);
}

function notifyText(installed: string, latest: string): string {
	return `Foundry ${latest} available. Installed: ${installed}. Update to release tag v${latest} and restart OMP.`;
}

export async function checkForUpdate(deps: UpdateCheckDeps = {}): Promise<UpdateResult> {
	const now = deps.now ?? Date.now;
	const installed = deps.installed ?? FOUNDRY_VERSION;
	const omp = deps.omp ?? (await resolveOmpVersion());
	const cachePath = deps.cachePath ?? (await xdgCachePath());
	const cached = readCache(cachePath);
	const fresh = cached && now() - cached.checkedAt < (cached.fetchFailed ? FAIL_TTL_MS : TTL_MS);
	let latest = cached?.latest;
	if (!fresh || deps.force) {
		try {
			const fetched = await (deps.fetchLatest ?? fetchLatestTag)();
			if (fetched) {
				latest = fetched;
				writeCache(cachePath, { checkedAt: now(), latest });
			} else {
				writeCache(cachePath, { checkedAt: now(), latest: latest ?? "", fetchFailed: true });
			}
		} catch {
			writeCache(cachePath, { checkedAt: now(), latest: latest ?? "", fetchFailed: true });
		}
	}
	const newer = Boolean(latest && compareSemver(latest, installed) > 0);
	return {
		installed,
		omp,
		latest,
		newer,
		notify: newer && latest ? notifyText(installed, latest) : undefined,
	};
}

export function versionReport(result: UpdateResult): string {
	return [
		`Foundry: ${result.installed}`,
		`OMP: ${result.omp}`,
		`Latest stable: ${result.latest ?? "(unknown)"}`,
		result.newer
			? `Update (stable): git fetch --tags && git checkout v${result.latest} then restart OMP.`
			: "Installed Foundry is current or newer than the latest release tag.",
	].join("\n");
}

export function cacheExists(path: string): boolean {
	return existsSync(path);
}
