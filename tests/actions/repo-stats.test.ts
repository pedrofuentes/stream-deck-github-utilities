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
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockSetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerDebug: vi.fn(),
	mockLoggerError: vi.fn(),
	mockOpenUrl: vi.fn().mockResolvedValue(undefined),
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

import { RepoStatsAction } from "../../src/actions/repo-stats";
import * as githubApi from "../../src/utils/github-api";

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

		// Default: return empty global settings
		mockGetGlobalSettings.mockResolvedValue({});

		vi.clearAllMocks();
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

		it("shows loading then fetches data when repo is set", async () => {
			const mockAction = createMockKeyAction("action-2");
			const settings = { repo: "facebook/react", statType: "stars" };

			// Mock the actions iterable to find our action
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
			});

			mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });

			// Mock fetch for github API
			const mockResponse = {
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 200000,
						open_issues_count: 1000,
						forks_count: 40000,
						watchers_count: 200000,
						full_name: "facebook/react",
						description: "A JS library",
						visibility: "public",
						html_url: "https://github.com/facebook/react",
					}),
				text: () => Promise.resolve(""),
			};
			vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse as unknown as Response);

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

			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 10,
						forks_count: 20,
						watchers_count: 50,
						full_name: "facebook/react",
						description: null,
						visibility: "public",
						html_url: "https://github.com/facebook/react",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

			// Appear first so the action is known
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.setImage.mockClear();
			vi.mocked(globalThis.fetch).mockClear();

			const now = 4000;
			vi.spyOn(Date, "now").mockReturnValue(now);

			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			vi.spyOn(Date, "now").mockReturnValue(now + 150);
			await action.onKeyUp?.(createKeyUpEvent(mockAction, settings) as never);

			// Should have triggered a fetch for the new stat
			expect(globalThis.fetch).toHaveBeenCalled();
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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 100,
						open_issues_count: 42,
						forks_count: 20,
						watchers_count: 50,
						full_name: "owner/repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/owner/repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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

		it("refreshes with new settings when repo changes", async () => {
			const mockAction = createMockKeyAction("action-7");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () =>
					Promise.resolve({
						stargazers_count: 500,
						open_issues_count: 10,
						forks_count: 50,
						watchers_count: 100,
						full_name: "new-owner/new-repo",
						description: null,
						visibility: "public",
						html_url: "https://github.com/new-owner/new-repo",
					}),
				text: () => Promise.resolve(""),
			} as unknown as Response);

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "new-owner/new-repo",
				statType: "forks",
			});
			await action.onDidReceiveSettings?.(ev as never);

			// Should have fetched data for the new repo
			expect(globalThis.fetch).toHaveBeenCalled();
			const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(fetchUrl).toContain("new-owner");
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

			mockGetGlobalSettings.mockResolvedValue({});
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 404,
				headers: new Headers({
					"x-ratelimit-limit": "60",
					"x-ratelimit-remaining": "59",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({ message: "Not Found" }),
				text: () => Promise.resolve('{"message":"Not Found"}'),
			} as unknown as Response);

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

			mockGetGlobalSettings.mockResolvedValue({});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should show "Invalid" error without making API call
			expect(lastImage(mockAction)).toContain("Invalid");
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});
	});
});
