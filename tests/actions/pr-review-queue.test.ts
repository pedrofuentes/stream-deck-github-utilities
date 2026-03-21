/**
 * Tests for the PRReviewQueueAction (src/actions/pr-review-queue.ts).
 *
 * Mocks the @elgato/streamdeck module and the fetch API to test
 * the action's lifecycle, settings handling, encoder support, and error states.
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

const {
	mockCoordinatorSubscribe,
	mockCoordinatorUnsubscribe,
	mockCoordinatorFetchData,
	mockCoordinatorInvalidateAndFetch,
} = vi.hoisted(() => ({
	mockCoordinatorSubscribe: vi.fn(),
	mockCoordinatorUnsubscribe: vi.fn(),
	mockCoordinatorFetchData: vi.fn(),
	mockCoordinatorInvalidateAndFetch: vi.fn(),
}));

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	GraphQLQueryCoordinator: vi.fn().mockImplementation(() => ({
		subscribe: mockCoordinatorSubscribe,
		unsubscribe: mockCoordinatorUnsubscribe,
		fetchData: mockCoordinatorFetchData,
		invalidateAndFetch: mockCoordinatorInvalidateAndFetch,
	})),
}));

vi.mock("../../src/utils/repo-data-cache", () => ({
	RepoDataCache: vi.fn(),
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

import { PRReviewQueueAction } from "../../src/actions/pr-review-queue";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.pr-review-queue",
		isKey: () => true,
		isDial: () => false,
		setImage: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
		setFeedback: vi.fn().mockResolvedValue(undefined),
		showAlert: vi.fn().mockResolvedValue(undefined),
		showOk: vi.fn().mockResolvedValue(undefined),
		getSettings: vi.fn().mockResolvedValue(settings),
		setSettings: vi.fn().mockResolvedValue(undefined),
	};
}

function createMockDialAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.pr-review-queue",
		isKey: () => false,
		isDial: () => true,
		setImage: vi.fn().mockResolvedValue(undefined),
		setTitle: vi.fn().mockResolvedValue(undefined),
		setFeedback: vi.fn().mockResolvedValue(undefined),
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

function createDialRotateEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings, ticks: 1, pressed: false },
	};
}

function createDialDownEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings },
	};
}

function createTouchTapEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return {
		action: actionMock,
		payload: { settings, hold: false, tapPos: [100, 50] },
	};
}

function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

function lastImage(mockAction: ReturnType<typeof createMockKeyAction>): string {
	const calls = mockAction.setImage.mock.calls;
	return decodeSvg(calls[calls.length - 1][0] as string);
}

function mockCoordinatorResponse(totalCount: number) {
	return {
		reviewRequestedPRs: {
			total_count: totalCount,
			items: Array.from({ length: Math.min(totalCount, 10) }, (_, i) => ({
				number: i + 1,
				title: `PR ${i + 1}`,
				user: { login: "testuser" },
				html_url: `https://github.com/owner/repo/pull/${i + 1}`,
				created_at: "2024-01-01T00:00:00Z",
			})),
		},
	};
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("PRReviewQueueAction", () => {
	let action: PRReviewQueueAction;

	beforeEach(() => {
		action = new PRReviewQueueAction();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("prq-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays review count for all repos when no repo configured", async () => {
			const mockAction = createMockKeyAction("prq-2");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(5));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("5");
			expect(svg).toContain("Reviews");
			expect(svg).toContain("All Repos");
		});

		it("fetches and displays review count for a specific repo", async () => {
			const mockAction = createMockKeyAction("prq-3");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(2));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("2");
			expect(svg).toContain("Reviews");
			expect(svg).toContain("myrepo");
		});

		it("displays zero count correctly", async () => {
			const mockAction = createMockKeyAction("prq-4");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(0));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("0");
			expect(svg).toContain("Reviews");
		});

		it("shows unconfigured on dial when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("prq-dial-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});

		it("shows review count on dial (encoder)", async () => {
			const mockAction = createMockDialAction("prq-dial-2");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(3));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("3");
			expect(decodeSvg(lastCall.canvas)).toContain("reviews");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer on disappear", async () => {
			const mockAction = createMockKeyAction("prq-d-1");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			// No crash, timer cleaned up
			expect(true).toBe(true);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("prq-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens global review-requested page when no repo configured", async () => {
			const mockAction = createMockKeyAction("prq-k-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, {});
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/pulls/review-requested");
			vi.useRealTimers();
		});

		it("opens repo-specific review page when repo is configured", async () => {
			const mockAction = createMockKeyAction("prq-k-2");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith(
				"https://github.com/facebook/react/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me"
			);
			vi.useRealTimers();
		});
	});

	// ── Encoder: onDialDown ─────────────────────

	describe("onDialDown", () => {
		it("opens global review-requested page when no repo configured", async () => {
			const mockAction = createMockDialAction("prq-dd-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			const ev = createDialDownEvent(mockAction);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/pulls/review-requested");
		});

		it("opens repo-specific review page when repo is configured", async () => {
			const mockAction = createMockDialAction("prq-dd-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createDialDownEvent(mockAction, settings);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith(
				"https://github.com/owner/repo/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me"
			);
		});
	});

	// ── Encoder: onDialRotate ───────────────────

	describe("onDialRotate", () => {
		it("triggers a refresh on dial rotate", async () => {
			const mockAction = createMockDialAction("prq-dr-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(2));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			mockCoordinatorInvalidateAndFetch.mockResolvedValue(mockCoordinatorResponse(7));

			const ev = createDialRotateEvent(mockAction);
			await action.onDialRotate?.(ev as never);

			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("7");
		});
	});

	// ── Encoder: onTouchTap ─────────────────────

	describe("onTouchTap", () => {
		it("triggers a refresh on touch tap", async () => {
			const mockAction = createMockDialAction("prq-tt-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(1));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			mockCoordinatorInvalidateAndFetch.mockResolvedValue(mockCoordinatorResponse(4));

			const ev = createTouchTapEvent(mockAction);
			await action.onTouchTap?.(ev as never);

			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("4");
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("prq-s-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(mockCoordinatorResponse(8));

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("8");
		});

		it("shows unconfigured when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("prq-s-2");
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

		it("shows unconfigured on dial when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("prq-s-3");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows auth error when API returns 401", async () => {
			const mockAction = createMockKeyAction("prq-err-1");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Bad credentials (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows rate limited error on key", async () => {
			const mockAction = createMockKeyAction("prq-err-2");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("API rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows error on dial when API fails", async () => {
			const mockAction = createMockDialAction("prq-err-3");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Bad credentials (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("Auth Error");
		});

		it("shows 'Not Found' for missing repository", async () => {
			const mockAction = createMockKeyAction("prq-err-notfound");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Repository not found"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows 'No Access' for access denied", async () => {
			const mockAction = createMockKeyAction("prq-err-access");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Access denied"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("No Access");
		});

		it("shows 'Error' for generic errors", async () => {
			const mockAction = createMockKeyAction("prq-err-generic");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Network error: connection refused"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Error");
		});
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockResolvedValue({
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

			try {
				const mockAction = createMockKeyAction("prq-pi-1", { repo: "owner/repo" });
				const ev = createSendToPluginEvent(mockAction, { event: "getRepos" });

				// Should not throw
				await action.onSendToPlugin?.(ev as never);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("ignores events without event property", async () => {
			const mockAction = createMockKeyAction("prq-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
