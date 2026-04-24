import { describe, it, expect } from "vitest";

import { findRepository, snapshotGitState, type GitAPI } from "./git-state";

type AnyRepo = {
	rootUri: { fsPath: string };
	state: {
		HEAD?: {
			name?: string;
			commit?: string;
			upstream?: { name: string; remote: string };
			ahead?: number;
			behind?: number;
		};
		indexChanges: Array<{ status: number; uri: { fsPath: string } }>;
		workingTreeChanges: Array<{ status: number; uri: { fsPath: string } }>;
		mergeChanges: Array<{ status: number; uri: { fsPath: string } }>;
		onDidChange: (...args: unknown[]) => unknown;
	};
};

function makeApi(repos: AnyRepo[]): GitAPI {
	return {
		repositories: repos,
		getRepository: () => null,
		onDidOpenRepository: (() => ({ dispose: () => {} })) as unknown as GitAPI["onDidOpenRepository"],
		onDidCloseRepository: (() => ({ dispose: () => {} })) as unknown as GitAPI["onDidCloseRepository"],
	} as unknown as GitAPI;
}

function makeRepo(rootFsPath: string, state: Partial<AnyRepo["state"]> = {}): AnyRepo {
	return {
		rootUri: { fsPath: rootFsPath },
		state: {
			indexChanges: [],
			workingTreeChanges: [],
			mergeChanges: [],
			onDidChange: () => ({ dispose: () => {} }),
			...state,
		},
	};
}

describe("findRepository", () => {
	it("returns the repo with an exact rootUri match", () => {
		const target = makeRepo("/ws/demo");
		const other = makeRepo("/ws/other");
		const api = makeApi([other, target]);
		expect(findRepository(api, "/ws/demo")).toBe(target);
	});

	it("falls back to a repo whose root contains the workspace", () => {
		const parent = makeRepo("/ws/demo");
		const api = makeApi([parent]);
		expect(findRepository(api, "/ws/demo/packages/app")).toBe(parent);
	});

	it("returns null when no repo matches", () => {
		const api = makeApi([makeRepo("/elsewhere")]);
		expect(findRepository(api, "/ws/demo")).toBeNull();
	});
});

describe("snapshotGitState", () => {
	it("reports clean when there are no changes and synced upstream", () => {
		const repo = makeRepo("/ws/demo", {
			HEAD: {
				name: "main",
				commit: "a3f91c0abcdef",
				upstream: { name: "main", remote: "origin" },
				ahead: 0,
				behind: 0,
			},
		});
		const state = snapshotGitState(repo as never);
		expect(state).toMatchObject({
			branch: "main",
			headSha: "a3f91c0",
			upstream: "origin/main",
			ahead: 0,
			behind: 0,
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicts: 0,
			isDirty: false,
		});
	});

	it("counts staged, unstaged, and untracked separately", () => {
		// Status codes: 0=INDEX_MODIFIED, 5=MODIFIED, 6=DELETED, 7=UNTRACKED, 8=IGNORED, 11=TYPE_CHANGED
		const repo = makeRepo("/ws/demo", {
			HEAD: { name: "feat/x", commit: "deadbeefcafe" },
			indexChanges: [
				{ status: 0, uri: { fsPath: "/a" } },
				{ status: 2, uri: { fsPath: "/b" } },
			],
			workingTreeChanges: [
				{ status: 5, uri: { fsPath: "/c" } }, // unstaged modified
				{ status: 11, uri: { fsPath: "/d" } }, // unstaged type change
				{ status: 7, uri: { fsPath: "/e" } }, // untracked
				{ status: 8, uri: { fsPath: "/f" } }, // ignored — shouldn't count
			],
		});
		const state = snapshotGitState(repo as never);
		expect(state.branch).toBe("feat/x");
		expect(state.staged).toBe(2);
		expect(state.unstaged).toBe(2);
		expect(state.untracked).toBe(1);
		expect(state.isDirty).toBe(true);
	});

	it("surfaces merge conflicts and sets isDirty", () => {
		const repo = makeRepo("/ws/demo", {
			HEAD: { name: "main", commit: "abc1234" },
			mergeChanges: [{ status: 18, uri: { fsPath: "/x" } }],
		});
		const state = snapshotGitState(repo as never);
		expect(state.conflicts).toBe(1);
		expect(state.isDirty).toBe(true);
	});

	it("handles detached HEAD (no branch name)", () => {
		const repo = makeRepo("/ws/demo", {
			HEAD: { commit: "abcdef1234567" },
		});
		const state = snapshotGitState(repo as never);
		expect(state.branch).toBeUndefined();
		expect(state.headSha).toBe("abcdef1");
		expect(state.upstream).toBeUndefined();
	});

	it("handles missing HEAD gracefully", () => {
		const repo = makeRepo("/ws/demo", {});
		const state = snapshotGitState(repo as never);
		expect(state.branch).toBeUndefined();
		expect(state.headSha).toBeUndefined();
		expect(state.upstream).toBeUndefined();
		expect(state.isDirty).toBe(false);
	});
});
