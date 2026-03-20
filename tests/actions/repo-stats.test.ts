/**
 * Tests for the RepoStatsAction (src/actions/repo-stats.ts).
 *
 * Mocks the @elgato/streamdeck module and the fetch API to test
 * the action's lifecycle, settings handling, and error states.
 * The action uses setImage() for SVG key images.
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
	mockSetGlobalSettings,
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
	mockSetGlobalSettings: vi.fn(),
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
	// Create a class that the decorator can extend
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
				setGlobalSettings: mockSetGlobalSettings,
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
		// The @action decorator — just return the class unmodified
		action: () => (target: unknown) => target,
	};
});

vi.mock("../../src/utils/graphql-query-coordinator", () => ({
	coordinator: {
		subscribe: mockCoordinatorSubscribe,
		unsubscribe: mockCoordinatorUnsubscribe,
		fetchData: mockCoordinatorFetchData,
		invalidateAndFetch: mockCoordinatorInvalidateAndFetch,
		isSubscribed: vi.fn().mockReturnValue(true),
	},
}));

import { RepoStatsAction } from "../../src/actions/repo-stats";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.repo-stats",
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

function createKeyUpEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown> = {}) {
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

/** Decode SVG from a data URI */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

/** Returns the SVG content from the last setImage call */
function lastImage(mockAction: ReturnType<typeof createMockKeyAction>): string {
	const calls = mockAction.setImage.mock.calls;
	return decodeSvg(calls[calls.length - 1][0] as string);
}

