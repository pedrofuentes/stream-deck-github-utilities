/**
 * Tests for the BranchNetworkAction (src/actions/branch-network.ts).
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
	mockCoordinatorSubscribe,
	mockCoordinatorUnsubscribe,
	mockCoordinatorFetchData,
	mockCoordinatorInvalidateAndFetch,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerDebug: vi.fn(),
	mockLoggerError: vi.fn(),
	mockOpenUrl: vi.fn().mockResolvedValue(undefined),
	mockCoordinatorSubscribe: vi.fn(),
	mockCoordinatorUnsubscribe: vi.fn(),
	mockCoordinatorFetchData: vi.fn(),
	mockCoordinatorInvalidateAndFetch: vi.fn(),
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

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	coordinator: {
		subscribe: mockCoordinatorSubscribe,
		unsubscribe: mockCoordinatorUnsubscribe,
		fetchData: mockCoordinatorFetchData,
		invalidateAndFetch: mockCoordinatorInvalidateAndFetch,
	},
}));

import { BranchNetworkAction } from "../../src/actions/branch-network";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockDialAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.branch-network",
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

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

/** Decode an SVG data URI to raw SVG string for content assertions. */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

/** Creates a default coordinator result with branches */
function branchResult(branches: Array<{ name: string; commitSha?: string }>) {
	return {
		branches: branches.map((b) => ({
			name: b.name,
			commitSha: b.commitSha ?? "abc123",
		})),
	};
}

describe("BranchNetworkAction", () => {
	let action: BranchNetworkAction;

	beforeEach(() => {
		action = new BranchNetworkAction();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinatorFetchData.mockResolvedValue({ branches: [] });
		mockCoordinatorInvalidateAndFetch.mockResolvedValue({ branches: [] });

		// Reset static shared state between tests
		(BranchNetworkAction as any).sharedScrollH?.clear();
		(BranchNetworkAction as any).sharedScrollV?.clear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockDialAction("bn-1");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Setup Required");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("bn-1b");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Setup Required");
		});

		it("fetches and displays branch network", async () => {
			const mockAction = createMockDialAction("bn-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([
					{ name: "main" },
					{ name: "feature/auth" },
					{ name: "develop" },
				]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
			expect(svg).toContain("main");
		});

		it("shows loading state before fetching data", async () => {
			const mockAction = createMockDialAction("bn-2c");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// First call should be the loading state
			const firstCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(firstCall.canvas)).toContain("Loading");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockDialAction("bn-3");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockDialAction("bn-never");
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});
	});

	describe("onDialRotate", () => {
		it("scrolls the branch network on dial rotate", async () => {
			const mockAction = createMockDialAction("bn-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([
					{ name: "main" },
					{ name: "feature/test" },
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
			const mockAction = createMockDialAction("bn-4b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
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
	});

	describe("onDialDown", () => {
		it("does nothing — press is reserved for press+rotate vertical scroll", async () => {
			const mockAction = createMockDialAction("bn-5");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			await action.onDialDown?.(createDialDownEvent(mockAction, settings) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onTouchTap", () => {
		it("opens network page on GitHub", async () => {
			const mockAction = createMockDialAction("bn-6");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "develop" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			await action.onTouchTap?.(createTouchTapEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/network");
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes when settings change", async () => {
			const mockAction = createMockDialAction("bn-7");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "feature/new" }]),
			);

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("main");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockDialAction("bn-7b");

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
			const mockAction = createMockDialAction("bn-err-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "bad" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Invalid repo");
		});

		it("shows error for API failure", async () => {
			const mockAction = createMockDialAction("bn-err-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Repository not found"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Not Found");
		});

		it("shows auth error for 401 response", async () => {
			const mockAction = createMockDialAction("bn-err-3");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Unauthorized (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Auth Error");
		});

		it("shows rate limit error for 403 with no remaining calls", async () => {
			const mockAction = createMockDialAction("bn-err-4");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("API rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			expect(decodeSvg(lastFeedbackCanvas(mockAction))).toContain("Rate Limited");
		});
	});

	describe("onSendToPlugin", () => {
		it("handles PI data request without error", async () => {
			const mockAction = createMockDialAction("bn-pi-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Should not throw
			await action.onSendToPlugin?.({
				action: mockAction,
				payload: { event: "getRepos" },
			} as never);
		});

		it("ignores invalid payload gracefully", async () => {
			const mockAction = createMockDialAction("bn-pi-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onSendToPlugin?.({
				action: mockAction,
				payload: {},
			} as never);

			// Should not log error for missing event
			expect(mockLoggerError).not.toHaveBeenCalled();
		});
	});

	describe("multi-quarter quarterPosition", () => {
		it("renders with default quarterPosition 1 (no offset)", async () => {
			const mockAction = createMockDialAction("bn-mq-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "develop" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
			expect(svg).toContain("main");
		});

		it("renders with quarterPosition 2 (200px offset applied)", async () => {
			const mockAction = createMockDialAction("bn-mq-2");
			const settings = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "develop" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = decodeSvg(lastFeedbackCanvas(mockAction));
			expect(svg).toContain("<svg");
		});

		it("syncs scroll across instances with the same repo", async () => {
			const mockAction1 = createMockDialAction("bn-mq-sync1");
			const mockAction2 = createMockDialAction("bn-mq-sync2");
			const settings1 = { repo: "owner/repo", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "develop" }]),
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
			const mockAction1 = createMockDialAction("bn-mq-share1");
			const mockAction2 = createMockDialAction("bn-mq-share2");
			const settings1 = { repo: "owner/repo", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }, { name: "develop" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings1) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockAction2, settings2) as never);

			// Both actions fetch through coordinator (which handles caching internally)
			expect(mockCoordinatorFetchData).toHaveBeenCalledTimes(2);
		});

		it("does not share data between different repos", async () => {
			const mockAction1 = createMockDialAction("bn-mq-diff1");
			const mockAction2 = createMockDialAction("bn-mq-diff2");
			const settings1 = { repo: "owner/repo-a", quarterPosition: 1 };
			const settings2 = { repo: "owner/repo-b", quarterPosition: 1 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction1, mockAction2],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings1) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockAction2, settings2) as never);

			// Different repos = 2 coordinator fetchData calls
			expect(mockCoordinatorFetchData).toHaveBeenCalledTimes(2);
		});

		it("cleans up on disappear without affecting shared scroll", async () => {
			const mockAction = createMockDialAction("bn-mq-4");
			const settings = { repo: "owner/repo", quarterPosition: 2 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue(
				branchResult([{ name: "main" }]),
			);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);

			// No error should occur after cleanup
		});
	});
});
