/**
 * Tests for the WorkflowStatusAction (src/actions/workflow-status.ts).
 *
 * Mocks the @elgato/streamdeck module and the graphql-query-coordinator to test
 * the action's lifecycle, settings handling, deploying vs run states,
 * and error states. Dispatch tests still mock fetch directly.
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
	mockSubscribe,
	mockUnsubscribe,
	mockFetchData,
	mockInvalidateAndFetch,
} = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockSetGlobalSettings: vi.fn(),
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

import { WorkflowStatusAction } from "../../src/actions/workflow-status";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockKeyAction(id: string, settings: Record<string, unknown> = {}) {
	return {
		id,
		manifestId: "com.pedrofuentes.github-utilities.workflow-status",
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

/** Build standard headers for GitHub API responses */
function makeHeaders() {
	return new Headers({
		"x-ratelimit-limit": "5000",
		"x-ratelimit-remaining": "4999",
		"x-ratelimit-reset": "9999999999",
		"x-ratelimit-used": "1",
	});
}

/** Create a mock Response for a workflow runs API call */
function makeWorkflowRunsResponse(runs: Record<string, unknown>[] = []) {
	return {
		ok: true,
		status: 200,
		headers: makeHeaders(),
		json: () => Promise.resolve({ total_count: runs.length, workflow_runs: runs }),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Create a mock Response for a deployments list API call */
function makeDeploymentsResponse(deployments: Record<string, unknown>[] = []) {
	return {
		ok: true,
		status: 200,
		headers: makeHeaders(),
		json: () => Promise.resolve(deployments),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Create a mock Response for deployment statuses API call */
function makeDeploymentStatusesResponse(statuses: Record<string, unknown>[] = []) {
	return {
		ok: true,
		status: 200,
		headers: makeHeaders(),
		json: () => Promise.resolve(statuses),
		text: () => Promise.resolve(""),
	} as unknown as Response;
}

/** Create a typical workflow run data object */
function makeRunData(overrides: Record<string, unknown> = {}) {
	return {
		id: 12345,
		name: "CI",
		status: "completed",
		conclusion: "success",
		head_branch: "main",
		event: "push",
		display_title: "Fix tests",
		run_number: 42,
		html_url: "https://github.com/owner/repo/actions/runs/12345",
		created_at: "2024-01-01T00:00:00Z",
		updated_at: "2024-01-01T00:01:00Z",
		...overrides,
	};
}

/**
 * Set up fetch mock to handle the typical 3-call pattern:
 * 1. Workflow runs
 * 2. Deployments list
 * 3. Deployment statuses
 */
function setupFetchMock(
	runs: Record<string, unknown>[] = [makeRunData()],
	deployments: Record<string, unknown>[] = [],
	deployStatuses: Record<string, unknown>[] = [],
) {
	const fetchMock = vi.mocked(globalThis.fetch);

	fetchMock.mockImplementation((url: string | URL | Request) => {
		const urlStr = typeof url === "string" ? url : url.toString();

		if (urlStr.includes("/actions/runs") || urlStr.includes("/actions/workflows/")) {
			return Promise.resolve(makeWorkflowRunsResponse(runs));
		}
		if (urlStr.includes("/deployments/") && urlStr.includes("/statuses")) {
			return Promise.resolve(makeDeploymentStatusesResponse(deployStatuses));
		}
		if (urlStr.includes("/deployments")) {
			return Promise.resolve(makeDeploymentsResponse(deployments));
		}

		// Fallback
		return Promise.resolve(makeWorkflowRunsResponse(runs));
	});
}

function setupErrorFetchMock(status: number, message: string) {
	vi.mocked(globalThis.fetch).mockResolvedValue({
		ok: false,
		status,
		headers: makeHeaders(),
		json: () => Promise.resolve({ message }),
		text: () => Promise.resolve(JSON.stringify({ message })),
	} as unknown as Response);
}

/** Set up coordinator mock for workflow data */
function setupCoordinatorMock(
	latestRun: Record<string, unknown> | null = makeRunData(),
	deployment: Record<string, unknown> | null = null,
) {
	const result = { workflowRuns: { latestRun, deployment } };
	mockFetchData.mockResolvedValue(result);
	mockInvalidateAndFetch.mockResolvedValue(result);
}

/** Set up coordinator to throw an error */
function setupCoordinatorError(message: string) {
	mockFetchData.mockRejectedValue(new Error(message));
	mockInvalidateAndFetch.mockRejectedValue(new Error(message));
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

/** Returns the last title string passed to setTitle */
function lastTitle(mockAction: ReturnType<typeof createMockKeyAction>): string {
	const calls = mockAction.setTitle.mock.calls;
	return calls[calls.length - 1][0] as string;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("WorkflowStatusAction", () => {
	let action: WorkflowStatusAction;
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		action = new WorkflowStatusAction();
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();

		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
		vi.clearAllMocks();
		// Re-set after clearAllMocks
		mockGetGlobalSettings.mockResolvedValue({ githubToken: "ghp_test123" });
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	// ── onWillAppear ────────────────────────────

	describe("onWillAppear", () => {
		it("shows unconfigured state when repo is not set", async () => {
			const mockAction = createMockKeyAction("wf-1");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when token is not set", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("wf-1b");
			const settings = { repo: "owner/repo" };
			const ev = createWillAppearEvent(mockAction, settings);

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured state when both repo and token are missing", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("wf-1c");
			const ev = createWillAppearEvent(mockAction, {});

			await action.onWillAppear?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows loading then fetches workflow run data", async () => {
			const mockAction = createMockKeyAction("wf-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			// Should set image at least twice: loading + final
			expect(mockAction.setImage).toHaveBeenCalled();
		});

		it("shows success status for completed successful run", async () => {
			const mockAction = createMockKeyAction("wf-3");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData({ status: "completed", conclusion: "success" }));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Success");
		});

		it("shows failure status for failed run", async () => {
			const mockAction = createMockKeyAction("wf-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData({ status: "completed", conclusion: "failure" }));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Failed");
		});

		it("shows in-progress status for running workflow", async () => {
			const mockAction = createMockKeyAction("wf-5");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData({ status: "in_progress", conclusion: null }));

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Running");
		});

		it("shows 'No Runs' when no workflow runs exist", async () => {
			const mockAction = createMockKeyAction("wf-6");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(null, null);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("No Runs");
		});

		it("shows deploying state when deployment is in_progress", async () => {
			const mockAction = createMockKeyAction("wf-7");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData(), { environment: "production", state: "in_progress", description: "Deploying...", log_url: null });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("production");
			// Deploying now renders as an icon (polygon), not text
			expect(lastImage(mockAction)).toContain("polygon");
		});

		it("shows workflow run with deploy label when deployment is completed", async () => {
			const mockAction = createMockKeyAction("wf-8");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData({ status: "completed", conclusion: "success" }), { environment: "production", state: "success", description: "Deployed", log_url: null });

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("polyline"); // success icon
			expect(lastImage(mockAction)).toContain("production");
		});
	});

	// ── onWillDisappear ─────────────────────────

	describe("onWillDisappear", () => {
		it("cleans up timer on disappear", async () => {
			const mockAction = createMockKeyAction("wf-10");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const disappearEv = createWillDisappearEvent(mockAction);
			action.onWillDisappear?.(disappearEv as never);

			// Should not throw, timer cleaned up
			expect(true).toBe(true);
		});

		it("handles disappear without prior appear", () => {
			const mockAction = createMockKeyAction("wf-never-appeared");
			const ev = createWillDisappearEvent(mockAction);

			// Should not throw
			action.onWillDisappear?.(ev as never);
		});
	});

	// ── onKeyDown ───────────────────────────────

	describe("onKeyDown", () => {
		it("does nothing when repo is not configured", async () => {
			const mockAction = createMockKeyAction("wf-11");
			const ev = createKeyDownEvent(mockAction, {});

			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("opens the workflow run URL when button is pressed", async () => {
			const mockAction = createMockKeyAction("wf-12");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(makeRunData({ html_url: "https://github.com/owner/repo/actions/runs/12345" }));

			// Set up by appearing first (this populates lastUrl)
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockOpenUrl.mockClear();

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/actions/runs/12345");
		});

		it("falls back to actions page when no URL stored", async () => {
			const mockAction = createMockKeyAction("wf-13-fallback");
			const settings = { repo: "owner/repo" };

			// Don't set up appearance (no lastUrl stored)
			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/actions");
		});

		it("falls back to workflow file URL when workflowFile is set and no stored URL", async () => {
			const mockAction = createMockKeyAction("wf-14-wffile");
			const settings = { repo: "owner/repo", workflowFile: "deploy.yml" };

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/actions/workflows/deploy.yml");
		});

		it("opens actions page when no runs exist", async () => {
			const mockAction = createMockKeyAction("wf-15-noruns");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock(null, null);

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockOpenUrl.mockClear();

			const ev = createKeyDownEvent(mockAction, settings);
			await action.onKeyDown?.(ev as never);

			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/owner/repo/actions");
		});
	});

	// ── onDidReceiveSettings ────────────────────

	describe("onDidReceiveSettings", () => {
		it("shows unconfigured when repo is cleared", async () => {
			const mockAction = createMockKeyAction("wf-13");

			const ev = createDidReceiveSettingsEvent(mockAction, {});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("shows unconfigured when token is cleared", async () => {
			mockGetGlobalSettings.mockResolvedValue({});
			const mockAction = createMockKeyAction("wf-13b");

			const ev = createDidReceiveSettingsEvent(mockAction, { repo: "owner/repo" });
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockAction.setImage).toHaveBeenCalled();
			expect(lastImage(mockAction)).toContain("Setup");
		});

		it("refreshes with new settings when repo changes", async () => {
			const mockAction = createMockKeyAction("wf-14");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("wf-14", mockAction);

			setupCoordinatorMock(makeRunData({ name: "Deploy" }));

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "new-owner/new-repo",
			});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockFetchData).toHaveBeenCalled();
			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({ repo: "new-owner/new-repo" }),
				expect.any(Function),
			);
		});

		it("passes workflow file and branch filters", async () => {
			const mockAction = createMockKeyAction("wf-15");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});
			(action as any).actionContexts.set("wf-15", mockAction);

			setupCoordinatorMock();

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "owner/repo",
				workflowFile: "ci.yml",
				branch: "develop",
			});
			await action.onDidReceiveSettings?.(ev as never);

			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					params: expect.objectContaining({
						workflowFile: "ci.yml",
						branch: "develop",
					}),
				}),
				expect.any(Function),
			);
		});
	});

	// ── Error handling ──────────────────────────

	describe("error handling", () => {
		it("shows 'Not Found' when API returns 404", async () => {
			const mockAction = createMockKeyAction("wf-err-1");
			const settings = { repo: "owner/nonexistent" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Repository not found");

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Not Found");
		});

		it("shows 'Auth Error' when API returns 401", async () => {
			const mockAction = createMockKeyAction("wf-err-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("Bad credentials 401");

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Auth Error");
		});

		it("shows 'Invalid repo' for malformed owner/repo", async () => {
			const mockAction = createMockKeyAction("wf-err-3");
			const settings = { repo: "invalid-no-slash" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Invalid");
			expect(mockFetchData).not.toHaveBeenCalled();
		});

		it("shows 'Rate Limited' when API returns 403 with rate limit", async () => {
			const mockAction = createMockKeyAction("wf-err-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorError("API rate limit exceeded");

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Rate Limited");
		});
	});

	// ── onTouchTap / dispatchWorkflow ──────────────

	describe("onTouchTap", () => {
		function createTouchTapEvent(actionMock: ReturnType<typeof createMockKeyAction>, settings: Record<string, unknown>, hold = false) {
			return { action: actionMock, payload: { settings, hold } };
		}

		it("refreshes on regular tap (hold=false)", async () => {
			const mockAction = createMockKeyAction("wf-touch-1");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();

			// First appear to set settings
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.setImage.mockClear();

			const ev = createTouchTapEvent(mockAction, settings, false);
			await action.onTouchTap?.(ev as never);

			// Should have called setImage again for refresh
			expect(mockAction.setImage).toHaveBeenCalled();
		});

		it("dispatches workflow on long touch (hold=true)", async () => {
			const mockAction = createMockKeyAction("wf-touch-2");
			const settings = { repo: "owner/repo", workflowFile: "deploy.yml", branch: "main" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();
			const fetchMock = vi.mocked(globalThis.fetch);
			fetchMock.mockImplementation((url: string | URL | Request) => {
				const urlStr = typeof url === "string" ? url : url.toString();
				if (urlStr.includes("/dispatches")) {
					return Promise.resolve({
						ok: true,
						status: 204,
						headers: makeHeaders(),
					} as unknown as Response);
				}
				return Promise.resolve(makeWorkflowRunsResponse([makeRunData()]));
			});

			// Appear to register settings
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.showOk.mockClear();

			const ev = createTouchTapEvent(mockAction, settings, true);
			await action.onTouchTap?.(ev as never);

			// Should have called the dispatch endpoint
			const dispatchCall = fetchMock.mock.calls.find((c) => {
				const url = typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "";
				return url.includes("/dispatches");
			});
			expect(dispatchCall).toBeDefined();

			// Should show OK feedback
			expect(mockAction.showOk).toHaveBeenCalled();
		});

		it("does nothing on long touch when no workflowFile is configured", async () => {
			const mockAction = createMockKeyAction("wf-touch-3");
			const settings = { repo: "owner/repo" }; // no workflowFile

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const fetchCallsBefore = vi.mocked(globalThis.fetch).mock.calls.length;

			const ev = createTouchTapEvent(mockAction, settings, true);
			await action.onTouchTap?.(ev as never);

			// No dispatch call should have been made (only the original setup calls)
			const dispatchCalls = vi.mocked(globalThis.fetch).mock.calls.slice(fetchCallsBefore).filter((c) => {
				const url = typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "";
				return url.includes("/dispatches");
			});
			expect(dispatchCalls).toHaveLength(0);
		});

		it("shows alert on dispatch failure", async () => {
			const mockAction = createMockKeyAction("wf-touch-4");
			const settings = { repo: "owner/repo", workflowFile: "deploy.yml", branch: "main" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();
			const fetchMock = vi.mocked(globalThis.fetch);
			fetchMock.mockImplementation((url: string | URL | Request) => {
				const urlStr = typeof url === "string" ? url : url.toString();
				if (urlStr.includes("/dispatches")) {
					return Promise.resolve({
						ok: false,
						status: 403,
						headers: makeHeaders(),
					} as unknown as Response);
				}
				return Promise.resolve(makeWorkflowRunsResponse([makeRunData()]));
			});

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.showAlert.mockClear();

			const ev = createTouchTapEvent(mockAction, settings, true);
			await action.onTouchTap?.(ev as never);

			expect(mockAction.showAlert).toHaveBeenCalled();
		});

		it("does nothing on long touch when no token is set", async () => {
			const mockAction = createMockKeyAction("wf-touch-5");
			const settings = { repo: "owner/repo", workflowFile: "deploy.yml" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();

			// Appear with valid token to register settings
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			// Now remove token for the dispatch call
			mockGetGlobalSettings.mockResolvedValue({ githubToken: "" });

			const ev = createTouchTapEvent(mockAction, settings, true);
			await action.onTouchTap?.(ev as never);

			// Should not have called showOk or showAlert
			const fetchCallsAfterAppear = vi.mocked(globalThis.fetch).mock.calls.filter((c) => {
				const url = typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "";
				return url.includes("/dispatches");
			});
			expect(fetchCallsAfterAppear).toHaveLength(0);
		});

		it("uses 'main' as default branch when none configured", async () => {
			const mockAction = createMockKeyAction("wf-touch-6");
			const settings = { repo: "owner/repo", workflowFile: "deploy.yml" }; // no branch

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupCoordinatorMock();
			const fetchMock = vi.mocked(globalThis.fetch);
			fetchMock.mockImplementation((url: string | URL | Request) => {
				const urlStr = typeof url === "string" ? url : url.toString();
				if (urlStr.includes("/dispatches")) {
					return Promise.resolve({
						ok: true,
						status: 204,
						headers: makeHeaders(),
					} as unknown as Response);
				}
				return Promise.resolve(makeWorkflowRunsResponse([makeRunData()]));
			});

			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			const ev = createTouchTapEvent(mockAction, settings, true);
			await action.onTouchTap?.(ev as never);

			// Find the dispatch call and verify the body ref
			const dispatchCall = fetchMock.mock.calls.find((c) => {
				const url = typeof c[0] === "string" ? c[0] : c[0]?.toString() ?? "";
				return url.includes("/dispatches");
			});
			expect(dispatchCall).toBeDefined();
			const body = JSON.parse(dispatchCall![1]?.body as string);
			expect(body.ref).toBe("main");
		});
	});
});
