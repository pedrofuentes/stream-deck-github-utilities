/**
 * Thin adapter over the built-in `vscode.git` extension API. We only need a
 * handful of fields, so we vendor a minimal structural type definition here
 * rather than depending on the full `git.d.ts` from vscode's repo.
 *
 * Source of truth for the real API:
 *   https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */

import type * as vscode from "vscode";
import type { BridgeGitState } from "./bridge";

/** Working-tree status codes we care about. Match vscode.git's `Status` enum. */
const STATUS_UNTRACKED = 7;
const STATUS_IGNORED = 8;

interface GitUpstream {
	readonly name: string;
	readonly remote: string;
	readonly commit?: string;
}

interface GitBranch {
	readonly name?: string;
	readonly commit?: string;
	readonly upstream?: GitUpstream;
	readonly ahead?: number;
	readonly behind?: number;
}

interface GitChange {
	readonly uri: vscode.Uri;
	readonly status: number;
}

interface GitRepositoryState {
	readonly HEAD?: GitBranch;
	readonly indexChanges: readonly GitChange[];
	readonly workingTreeChanges: readonly GitChange[];
	readonly mergeChanges: readonly GitChange[];
	readonly onDidChange: vscode.Event<void>;
}

interface GitRepository {
	readonly rootUri: vscode.Uri;
	readonly state: GitRepositoryState;
}

export interface GitAPI {
	readonly repositories: readonly GitRepository[];
	getRepository(uri: vscode.Uri): GitRepository | null;
	readonly onDidOpenRepository: vscode.Event<GitRepository>;
	readonly onDidCloseRepository: vscode.Event<GitRepository>;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: vscode.Event<boolean>;
	getAPI(version: 1): GitAPI;
}

/**
 * Find the repository whose root matches (or contains) the given workspace path.
 * The vscode.git API may report multiple repos — we pick the one whose rootUri
 * is the workspace path itself, falling back to any repo under that path.
 */
export function findRepository(api: GitAPI, workspacePath: string): GitRepository | null {
	// Prefer an exact match on rootUri.fsPath.
	for (const repo of api.repositories) {
		if (repo.rootUri.fsPath === workspacePath) return repo;
	}
	// Fall back to any repo whose root is a prefix of the workspace path
	// (catches submodule/nested cases) or vice versa (workspace inside a repo).
	for (const repo of api.repositories) {
		const root = repo.rootUri.fsPath;
		if (workspacePath.startsWith(root + "/") || root.startsWith(workspacePath + "/")) return repo;
	}
	return null;
}

/** Build a BridgeGitState snapshot from a live vscode.git Repository. */
export function snapshotGitState(repo: GitRepository): BridgeGitState {
	const { HEAD, indexChanges, workingTreeChanges, mergeChanges } = repo.state;

	let untracked = 0;
	let unstaged = 0;
	for (const change of workingTreeChanges) {
		if (change.status === STATUS_UNTRACKED) untracked += 1;
		else if (change.status !== STATUS_IGNORED) unstaged += 1;
	}

	const staged = indexChanges.length;
	const conflicts = mergeChanges.length;
	const isDirty = staged + unstaged + untracked + conflicts > 0;

	const branch = HEAD?.name;
	const headSha = HEAD?.commit ? HEAD.commit.slice(0, 7) : undefined;
	const upstream = HEAD?.upstream ? `${HEAD.upstream.remote}/${HEAD.upstream.name}` : undefined;

	return {
		branch,
		headSha,
		upstream,
		ahead: HEAD?.ahead,
		behind: HEAD?.behind,
		staged,
		unstaged,
		untracked,
		conflicts,
		isDirty,
	};
}