/** Creates a CoordinatorResult with repoMetadata for mock coordinator responses */
function makeCoordinatorResult(overrides: Record<string, unknown> = {}) {
	return {
		repoMetadata: {
			stargazers_count: 100,
			open_issues_count: 42,
			forks_count: 20,
			watchers_count: 50,
			full_name: "owner/repo",
			description: null,
			visibility: "public",
			html_url: "https://github.com/owner/repo",
			language: "TypeScript",
			size: 1024,
			license: "MIT",
			default_branch: "main",
			...overrides,
		},
	};
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("RepoStatsAction", () => {
	let action: RepoStatsAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new RepoStatsAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();

		// Default: global settings with token (set AFTER clearAllMocks)
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });

		// Default: coordinator returns empty result (tests override as needed)
		mockCoordinatorFetchData.mockResolvedValue({});
		mockCoordinatorInvalidateAndFetch.mockResolvedValue({});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("action-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("action-1b");
			const settings = { repo: "owner/repo", statType: "stars" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when both repo and token are missing", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("action-1c");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows loading then fetches data when repo is set", async () => {
			const mockAction = createMockKeyAction("action-2");
			const settings = { repo: "facebook/react", statType: "stars" };

			// Mock the actions iterable to find our action
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
			});

			// Mock coordinator to return repo stats
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult({
				stargazers_count: 200000,
				open_issues_count: 1000,
				forks_count: 40000,
				watchers_count: 200000,
				full_name: "facebook/react",
				description: "A JS library",
			}));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should have called setImage at least twice: loading + final
			expect(mockAction.setImage).toHaveBeenCalled();
			// Final image should include the repo name
			expect(lastImage(mockAction)).toContain("react");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer on disappear", async () => {
			const mockAction = createMockKeyAction("action-3");
			const settings = { repo: "facebook/react", statType: "stars" };

			// Set up the action first
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
			});

			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult({
				full_name: "facebook/react",
				description: null,
			}));

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			// Now disappear
			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			// No crash, timer cleaned up
			expect(true).toBe(true);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("action-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			// Should not throw
			action.onWillDisappear?.(ev as never);
		});
	});

	// ── onKeyDown ───────────────────────────────

	// ── Key press behavior (long/short press) ──

	describe("onKeyDown", () => {
		it("records timestamp but does not open URL or cycle stat", async () => {
			const mockAction = createMockKeyAction("action-4");
			const settings = { repo: "owner/repo", statType: "stars" };
			const ev = createKeyDownEvent(mockAction, settings);

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
			expect(mockAction.setSettings).not.toHaveBeenCalled();
		});
	});

	describe("onKeyUp — short press (cycle stat type)", () => {
		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("action-sp-1");
			const now = 1000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, {}) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 100);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
			expect(mockAction.setSettings).not.toHaveBeenCalled();
		});

		it("cycles from stars to issues on short press", async () => {
			const mockAction = createMockKeyAction("action-sp-2");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const now = 1000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			// Short press: 100ms later
			vi.spyOn(Date, "now").mockReturnValue(now + 100);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
			expect(mockAction.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);
		});

		it("cycles from visibility (last) back to stars (first)", async () => {
			const mockAction = createMockKeyAction("action-sp-3");
			const settings = { repo: "owner/repo", statType: "visibility" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const now = 2000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockAction.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "stars" }),
			);
		});

		it("defaults to stars then cycles to issues when statType is not set", async () => {
			const mockAction = createMockKeyAction("action-sp-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const now = 3000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 200);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			// Default statType is "stars" → next is "issues"
			expect(mockAction.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);
		});

		it("refreshes the display after cycling stat type", async () => {
			const mockAction = createMockKeyAction("action-sp-5");
			const settings = { repo: "owner/repo", statType: "forks" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			// Appear first so the action is known
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.setImage.mockClear();
			mockCoordinatorFetchData.mockClear();

			const now = 4000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 150);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			// Should have triggered a coordinator fetch for the new stat
			expect(mockCoordinatorFetchData).toHaveBeenCalled();
			// Should have updated the image with new stat display
			expect(mockAction.setImage).toHaveBeenCalled();
		});
	});

	describe("onKeyUp — long press (open URL)", () => {
		it("opens the stat URL after data loads", async () => {
			const mockAction = createMockKeyAction("action-lp-1");
			const settings = { repo: "owner/repo", statType: "issues" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			// Appear to populate lastUrl
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);
			mockOpenUrl.mockClear();

			const now = 5000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			// Long press: 600ms later
			vi.spyOn(Date, "now").mockReturnValue(now + 600);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/issues");
			expect(mockAction.setSettings).not.toHaveBeenCalled();
		});

		it("opens stargazers URL for stars stat type", async () => {
			const mockAction = createMockKeyAction("action-lp-2");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);
			mockOpenUrl.mockClear();

			const now = 6000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 700);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/stargazers");
		});

		it("falls back to constructed URL when lastUrl is not set", async () => {
			const mockAction = createMockKeyAction("action-lp-3");
			const settings = { repo: "owner/repo", statType: "forks" };

			const now = 7000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			// Don't appear first — just press directly
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 500);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/forks");
		});

		it("does not open URL on long press when repo is not configured", async () => {
			const mockAction = createMockKeyAction("action-lp-4");

			const now = 8000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, {}) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 1000);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("treats exactly 500ms as long press", async () => {
			const mockAction = createMockKeyAction("action-lp-5");
			const settings = { repo: "owner/repo", statType: "forks" };

			const now = 9000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 500);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalled();
			expect(mockAction.setSettings).not.toHaveBeenCalled();
		});

		it("treats 499ms as short press", async () => {
			const mockAction = createMockKeyAction("action-lp-6");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const now = 10000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 499);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
			expect(mockAction.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("action-6");

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("action-6b");

			const ev = createDidReceiveSettingsEvent(mockAction, { repo: "owner/repo", statType: "stars" });
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("refreshes with new settings when repo changes", async () => {
			const mockAction = createMockKeyAction("action-7");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("action-7", mockAction);

			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult({
				stargazers_count: 500,
				open_issues_count: 10,
				forks_count: 50,
				watchers_count: 100,
				full_name: "new-owner/new-repo",
			}));

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "new-owner/new-repo",
				statType: "forks",
			});
			await action.onDidReceiveSettings?.(ev as never);

			// Should have re-subscribed and fetched data for the new repo
			expect(mockCoordinatorFetchData).toHaveBeenCalled();
			expect(mockCoordinatorSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({ repo: "new-owner/new-repo" }),
				expect.any(Function),
			);
		});
	});

	// ── Error display ───────────────────────────

	describe("error handling on display", () => {
		it("shows error state when API returns 404", async () => {
			const mockAction = createMockKeyAction("action-err-1");
			const settings = { repo: "owner/nonexistent", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Coordinator returns error result (no repoMetadata)
			mockCoordinatorFetchData.mockResolvedValue({
				errors: { repoMetadata: "Repository not found" },
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// The last setImage call should show error
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows error when repo identifier is invalid format", async () => {
			const mockAction = createMockKeyAction("action-err-2");
			const settings = { repo: "invalid-no-slash", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should show "Invalid" error without calling coordinator
			expect(lastImage(mockAction)).toContain("Invalid");
			expect(mockCoordinatorFetchData).not.toHaveBeenCalled();
		});

		it("shows 'Auth Error' for invalid token", async () => {
			const mockAction = createMockKeyAction("action-err-auth");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Invalid or expired GitHub token"));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows 'Rate Limited' for rate limit exceeded", async () => {
			const mockAction = createMockKeyAction("action-err-rate");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("GitHub API rate limit exceeded"));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows 'No Access' for access denied", async () => {
			const mockAction = createMockKeyAction("action-err-access");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Access denied"));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("No Access");
		});

		it("shows 'Error' for generic errors", async () => {
			const mockAction = createMockKeyAction("action-err-generic");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Network error: connection refused"));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Error");
		});
	});

	// ── Multi-button cycling (issue #1) ─────────

	describe("multi-button cycling (issue #1)", () => {
		/** Reusable mock coordinator response */
		function mockFetchSuccess(): void {
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());
			mockCoordinatorInvalidateAndFetch.mockResolvedValue(makeCoordinatorResult());
		}

		it("second button cycles independently from the first", async () => {
			const mockActionA = createMockKeyAction("multi-A");
			const mockActionB = createMockKeyAction("multi-B");
			const settingsA = { repo: "owner/repoA", statType: "stars" };
			const settingsB = { repo: "owner/repoB", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockActionA, mockActionB],
				configurable: true,
			});
			mockFetchSuccess();

			// Both buttons appear
			await action.onWillAppear?.(createWillAppearEvent(mockActionA, settingsA) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockActionB, settingsB) as never);

			// Short press on button B
			const now = 20000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockActionB, settingsB) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 100);
			await action.onKeyUp?.(createKeyUpEvent(mockActionB, settingsB) as never);

			// Button B should have cycled stars → issues
			expect(mockActionB.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);
			// Button A should NOT have been touched by setSettings
			expect(mockActionA.setSettings).not.toHaveBeenCalled();
		});

		it("both buttons cycle independently through all stat types", async () => {
			const mockActionA = createMockKeyAction("multi-cycle-A");
			const mockActionB = createMockKeyAction("multi-cycle-B");

			Object.defineProperty(action, "actions", {
				get: () => [mockActionA, mockActionB],
				configurable: true,
			});
			mockFetchSuccess();

			const settingsA = { repo: "owner/repoA", statType: "stars" };
			const settingsB = { repo: "owner/repoB", statType: "stars" };

			await action.onWillAppear?.(createWillAppearEvent(mockActionA, settingsA) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockActionB, settingsB) as never);

			// Cycle button A: stars → issues
			let now = 30000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockActionA, settingsA) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockActionA, settingsA) as never);
			expect(mockActionA.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);

			// Cycle button B: stars → issues (independent from A)
			now = 31000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockActionB, settingsB) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockActionB, settingsB) as never);
			expect(mockActionB.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);

			// Cycle button A again: the cache now has "issues", so next should be "forks"
			// ev.payload.settings still has "stars" (simulating stale event payload)
			now = 32000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockActionA, settingsA) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockActionA, settingsA) as never);

			// Should cycle to "forks" (using cached "issues"), NOT "issues" (stale payload "stars")
			const lastCall = mockActionA.setSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
			expect(lastCall.statType).toBe("forks");
		});

		it("cycling uses cached statType when event payload is stale", async () => {
			const mockAction1 = createMockKeyAction("stale-payload-1");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction1],
				configurable: true,
			});
			mockFetchSuccess();

			const initialSettings = { repo: "owner/repo", statType: "stars" };
			await action.onWillAppear?.(createWillAppearEvent(mockAction1, initialSettings) as never);

			// First press: stars → issues
			let now = 40000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockAction1, initialSettings) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockAction1, initialSettings) as never);
			expect(mockAction1.setSettings).toHaveBeenCalledWith(
				expect.objectContaining({ statType: "issues" }),
			);

			// Second press with STALE event payload (still says "stars") —
			// the fix should use the cached "issues" instead.
			now = 41000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockAction1, initialSettings) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockAction1, initialSettings) as never);

			const lastCall = mockAction1.setSettings.mock.calls.at(-1)?.[0] as Record<string, unknown>;
			expect(lastCall.statType).toBe("forks");
		});

		it("onDidReceiveSettings is skipped after programmatic setSettings", async () => {
			const mockAction1 = createMockKeyAction("drs-skip-1");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction1],
				configurable: true,
			});
			mockFetchSuccess();

			const settings = { repo: "owner/repo", statType: "stars" };
			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings) as never);

			// Short press → cycles stars → issues
			const now = 50000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockAction1, settings) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockAction1, settings) as never);

			// Track setImage calls AFTER the cycle
			mockAction1.setImage.mockClear();
			mockCoordinatorFetchData.mockClear();

			// Simulate the SD echoing didReceiveSettings after setSettings
			const drsEv = createDidReceiveSettingsEvent(mockAction1, { repo: "owner/repo", statType: "issues" });
			await action.onDidReceiveSettings?.(drsEv as never);

			// Should NOT have shown loading or re-fetched
			expect(mockCoordinatorFetchData).not.toHaveBeenCalled();
			// onDidReceiveSettings should have returned early (no setImage calls)
			expect(mockAction1.setImage).not.toHaveBeenCalled();
		});

		it("onDidReceiveSettings still refreshes for PI-triggered changes", async () => {
			const mockAction1 = createMockKeyAction("drs-pi-1");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction1],
				configurable: true,
			});
			mockFetchSuccess();

			const settings = { repo: "owner/repo", statType: "stars" };
			await action.onWillAppear?.(createWillAppearEvent(mockAction1, settings) as never);

			mockAction1.setImage.mockClear();
			mockCoordinatorFetchData.mockClear();
			mockFetchSuccess();

			// Simulate the PI changing settings (no prior setSettings from plugin)
			const drsEv = createDidReceiveSettingsEvent(mockAction1, {
				repo: "owner/new-repo",
				statType: "forks",
			});
			await action.onDidReceiveSettings?.(drsEv as never);

			// Should have shown loading and re-fetched
			expect(mockCoordinatorFetchData).toHaveBeenCalled();
			expect(mockAction1.setImage).toHaveBeenCalled();
		});

		it("second button renders correctly after cycling", async () => {
			const mockActionA = createMockKeyAction("render-A");
			const mockActionB = createMockKeyAction("render-B");

			Object.defineProperty(action, "actions", {
				get: () => [mockActionA, mockActionB],
				configurable: true,
			});
			mockFetchSuccess();

			const settingsA = { repo: "owner/repoA", statType: "stars" };
			const settingsB = { repo: "owner/repoB", statType: "stars" };

			await action.onWillAppear?.(createWillAppearEvent(mockActionA, settingsA) as never);
			await action.onWillAppear?.(createWillAppearEvent(mockActionB, settingsB) as never);

			// Clear image mocks after initial render
			mockActionA.setImage.mockClear();
			mockActionB.setImage.mockClear();

			// Press button B → cycles to issues
			const now = 60000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockActionB, settingsB) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockActionB, settingsB) as never);

			// Button B should have been rendered (setImage called)
			expect(mockActionB.setImage).toHaveBeenCalled();
			const bSvg = lastImage(mockActionB);
			expect(bSvg).toContain("repoB");

			// Button A should NOT have had setImage called by the cycling
			expect(mockActionA.setImage).not.toHaveBeenCalled();
		});
	});

	// ── Coordinator integration ────────────────────

	describe("coordinator integration", () => {
		it("subscribes to coordinator in onWillAppear with correct params", async () => {
			const mockAction = createMockKeyAction("coord-sub-1");
			const settings = { repo: "owner/repo", statType: "stars", refreshInterval: 120 };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinatorSubscribe).toHaveBeenCalledWith({
				actionId: "coord-sub-1",
				repo: "owner/repo",
				fragments: ["repoMetadata", "prCount"],
				maxAgeSec: 120,
			}, expect.any(Function));
		});

		it("uses default refresh interval when not set", async () => {
			const mockAction = createMockKeyAction("coord-sub-2");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockCoordinatorSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({ maxAgeSec: 300 }),
				expect.any(Function),
			);
		});

		it("does not subscribe when repo is missing", async () => {
			const mockAction = createMockKeyAction("coord-sub-3");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockCoordinatorSubscribe).not.toHaveBeenCalled();
		});

		it("unsubscribes from coordinator in onWillDisappear", async () => {
			const mockAction = createMockKeyAction("coord-unsub-1");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinatorUnsubscribe.mockClear();

			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);

			expect(mockCoordinatorUnsubscribe).toHaveBeenCalledWith("coord-unsub-1");
		});

		it("re-subscribes on settings change via Property Inspector", async () => {
			const mockAction = createMockKeyAction("coord-resub-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("coord-resub-1", mockAction);
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			// Initial appear
			const settings = { repo: "owner/repo", statType: "stars" };
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinatorSubscribe.mockClear();
			mockCoordinatorUnsubscribe.mockClear();

			// PI changes repo
			const drsEv = createDidReceiveSettingsEvent(mockAction, {
				repo: "owner/new-repo",
				statType: "forks",
			});
			await action.onDidReceiveSettings?.(drsEv as never);

			// Should unsubscribe old and subscribe with new repo
			expect(mockCoordinatorUnsubscribe).toHaveBeenCalledWith("coord-resub-1");
			expect(mockCoordinatorSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({ repo: "owner/new-repo" }),
				expect.any(Function),
			);
		});

		it("unsubscribes when settings are cleared in onDidReceiveSettings", async () => {
			const mockAction = createMockKeyAction("coord-unsub-drs");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("coord-unsub-drs", mockAction);
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			// Initial appear
			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo", statType: "stars" }) as never);
			mockCoordinatorUnsubscribe.mockClear();

			// PI clears repo
			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, {}) as never);

			expect(mockCoordinatorUnsubscribe).toHaveBeenCalledWith("coord-unsub-drs");
		});

		it("uses invalidateAndFetch on double-click", async () => {
			const mockAction = createMockKeyAction("coord-dblclick-1");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());
			mockCoordinatorInvalidateAndFetch.mockResolvedValue(makeCoordinatorResult());

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinatorFetchData.mockClear();
			mockCoordinatorInvalidateAndFetch.mockClear();

			// Simulate double-click (two key-ups within 400ms)
			const now = 100000;
			vi.spyOn(Date, "now").mockReturnValue(now);
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 50);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			// Second click within 400ms
			vi.spyOn(Date, "now").mockReturnValue(now + 200);
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);
			vi.spyOn(Date, "now").mockReturnValue(now + 250);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			// Should have used invalidateAndFetch for the force refresh
			expect(mockCoordinatorInvalidateAndFetch).toHaveBeenCalled();
		});

		it("uses invalidateAndFetch on touch tap", async () => {
			const mockAction = createMockKeyAction("coord-touchtap-1");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());
			mockCoordinatorInvalidateAndFetch.mockResolvedValue(makeCoordinatorResult());

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinatorFetchData.mockClear();
			mockCoordinatorInvalidateAndFetch.mockClear();

			// Simulate touch tap
			await (action as any).onTouchTap?.({
				action: mockAction,
				payload: { settings },
			});

			expect(mockCoordinatorInvalidateAndFetch).toHaveBeenCalled();
			expect(mockCoordinatorFetchData).not.toHaveBeenCalled();
		});

		it("uses invalidateAndFetch on dial rotate", async () => {
			const mockAction = createMockKeyAction("coord-dialrotate-1");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());
			mockCoordinatorInvalidateAndFetch.mockResolvedValue(makeCoordinatorResult());

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			mockCoordinatorFetchData.mockClear();
			mockCoordinatorInvalidateAndFetch.mockClear();

			// Simulate dial rotate (clockwise)
			await (action as any).onDialRotate?.({
				action: mockAction,
				payload: { settings, ticks: 1 },
			});

			expect(mockCoordinatorInvalidateAndFetch).toHaveBeenCalled();
			expect(mockCoordinatorFetchData).not.toHaveBeenCalled();
		});

		it("calls fetchData on normal poll tick", async () => {
			const mockAction = createMockKeyAction("coord-fetch-1");
			const settings = { repo: "owner/repo", statType: "stars" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue(makeCoordinatorResult());

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			// fetchData should have been called during initial refresh
			expect(mockCoordinatorFetchData).toHaveBeenCalled();
		});
	});
});
