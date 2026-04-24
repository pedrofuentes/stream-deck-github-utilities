/**
 * Pure helpers for computing the default bridge-file path, parsing
 * GitHub remote URLs, and building the bridge payload. Kept separate from
 * extension.ts so they can be unit-tested without the vscode module.
 */

import * as os from "node:os";
import * as path from "node:path";

/** Filename inside the platform-specific app-data directory. */
const BRIDGE_FILENAME = "active-repo.json";

/** Bridge schema version written by this extension. */
export const BRIDGE_SCHEMA_VERSION = 2;

/**
 * Default bridge-file path. MUST match the plugin's
 * `src/utils/active-repo-source.ts` → `getDefaultBridgePath()`.
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

/**
 * Parse `owner/repo` from a GitHub remote URL (ssh or https).
 * Returns `null` if the URL isn't GitHub or can't be decoded.
 */
export function parseGitHubRemote(remoteUrl: string): string | null {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return null;

	const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
	if (ssh) {
		return `${ssh[1]}/${ssh[2]}`;
	}

	const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
	if (https) {
		return `${https[1]}/${https[2]}`;
	}

	return null;
}

/**
 * Snapshot of the working tree + HEAD we want the plugin to surface on the
 * Stream Deck LCD. All fields are optional so the plugin degrades gracefully
 * if git state isn't available (extension not yet queried git, or `vscode.git`
 * not enabled).
 */
export interface BridgeGitState {
	branch?: string;
	headSha?: string;
	upstream?: string;
	ahead?: number;
	behind?: number;
	staged?: number;
	unstaged?: number;
	untracked?: number;
	conflicts?: number;
	isDirty?: boolean;
}

export interface BridgePayload extends BridgeGitState {
	version: typeof BRIDGE_SCHEMA_VERSION;
	sourceApp: string;
	workspacePath: string;
	repo: string;
	remoteUrl: string;
	updatedAt: string;
}

export function buildBridgePayload(args: {
	workspacePath: string;
	repo: string;
	remoteUrl: string;
	sourceApp: string;
	git?: BridgeGitState;
	now?: Date;
}): BridgePayload {
	const base: BridgePayload = {
		version: BRIDGE_SCHEMA_VERSION,
		sourceApp: args.sourceApp,
		workspacePath: args.workspacePath,
		repo: args.repo,
		remoteUrl: args.remoteUrl,
		updatedAt: (args.now ?? new Date()).toISOString(),
	};
	return args.git ? { ...base, ...args.git } : base;
}

/** Two payloads are "equivalent" if only `updatedAt` differs. */
export function payloadsEquivalent(a: BridgePayload | null, b: BridgePayload): boolean {
	if (!a) return false;
	const { updatedAt: _au, ...ra } = a;
	const { updatedAt: _bu, ...rb } = b;
	return JSON.stringify(ra) === JSON.stringify(rb);
}
