/**
 * Tests for the FleetMonitorAction (src/actions/fleet-monitor.ts).
 *
 * Mocks the @elgato/streamdeck module and the GraphQL Query Coordinator
 * to test the action's lifecycle, settings handling, encoder support,
 * and error states.
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

const {
	mockSubscribe,
	mockUnsubscribe,
	mockFetchData,
	mockInvalidateAndFetch,
} = vi.hoisted(() => ({
	mockSubscribe: vi.fn(),
	mockUnsubscribe: vi.fn(),
	mockFetchData: vi.fn(),
	mockInvalidateAndFetch: vi.fn(),
}));

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	coordinator: {
		subscribe: mockSubscribe,
		unsubscribe: mockUnsubscribe,
		fetchData: mockFetchData,
		invalidateAndFetch: mockInvalidateAndFetch,
	},
}));

import { FleetMonitorAction } from "../../src/actions/fleet-monitor";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.fleet-monitor",
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
		manifestId: "com.pedrofuentes.github-utilities.fleet-monitor",
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

/** Standard commit weeks for testing */
const SAMPLE_WEEKS = [
	{ total: 5, week: 1704067200, days: [0, 1, 1, 1, 1, 1, 0] },
	{ total: 12, week: 1704672000, days: [1, 2, 2, 3, 2, 1, 1] },
	{ total: 8, week: 1705276800, days: [1, 1, 2, 1, 1, 1, 1] },
	{ total: 15, week: 1705881600, days: [2, 3, 2, 3, 2, 2, 1] },
];

/** Standard successful coordinator result */
function makeCoordinatorResult(overrides: Record<string, unknown> = {}) {
	return {
		prCount: 3,
		workflowRuns: {
			latestRun: {
				id: 123,
				name: "CI",
				status: "completed",
				conclusion: "success",
				head_branch: "main",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:05:00Z",
				run_started_at: "2024-01-01T00:00:00Z",
				html_url: "https://github.com/owner/repo/actions/runs/123",
				path: ".github/workflows/ci.yml",
			},
			deployment: null,
		},
		commitActivity: SAMPLE_WEEKS,
		...overrides,
	};
}

/**
 * Sets up the coordinator mock with a standard successful result.
 */
