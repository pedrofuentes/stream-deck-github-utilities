/**
 * Active-editor repo bridge.
 *
 * Resolves the reserved sentinel value `__ACTIVE_EDITOR_REPO__` (stored in a
 * normal `repo` action setting) into a real `owner/repo` by reading a small
 * JSON bridge file that an external editor companion (Cursor/VS Code) writes.
 *
 * The sentinel is deliberately shaped so `parseRepoIdentifier()` rejects it —
 * callers must always go through {@link resolveRepoSelection} first.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { isValidRepoIdentifier } from "./github";

/** Sentinel string saved to a button's `repo` setting when dynamic mode is selected. */
export const ACTIVE_REPO_SENTINEL = "__ACTIVE_EDITOR_REPO__";

/** Filename used under the per-OS app-data directory. */
const BRIDGE_FILENAME = "active-repo.json";

/** Zod schema for the JSON bridge file. `repo` wins; `remoteUrl` is a fallback. */
const bridgeSchema = z
	.object({
		repo: z.string().optional(),
		remoteUrl: z.string().optional(),
		sourceApp: z.string().optional(),
		workspacePath: z.string().optional(),
		updatedAt: z.string().optional(),
		version: z.number().optional(),
	})
	.passthrough();

export type ActiveRepoBridgePayload = z.infer<typeof bridgeSchema>;

/** Reason a sentinel-resolve failed, surfaced to callers for user-facing copy. */
export type ActiveRepoMissingReason = "bridge" | "invalid";

/**
 * Result of resolving a `repo` setting.
 *
 * For a fixed `owner/repo` value, returns `{ repo, isSentinel: false }`.
 * For the sentinel, returns either the resolved repo or a `missing` reason.
 * For anything else (empty string, undefined, malformed), returns `null`.
 */
export interface ResolvedRepo {
	/** The concrete `owner/repo` to use, or empty string when not resolvable. */
	repo: string;
	/** True when the resolution came via the bridge file. */
	isSentinel: boolean;
	/** When the sentinel couldn't be resolved, describes why. */
	missing?: ActiveRepoMissingReason;
	/** Populated bridge payload, if any — PI layer uses it to show the active repo label. */
	payload?: ActiveRepoBridgePayload;
}

/** True when `value` is the active-repo sentinel. */
export function isActiveRepoSentinel(value: string | undefined | null): boolean {
	return value === ACTIVE_REPO_SENTINEL;
}

/**
 * Default bridge-file path per OS. Falls through to `~/.config/...` on unknown
 * platforms so the feature at least has a deterministic location.
 */
export function getDefaultBridgePath(): string {
	const home = os.homedir();

	if (process.platform === "darwin") {
		return path.join(home, "Library", "Application Support", "stream-deck-github-utilities", BRIDGE_FILENAME);
	}

	if (process.platform === "win32") {
		const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
		return path.join(appData, "stream-deck-github-utilities", BRIDGE_FILENAME);
	}

	const xdg = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
	return path.join(xdg, "stream-deck-github-utilities", BRIDGE_FILENAME);
}

/** In-memory cache of the last-read bridge payload, keyed by mtime. */
interface BridgeCacheEntry {
	mtimeMs: number;
	payload: ActiveRepoBridgePayload | null;
	/** Monotonic timestamp in ms; `null` payloads are cached briefly to avoid fs thrash. */
	cachedAt: number;
}

const bridgeCache = new Map<string, BridgeCacheEntry>();

/** Cache-dedupe window for consecutive reads with no mtime change. */
const BRIDGE_CACHE_TTL_MS = 1_000;

/** Reset the in-memory cache. Exposed for tests. */
export function _resetBridgeCache(): void {
	bridgeCache.clear();
}

/**
 * Read and parse the bridge file. Returns `null` if the file is missing or
 * malformed. Uses an mtime-keyed cache to collapse the burst when several
 * actions refresh in the same tick.
 */
export async function readBridgeFile(bridgePath: string): Promise<ActiveRepoBridgePayload | null> {
	const now = Date.now();
	const cached = bridgeCache.get(bridgePath);

	if (cached && now - cached.cachedAt < BRIDGE_CACHE_TTL_MS) {
		return cached.payload;
	}

	let mtimeMs: number;
	try {
		const stat = await fs.stat(bridgePath);
		mtimeMs = stat.mtimeMs;
	} catch {
		bridgeCache.set(bridgePath, { mtimeMs: 0, payload: null, cachedAt: now });
		return null;
	}

	if (cached && cached.mtimeMs === mtimeMs) {
		cached.cachedAt = now;
		return cached.payload;
	}

	let raw: string;
	try {
		raw = await fs.readFile(bridgePath, "utf8");
	} catch {
		bridgeCache.set(bridgePath, { mtimeMs, payload: null, cachedAt: now });
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		bridgeCache.set(bridgePath, { mtimeMs, payload: null, cachedAt: now });
		return null;
	}

	const validated = bridgeSchema.safeParse(parsed);
	if (!validated.success) {
		bridgeCache.set(bridgePath, { mtimeMs, payload: null, cachedAt: now });
		return null;
	}

	bridgeCache.set(bridgePath, { mtimeMs, payload: validated.data, cachedAt: now });
	return validated.data;
}

/**
 * Extract an `owner/repo` from a bridge payload. Honors explicit `repo` first,
 * then attempts to parse a GitHub `remoteUrl` (ssh or https).
 */
export function extractRepoFromBridge(payload: ActiveRepoBridgePayload): string | null {
	if (payload.repo && isValidRepoIdentifier(payload.repo)) {
		return payload.repo.trim();
	}

	if (payload.remoteUrl) {
		const parsed = parseRemoteUrl(payload.remoteUrl);
		if (parsed && isValidRepoIdentifier(parsed)) {
			return parsed;
		}
	}

	return null;
}

/**
 * Parse `owner/repo` from a GitHub remote URL. Returns `null` if the URL is
 * not GitHub or can't be decoded.
 */
export function parseRemoteUrl(remoteUrl: string): string | null {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return null;

	// git@github.com:owner/repo(.git)
	const sshMatch = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
	if (sshMatch) {
		return `${sshMatch[1]}/${sshMatch[2]}`;
	}

	// https://github.com/owner/repo(.git)
	const httpsMatch = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
	if (httpsMatch) {
		return `${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

/**
 * Resolve a `repo` setting value into a concrete `owner/repo`.
 *
 * - `undefined` / `""` → `null` (caller decides semantics, e.g. pr-review-queue
 *   treats empty as "all repos").
 * - The sentinel → consults the bridge file. Returns `missing: "bridge"` when
 *   the file is absent/unreadable, or `missing: "invalid"` when present but
 *   without a parseable `owner/repo`.
 * - Any other string → returned as-is (callers still validate via
 *   `parseRepoIdentifier` if they need the split).
 */
export async function resolveRepoSelection(
	repoSetting: string | undefined,
	options?: { bridgePath?: string },
): Promise<ResolvedRepo | null> {
	if (!repoSetting) return null;

	if (!isActiveRepoSentinel(repoSetting)) {
		return { repo: repoSetting, isSentinel: false };
	}

	const bridgePath = options?.bridgePath && options.bridgePath.trim().length > 0
		? options.bridgePath
		: getDefaultBridgePath();

	const payload = await readBridgeFile(bridgePath);
	if (!payload) {
		return { repo: "", isSentinel: true, missing: "bridge" };
	}

	const extracted = extractRepoFromBridge(payload);
	if (!extracted) {
		return { repo: "", isSentinel: true, missing: "invalid", payload };
	}

	return { repo: extracted, isSentinel: true, payload };
}
