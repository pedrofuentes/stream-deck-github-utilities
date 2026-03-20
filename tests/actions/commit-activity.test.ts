/**
 * Tests for the CommitActivityAction (src/actions/commit-activity.ts).
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
	mockSubscribe,
	mockUnsubscribe,
	mockFetchData,
	mockInvalidateAndFetch,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerDebug: vi.fn(),
	mockLoggerError: vi.fn(),
	mockOpenUrl: vi.fn().mockResolvedValue(undefined),
	mockSubscribe: vi.fn(),
	mockUnsubscribe: vi.fn(),
	mockFetchData: vi.fn(),
	mockInvalidateAndFetch: vi.fn(),
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
		subscribe: mockSubscribe,
		unsubscribe: mockUnsubscribe,
		fetchData: mockFetchData,
		invalidateAndFetch: mockInvalidateAndFetch,
	},
}));

import { CommitActivityAction } from "../../src/actions/commit-activity";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.commit-activity",
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

function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

function lastImage(mockAction: ReturnType<typeof createMockKeyAction>): string {
	const calls = mockAction.setImage.mock.calls;
	return decodeSvg(calls[calls.length - 1][0] as string);
}

/** Set up coordinator mock for commit activity data */
function setupCoordinatorMock(weeks: Array<{ total: number; days: number[]; week: number }> | null) {
	const result = { commitActivity: weeks };
	mockFetchData.mockResolvedValue(result);
	mockInvalidateAndFetch.mockResolvedValue(result);
}

/** Set up coordinator to throw an error */
function setupCoordinatorError(message: string) {
	mockFetchData.mockRejectedValue(new Error(message));
	mockInvalidateAndFetch.mockRejectedValue(new Error(message));
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("CommitActivityAction", () => {
	let action: CommitActivityAction;

	beforeEach(() => {
		action = new CommitActivityAction();
		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("commit-1");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("commit-1b");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays commit activity for 7d", async () => {
			const mockAction = createMockKeyAction("commit-2");
			const settings = { repo: "owner/repo", timeRange: "7d" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// 52 weeks of data, last week has 42 total commits
			const weeks = Array.from({ length: 52 }, (_, i) => ({
				total: i === 51 ? 42 : 5,
				days: i === 51 ? [6, 6, 6, 6, 6, 6, 6] : [1, 1, 1, 1, 0, 1, 0],
				week: Math.floor(Date.now() / 1000) - (51 - i) * 604800,
			}));

			setupCoordinatorMock(weeks);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("42");
			expect(svg).toContain("Commits (7d)");
		});

		it("shows computing state when API returns 202", async () => {
			const mockAction = createMockKeyAction("commit-2b");
			const settings = { repo: "owner/repo", timeRange: "7d" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(null);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			// Should show "..." for computing state
			expect(svg).toContain("...");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockKeyAction("commit-3");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const weeks = Array.from({ length: 52 }, () => ({
				total: 10,
				days: [1, 1, 2, 2, 1, 2, 1],
				week: Math.floor(Date.now() / 1000),
			}));
			setupCoordinatorMock(weeks);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("commit-never");
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});
	});

	describe("onKeyDown", () => {
		it("opens commits page on GitHub", async () => {
			const mockAction = createMockKeyAction("commit-4");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const weeks = Array.from({ length: 52 }, () => ({
				total: 10,
				days: [1, 1, 2, 2, 1, 2, 1],
				week: Math.floor(Date.now() / 1000),
			}));
			setupCoordinatorMock(weeks);

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.useFakeTimers();
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);
			vi.advanceTimersByTime(400);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/commits");
			vi.useRealTimers();
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("commit-4b");
			await action.onKeyDown?.(createKeyDownEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes when settings change", async () => {
			const mockAction = createMockKeyAction("commit-5");
			const settings = { repo: "owner/repo", timeRange: "30d" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("commit-5", mockAction);

			const weeks = Array.from({ length: 52 }, (_, i) => ({
				total: 100,
				days: [14, 14, 15, 14, 14, 15, 14],
				week: Math.floor(Date.now() / 1000) - (51 - i) * 604800,
			}));
			setupCoordinatorMock(weeks);

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Commits (30d)");
		});

		it("defaults timeRange to 7d when not set", async () => {
			const mockAction = createMockKeyAction("commit-5b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("commit-5b", mockAction);

			const weeks = Array.from({ length: 52 }, () => ({
				total: 5,
				days: [1, 1, 1, 1, 0, 1, 0],
				week: Math.floor(Date.now() / 1000),
			}));
			setupCoordinatorMock(weeks);

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Commits (7d)");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("commit-5c");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, {}) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});
	});

	describe("error handling", () => {
		it("shows error for invalid repo format", async () => {
			const mockAction = createMockKeyAction("commit-err-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "bad" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("shows error for API failure", async () => {
			const mockAction = createMockKeyAction("commit-err-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Repository not found");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows 'Auth Error' for invalid token", async () => {
			const mockAction = createMockKeyAction("commit-err-auth");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Invalid or expired GitHub token");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows 'Rate Limited' for rate limit exceeded", async () => {
			const mockAction = createMockKeyAction("commit-err-rate");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("GitHub API rate limit exceeded");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows 'No Access' for access denied", async () => {
			const mockAction = createMockKeyAction("commit-err-access");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Access denied");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("No Access");
		});

		it("shows 'Error' for generic errors", async () => {
			const mockAction = createMockKeyAction("commit-err-generic");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Network error: connection refused");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Error");
		});
	});
});
