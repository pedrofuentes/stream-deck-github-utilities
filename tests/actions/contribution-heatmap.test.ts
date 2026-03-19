/**
 * Tests for the ContributionHeatmapAction (src/actions/contribution-heatmap.ts).
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

import { ContributionHeatmapAction } from "../../src/actions/contribution-heatmap";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockDialAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.contribution-heatmap",
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

function createWillAppearEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, coordinates: { column: 0, row: 0 } } };
}

function createWillDisappearEvent(actionMock: ReturnType<typeof createMockDialAction>) {
	return { action: actionMock, payload: {} };
}

function createDidReceiveSettingsEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, coordinates: { column: 0, row: 0 } } };
}

function createDialRotateEvent(actionMock: ReturnType<typeof createMockDialAction>, ticks: number, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, ticks, pressed: false } };
}

function createDialDownEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, controller: "Encoder" } };
}

function createTouchTapEvent(actionMock: ReturnType<typeof createMockDialAction>, settings: Record<string, unknown> = {}) {
	return { action: actionMock, payload: { settings, tapPos: [100, 50], hold: false } };
}

function lastFeedbackCanvas(mockAction: ReturnType<typeof createMockDialAction>): string {
	const calls = mockAction.setFeedback.mock.calls;
	const lastCall = calls[calls.length - 1][0] as { canvas: string };
	return lastCall.canvas;
}

/** Creates a mock commit activity API response */
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

