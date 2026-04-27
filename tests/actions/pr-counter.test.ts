/**
 * Tests for the PRCounterAction (src/actions/pr-counter.ts).
 *
 * Mocks the @elgato/streamdeck module and the GraphQL Query Coordinator
 * to test the action's lifecycle, settings handling, and error states.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ──────────────────────────────────────────────
// Mock the @elgato/streamdeck module BEFORE importing the action
// ──────────────────────────────────────────────

const {
	mockGetGlobalSettings,
	mockRegisterAction,
	mockLoggerDebug,
	mockLoggerError,
	mockOpenUrl,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerDebug: vi.fn(),
	mockLoggerError: vi.fn(),
	mockOpenUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@elgato/streamdeck", () => {
	class MockSingletonAction {
		manifestId: string | undefined;
		get actions(): unknown[] {
			return [];
		}
	}

	return {
		default: {
			actions: { registerAction: mockRegisterAction },
			settings: {
				getGlobalSettings: mockGetGlobalSettings,
			},
			system: {
				openUrl: mockOpenUrl,
			},
			logger: {
				setLevel: vi.fn(),
				debug: mockLoggerDebug,
				error: mockLoggerError,
				info: vi.fn(),
				warn: vi.fn(),
			},
			connect: vi.fn(),
		},
		SingletonAction: MockSingletonAction,
		action: () => (target: unknown) => target,
	};
});

// ──────────────────────────────────────────────
// Mock the GraphQL Query Coordinator
// ──────────────────────────────────────────────

const { mockCoordinator } = vi.hoisted(() => ({
	mockCoordinator: {
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		fetchData: vi.fn(),
		invalidateAndFetch: vi.fn(),
		isSubscribed: vi.fn().mockReturnValue(true),
	},
}));

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	GraphQLQueryCoordinator: vi.fn().mockImplementation(() => mockCoordinator),
}));

vi.mock("../../src/utils/repo-data-cache", () => ({
	RepoDataCache: vi.fn(),
}));

import { PRCounterAction } from "../../src/actions/pr-counter";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.pr-counter",
		isKey: () => true,
		isDial: () => false,
		setImage: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
		showAlert: vi.fn().mockResolvedValue(undefined),
		showOk: vi.fn().mockResolvedValue(undefined),
		getSettings: vi.fn().mockResolvedValue(settings),
		setSettings: vi.fn().mockResolvedValue(undefined),
	};
}

function createWillAppearEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings },
	};
}

function createKeyDownEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings },
	};
}

function createDidReceiveSettingsEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings },
	};
}

function createWillDisappearEvent(actionMock: ReturnType<typeof createMockKeyAction>) {
	return {
		action: actionMock,
		payload: {},
	};
}

function createSendToPluginEvent(actionMock: ReturnType<typeof createMockKeyAction>, payload: Record<string, unknown>) {
	return {
		action: actionMock,
		payload,
	};
}

function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

function lastImage(mockAction: ReturnType<typeof createMockKeyAction>): string {
	const calls = mockAction.setImage.mock.calls;
	return decodeSvg(calls[calls.length - 1][0] as string);
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("PRCounterAction", () => {
	let action: PRCounterAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new PRCounterAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinator.fetchData.mockResolvedValue({ prCount: 0 });
		mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 0 });
		mockCoordinator.isSubscribed.mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("pr-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("pr-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays PR count when configured", async () => {
			const mockAction = createMockKeyAction("pr-2");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 42 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("42");
			expect(svg).toContain("Open PRs");
		});

		it("displays closed PR count when stateFilter is closed", async () => {
			const mockAction = createMockKeyAction("pr-2b");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 10 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("10");
			expect(svg).toContain("Closed PRs");
		});

		it("subscribes to coordinator with correct params", async () => {
			const mockAction = createMockKeyAction("pr-sub-1");
			const settings = { repo: "owner/repo", stateFilter: "closed", refreshInterval: 120 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "pr-sub-1",
				repo: "owner/repo",
				fragments: ["prCount"],
				maxAgeSec: 120,
				params: { prState: "closed" },
			}, expect.any(Function));
		});

		it("defaults prState param to open when stateFilter is not set", async () => {
			const mockAction = createMockKeyAction("pr-sub-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 3 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					params: { prState: "open" },
				}),
				expect.any(Function),
			);
		});

		it("does not subscribe when repo is not set", async () => {
			const mockAction = createMockKeyAction("pr-sub-3");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).not.toHaveBeenCalled();
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer and unsubscribes on disappear", async () => {
			const mockAction = createMockKeyAction("pr-3");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("pr-3");
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("pr-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("pr-never-appeared");
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens PR page on GitHub when repo is configured", async () => {
			const mockAction = createMockKeyAction("pr-4");
			const settings = { repo: "facebook/react" };

			// First appear to cache settings
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/pulls");
			vi.useRealTimers();
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("pr-4b");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("pr-5");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("pr-5", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 15 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("15");
		});

		it("defaults stateFilter to open when not set", async () => {
			const mockAction = createMockKeyAction("pr-5b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("pr-5b", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 3 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Open PRs");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("pr-5c");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("re-subscribes to coordinator on settings change", async () => {
			const mockAction = createMockKeyAction("pr-sub-change");
			const settings = { repo: "owner/new-repo", stateFilter: "all", refreshInterval: 60 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("pr-sub-change", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 7 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "pr-sub-change",
				repo: "owner/new-repo",
				fragments: ["prCount"],
				maxAgeSec: 60,
				params: { prState: "all" },
			}, expect.any(Function));
		});

		it("unsubscribes when repo is cleared", async () => {
			const mockAction = createMockKeyAction("pr-sub-clear");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("pr-sub-clear");
		});
	});

	// ── Repo switching ─────────────────────────────
	// Verifies that changing the repo in the Property Inspector results in
	// the coordinator being re-subscribed with the new repo (the coordinator
	// handles cache invalidation internally when it detects a repo change).

	describe("repo switching", () => {
		it("should re-subscribe to coordinator with new repo on settings change", async () => {
			const mockAction = createMockKeyAction("pr-switch-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 17 });

			// Initial appear with repo A
			await action.onWillAppear?.(
				createWillAppearEvent(mockAction, { repo: "owner/repo-a", stateFilter: "open" }) as never,
			);

			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });

			// User changes to repo B via Property Inspector
			await action.onDidReceiveSettings?.(
				createDidReceiveSettingsEvent(mockAction, { repo: "owner/repo-b", stateFilter: "open" }) as never,
			);

			// Coordinator.subscribe should be called with the new repo.
			// The coordinator itself detects the repo change and invalidates stale cache.
			expect(mockCoordinator.subscribe).toHaveBeenCalledWith(
				expect.objectContaining({ actionId: "pr-switch-1", repo: "owner/repo-b" }),
				expect.any(Function),
			);
		});

		it("should display the NEW repo's PR count after switching repos", async () => {
			const mockAction = createMockKeyAction("pr-switch-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 17 });

			// Initial appear with repo A — count is 17
			await action.onWillAppear?.(
				createWillAppearEvent(mockAction, { repo: "owner/repo-a", stateFilter: "open" }) as never,
			);

			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });

			// After repo switch, coordinator returns fresh data for repo B
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });

			// User switches to repo B
			await action.onDidReceiveSettings?.(
				createDidReceiveSettingsEvent(mockAction, { repo: "owner/repo-b", stateFilter: "open" }) as never,
			);

			// The button should show repo B's count (5), not repo A's stale count (17)
			const svg = lastImage(mockAction);
			expect(svg).toContain("5");
			expect(svg).not.toContain(">17<");
		});

		it("should re-subscribe when stateFilter changes on same repo", async () => {
			const mockAction = createMockKeyAction("pr-switch-3");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 17 });

			// Initial appear with open PRs
			await action.onWillAppear?.(
				createWillAppearEvent(mockAction, { repo: "owner/repo", stateFilter: "open" }) as never,
			);

			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 42 });

			// User changes to closed PRs
			await action.onDidReceiveSettings?.(
				createDidReceiveSettingsEvent(mockAction, { repo: "owner/repo", stateFilter: "closed" }) as never,
			);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith(
				expect.objectContaining({ params: { prState: "closed" } }),
				expect.any(Function),
			);

			const svg = lastImage(mockAction);
			expect(svg).toContain("42");
			expect(svg).toContain("Closed PRs");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows error image when coordinator throws not found", async () => {
			const mockAction = createMockKeyAction("pr-err-1");
			const settings = { repo: "owner/nonexistent", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("Repository not found"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows auth error when token is invalid", async () => {
			const mockAction = createMockKeyAction("pr-err-2");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("401 Unauthorized"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows error for invalid repo format", async () => {
			const mockAction = createMockKeyAction("pr-err-3");
			const settings = { repo: "invalid-repo-name", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("defaults to zero when coordinator returns no prCount", async () => {
			const mockAction = createMockKeyAction("pr-err-4");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("0");
		});
	});

	// ── onKeyDown double-click force refresh ────

	describe("onKeyDown double-click", () => {
		it("calls invalidateAndFetch on double-click", async () => {
			const mockAction = createMockKeyAction("pr-dbl-1");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 10 });

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 10 });

			// First press
			const ev1 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev1 as never);

			// Second press within 400ms → double-click
			const ev2 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev2 as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("pr-dbl-1", "ghp_test123");
			expect(mockCoordinator.fetchData).not.toHaveBeenCalled();
		});
	});

	// ── onTouchTap force refresh ────────────────

	describe("onTouchTap", () => {
		it("calls invalidateAndFetch on touch tap", async () => {
			const mockAction = createMockKeyAction("pr-tap-1");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 20 });

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 20 });

			const tapEv = { action: mockAction, payload: { settings } };
			await action.onTouchTap?.(tapEv as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("pr-tap-1", "ghp_test123");
			expect(mockCoordinator.fetchData).not.toHaveBeenCalled();
		});
	});

	// ── onDialRotate force refresh ──────────────

	describe("onDialRotate", () => {
		it("calls invalidateAndFetch after cycling state filter", async () => {
			const mockAction = createMockKeyAction("pr-rot-1");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 15 });

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			vi.clearAllMocks();
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
			mockCoordinator.fetchData.mockResolvedValue({ prCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ prCount: 15 });

			const rotateEv = {
				action: mockAction,
				payload: { settings, ticks: 1, pressed: false },
			};
			await action.onDialRotate?.(rotateEv as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("pr-rot-1", "ghp_test123");
			expect(mockCoordinator.fetchData).not.toHaveBeenCalled();
		});
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const mockAction = createMockKeyAction("pr-pi-1", { repo: "owner/repo" });

			// Mock fetch for repo list
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve([{ full_name: "owner/repo", visibility: "public" }]),
				text: () => Promise.resolve(""),
			} as unknown as Response);

			const ev = createSendToPluginEvent(mockAction, { event: "getRepos" });

			// Should not throw
			await action.onSendToPlugin?.(ev as never);
		});

		it("ignores events without event property", async () => {
			const mockAction = createMockKeyAction("pr-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
