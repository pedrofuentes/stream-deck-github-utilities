/**
 * Tests for the DiscussionsMonitorAction (src/actions/discussions-monitor.ts).
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
	coordinator: mockCoordinator,
}));

import { DiscussionsMonitorAction } from "../../src/actions/discussions-monitor";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.discussions-monitor",
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

describe("DiscussionsMonitorAction", () => {
	let action: DiscussionsMonitorAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new DiscussionsMonitorAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinator.fetchData.mockResolvedValue({
			discussions: { totalCount: 0, answeredCount: 0, items: [] },
		});
		mockCoordinator.invalidateAndFetch.mockResolvedValue({
			discussions: { totalCount: 0, answeredCount: 0, items: [] },
		});
		mockCoordinator.isSubscribed.mockReturnValue(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("disc-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("disc-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays discussion count when configured", async () => {
			const mockAction = createMockKeyAction("disc-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 42, answeredCount: 10, items: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("42");
		});

		it("shows loading spinner initially", async () => {
			const mockAction = createMockKeyAction("disc-2c");
			const settings = { repo: "owner/repo" };

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 5, answeredCount: 0, items: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// First call should be the spinner, then the data
			const firstCall = decodeSvg(mockAction.setImage.mock.calls[0][0] as string);
			expect(firstCall).toContain("Loading");
		});

		it("subscribes to coordinator with correct params", async () => {
			const mockAction = createMockKeyAction("disc-sub-1");
			const settings = { repo: "owner/repo", refreshInterval: 120 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 5, answeredCount: 0, items: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "disc-sub-1",
				repo: "owner/repo",
				fragments: ["discussions"],
				maxAgeSec: 120,
			});
		});

		it("does not subscribe when repo is not set", async () => {
			const mockAction = createMockKeyAction("disc-sub-3");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).not.toHaveBeenCalled();
		});

		it("displays discussions label with answered count when available", async () => {
			const mockAction = createMockKeyAction("disc-2d");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 20, answeredCount: 5, items: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("20");
			expect(svg).toContain("answered");
		});

		it("shows 'Discussions' label when no answered discussions", async () => {
			const mockAction = createMockKeyAction("disc-2e");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 10, answeredCount: 0, items: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("10");
			expect(svg).toContain("Discussions");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer and unsubscribes on disappear", async () => {
			const mockAction = createMockKeyAction("disc-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 5, answeredCount: 0, items: [] },
			});

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("disc-3");
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("disc-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("disc-never-appeared");
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens discussions page on GitHub when repo is configured", async () => {
			const mockAction = createMockKeyAction("disc-4");
			const settings = { repo: "facebook/react" };

			// First appear to cache settings
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 5, answeredCount: 0, items: [] },
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/discussions");
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("disc-4b");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("force refreshes on double-click", async () => {
			const mockAction = createMockKeyAction("disc-dbl");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 5, answeredCount: 0, items: [] },
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// First key press
			const ev1 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev1 as never);

			// Second key press within 400ms (double-click)
			const ev2 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev2 as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalledWith("disc-dbl", "ghp_test123");
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("disc-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("disc-5", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 15, answeredCount: 3, items: [] },
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("15");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("disc-5c");
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
			const mockAction = createMockKeyAction("disc-sub-change");
			const settings = { repo: "owner/new-repo", refreshInterval: 60 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("disc-sub-change", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 7, answeredCount: 0, items: [] },
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "disc-sub-change",
				repo: "owner/new-repo",
				fragments: ["discussions"],
				maxAgeSec: 60,
			});
		});

		it("unsubscribes when repo is cleared", async () => {
			const mockAction = createMockKeyAction("disc-sub-clear");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("disc-sub-clear");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows error image when coordinator throws not found", async () => {
			const mockAction = createMockKeyAction("disc-err-1");
			const settings = { repo: "owner/nonexistent" };

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
			const mockAction = createMockKeyAction("disc-err-2");
			const settings = { repo: "owner/repo" };

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
			const mockAction = createMockKeyAction("disc-err-3");
			const settings = { repo: "invalid-repo-name" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("defaults to zero when coordinator returns no discussions data", async () => {
			const mockAction = createMockKeyAction("disc-err-4");
			const settings = { repo: "owner/repo" };

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

		it("handles zero discussions", async () => {
			const mockAction = createMockKeyAction("disc-zero");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				discussions: { totalCount: 0, answeredCount: 0, items: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("0");
			expect(svg).toContain("Discussions");
		});
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const mockAction = createMockKeyAction("disc-pi-1", { repo: "owner/repo" });

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
			const mockAction = createMockKeyAction("disc-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