/** Creates a sample week of commit data */
function sampleWeek(total: number, weekTimestamp: number): { total: number; week: number; days: number[] } {
	return {
		total,
		week: weekTimestamp,
		days: [1, 3, 2, 5, 4, 0, 1], // Sun-Sat
	};
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

/** Decode an SVG data URI to raw SVG string for content assertions. */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

describe("ContributionHeatmapAction", () => {
	let action: ContributionHeatmapAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new ContributionHeatmapAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });

		// Reset static shared state between tests
		(ContributionHeatmapAction as any).sharedScrollH?.clear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockDialAction("ch-1");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Setup Required");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("ch-1b");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Setup Required");
		});

		it("fetches and displays contribution heatmap", async () => {
			const mockAction = createMockDialAction("ch-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const now = Math.floor(Date.now() / 1000);
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([
					sampleWeek(16, now - 7 * 86400),
					sampleWeek(12, now),
				]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
			expect(svg).toContain("commits");
		});

		it("shows loading state before fetching data", async () => {
			const mockAction = createMockDialAction("ch-2c");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// First call should be the loading state
			const firstCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(firstCall.canvas)).toContain("Loading");
		});

		it("shows computing state when API returns 202", async () => {
			const mockAction = createMockDialAction("ch-2d");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 202,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("Computing");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockDialAction("ch-3");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockDialAction("ch-never");
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});
	});

	describe("onDialRotate", () => {
		it("scrolls the heatmap on dial rotate", async () => {
			const mockAction = createMockDialAction("ch-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const now = Math.floor(Date.now() / 1000);
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([
					sampleWeek(16, now - 7 * 86400),
					sampleWeek(12, now),
				]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// Reset to track only dial rotate calls
			mockAction.setFeedback.mockClear();

			await action.onDialRotate?.(createDialRotateEvent(mockAction, 3, settings) as never);

			vi.useFakeTimers();
			await action.onDialRotate?.(createDialRotateEvent(mockAction, 3, settings) as never);
			await vi.advanceTimersByTimeAsync(16);
			vi.useRealTimers();

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
		});

		it("does not scroll below offset 0", async () => {
			const mockAction = createMockDialAction("ch-4b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockAction.setFeedback.mockClear();

			// Rotate left (negative ticks) — offset should stay at 0
			vi.useFakeTimers();
			await action.onDialRotate?.(createDialRotateEvent(mockAction, -5, settings) as never);
			await vi.advanceTimersByTimeAsync(16);
			vi.useRealTimers();

			expect(mockAction.setFeedback).toHaveBeenCalled();
		});

		it("does nothing when no cached data exists", async () => {
			const mockAction = createMockDialAction("ch-4c");
			await action.onDialRotate?.(createDialRotateEvent(mockAction, 3) as never);

			expect(mockAction.setFeedback).not.toHaveBeenCalled();
		});
	});

	describe("onDialDown", () => {
		it("opens contributors page on GitHub", async () => {
			const mockAction = createMockDialAction("ch-5");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			await action.onDialDown?.(createDialDownEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/graphs/contributors");
		});

		it("does nothing when no URL is cached", async () => {
			const mockAction = createMockDialAction("ch-5b");
			await action.onDialDown?.(createDialDownEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onTouchTap", () => {
		it("refreshes and resets scroll offset on tap", async () => {
			const mockAction = createMockDialAction("ch-6");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// Scroll first
			await action.onDialRotate?.(createDialRotateEvent(mockAction, 5, settings) as never);

			// Tap to reset
			mockAction.setFeedback.mockClear();
			await action.onTouchTap?.(createTouchTapEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes when settings change", async () => {
			const mockAction = createMockDialAction("ch-7");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(16, Math.floor(Date.now() / 1000))]),
			);

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("commits");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockDialAction("ch-7b");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, {}) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Setup Required");
		});
	});

	describe("error handling", () => {
		it("shows error for invalid repo format", async () => {
			const mockAction = createMockDialAction("ch-err-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "bad" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Invalid repo");
		});

		it("shows error for API failure", async () => {
			const mockAction = createMockDialAction("ch-err-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 404,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({ message: "Not Found" }),
				text: () => Promise.resolve("Not Found"),
			} as unknown as Response);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Not Found");
		});

		it("shows auth error for 401 response", async () => {
			const mockAction = createMockDialAction("ch-err-3");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 401,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({ message: "Bad credentials" }),
				text: () => Promise.resolve("Bad credentials"),
			} as unknown as Response);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Auth Error");
		});

		it("shows rate limit error for 403 with no remaining calls", async () => {
			const mockAction = createMockDialAction("ch-err-4");

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

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Rate Limited");
		});
	});

	describe("onSendToPlugin", () => {
		it("handles PI data request without error", async () => {
			const mockAction = createMockDialAction("ch-pi-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onSendToPlugin?.({
				action: mockAction,
				payload: { event: "getRepos" },
			} as never);
		});

		it("ignores invalid payload gracefully", async () => {
			const mockAction = createMockDialAction("ch-pi-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onSendToPlugin?.({
				action: mockAction,
				payload: {},
			} as never);

			expect(mockLoggerError).not.toHaveBeenCalled();
		});
	});

	describe("multi-quarter quarterPosition", () => {
		it("renders with default quarterPosition 1 (no offset)", async () => {
			const mockAction = createMockDialAction("ch-qp-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
			expect(svg).toContain("commits");
		});

		it("renders with quarterPosition 2 (200px offset applied)", async () => {
			const mockAction = createMockDialAction("ch-qp-2");
			const settings = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
		});

		it("syncs scroll across instances with the same repo", async () => {
			const mockAction1 = createMockDialAction("ch-qp-sync1");
			const mockAction2 = createMockDialAction("ch-qp-sync2");
			const settings1 = { repo: "owner/repo", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(16, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings1) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockAction2, settings2) as never);

			mockAction1.setFeedback.mockClear();
			mockAction2.setFeedback.mockClear();

			// Rotate dial 1 — both should re-render
			vi.useFakeTimers();
			await action.onDialRotate?.(createDialRotateEvent(mockAction1, 3, settings1) as never);
			await vi.advanceTimersByTimeAsync(16);
			vi.useRealTimers();

			expect(mockAction1.setFeedback).toHaveBeenCalled();
			expect(mockAction2.setFeedback).toHaveBeenCalled();
		});

		it("shares API data across instances with the same repo", async () => {
			const mockAction1 = createMockDialAction("ch-qp-share1");
			const mockAction2 = createMockDialAction("ch-qp-share2");
			const settings1 = { repo: "owner/repo", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockCommitActivityResponse([sampleWeek(16, Math.floor(Date.now() / 1000))]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings1) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockAction2, settings2) as never);

			// Only 1 API call — second instance reuses cached data
			expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		});

		it("does not share data between different repos", async () => {
			const mockAction1 = createMockDialAction("ch-qp-diff1");
			const mockAction2 = createMockDialAction("ch-qp-diff2");
			const settings1 = { repo: "owner/repo-a", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo-b", quarterPosition: 1 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			vi.mocked(globalThis.fetch)
				.mockResolvedValueOnce(mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]))
				.mockResolvedValueOnce(mockCommitActivityResponse([sampleWeek(10, Math.floor(Date.now() / 1000))]));

			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings1) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockAction2, settings2) as never);

			// Different repos = 2 API calls
			expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		});
	});
});
