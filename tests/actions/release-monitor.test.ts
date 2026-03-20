/**
 * Tests for the ReleaseMonitorAction (src/actions/release-monitor.ts).
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

import { ReleaseMonitorAction } from "../../src/actions/release-monitor";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.release-monitor",
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

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("ReleaseMonitorAction", () => {
	let action: ReleaseMonitorAction;

	beforeEach(() => {
		action = new ReleaseMonitorAction();

		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		mockCoordinatorFetchData.mockResolvedValue({ latestRelease: null });
		mockCoordinatorInvalidateAndFetch.mockResolvedValue({ latestRelease: null });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("rel-1");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("rel-1b");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays release when configured", async () => {
			const mockAction = createMockKeyAction("rel-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue({
				latestRelease: {
					tag_name: "v1.2.3",
					name: "Release v1.2.3",
					published_at: new Date(Date.now() - 3600000).toISOString(),
					prerelease: false,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("v1.2.3");
		});

		it("shows 'None' when no releases exist", async () => {
			const mockAction = createMockKeyAction("rel-2b");
			const settings = { repo: "owner/new-repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue({ latestRelease: null });

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("None");
		});

		it("shows pre-release indicator for pre-releases", async () => {
			const mockAction = createMockKeyAction("rel-2c");
			const settings = { repo: "owner/repo", includePreReleases: true };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue({
				latestRelease: {
					tag_name: "v2.0.0-beta.1",
					name: "Beta Release",
					published_at: new Date(Date.now() - 86400000).toISOString(),
					prerelease: true,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v2.0.0-beta.1",
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("v2.0.0-beta.1");
			expect(svg).toContain("Pre");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockKeyAction("rel-3");
			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			mockCoordinatorFetchData.mockResolvedValue({
				latestRelease: {
					tag_name: "v1.0.0",
					published_at: new Date().toISOString(),
					prerelease: false,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("rel-never");
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});
	});

	describe("onKeyDown", () => {
		it("opens release URL when available", async () => {
			const mockAction = createMockKeyAction("rel-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockResolvedValue({
				latestRelease: {
					tag_name: "v1.0.0",
					published_at: new Date().toISOString(),
					prerelease: false,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
				},
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/releases/tag/v1.0.0");
		});

		it("opens releases page when no specific release URL", async () => {
			const mockAction = createMockKeyAction("rel-4b");
			const settings = { repo: "owner/repo" };

			// Don't appear first — no cached URL
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/releases");
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("rel-4c");
			await action.onKeyDown?.(createKeyDownEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes when settings change", async () => {
			const mockAction = createMockKeyAction("rel-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("rel-5", mockAction);

			mockCoordinatorFetchData.mockResolvedValue({
				latestRelease: {
					tag_name: "v3.0.0",
					published_at: new Date().toISOString(),
					prerelease: false,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v3.0.0",
				},
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("v3.0.0");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("rel-5b");

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
			const mockAction = createMockKeyAction("rel-err-1");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "bad" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("shows auth error for 401 response", async () => {
			const mockAction = createMockKeyAction("rel-err-2");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Unauthorized (401)"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows 'Rate Limited' for rate limit exceeded", async () => {
			const mockAction = createMockKeyAction("rel-err-rate");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("GitHub API rate limit exceeded"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Rate Limited");
		});

		it("shows 'Not Found' for missing repository", async () => {
			const mockAction = createMockKeyAction("rel-err-notfound");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Repository not found"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows 'No Access' for access denied", async () => {
			const mockAction = createMockKeyAction("rel-err-access");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Access denied"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("No Access");
		});

		it("shows 'Error' for generic errors", async () => {
			const mockAction = createMockKeyAction("rel-err-generic");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			mockCoordinatorFetchData.mockRejectedValue(new Error("Network error: connection refused"));

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Error");
		});
	});
});
