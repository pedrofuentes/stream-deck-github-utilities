/**
 * Stream Deck GitHub Utilities — Active Repo Bridge.
 *
 * Writes the currently active workspace's GitHub repo to a JSON bridge file.
 * The Stream Deck plugin reads that file whenever a button is configured with
 * the "★ Current Active Repo" option, so buttons follow your editor focus
 * without manual reconfiguration.
 *
 * The extension triggers on:
 *   - startup (one initial write if the workspace has a GitHub remote)
 *   - workspace-folder changes (add / remove / switch)
 *   - window focus changes (the last-focused window owns the bridge file)
 *   - manual "Stream Deck Bridge: Refresh Active Repo" command
 *
 * Writes are debounced and atomic (tmp file → rename) so rapid switching
 * can't thrash the plugin's reader.
 */

import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildBridgePayload, getDefaultBridgePath, parseGitHubRemote } from "./bridge";

const execFileAsync = promisify(execFile);

const CONFIG_SECTION = "streamDeckGitHubBridge";
const DEFAULT_DEBOUNCE_MS = 300;
const GIT_TIMEOUT_MS = 3000;

let debounceTimer: NodeJS.Timeout | undefined;
let outputChannel: vscode.OutputChannel | undefined;

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

	const payload = buildBridgePayload({
		workspacePath,
		repo,
		remoteUrl,
		sourceApp: vscode.env.appName,
	});

	const destPath = getConfiguredBridgePath();
	await atomicWrite(destPath, JSON.stringify(payload, null, 2) + "\n");
	log(`wrote ${destPath} → ${repo}`);
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

export function activate(context: vscode.ExtensionContext): void {
	outputChannel = vscode.window.createOutputChannel("Stream Deck GitHub Bridge");
	context.subscriptions.push(outputChannel);

	log(`activated in ${vscode.env.appName}`);

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
}

export function deactivate(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
}
