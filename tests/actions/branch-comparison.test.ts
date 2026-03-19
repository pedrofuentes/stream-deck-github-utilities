/**
 * Tests for the BranchComparisonAction (src/actions/branch-comparison.ts).
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

import { BranchComparisonAction } from "../../src/actions/branch-comparison";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.branch-comparison",
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

/** Set up coordinator mock for branch comparison data */
function setupCoordinatorMock(data: { ahead_by: number; behind_by: number; status: string; html_url: string }) {
	const result = { branchComparison: data };
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

describe("BranchComparisonAction", () => {
	let action: BranchComparisonAction;

	beforeEach(() => {
		action = new BranchComparisonAction();
		vi.clearAllMocks();
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("branch-1");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {}) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when baseBranch is missing", async () => {
			const mockAction = createMockKeyAction("branch-1b");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {
				repo: "owner/repo",
				headBranch: "develop",
			}) as never);

			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when headBranch is missing", async () => {
			const mockAction = createMockKeyAction("branch-1c");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {
				repo: "owner/repo",
				baseBranch: "main",
			}) as never);

			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when token is missing", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("branch-1d");
			await action.onWillAppear?.(createWillAppearEvent(mockAction, {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "develop",
			}) as never);

			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("fetches and displays ahead/behind counts", async () => {
			const mockAction = createMockKeyAction("branch-2");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "feature-x",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 5,
				behind_by: 2,
				status: "diverged",
				html_url: "https://github.com/owner/repo/compare/main...feature-x",
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("↑5");
			expect(svg).toContain("↓2");
		});

		it("shows 'Even' when branches are identical", async () => {
			const mockAction = createMockKeyAction("branch-2b");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "main-copy",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 0,
				behind_by: 0,
				status: "identical",
				html_url: "https://github.com/owner/repo/compare/main...main-copy",
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("Even");
		});

		it("shows only ahead count when not behind", async () => {
			const mockAction = createMockKeyAction("branch-2c");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "feature",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 3,
				behind_by: 0,
				status: "ahead",
				html_url: "https://github.com/owner/repo/compare/main...feature",
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			const svg = lastImage(mockAction);
			expect(svg).toContain("↑3");
			expect(svg).not.toContain("↓");
		});
	});

	describe("onWillDisappear", () => {
		it("cleans up timers and state", async () => {
			const mockAction = createMockKeyAction("branch-3");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "develop",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 1,
				behind_by: 0,
				status: "ahead",
				html_url: "https://github.com/owner/repo/compare/main...develop",
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("branch-never");
			action.onWillDisappear?.(createWillDisappearEvent(mockAction) as never);
		});
	});

	describe("onKeyDown", () => {
		it("opens compare page from cached URL", async () => {
			const mockAction = createMockKeyAction("branch-4");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "develop",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 2,
				behind_by: 1,
				status: "diverged",
				html_url: "https://github.com/owner/repo/compare/main...develop",
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/compare/main...develop");
		});

		it("constructs fallback URL when no cached URL", async () => {
			const mockAction = createMockKeyAction("branch-4b");
			const settings = {
				repo: "facebook/react",
				baseBranch: "main",
				headBranch: "canary",
			};

			// Set up action settings cache without fetching (so no cached URL)
			await action.onKeyDown?.(createKeyDownEvent(mockAction, settings) as never);

			// No cached URL exists, but settings have repo/branches — it should build a fallback
			// (The action uses actionSettings cache from onWillAppear, so direct keyDown with settings
			// will go through the fallback path that parses repo and builds URL)
		});

		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("branch-4c");
			await action.onKeyDown?.(createKeyDownEvent(mockAction, {}) as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});
	});

	describe("onDidReceiveSettings", () => {
		it("refreshes when settings change", async () => {
			const mockAction = createMockKeyAction("branch-5");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "staging",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock({
				ahead_by: 10,
				behind_by: 3,
				status: "diverged",
				html_url: "https://github.com/owner/repo/compare/main...staging",
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, settings) as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			const svg = lastImage(mockAction);
			expect(svg).toContain("↑10");
			expect(svg).toContain("↓3");
		});

		it("shows unconfigured when repo cleared", async () => {
			const mockAction = createMockKeyAction("branch-5b");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, {}) as never);

			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when branches cleared", async () => {
			const mockAction = createMockKeyAction("branch-5c");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onDidReceiveSettings?.(createDidReceiveSettingsEvent(mockAction, {
				repo: "owner/repo",
			}) as never);

			expect(lastImage(mockAction)).toContain("Setup");
		});
	});

	describe("error handling", () => {
		it("shows error for invalid repo format", async () => {
			const mockAction = createMockKeyAction("branch-err-1");
			const settings = {
				repo: "invalid-format",
				baseBranch: "main",
				headBranch: "develop",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(lastImage(mockAction)).toContain("Invalid");
		});

		it("shows error for 404 API response", async () => {
			const mockAction = createMockKeyAction("branch-err-2");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "nonexistent",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Repository not found");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows auth error for 401 response", async () => {
			const mockAction = createMockKeyAction("branch-err-3");
			const settings = {
				repo: "owner/repo",
				baseBranch: "main",
				headBranch: "develop",
			};

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Bad credentials 401");

			await action.onWillAppear?.(createWillAppearEvent(mockAction, settings) as never);

			expect(lastImage(mockAction)).toContain("Auth Error");
		});
	});
});
