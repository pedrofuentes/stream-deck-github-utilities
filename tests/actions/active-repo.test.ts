/**
 * Tests for the ActiveRepoAction (src/actions/active-repo.ts).
 *
 * Exercises the action's orchestration: first-appear sentinel seeding,
 * bridge-file resolution, view-mode cycling via dial rotate, press-to-open-
 * editor routing, and unconfigured/invalid bridge fallbacks.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────

const {
	mockGetGlobalSettings,
	mockOpenUrl,
	mockLoggerInfo,
	mockLoggerError,
	mockCoordinatorSubscribe,
	mockCoordinatorUnsubscribe,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockOpenUrl: vi.fn(),
	mockLoggerInfo: vi.fn(),
	mockLoggerError: vi.fn(),
	mockCoordinatorSubscribe: vi.fn(),
	mockCoordinatorUnsubscribe: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class MockSingletonAction {}
	return {
		default: {
			actions: { registerAction: vi.fn() },
			settings: { getGlobalSettings: mockGetGlobalSettings, setGlobalSettings: vi.fn() },
			system: { openUrl: mockOpenUrl },
			logger: {
				setLevel: vi.fn(),
				info: mockLoggerInfo,
				error: mockLoggerError,
				debug: vi.fn(),
				warn: vi.fn(),
			},
			connect: vi.fn(),
		},
		SingletonAction: MockSingletonAction,
		action: () => (target: unknown) => target,
	};
});

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	GraphQLQueryCoordinator: vi.fn().mockImplementation(() => ({
		subscribe: mockCoordinatorSubscribe,
		unsubscribe: mockCoordinatorUnsubscribe,
		fetchData: vi.fn(),
		invalidateAndFetch: vi.fn(),
		isSubscribed: vi.fn().mockReturnValue(true),
	})),
}));

vi.mock("../../src/utils/repo-data-cache", () => ({
	RepoDataCache: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({
	stat: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
	promises: fsMock,
	default: { promises: fsMock },
}));

import { ActiveRepoAction } from "../../src/actions/active-repo";
import {
	ACTIVE_REPO_SENTINEL,
	_resetBridgeCache,
	activeRepoWatcher,
} from "../../src/utils/active-repo-source";

// ─── Helpers ──────────────────────────────────────────────────────────────

function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

function createMockKeyAction(id: string) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.active-repo",
		isKey: () => true,
		isDial: () => false,
		setImage: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
		setSettings: vi.fn().mockResolvedValue(undefined),
		setFeedback: vi.fn().mockResolvedValue(undefined),
		setFeedbackLayout: vi.fn().mockResolvedValue(undefined),
	};
}

function createMockDialAction(id: string) {
	return {
		...createMockKeyAction(id),
		isKey: () => false,
		isDial: () => true,
	};
}

type MockAction = ReturnType<typeof createMockKeyAction>;

function appearEvent(actionMock: MockAction, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings } };
}

function receiveSettingsEvent(actionMock: MockAction, settings: Record<string, unknown>) {
	return { action: actionMock, payload: { settings } };
}

function lastImage(actionMock: MockAction): string {
	const calls = actionMock.setImage.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	return decodeSvg(calls[calls.length - 1][0] as string);
}

function lastFeedback(actionMock: MockAction): string {
	const calls = actionMock.setFeedback.mock.calls;
	expect(calls.length).toBeGreaterThan(0);
	const arg = calls[calls.length - 1][0] as { canvas: string };
	return decodeSvg(arg.canvas);
}

const v2Payload = {
	version: 2,
	sourceApp: "Cursor",
	workspacePath: "/Users/you/projects/demo",
	repo: "owner/demo",
	remoteUrl: "git@github.com:owner/demo.git",
	updatedAt: "2026-04-23T22:10:00.000Z",
	branch: "feat/x",
	headSha: "a3f91c0",
	upstream: "origin/main",
	ahead: 3,
	behind: 1,
	staged: 2,
	unstaged: 5,
	untracked: 1,
	conflicts: 0,
	isDirty: true,
};

function mockBridgeFile(payload: unknown, mtimeMs = 1) {
	fsMock.stat.mockResolvedValue({ mtimeMs });
	fsMock.readFile.mockResolvedValue(JSON.stringify(payload));
}

function mockBridgeMissing() {
	fsMock.stat.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
}

// ─── Setup ────────────────────────────────────────────────────────────────

describe("ActiveRepoAction", () => {
	let action: ActiveRepoAction;

	beforeEach(() => {
		vi.clearAllMocks();
		_resetBridgeCache();
		mockGetGlobalSettings.mockResolvedValue({});
		action = new ActiveRepoAction();
	});

	afterEach(() => {
		// Clean the watcher so subscribers don't leak across tests.
		activeRepoWatcher.unsubscribe("k1");
		activeRepoWatcher.unsubscribe("d1");
	});

	// ── First-appear behavior ────────────────────────────────────────────

	it("seeds the sentinel as the default repo on first appear when unset", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction) as never);

		expect(mockAction.setSettings).toHaveBeenCalledWith(
			expect.objectContaining({ repo: ACTIVE_REPO_SENTINEL }),
		);
	});

	it("does not re-seed when every default is already set", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(
			appearEvent(mockAction, {
				repo: "owner/demo",
				ownerDisplay: "full",
				viewMode: "branch-sync",
			}) as never,
		);

		expect(mockAction.setSettings).not.toHaveBeenCalled();
	});

	it("seeds missing display defaults (ownerDisplay, viewMode) on first appear", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction) as never);

		const seeded = mockAction.setSettings.mock.calls[0][0];
		expect(seeded.repo).toBe(ACTIVE_REPO_SENTINEL);
		expect(seeded.ownerDisplay).toBe("full");
		expect(seeded.viewMode).toBe("branch-sync");
	});

	it("passes showOwner=false to the renderer when ownerDisplay is 'short'", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(
			appearEvent(mockAction, {
				repo: ACTIVE_REPO_SENTINEL,
				ownerDisplay: "short",
			}) as never,
		);

		const svg = lastImage(mockAction);
		// Short form must not include the owner slash.
		expect(svg).not.toContain("owner/demo");
		// But should still include the repo name itself.
		expect(svg).toContain("demo");
	});

	it("renders the keypad with branch + status from a v2 bridge", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("owner/demo");
		expect(svg).toContain("feat/x");
		expect(svg).toMatch(/3↑/);
		expect(svg).toMatch(/1↓/);
	});

	it("renders the dial Mode A by default on a dial context", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		expect(mockAction.setFeedbackLayout).toHaveBeenCalledWith("layouts/github-full-canvas.json");
		const svg = lastFeedback(mockAction);
		// Mode A includes the upstream label; Mode B does not.
		expect(svg).toContain("origin/main");
	});

	it("renders dial Mode B when viewMode setting is working-tree", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(
			appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL, viewMode: "working-tree" }) as never,
		);

		const svg = lastFeedback(mockAction);
		expect(svg).toContain("STAGED");
		expect(svg).toContain("UNSTAGED");
	});

	// ── Fixed-repo + bridge-repo match/mismatch ──────────────────────────

	it("shows full git state when fixed-repo matches the bridge repo", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction, { repo: "owner/demo" }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("feat/x");
	});

	it("falls back to the no-git-state renderer when fixed-repo differs from bridge repo", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(appearEvent(mockAction, { repo: "other/project" }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("other/project");
		expect(svg).toMatch(/upgrade/i);
		expect(svg).not.toContain("feat/x");
	});

	// ── View-mode cycling via dial rotate ────────────────────────────────

	it("toggles viewMode on dial rotate and persists via setSettings", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);

		await action.onWillAppear(
			appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL, viewMode: "branch-sync" }) as never,
		);
		mockAction.setSettings.mockClear();
		mockAction.setFeedback.mockClear();

		await action.onDialRotate({ action: mockAction, payload: { ticks: 1, pressed: false, settings: { repo: ACTIVE_REPO_SENTINEL, viewMode: "branch-sync" } } } as never);

		expect(mockAction.setSettings).toHaveBeenCalledWith(
			expect.objectContaining({ viewMode: "working-tree" }),
		);
		const svg = lastFeedback(mockAction);
		expect(svg).toContain("STAGED");
	});

	it("toggles back to branch-sync on a second rotate", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);

		// Start in branch-sync → rotate once → working-tree → rotate again → branch-sync.
		await action.onWillAppear(
			appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL, viewMode: "branch-sync" }) as never,
		);
		await action.onDialRotate({ action: mockAction, payload: { ticks: 1, pressed: false, settings: {} } } as never);
		mockAction.setFeedback.mockClear();
		await action.onDialRotate({ action: mockAction, payload: { ticks: -1, pressed: false, settings: {} } } as never);

		const svg = lastFeedback(mockAction);
		expect(svg).toContain("origin/main");
	});

	// ── Press routing ────────────────────────────────────────────────────

	it("opens the workspace in the editor on key press (Cursor when bridge wrote Cursor)", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile(v2Payload);
		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		await action.onKeyUp({ action: mockAction, payload: { settings: {} } } as never);

		expect(mockOpenUrl).toHaveBeenCalledTimes(1);
		const url = mockOpenUrl.mock.calls[0][0];
		expect(url).toMatch(/^cursor:\/\/file\//);
	});

	it("opens the workspace on dial press", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);
		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		await action.onDialUp({ action: mockAction, payload: { settings: {} } } as never);

		expect(mockOpenUrl).toHaveBeenCalledTimes(1);
		expect(mockOpenUrl.mock.calls[0][0]).toMatch(/^cursor:\/\//);
	});

	it("falls back to vscode:// when the bridge sourceApp is VS Code", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile({ ...v2Payload, sourceApp: "Visual Studio Code" });
		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		await action.onKeyUp({ action: mockAction, payload: { settings: {} } } as never);

		expect(mockOpenUrl.mock.calls[0][0]).toMatch(/^vscode:\/\//);
	});

	// ── Error / unconfigured states ──────────────────────────────────────

	it("renders the setup-required state when the bridge file is missing", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeMissing();

		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("Active Repo");
		expect(svg).toContain("Setup required");
	});

	it("renders 'Bad bridge' when the bridge payload has no resolvable repo", async () => {
		const mockAction = createMockKeyAction("k1");
		// Payload present but missing both repo and remoteUrl — resolves as 'invalid'.
		mockBridgeFile({ version: 2, sourceApp: "Cursor", workspacePath: "/x", updatedAt: "t" });

		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("Bad bridge");
	});

	it("renders the no-git-state hint for a v1 bridge on sentinel", async () => {
		const mockAction = createMockKeyAction("k1");
		mockBridgeFile({ version: 1, repo: "owner/demo" });

		await action.onWillAppear(appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL }) as never);

		const svg = lastImage(mockAction);
		expect(svg).toContain("owner/demo");
		expect(svg).toMatch(/upgrade/i);
	});

	// ── Settings reception ───────────────────────────────────────────────

	it("re-renders when settings change via onDidReceiveSettings", async () => {
		const mockAction = createMockDialAction("d1");
		mockBridgeFile(v2Payload);
		await action.onWillAppear(
			appearEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL, viewMode: "branch-sync" }) as never,
		);
		mockAction.setFeedback.mockClear();

		await action.onDidReceiveSettings(
			receiveSettingsEvent(mockAction, { repo: ACTIVE_REPO_SENTINEL, viewMode: "working-tree" }) as never,
		);

		const svg = lastFeedback(mockAction);
		expect(svg).toContain("STAGED");
	});
});
