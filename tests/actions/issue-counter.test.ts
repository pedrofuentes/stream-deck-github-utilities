/**
 * Tests for the IssueCounterAction (src/actions/issue-counter.ts).
 *
 * Mocks the @elgato/streamdeck module and the GraphQL Query Coordinator
 * to test the action's lifecycle, settings handling, and error states.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
	coordinator: mockCoordinator,
}));

import { IssueCounterAction } from "../../src/actions/issue-counter";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.issue-counter",
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
	return { action: actionMock, payload: { settings } };
}

function createKeyDownEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings } };
}

function createDidReceiveSettingsEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings } };
}

function createWillDisappearEvent(actionMock: ReturnType<typeof createMockKeyAction>) {
	return { action: actionMock, payload: {} };
}

function createMockDialAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.issue-counter",
		isKey: () => false,
		isDial: () => true,
		setImage: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
		setFeedback: vi.fn().mockResolvedValue(undefined),
		setFeedbackLayout: vi.fn().mockResolvedValue(undefined),
		showAlert: vi.fn().mockResolvedValue(undefined),
		showOk: vi.fn().mockResolvedValue(undefined),
		getSettings: vi.fn().mockResolvedValue(settings),
		setSettings: vi.fn().mockResolvedValue(undefined),
	};
}

function createTouchTapEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, hold: false, position: { x: 0, y: 0 } } };
}

function createDialRotateEvent(actionMock: ReturnType<typeof createMockDialAction>, ticks: number, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, ticks, pressed: false } };
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

describe("IssueCounterAction", () => {
	let action: IssueCounterAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new IssueCounterAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinator.fetchData.mockResolvedValue({ issueCount: 0 });
		mockCoordinator.invalidateAndFetch.mockResolvedValue({ issueCount: 0 });
		mockCoordinator.isSubscribed.mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("issue-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("issue-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays issue count when configured", async () => {
			const mockAction = createMockKeyAction("issue-2");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 25 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("25");
			expect(svg).toContain("Open Issues");
		});

		it("fetches and displays closed issue count", async () => {
			const mockAction = createMockKeyAction("issue-2-closed");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 17 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("17");
			expect(svg).toContain("Closed Issues");
		});

		it("fetches and displays all issue count", async () => {
			const mockAction = createMockKeyAction("issue-2-all");
			const settings = { repo: "owner/repo", stateFilter: "all" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 20 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("20");
			expect(svg).toContain("All Issues");
		});

		it("handles zero issues", async () => {
			const mockAction = createMockKeyAction("issue-2-no-prs");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 10 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("10");
			expect(svg).toContain("Closed Issues");
		});

		it("returns zero when coordinator returns no issueCount", async () => {
			const mockAction = createMockKeyAction("issue-2-all-prs");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 0 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("0");
		});

		it("subscribes to coordinator with correct params", async () => {
			const mockAction = createMockKeyAction("issue-sub-1");
			const settings = { repo: "owner/repo", stateFilter: "closed", refreshInterval: 120 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 5 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "issue-sub-1",
				repo: "owner/repo",
				fragments: ["issueCount"],
				maxAgeSec: 120,
				params: { issueState: "closed" },
			}, expect.any(Function));
		});

		it("defaults issueState param to open when stateFilter is not set", async () => {
			const mockAction = createMockKeyAction("issue-sub-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 3 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					params: { issueState: "open" },
				}),
				expect.any(Function),
			);
		});

		it("does not subscribe when repo is not set", async () => {
			const mockAction = createMockKeyAction("issue-sub-3");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).not.toHaveBeenCalled();
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up timer and unsubscribes on disappear", async () => {
			const mockAction = createMockKeyAction("issue-3");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 10 });

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("issue-3");
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("issue-never");
			const ev = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(ev as never);
			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("issue-never");
		});
	});

	describe("onKeyDown", () => {
		it("opens issues page on GitHub when repo is configured", async () => {
			const mockAction = createMockKeyAction("issue-4");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 100 });
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/issues");
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("issue-4b");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("force-refreshes on double-click using invalidateAndFetch", async () => {
			const mockAction = createMockKeyAction("issue-dbl-click");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 10 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ issueCount: 42 });

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinator.invalidateAndFetch.mockClear();

			// Simulate double-click: two keyDown events within 400ms
			const ev1 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev1 as never);
			const ev2 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev2 as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("issue-dbl-click", "ghp_test123");
		});
	});

	describe("onTouchTap", () => {
		it("force-refreshes using invalidateAndFetch", async () => {
			const dialAction = createMockDialAction("issue-touch-1");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [dialAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ issueCount: 15 });

			await action.onWillAppear?.({ action: dialAction, payload: { settings } } as never);
			mockCoordinator.invalidateAndFetch.mockClear();

			const ev = createTouchTapEvent(dialAction, settings);
			await action.onTouchTap?.(ev as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("issue-touch-1", "ghp_test123");
		});
	});

	describe("onDialRotate", () => {
		it("force-refreshes using invalidateAndFetch after cycling state", async () => {
			const dialAction = createMockDialAction("issue-dial-1");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [dialAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 5 });
			mockCoordinator.invalidateAndFetch.mockResolvedValue({ issueCount: 20 });

			await action.onWillAppear?.({ action: dialAction, payload: { settings } } as never);
			mockCoordinator.invalidateAndFetch.mockClear();

			const ev = createDialRotateEvent(dialAction, 1, settings);
			await action.onDialRotate?.(ev as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("issue-dial-1", "ghp_test123");
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("issue-5");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 30 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("30");
		});

		it("defaults stateFilter to open when not set", async () => {
			const mockAction = createMockKeyAction("issue-5b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("issue-5b", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 8 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Open Issues");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("issue-5c");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("re-subscribes to coordinator on settings change", async () => {
			const mockAction = createMockKeyAction("issue-sub-change");
			const settings = { repo: "owner/new-repo", stateFilter: "all", refreshInterval: 60 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("issue-sub-change", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({ issueCount: 7 });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "issue-sub-change",
				repo: "owner/new-repo",
				fragments: ["issueCount"],
				maxAgeSec: 60,
				params: { issueState: "all" },
			}, expect.any(Function));
		});

		it("unsubscribes when repo is cleared", async () => {
			const mockAction = createMockKeyAction("issue-sub-clear");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("issue-sub-clear");
		});
	});

	describe("error handling", () => {
		it("shows error image when coordinator throws not found", async () => {
			const mockAction = createMockKeyAction("issue-err-1");
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

		it("shows error for invalid repo format", async () => {
			const mockAction = createMockKeyAction("issue-err-2");
			const settings = { repo: "invalid-repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("defaults to zero when coordinator returns no issueCount", async () => {
			const mockAction = createMockKeyAction("issue-err-3");
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

		it("shows 'Auth Error' for invalid token", async () => {
			const mockAction = createMockKeyAction("issue-err-auth");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("Invalid or expired GitHub token"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows 'Rate Limited' for rate limit exceeded", async () => {
			const mockAction = createMockKeyAction("issue-err-rate");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("GitHub API rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows 'No Access' for access denied", async () => {
			const mockAction = createMockKeyAction("issue-err-access");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("Access denied"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("No Access");
		});

		it("shows 'Error' for generic errors", async () => {
			const mockAction = createMockKeyAction("issue-err-generic");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("Network error: connection refused"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Error");
		});
	});
});
