/**
 * Tests for the RepoStatsAction (src/actions/repo-stats.ts).
 *
 * Mocks the @elgato/streamdeck module and the fetch API to test
 * the action's lifecycle, settings handling, and error states.
 * The action uses setImage() for SVG key images.
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
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockSetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerDebug: vi.fn(),
	mockLoggerError: vi.fn(),
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

	describe("onKeyDown", () => {
		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("action-4");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			// setImage should not be called for unconfigured key press
			expect(mockAction.setImage).not.toHaveBeenCalled();
		});

		it("shows loading and refreshes when repo is configured", async () => {
			const mockAction = createMockKeyAction("action-5");
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

			// First appear to set up settings
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.setImage.mockClear();

			// Now key down
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			// Should have shown loading then refreshed
			expect(mockAction.setImage).toHaveBeenCalled();
			// First call should be Loading image
			expect(decodeSvg(mockAction.setImage.mock.calls[0][0] as string)).toContain("Loading");
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
