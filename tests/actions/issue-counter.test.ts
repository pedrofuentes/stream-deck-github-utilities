/**
 * Tests for the IssueCounterAction (src/actions/issue-counter.ts).
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

import { IssueCounterAction } from "../../src/actions/issue-counter";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.issue-counter",
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

/** Mock fetch for issue count — open state uses repo stats + Search API for PR count */
function mockFetchForOpenIssues(openIssuesCount: number, openPRCount: number) {
	return vi.fn().mockImplementation((url: string) => {
		const urlStr = typeof url === "string" ? url : (url as URL).toString();

		// Repo stats (for open_issues_count which includes PRs)
		if (urlStr.includes("/repos/") && !urlStr.includes("/search/")) {
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4998",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "2",
				}),
				json: () => Promise.resolve({
					open_issues_count: openIssuesCount + openPRCount,
					stargazers_count: 100,
					forks_count: 20,
					watchers_count: 50,
					full_name: "owner/repo",
					description: "test",
					visibility: "public",
					html_url: "https://github.com/owner/repo",
				}),
				text: () => Promise.resolve(""),
			});
		}

		// Search API for open PR count (type:pr is:open)
		if (urlStr.includes("/search/issues")) {
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "30",
					"x-ratelimit-remaining": "29",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({ total_count: openPRCount, incomplete_results: false, items: [] }),
				text: () => Promise.resolve(""),
			});
		}

		// Default fallback
		return Promise.resolve({
			ok: true,
			status: 200,
			headers: new Headers({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "4996",
				"x-ratelimit-reset": "9999999999",
				"x-ratelimit-used": "4",
			}),
			json: () => Promise.resolve({ total_count: 0, items: [] }),
			text: () => Promise.resolve(""),
		});
	});
}

/** Mock fetch for closed or all issue count — uses the Search API with total_count */
function mockFetchForIssueState(issueCount: number) {
	return vi.fn().mockImplementation((url: string) => {
		const urlStr = typeof url === "string" ? url : (url as URL).toString();

		// Search API endpoint — returns total_count directly
		if (urlStr.includes("/search/issues")) {
			return Promise.resolve({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "30",
					"x-ratelimit-remaining": "29",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve({ total_count: issueCount, incomplete_results: false, items: [] }),
				text: () => Promise.resolve(""),
			});
		}

		// Default fallback
		return Promise.resolve({
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
		});
	});
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("IssueCounterAction", () => {
	let action: IssueCounterAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new IssueCounterAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("issue-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("issue-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays issue count when configured", async () => {
			const mockAction = createMockKeyAction("issue-2");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			globalThis.fetch = mockFetchForOpenIssues(25, 5);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("25");
			expect(svg).toContain("Open Issues");
		});

		it("fetches and displays closed issue count (excluding PRs)", async () => {
			const mockAction = createMockKeyAction("issue-2-closed");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Search API returns exact count of 17 closed issues (PRs excluded)
			globalThis.fetch = mockFetchForIssueState(17);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("17");
			expect(svg).toContain("Closed Issues");
		});

		it("fetches and displays all issue count (excluding PRs)", async () => {
			const mockAction = createMockKeyAction("issue-2-all");
			const settings = { repo: "owner/repo", stateFilter: "all" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Search API returns exact count of 20 issues (PRs excluded)
			globalThis.fetch = mockFetchForIssueState(20);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("20");
			expect(svg).toContain("All Issues");
		});

		it("handles closed state with zero PRs", async () => {
			const mockAction = createMockKeyAction("issue-2-no-prs");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Search API returns 10 closed issues
			globalThis.fetch = mockFetchForIssueState(10);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("10");
			expect(svg).toContain("Closed Issues");
		});

		it("returns zero when all items are PRs", async () => {
			const mockAction = createMockKeyAction("issue-2-all-prs");
			const settings = { repo: "owner/repo", stateFilter: "closed" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Search API returns 0 issues (all items were PRs)
			globalThis.fetch = mockFetchForIssueState(0);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("0");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up timer on disappear", async () => {
			const mockAction = createMockKeyAction("issue-3");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			globalThis.fetch = mockFetchForOpenIssues(10, 2);

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("issue-never");
			const ev = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(ev as never);
		});
	});

	describe("onKeyDown", () => {
		it("opens issues page on GitHub when repo is configured", async () => {
			const mockAction = createMockKeyAction("issue-4");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			globalThis.fetch = mockFetchForOpenIssues(100, 20);
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/issues");
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("issue-4b");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("issue-5");
			const settings = { repo: "owner/repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			globalThis.fetch = mockFetchForOpenIssues(30, 10);

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("30");
		});

		it("defaults stateFilter to open when not set", async () => {
			const mockAction = createMockKeyAction("issue-5b");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("issue-5b", mockAction);

			globalThis.fetch = mockFetchForOpenIssues(8, 2);

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("Open Issues");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("issue-5c");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});
	});

	describe("error handling", () => {
		it("shows error image when API returns 404", async () => {
			const mockAction = createMockKeyAction("issue-err-1");
			const settings = { repo: "owner/nonexistent", stateFilter: "open" };

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

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows error for invalid repo format", async () => {
			const mockAction = createMockKeyAction("issue-err-2");
			const settings = { repo: "invalid-repo", stateFilter: "open" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});
	});
});
