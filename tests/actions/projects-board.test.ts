/**
 * Tests for the ProjectsBoardAction (src/actions/projects-board.ts).
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

import { ProjectsBoardAction } from "../../src/actions/projects-board";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.projects-board",
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

function createMockDialAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.projects-board",
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

function createDialRotateEvent(actionMock: ReturnType<typeof createMockDialAction>, ticks: number, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, ticks, pressed: false } };
}

function createTouchTapEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, tapPos: [100, 50], hold: false } };
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

describe("ProjectsBoardAction", () => {
	let action: ProjectsBoardAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new ProjectsBoardAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinator.fetchData.mockResolvedValue({
			projectsV2: {
				projects: [],
			},
		});
		mockCoordinator.invalidateAndFetch.mockResolvedValue({
			projectsV2: {
				projects: [],
			},
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
			const mockAction = createMockKeyAction("proj-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("proj-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows loading spinner before data arrives", async () => {
			const mockAction = createMockKeyAction("proj-loading");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// The first setImage call should be the animated spinner (before fetch completes)
			const firstCall = mockAction.setImage.mock.calls[0];
			expect(firstCall).toBeDefined();
			const svg = decodeSvg(firstCall[0] as string);
			expect(svg).toContain("animateTransform");
		});

		it("fetches and displays project data when configured", async () => {
			const mockAction = createMockKeyAction("proj-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: {
					projects: [
						{ title: "Sprint 1", shortDescription: "Q1 work", closed: false, number: 1, url: "https://github.com/orgs/owner/projects/1", totalItems: 15 },
					],
				},
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Sprint 1");
			expect(svg).toContain("15 items");
			expect(svg).toContain("Project");
		});

		it("subscribes to coordinator with correct params", async () => {
			const mockAction = createMockKeyAction("proj-sub-1");
			const settings = { repo: "owner/repo", refreshInterval: 120 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "proj-sub-1",
				repo: "owner/repo",
				fragments: ["projectsV2"],
				maxAgeSec: 120,
			}, expect.any(Function));
		});

		it("does not subscribe when repo is not set", async () => {
			const mockAction = createMockKeyAction("proj-sub-2");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockCoordinator.subscribe).not.toHaveBeenCalled();
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer and unsubscribes on disappear", async () => {
			const mockAction = createMockKeyAction("proj-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [{ title: "Test", shortDescription: "", closed: false, number: 1, url: "", totalItems: 5 }] },
			});

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("proj-3");
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("proj-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("proj-never-appeared");
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens projects page on GitHub when repo is configured", async () => {
			const mockAction = createMockKeyAction("proj-4");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/projects");
			vi.useRealTimers();
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("proj-4b");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("force refreshes on double-click", async () => {
			const mockAction = createMockKeyAction("proj-dbl");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});
			mockCoordinator.invalidateAndFetch.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// Simulate double-click (two key-down events within 400ms)
			const ev1 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev1 as never);

			const ev2 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev2 as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalled();
		});
	});

	// ── onTouchTap ─────────────────────────────

	describe("onTouchTap", () => {
		it("force-refreshes data via invalidateAndFetch", async () => {
			const mockAction = createMockDialAction("proj-touch-1");
			const settings = { repo: "owner/repo" };

			(action as any).actionContexts.set("proj-touch-1", mockAction);
			(action as any).actionSettings.set("proj-touch-1", settings);

			mockCoordinator.invalidateAndFetch.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinator.invalidateAndFetch.mockClear();
			mockCoordinator.invalidateAndFetch.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			const ev = createTouchTapEvent(mockAction, settings);
			await action.onTouchTap?.(ev as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalled();
		});
	});

	// ── onDialRotate ───────────────────────────

	describe("onDialRotate", () => {
		it("force-refreshes data via invalidateAndFetch", async () => {
			const mockAction = createMockDialAction("proj-rotate-1");
			const settings = { repo: "owner/repo" };

			(action as any).actionContexts.set("proj-rotate-1", mockAction);
			(action as any).actionSettings.set("proj-rotate-1", settings);

			mockCoordinator.invalidateAndFetch.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinator.invalidateAndFetch.mockClear();
			mockCoordinator.invalidateAndFetch.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			const ev = createDialRotateEvent(mockAction, 1, settings);
			await action.onDialRotate?.(ev as never);

			expect(mockCoordinator.invalidateAndFetch).toHaveBeenCalled();
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("proj-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("proj-5", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: {
					projects: [{ title: "My Project", shortDescription: "", closed: false, number: 1, url: "", totalItems: 8 }],
				},
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("My Project");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("proj-5c");
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
			const mockAction = createMockKeyAction("proj-sub-change");
			const settings = { repo: "owner/new-repo", refreshInterval: 60 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("proj-sub-change", mockAction);

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.subscribe).toHaveBeenCalledWith({
				actionId: "proj-sub-change",
				repo: "owner/new-repo",
				fragments: ["projectsV2"],
				maxAgeSec: 60,
			}, expect.any(Function));
		});

		it("unsubscribes when repo is cleared", async () => {
			const mockAction = createMockKeyAction("proj-sub-clear");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockCoordinator.unsubscribe).toHaveBeenCalledWith("proj-sub-clear");
		});
	});

	// ── Data display scenarios ──────────────────

	describe("data display", () => {
		it("handles zero projects", async () => {
			const mockAction = createMockKeyAction("proj-zero");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: { projects: [] },
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("No Projects");
		});

		it("handles single project with item count", async () => {
			const mockAction = createMockKeyAction("proj-single");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: {
					projects: [
						{ title: "Roadmap", shortDescription: "Product roadmap", closed: false, number: 1, url: "https://github.com/orgs/owner/projects/1", totalItems: 42 },
					],
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Roadmap");
			expect(svg).toContain("42 items");
			expect(svg).toContain("Project");
		});

		it("handles multiple projects", async () => {
			const mockAction = createMockKeyAction("proj-multi");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({
				projectsV2: {
					projects: [
						{ title: "Sprint 1", shortDescription: "", closed: false, number: 1, url: "", totalItems: 10 },
						{ title: "Sprint 2", shortDescription: "", closed: false, number: 2, url: "", totalItems: 5 },
						{ title: "Backlog", shortDescription: "", closed: false, number: 3, url: "", totalItems: 20 },
					],
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("3");
			expect(svg).toContain("Sprint 1");
			expect(svg).toContain("Projects");
		});

		it("handles missing projectsV2 data gracefully", async () => {
			const mockAction = createMockKeyAction("proj-missing");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockResolvedValue({});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("No Projects");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows error image when coordinator throws not found", async () => {
			const mockAction = createMockKeyAction("proj-err-1");
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
			const mockAction = createMockKeyAction("proj-err-2");
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
			const mockAction = createMockKeyAction("proj-err-3");
			const settings = { repo: "invalid-repo-name" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("shows rate limited error", async () => {
			const mockAction = createMockKeyAction("proj-err-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinator.fetchData.mockRejectedValue(new Error("API rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const mockAction = createMockKeyAction("proj-pi-1", { repo: "owner/repo" });

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

			await action.onSendToPlugin?.(ev as never);
		});

		it("ignores events without event property", async () => {
			const mockAction = createMockKeyAction("proj-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
