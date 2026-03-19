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

function mockReleaseResponse(release: Record<string, unknown> | null) {
	if (release === null) {
		// No releases
		return {
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
		} as unknown as Response;
	}

	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve(release),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("ReleaseMonitorAction", () => {
	let action: ReleaseMonitorAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new ReleaseMonitorAction();
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

			vi.mocked(globalThis.fetch).mockResolvedValue(mockReleaseResponse({
				tag_name: "v1.2.3",
				name: "Release v1.2.3",
				published_at: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
				prerelease: false,
				html_url: "https://github.com/owner/repo/releases/tag/v1.2.3",
			}));

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

			vi.mocked(globalThis.fetch).mockResolvedValue(mockReleaseResponse(null));

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

			// includePreReleases=true uses /releases?per_page=1 which returns an array
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "1",
				}),
				json: () => Promise.resolve([{
					tag_name: "v2.0.0-beta.1",
					name: "Beta Release",
					published_at: new Date(Date.now() - 86400000).toISOString(),
					prerelease: true,
					draft: false,
					html_url: "https://github.com/owner/repo/releases/tag/v2.0.0-beta.1",
				}]),
				text: () => Promise.resolve(""),
			} as unknown as Response);

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
			vi.mocked(globalThis.fetch).mockResolvedValue(mockReleaseResponse({
				tag_name: "v1.0.0",
				published_at: new Date().toISOString(),
				prerelease: false,
				html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
			}));

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

			vi.mocked(globalThis.fetch).mockResolvedValue(mockReleaseResponse({
				tag_name: "v1.0.0",
				published_at: new Date().toISOString(),
				prerelease: false,
				html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
			}));

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

			vi.mocked(globalThis.fetch).mockResolvedValue(mockReleaseResponse({
				tag_name: "v3.0.0",
				published_at: new Date().toISOString(),
				prerelease: false,
				html_url: "https://github.com/owner/repo/releases/tag/v3.0.0",
			}));

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

			await action.onWillAppear?.(createWillAppearEvent(mockAction, { repo: "owner/repo" }) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Auth Error");
		});
	});
});
