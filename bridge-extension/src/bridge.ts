/**
 * Pure helpers for computing the default bridge-file path and parsing
 * GitHub remote URLs. Kept separate from extension.ts so they can be
 * unit-tested without the vscode module.
 */

import * as os from "node:os";
import * as path from "node:path";

/** Filename inside the platform-specific app-data directory. */
const BRIDGE_FILENAME = "active-repo.json";

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

	// git@github.com:owner/repo(.git)
	const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
	if (ssh) {
		return `${ssh[1]}/${ssh[2]}`;
	}

	// https://github.com/owner/repo(.git)(/)?
	const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
	if (https) {
		return `${https[1]}/${https[2]}`;
	}

	return null;
}

export interface BridgePayload {
	version: 1;
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
	now?: Date;
}): BridgePayload {
	return {
		version: 1,
		sourceApp: args.sourceApp,
		workspacePath: args.workspacePath,
		repo: args.repo,
		remoteUrl: args.remoteUrl,
		updatedAt: (args.now ?? new Date()).toISOString(),
	};
}