function setupCoordinatorMock(overrides: Record<string, unknown> = {}): void {
	mockFetchData.mockResolvedValue(makeCoordinatorResult(overrides));
	mockInvalidateAndFetch.mockResolvedValue(makeCoordinatorResult(overrides));
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("FleetMonitorAction", () => {
	let action: FleetMonitorAction;

	beforeEach(() => {
		action = new FleetMonitorAction();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		setupCoordinatorMock();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("fm-1");
			const ev = createWillAppearEvent(mockAction, { repo: "owner/repo" });

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when no repo is configured", async () => {
			const mockAction = createMockKeyAction("fm-2");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays fleet data for a configured repo", async () => {
			const mockAction = createMockKeyAction("fm-3");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({ prCount: 7 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockSubscribe).toHaveBeenCalledWith({
				actionId: "fm-3",
				repo: "owner/myrepo",
				fragments: ["prCount", "workflowRuns", "commitActivity"],
				maxAgeSec: 300,
			}, expect.any(Function));
			expect(mockFetchData).toHaveBeenCalledWith("fm-3", "ghp_test123");
			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("myrepo");
			expect(svg).toContain("Success");
			expect(svg).toContain("7 PRs");
		});

		it("shows fleet data on dial (encoder)", async () => {
			const mockAction = createMockDialAction("fm-dial-1");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({ prCount: 4 });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("myrepo");
			expect(decodeSvg(lastCall.canvas)).toContain("4 PRs");
		});

		it("shows unconfigured on dial when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("fm-dial-2");
			const ev = createWillAppearEvent(mockAction, { repo: "owner/repo" });

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});

		it("shows failed workflow status correctly", async () => {
			const mockAction = createMockKeyAction("fm-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				workflowRuns: {
					latestRun: {
						id: 123,
						name: "CI",
						status: "completed",
						conclusion: "failure",
						head_branch: "main",
						created_at: "2024-01-01T00:00:00Z",
						updated_at: "2024-01-01T00:05:00Z",
						run_started_at: "2024-01-01T00:00:00Z",
						html_url: "https://github.com/owner/repo/actions/runs/123",
						path: ".github/workflows/ci.yml",
					},
					deployment: null,
				},
				prCount: 1,
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("Failed");
		});

		it("shows 'No Runs' when no workflow runs exist", async () => {
			const mockAction = createMockKeyAction("fm-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				workflowRuns: { latestRun: null, deployment: null },
				prCount: 0,
				commitActivity: [],
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("No Runs");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockKeyAction("fm-d-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			expect(mockUnsubscribe).toHaveBeenCalledWith("fm-d-1");
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("fm-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);

			expect(mockUnsubscribe).toHaveBeenCalledWith("fm-never-appeared");
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens GitHub homepage when no repo configured", async () => {
			const mockAction = createMockKeyAction("fm-k-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, {});
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com");
			vi.useRealTimers();
		});

		it("opens repo page when repo is configured", async () => {
			const mockAction = createMockKeyAction("fm-k-2");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.useFakeTimers();
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react");
			vi.useRealTimers();
		});

		it("force refreshes on double-click", async () => {
			const mockAction = createMockKeyAction("fm-k-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			setupCoordinatorMock({ prCount: 3 });

			// Simulate double-click: two key-downs within 400ms
			const ev1 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev1 as never);

			const ev2 = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev2 as never);

			expect(mockInvalidateAndFetch).toHaveBeenCalledWith("fm-k-3", "ghp_test123");
		});
	});

	// ── Encoder: onDialDown ─────────────────────

	describe("onDialDown", () => {
		it("opens GitHub homepage when no repo configured", async () => {
			const mockAction = createMockDialAction("fm-dd-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDialDownEvent(mockAction);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com");
		});

		it("opens repo page when repo is configured", async () => {
			const mockAction = createMockDialAction("fm-dd-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createDialDownEvent(mockAction, settings);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo");
		});
	});

	// ── Encoder: onDialRotate ───────────────────

	describe("onDialRotate", () => {
		it("triggers a force refresh on dial rotate", async () => {
			const mockAction = createMockDialAction("fm-dr-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			setupCoordinatorMock({ prCount: 9 });

			const ev = createDialRotateEvent(mockAction, settings);
			await action.onDialRotate?.(ev as never);

			expect(mockInvalidateAndFetch).toHaveBeenCalledWith("fm-dr-1", "ghp_test123");
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("9 PRs");
		});
	});

	// ── Encoder: onTouchTap ─────────────────────

	describe("onTouchTap", () => {
		it("triggers a force refresh on touch tap", async () => {
			const mockAction = createMockDialAction("fm-tt-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			setupCoordinatorMock({ prCount: 6 });

			const ev = createTouchTapEvent(mockAction, settings);
			await action.onTouchTap?.(ev as never);

			expect(mockInvalidateAndFetch).toHaveBeenCalledWith("fm-tt-1", "ghp_test123");
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("6 PRs");
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("fm-s-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				prCount: 11,
				workflowRuns: {
					latestRun: {
						id: 123,
						name: "CI",
						status: "completed",
						conclusion: "failure",
						head_branch: "main",
						created_at: "2024-01-01T00:00:00Z",
						updated_at: "2024-01-01T00:05:00Z",
						run_started_at: "2024-01-01T00:00:00Z",
						html_url: "https://github.com/owner/repo/actions/runs/123",
						path: ".github/workflows/ci.yml",
					},
					deployment: null,
				},
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockSubscribe).toHaveBeenCalledWith(expect.objectContaining({
				actionId: "fm-s-1",
				repo: "owner/repo",
				fragments: ["prCount", "workflowRuns", "commitActivity"],
			}), expect.any(Function));
			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Failed");
			expect(svg).toContain("11 PRs");
		});

		it("shows unconfigured when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("fm-s-2");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockUnsubscribe).toHaveBeenCalledWith("fm-s-2");
			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured on dial when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("fm-s-3");
			const settings = {};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockUnsubscribe).toHaveBeenCalledWith("fm-s-3");
			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows auth error when coordinator throws 401", async () => {
			const mockAction = createMockKeyAction("fm-err-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockFetchData.mockRejectedValue(new Error("Bad credentials (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows rate limited error on key", async () => {
			const mockAction = createMockKeyAction("fm-err-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockFetchData.mockRejectedValue(new Error("rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows error on dial when coordinator fails", async () => {
			const mockAction = createMockDialAction("fm-err-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockFetchData.mockRejectedValue(new Error("Bad credentials (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("Auth Error");
		});

		it("shows error for invalid repo identifier", async () => {
			const mockAction = createMockKeyAction("fm-err-4");
			const settings = { repo: "invalid-repo-format" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid Repo");
		});

		it("handles partial data gracefully (no PR count or commit data)", async () => {
			const mockAction = createMockKeyAction("fm-err-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Coordinator returns result without prCount or commitActivity
			mockFetchData.mockResolvedValue({
				workflowRuns: {
					latestRun: {
						id: 123,
						name: "CI",
						status: "completed",
						conclusion: "success",
						head_branch: "main",
						created_at: "2024-01-01T00:00:00Z",
						updated_at: "2024-01-01T00:05:00Z",
						run_started_at: "2024-01-01T00:00:00Z",
						html_url: "https://github.com/owner/repo/actions/runs/123",
						path: ".github/workflows/ci.yml",
					},
					deployment: null,
				},
				errors: {
					prCount: "No data available",
					commitActivity: "No data available",
				},
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should still display — prCount falls back to 0, commitActivity to []
			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Success");
			expect(svg).toContain("0 PRs");
		});
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const mockAction = createMockKeyAction("fm-pi-1", { repo: "owner/repo" });

			// PI data provider still uses fetch directly for repo lists
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

			const ev = createSendToPluginEvent(mockAction, { event: "getRepos" });

			// Should not throw
			await action.onSendToPlugin?.(ev as never);
		});

		it("ignores events without event property", async () => {
			const mockAction = createMockKeyAction("fm-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
