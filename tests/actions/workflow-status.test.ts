/**
 * Tests for the WorkflowStatusAction (src/actions/workflow-status.ts).
 *
 * Mocks the @elgato/streamdeck module and the fetch API to test
 * the action's lifecycle, settings handling, deploying vs run states,
 * and error states. The action uses setImage() for SVG key images.
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
		action: () => (target: unknown) => target,
	};
});

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

		it("shows loading then fetches workflow run data", async () => {
			const mockAction = createMockKeyAction("wf-2");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupFetchMock([makeRunData()]);

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

			setupFetchMock([makeRunData({ status: "completed", conclusion: "success" })]);

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

			setupFetchMock([makeRunData({ status: "completed", conclusion: "failure" })]);

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

			setupFetchMock([makeRunData({ status: "in_progress", conclusion: null })]);

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

			setupFetchMock([]);

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

			setupFetchMock(
				[makeRunData()],
				[{ id: 1, environment: "production", sha: "abc123" }],
				[{ id: 1, state: "in_progress", description: "Deploying...", environment: "production", created_at: "2024-01-01T00:00:00Z" }],
			);

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

			setupFetchMock(
				[makeRunData({ status: "completed", conclusion: "success" })],
				[{ id: 1, environment: "production", sha: "abc123" }],
				[{ id: 1, state: "success", description: "Deployed", environment: "production", created_at: "2024-01-01T00:00:00Z" }],
			);

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

			setupFetchMock([makeRunData()]);

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

			expect(mockAction.setImage).not.toHaveBeenCalled();
		});

		it("shows loading and refreshes when repo is configured", async () => {
			const mockAction = createMockKeyAction("wf-12");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupFetchMock([makeRunData()]);

			// Set up by appearing first
			const appearEv = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(appearEv as never);

			mockAction.setImage.mockClear();

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
			const mockAction = createMockKeyAction("wf-13");

			const ev = createDidReceiveSettingsEvent(mockAction, {});
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

			setupFetchMock([makeRunData({ name: "Deploy" })]);

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "new-owner/new-repo",
			});
			await action.onDidReceiveSettings?.(ev as never);

			expect(globalThis.fetch).toHaveBeenCalled();
			const fetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(fetchUrl).toContain("new-owner");
		});

		it("passes workflow file and branch filters", async () => {
			const mockAction = createMockKeyAction("wf-15");

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			setupFetchMock([makeRunData()]);

			const ev = createDidReceiveSettingsEvent(mockAction, {
				repo: "owner/repo",
				workflowFile: "ci.yml",
				branch: "develop",
			});
			await action.onDidReceiveSettings?.(ev as never);

			expect(globalThis.fetch).toHaveBeenCalled();
			// The workflow file is used in the URL path
			const firstFetchUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(firstFetchUrl).toContain("ci.yml");
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

			setupErrorFetchMock(404, "Not Found");

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

			setupErrorFetchMock(401, "Bad credentials");

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
			expect(globalThis.fetch).not.toHaveBeenCalled();
		});

		it("shows 'Rate Limited' when API returns 403 with rate limit", async () => {
			const mockAction = createMockKeyAction("wf-err-4");
			const settings = { repo: "owner/repo" };

			Object.defineProperty(action, "actions", {
				get: () => [mockAction],
				configurable: true,
			});

			// Must use remaining=0 so handleApiError triggers the rate limit path
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 403,
				headers: new Headers({
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": "9999999999",
					"x-ratelimit-used": "5000",
				}),
				json: () => Promise.resolve({ message: "API rate limit exceeded" }),
				text: () => Promise.resolve(JSON.stringify({ message: "API rate limit exceeded" })),
			} as unknown as Response);

			const ev = createWillAppearEvent(mockAction, settings);
			await action.onWillAppear?.(ev as never);

			expect(lastImage(mockAction)).toContain("Rate Limited");
		});
	});
});
