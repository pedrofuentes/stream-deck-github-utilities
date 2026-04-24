/**
 * Stream Deck GitHub Utilities — Active Repo Bridge.
 *
 * Writes the currently active workspace's GitHub repo + live working-tree
 * snapshot to a JSON bridge file. The Stream Deck plugin reads that file
 * whenever a button is configured with the "★ Current Active Repo" option,
 * so buttons follow your editor focus and git state without manual refresh.
 *
 * The extension triggers on:
 *   - startup (one initial write if the workspace has a GitHub remote)
 *   - workspace-folder changes (add / remove / switch)
 *   - window focus changes (the last-focused window owns the bridge file)
 *   - vscode.git Repository.state.onDidChange (every save / stage / commit)
 *   - manual "Stream Deck Bridge: Refresh Active Repo" command
 *
 * Writes are debounced, atomic (tmp file → rename), and suppressed when
 * nothing relevant changed, so rapid save/stage events don't thrash the
 * plugin's reader.
 */

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
	type BridgeGitState,
	type BridgePayload,
	buildBridgePayload,
	getDefaultBridgePath,
	parseGitHubRemote,
	payloadsEquivalent,
} from "./bridge";
import { findRepository, type GitAPI, type GitExtension, snapshotGitState } from "./git-state";

const execFileAsync = promisify(execFile);

const CONFIG_SECTION = "streamDeckGitHubBridge";
const DEFAULT_DEBOUNCE_MS = 300;
const GIT_TIMEOUT_MS = 3000;

let debounceTimer: NodeJS.Timeout | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let gitApi: GitAPI | null = null;
let repoStateSubscription: vscode.Disposable | undefined;
let watchedRepoRoot: string | undefined;

/**
 * Last successfully-snapshotted git state per workspace path.
 *
 * Cursor's git extension briefly drops repos out of `gitApi.repositories` during
 * many transient state transitions (active-editor changes, branch checkouts,
 * focus shifts). If we write an empty-git payload during those windows the
 * Stream Deck flickers to "git state unavailable". Instead, we fall back to
 * the cached snapshot so the LCD stays stable — the next real change will
 * update it. Keyed by workspace path so cross-workspace switches still
 * invalidate cleanly.
 */
const gitStateCache = new Map<string, BridgeGitState>();

function log(message: string): void {
	if (outputChannel) {
		outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
	}
}

function getConfiguredBridgePath(): string {
	const override = vscode.workspace.getConfiguration(CONFIG_SECTION).get<string>("bridgePath");
	return override && override.trim().length > 0 ? override.trim() : getDefaultBridgePath();
}

function getDebounceMs(): number {
	const ms = vscode.workspace.getConfiguration(CONFIG_SECTION).get<number>("debounceMs");
	return typeof ms === "number" && ms >= 0 ? ms : DEFAULT_DEBOUNCE_MS;
}

function getPrimaryFolder(): vscode.WorkspaceFolder | undefined {
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length > 0 ? folders[0] : undefined;
}

async function getGitRemote(cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, "remote", "get-url", "origin"], {
			timeout: GIT_TIMEOUT_MS,
		});
		const url = stdout.trim();
		return url.length > 0 ? url : null;
	} catch (err) {
		log(`git remote lookup failed for ${cwd}: ${err instanceof Error ? err.message : err}`);
		return null;
	}
}

async function atomicWrite(dest: string, contents: string): Promise<void> {
	await fs.mkdir(path.dirname(dest), { recursive: true });
	const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
	await fs.writeFile(tmp, contents, "utf8");
	await fs.rename(tmp, dest);
}

/**
 * Read and parse whatever is currently on disk at the bridge path. Used to
 * compare against our about-to-write payload so multi-window setups (where
 * each window's extension has its own in-memory state) don't skip writes
 * based on a local cache that doesn't reflect what another window already
 * wrote. Returns `null` when the file is missing or unreadable — in which
 * case we'll always write.
 */
async function readCurrentBridge(dest: string): Promise<BridgePayload | null> {
	try {
		const raw = await fs.readFile(dest, "utf8");
		return JSON.parse(raw) as BridgePayload;
	} catch {
		return null;
	}
}

async function loadGitAPI(): Promise<GitAPI | null> {
	const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
	if (!ext) {
		log("vscode.git extension not found");
		return null;
	}
	const api = ext.isActive ? ext.exports : await ext.activate();
	if (!api?.enabled) {
		log("vscode.git extension not enabled");
		return null;
	}
	return api.getAPI(1);
}

/**
 * Subscribe (or resubscribe) to the git repo matching the given workspace.
 *
 * If the git API doesn't currently have the repo (transient transition), we
 * keep the existing subscription alive and leave `watchedRepoRoot` unchanged,
 * so the next `onDidOpenRepository` for the same path is still a useful signal.
 */
