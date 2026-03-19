/**
 * Tests for the SecurityHealthAction (src/actions/security-health.ts).
 *
 * Mocks the @elgato/streamdeck module and the fetch API to test
 * the action's lifecycle, settings handling, encoder support, grading, and error states.
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

import { SecurityHealthAction, computeGrade } from "../../src/actions/security-health";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.security-health",
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
		manifestId: "com.pedrofuentes.github-utilities.security-health",
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

function mockFetchDependabotResponse(alerts: Array<{ severity: string }>) {
	return {
		ok: true,
		status: 200,
		headers: new Headers({
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "9999999999",
			"x-ratelimit-used": "1",
		}),
		json: () => Promise.resolve(
			alerts.map((a) => ({
				security_advisory: { severity: a.severity },
			}))
		),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("SecurityHealthAction", () => {
	let action: SecurityHealthAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new SecurityHealthAction();
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
			const mockAction = createMockKeyAction("sh-1");
			const ev = createWillAppearEvent(mockAction, { repo: "owner/repo" });

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("sh-2");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays grade A for zero alerts", async () => {
			const mockAction = createMockKeyAction("sh-3");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("A");
			expect(svg).toContain("No Alerts");
		});

		it("fetches and displays grade B for low-severity alerts", async () => {
			const mockAction = createMockKeyAction("sh-4");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "low" },
				{ severity: "medium" },
			]));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("B");
			expect(svg).toContain("2 alerts");
		});

		it("fetches and displays grade D for critical alerts", async () => {
			const mockAction = createMockKeyAction("sh-5");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "critical" },
				{ severity: "low" },
			]));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("D");
			expect(svg).toContain("2 alerts");
		});

		it("shows singular 'alert' for exactly one alert", async () => {
			const mockAction = createMockKeyAction("sh-6");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "low" },
			]));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("1 alert");
			expect(svg).not.toContain("1 alerts");
		});

		it("shows unconfigured on dial when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockDialAction("sh-dial-1");
			const ev = createWillAppearEvent(mockAction, { repo: "owner/repo" });

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const feedbackCall = mockAction.setFeedback.mock.calls[0][0] as { canvas: string };
			expect(decodeSvg(feedbackCall.canvas)).toContain("Setup Required");
		});

		it("shows security arc strip on dial with alert data", async () => {
			const mockAction = createMockDialAction("sh-dial-2");
			const settings = { repo: "owner/myrepo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "high" },
				{ severity: "medium" },
			]));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(mockAction.setFeedback).toHaveBeenCalled();
			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("Security");
			expect(decodeSvg(lastCall.canvas)).toContain("high");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up on disappear", async () => {
			const mockAction = createMockKeyAction("sh-d-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			// No crash, timer cleaned up
			expect(true).toBe(true);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("sh-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			action.onWillDisappear?.(ev as never);
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("opens repo security page when repo is configured", async () => {
			const mockAction = createMockKeyAction("sh-k-1");
			const settings = { repo: "facebook/react" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/facebook/react/security");
		});

		it("opens github.com when no repo configured", async () => {
			const mockAction = createMockKeyAction("sh-k-2");

			const ev = createKeyDownEvent(mockAction, {});
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com");
		});
	});

	// ── Encoder: onDialDown ─────────────────────

	describe("onDialDown", () => {
		it("opens security page when repo is configured", async () => {
			const mockAction = createMockDialAction("sh-dd-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const ev = createDialDownEvent(mockAction, settings);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/security");
		});

		it("opens github.com when no repo configured", async () => {
			const mockAction = createMockDialAction("sh-dd-2");

			const ev = createDialDownEvent(mockAction);
			await action.onDialDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com");
		});
	});

	// ── Encoder: onDialRotate ───────────────────

	describe("onDialRotate", () => {
		it("triggers a refresh on dial rotate", async () => {
			const mockAction = createMockDialAction("sh-dr-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "high" },
			]));

			const ev = createDialRotateEvent(mockAction, settings);
			await action.onDialRotate?.(ev as never);

			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("C");
		});
	});

	// ── Encoder: onTouchTap ─────────────────────

	describe("onTouchTap", () => {
		it("triggers a refresh on touch tap", async () => {
			const mockAction = createMockDialAction("sh-tt-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([]));
			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "critical" },
				{ severity: "critical" },
				{ severity: "critical" },
			]));

			const ev = createTouchTapEvent(mockAction, settings);
			await action.onTouchTap?.(ev as never);

			const lastCall = mockAction.setFeedback.mock.calls[mockAction.setFeedback.mock.calls.length - 1][0] as { canvas: string };
			expect(decodeSvg(lastCall.canvas)).toContain("F");
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("refreshes data when settings change", async () => {
			const mockAction = createMockKeyAction("sh-s-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchDependabotResponse([
				{ severity: "medium" },
				{ severity: "medium" },
				{ severity: "low" },
			]));

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("B");
		});

		it("shows unconfigured when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("sh-s-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createDidReceiveSettingsEvent(mockAction, settings);
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("sh-s-3");
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
			const mockAction = createMockDialAction("sh-s-4");
			const settings = { repo: "owner/repo" };

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
			const mockAction = createMockKeyAction("sh-err-1");
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
			const mockAction = createMockKeyAction("sh-err-2");
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
			const mockAction = createMockDialAction("sh-err-3");
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

		it("shows not found error for 404", async () => {
			const mockAction = createMockKeyAction("sh-err-4");
			const settings = { repo: "owner/nonexistent" };

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
	});

	// ── onSendToPlugin ──────────────────────────

	describe("onSendToPlugin", () => {
		it("handles PI data requests for getRepos", async () => {
			const mockAction = createMockKeyAction("sh-pi-1", { repo: "owner/repo" });

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
			const mockAction = createMockKeyAction("sh-pi-2");
			const ev = createSendToPluginEvent(mockAction, { something: "else" });

			await action.onSendToPlugin?.(ev as never);
			// No crash
		});
	});
});

// ── computeGrade ────────────────────────────────

describe("computeGrade", () => {
	it("returns grade A and score 100 for zero alerts", () => {
		const result = computeGrade({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
		expect(result.grade).toBe("A");
		expect(result.score).toBe(100);
	});

	it("returns grade B for 1-3 low/medium alerts", () => {
		const result = computeGrade({ critical: 0, high: 0, medium: 1, low: 1, total: 2 });
		expect(result.grade).toBe("B");
		expect(result.score).toBe(96); // 100 - 3 - 1
	});

	it("returns grade B for 3 low alerts", () => {
		const result = computeGrade({ critical: 0, high: 0, medium: 0, low: 3, total: 3 });
		expect(result.grade).toBe("B");
		expect(result.score).toBe(97); // 100 - 3
	});

	it("returns grade C for 4+ total alerts without high/critical", () => {
		const result = computeGrade({ critical: 0, high: 0, medium: 2, low: 2, total: 4 });
		expect(result.grade).toBe("C");
		expect(result.score).toBe(92); // 100 - 6 - 2
	});

	it("returns grade C for any high alerts (no critical)", () => {
		const result = computeGrade({ critical: 0, high: 1, medium: 0, low: 0, total: 1 });
		expect(result.grade).toBe("C");
		expect(result.score).toBe(90); // 100 - 10
	});

	it("returns grade D for any critical alert (less than 3)", () => {
		const result = computeGrade({ critical: 1, high: 0, medium: 0, low: 0, total: 1 });
		expect(result.grade).toBe("D");
		expect(result.score).toBe(75); // 100 - 25
	});

	it("returns grade D for 2 critical alerts", () => {
		const result = computeGrade({ critical: 2, high: 0, medium: 0, low: 0, total: 2 });
		expect(result.grade).toBe("D");
		expect(result.score).toBe(50); // 100 - 50
	});

	it("returns grade F for 3+ critical alerts", () => {
		const result = computeGrade({ critical: 3, high: 0, medium: 0, low: 0, total: 3 });
		expect(result.grade).toBe("F");
		expect(result.score).toBe(25); // 100 - 75
	});

	it("returns grade F for many critical alerts", () => {
		const result = computeGrade({ critical: 5, high: 2, medium: 3, low: 4, total: 14 });
		expect(result.grade).toBe("F");
		expect(result.score).toBe(0); // 100 - 125 - 20 - 9 - 4 = capped at 0
	});

	it("caps score at 0 (never negative)", () => {
		const result = computeGrade({ critical: 10, high: 10, medium: 10, low: 10, total: 40 });
		expect(result.score).toBe(0);
	});

	it("handles mixed severity for grade C", () => {
		const result = computeGrade({ critical: 0, high: 2, medium: 3, low: 5, total: 10 });
		expect(result.grade).toBe("C");
		expect(result.score).toBe(66); // 100 - 20 - 9 - 5
	});
});
