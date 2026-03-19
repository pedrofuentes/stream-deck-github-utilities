/**
 * Tests for the FleetMonitorAction (src/actions/fleet-monitor.ts).
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

/** Mock a successful workflow run response */
function mockWorkflowRunResponse(status: string, conclusion: string | null) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve({
			total_count: 1,
			workflow_runs: [{
				id: 123,
				name: "CI",
				status,
				conclusion,
				head_branch: "main",
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:05:00Z",
				run_started_at: "2024-01-01T00:00:00Z",
				html_url: "https://github.com/owner/repo/actions/runs/123",
				path: ".github/workflows/ci.yml",
			}],
		}),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Mock a PR count search response */
function mockPRCountResponse(count: number) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "30",
			"x-ratelimit-remaining": "29",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve({
			total_count: count,
			incomplete_results: false,
			items: [],
		}),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Mock a commit activity weeks response */
function mockCommitActivityResponse(weeks: Array<{ total: number; week: number; days: number[] }>) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve(weeks),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Mock a deployment status response (empty — no deployments) */
function mockEmptyDeploymentResponse() {
	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve([]),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Standard commit weeks for testing */
const SAMPLE_WEEKS = [
	{ total: 5, week: 1704067200, days: [0, 1, 1, 1, 1, 1, 0] },
	{ total: 12, week: 1704672000, days: [1, 2, 2, 3, 2, 1, 1] },
	{ total: 8, week: 1705276800, days: [1, 1, 2, 1, 1, 1, 1] },
	{ total: 15, week: 1705881600, days: [2, 3, 2, 3, 2, 2, 1] },
];

/**
 * Sets up fetch mock to handle the 3 parallel API calls:
 * 1. Workflow runs (+ deployment status)
 * 2. PR count search
 * 3. Commit activity weeks
 */
function setupFleetFetchMock(options: {
	workflowStatus?: string;
	workflowConclusion?: string | null;
	prCount?: number;
	commitWeeks?: Array<{ total: number; week: number; days: number[] }>;
} = {}): void {
	const {
		workflowStatus = "completed",
		workflowConclusion = "success",
		prCount = 3,
		commitWeeks = SAMPLE_WEEKS,
	} = options;

	vi.mocked(globalThis.fetch).mockImplementation((input: string | URL | Request) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

		if (url.includes("/actions/runs")) {
			return Promise.resolve(mockWorkflowRunResponse(workflowStatus, workflowConclusion));
		}
		if (url.includes("/deployments")) {
			return Promise.resolve(mockEmptyDeploymentResponse());
		}
		if (url.includes("/search/issues")) {
			return Promise.resolve(mockPRCountResponse(prCount));
		}
		if (url.includes("/stats/commit_activity")) {
			return Promise.resolve(mockCommitActivityResponse(commitWeeks));
		}

		return Promise.resolve(mockPRCountResponse(0));
	});
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("FleetMonitorAction", () => {
	let action: FleetMonitorAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new FleetMonitorAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
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

			setupFleetFetchMock({ prCount: 7, workflowConclusion: "success" });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

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

			setupFleetFetchMock({ prCount: 4 });

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

			setupFleetFetchMock({ workflowConclusion: "failure", prCount: 1 });

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

			vi.mocked(globalThis.fetch).mockImplementation((input: string | URL | Request) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
				if (url.includes("/actions/runs")) {
					return Promise.resolve({
						ok: true,
						status: 200,
						headers: new Headers({
							"x-ratelimit-limit": "5000",
							"x-ratelimit-remaining": "4999",
							"x-ratelimit-reset": "9999999999",
							"x-ratelimit-used": "1",
						}),
						json: () => Promise.resolve({ total_count: 0, workflow_runs: [] }),
						text: () => Promise.resolve(""),
					} as unknown as Response);
				}
				if (url.includes("/deployments")) {
					return Promise.resolve(mockEmptyDeploymentResponse());
				}
				if (url.includes("/search/issues")) {
					return Promise.resolve(mockPRCountResponse(0));
				}
				if (url.includes("/stats/commit_activity")) {
					return Promise.resolve(mockCommitActivityResponse([]));
				}
				return Promise.resolve(mockPRCountResponse(0));
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

			setupFleetFetchMock();

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			// No crash, polling cleaned up
			expect(true).toBe(true);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("fm-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
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

			const ev = createKeyDownEvent(mockAction, {});
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com");
		});

		it("opens repo page when repo is configured", async () => {
			const mockAction = createMockKeyAction("fm-k-2");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			setupFleetFetchMock();
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react");
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
			setupFleetFetchMock();
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createDialDownEvent(mockAction, settings);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo");
		});
	});

	// ── Encoder: onDialRotate ───────────────────

	describe("onDialRotate", () => {
		it("triggers a refresh on dial rotate", async () => {
			const mockAction = createMockDialAction("fm-dr-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			setupFleetFetchMock({ prCount: 2 });
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			setupFleetFetchMock({ prCount: 9 });

			const ev = createDialRotateEvent(mockAction, settings);
			await action.onDialRotate?.(ev as never);

			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("9 PRs");
		});
	});

	// ── Encoder: onTouchTap ─────────────────────

	describe("onTouchTap", () => {
		it("triggers a refresh on touch tap", async () => {
			const mockAction = createMockDialAction("fm-tt-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			setupFleetFetchMock({ prCount: 1 });
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			setupFleetFetchMock({ prCount: 6 });

			const ev = createTouchTapEvent(mockAction, settings);
			await action.onTouchTap?.(ev as never);

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

			setupFleetFetchMock({ prCount: 11, workflowConclusion: "failure" });

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

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

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows auth error when API returns 401", async () => {
			const mockAction = createMockKeyAction("fm-err-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 401,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "5000",
				}),
				json: () => Promise.resolve({ message: "Bad credentials" }),
				text: () => Promise.resolve("Bad credentials"),
			} as unknown as Response);

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

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 403,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "5000",
				}),
				json: () => Promise.resolve({ message: "rate limit exceeded" }),
				text: () => Promise.resolve("rate limit exceeded"),
			} as unknown as Response);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows error on dial when API fails", async () => {
			const mockAction = createMockDialAction("fm-err-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 401,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "5000",
				}),
				json: () => Promise.resolve({ message: "Bad credentials" }),
				text: () => Promise.resolve("Bad credentials"),
			} as unknown as Response);

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

		it("handles partial API failures gracefully (PR count fails)", async () => {
			const mockAction = createMockKeyAction("fm-err-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockImplementation((input: string | URL | Request) => {
				const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
				if (url.includes("/actions/runs")) {
					return Promise.resolve(mockWorkflowRunResponse("completed", "success"));
				}
				if (url.includes("/deployments")) {
					return Promise.resolve(mockEmptyDeploymentResponse());
				}
				if (url.includes("/search/issues")) {
					return Promise.reject(new Error("network error"));
				}
				if (url.includes("/stats/commit_activity")) {
					return Promise.reject(new Error("network error"));
				}
				return Promise.resolve(mockPRCountResponse(0));
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should still display — PR count falls back to 0, commit activity to null
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
			const mockAction = createMockKeyAction("fm-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});