function trackRepository(workspacePath: string): void {
	if (!gitApi) return;

	const repo = findRepository(gitApi, workspacePath);
	if (!repo) {
		// Transient: git extension doesn't have the repo right now. Don't tear
		// down the existing subscription — it'll still fire if it reappears.
		return;
	}

	const newRoot = repo.rootUri.fsPath;
	if (newRoot === watchedRepoRoot) return;

	repoStateSubscription?.dispose();
	watchedRepoRoot = newRoot;
	repoStateSubscription = repo.state.onDidChange(() => scheduleUpdate("gitState"));
	log(`tracking repo ${newRoot}`);
}

async function updateBridgeFile(): Promise<void> {
	const folder = getPrimaryFolder();
	if (!folder) {
		log("no workspace folder; skipping");
		return;
	}

	const workspacePath = folder.uri.fsPath;
	const remoteUrl = await getGitRemote(workspacePath);
	if (!remoteUrl) {
		log(`no git remote for ${workspacePath}; skipping`);
		return;
	}

	const repo = parseGitHubRemote(remoteUrl);
	if (!repo) {
		log(`remote is not a GitHub URL (${remoteUrl}); skipping`);
		return;
	}

	// Make sure we're subscribed to this workspace's git repo.
	trackRepository(workspacePath);

	const gitRepo = gitApi ? findRepository(gitApi, workspacePath) : null;
	let git: BridgeGitState | undefined;
	if (gitRepo) {
		git = snapshotGitState(gitRepo);
		gitStateCache.set(workspacePath, git);
	} else {
		// Transient: git API can't locate the repo right now. Fall back to the
		// last known snapshot for this workspace so the LCD doesn't flicker.
		git = gitStateCache.get(workspacePath);
	}

	const payload = buildBridgePayload({
		workspacePath,
		repo,
		remoteUrl,
		sourceApp: vscode.env.appName,
		git,
	});

	// Skip the disk write when nothing meaningful has changed — compare against
	// what's ACTUALLY on disk, not an in-memory cache. Each Cursor window has
	// its own extension host (and its own module state), so if we cached our
	// last write locally, a window that just became focused would think
	// "nothing changed" based on its own memory, while the bridge file on disk
	// actually reflects another window's data. Reading the file is the source
	// of truth and handles multi-window focus switches correctly.
	const destPath = getConfiguredBridgePath();
	const onDisk = await readCurrentBridge(destPath);
	if (payloadsEquivalent(onDisk, payload)) {
		return;
	}

	await atomicWrite(destPath, JSON.stringify(payload, null, 2) + "\n");

	const dirtySummary = git
		? `branch=${git.branch ?? "?"} staged=${git.staged ?? 0} unstaged=${git.unstaged ?? 0} untracked=${git.untracked ?? 0} ↑${git.ahead ?? 0} ↓${git.behind ?? 0}`
		: "no git state";
	log(`wrote ${destPath} → ${repo} (${dirtySummary})`);
}

function scheduleUpdate(reason: string): void {
	if (debounceTimer) clearTimeout(debounceTimer);
	const delay = getDebounceMs();
	debounceTimer = setTimeout(() => {
		debounceTimer = undefined;
		log(`updating (trigger: ${reason})`);
		updateBridgeFile().catch((err) => {
			log(`update failed: ${err instanceof Error ? err.message : String(err)}`);
		});
	}, delay);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	outputChannel = vscode.window.createOutputChannel("Stream Deck GitHub Bridge");
	context.subscriptions.push(outputChannel);

	log(`activated in ${vscode.env.appName}`);

	gitApi = await loadGitAPI();
	if (gitApi) {
		// If a repo opens after activation (cloning, multi-root), rewire.
		context.subscriptions.push(
			gitApi.onDidOpenRepository(() => {
				const folder = getPrimaryFolder();
				if (folder) trackRepository(folder.uri.fsPath);
				scheduleUpdate("gitRepoOpened");
			}),
		);
		context.subscriptions.push(
			gitApi.onDidCloseRepository(() => scheduleUpdate("gitRepoClosed")),
		);
	}

	// Initial write on activation — only if this window is focused, otherwise
	// a background window would clobber whatever the focused window just wrote.
	if (vscode.window.state.focused) {
		scheduleUpdate("activate");
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => scheduleUpdate("workspaceFolders")),
	);

	context.subscriptions.push(
		vscode.window.onDidChangeWindowState((state) => {
			if (state.focused) scheduleUpdate("focus");
		}),
	);

	// Tab-within-window switches don't fire the git-state or focus events,
	// but the user expects the Stream Deck to stay responsive to them.
	// The 300 ms debounce collapses rapid editor navigation into a single write.
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(() => scheduleUpdate("activeTextEditor")),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(`${CONFIG_SECTION}.refresh`, async () => {
			try {
				await updateBridgeFile();
				vscode.window.showInformationMessage("Bridge file updated.");
			} catch (err) {
				vscode.window.showErrorMessage(
					`Bridge update failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push({
		dispose: () => {
			repoStateSubscription?.dispose();
			repoStateSubscription = undefined;
		},
	});
}

export function deactivate(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
	repoStateSubscription?.dispose();
	repoStateSubscription = undefined;
}
