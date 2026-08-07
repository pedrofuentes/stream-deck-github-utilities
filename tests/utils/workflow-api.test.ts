/**
 * Tests for the workflow-related GitHub API functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	fetchLatestWorkflowRun,
	fetchLatestDeploymentStatus,
	fetchPendingDeployments,
	fetchWorkflowInfo,
	triggerWorkflowDispatch,
	getWorkflowDisplayStatus,
	getWorkflowStatusLabel,
	GitHubApiError,
	type WorkflowRun,
} from "../../src/utils/github-api";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeHeaders(overrides?: Record<string, string>): Headers {
	return new Headers({
		"x-ratelimit-limit": "5000",
		"x-ratelimit-remaining": "4999",
		"x-ratelimit-reset": "9999999999",
		"x-ratelimit-used": "1",
		...overrides,
	});
}

function mockFetchResponse(data: unknown, status = 200, ok = true, headers?: Headers) {
	return {
		ok,
		status,
		headers: headers ?? makeHeaders(),
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data)),
	} as unknown as Response;
}

function makeWorkflowRunData(overrides?: Record<string, unknown>) {
	return {
		id: 12345,
		name: "CI",
		status: "completed",
		conclusion: "success",
		head_branch: "main",
		event: "push",
		display_title: "Update README",
		run_number: 42,
		html_url: "https://github.com/owner/repo/actions/runs/12345",
		created_at: "2024-01-15T10:00:00Z",
		updated_at: "2024-01-15T10:05:00Z",
		...overrides,
	};
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("Workflow API", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	// ── fetchLatestWorkflowRun ──────────────────

	describe("fetchLatestWorkflowRun", () => {
		it("fetches the latest workflow run for a repository", async () => {
			const runData = makeWorkflowRunData();
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 1, workflow_runs: [runData] }),
			);

			const result = await fetchLatestWorkflowRun("owner", "repo", "ghp_test");

			expect(result).not.toBeNull();
			expect(result!.id).toBe(12345);
			expect(result!.name).toBe("CI");
			expect(result!.status).toBe("completed");
			expect(result!.conclusion).toBe("success");
			expect(result!.head_branch).toBe("main");
			expect(result!.run_number).toBe(42);
		});

		it("returns null when no workflow runs exist", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			const result = await fetchLatestWorkflowRun("owner", "repo", "ghp_test");
			expect(result).toBeNull();
		});

		it("uses correct URL for all-workflows query", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("owner", "repo", "ghp_test");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("/repos/owner/repo/actions/runs");
			expect(url).toContain("per_page=1");
		});

		it("uses correct URL when workflow file is specified", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("owner", "repo", "ghp_test", undefined, "deploy.yml");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("/actions/workflows/deploy.yml/runs");
		});

		it("appends branch filter when specified", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("owner", "repo", "ghp_test", "main");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("branch=main");
		});

		it("includes auth header when token is provided", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("owner", "repo", "ghp_testtoken123");

			const fetchOpts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
			const headers = fetchOpts.headers as Record<string, string>;
			expect(headers["Authorization"]).toBe("Bearer ghp_testtoken123");
		});

		it("includes API version header", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("owner", "repo", "ghp_test");

			const fetchOpts = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
			const headers = fetchOpts.headers as Record<string, string>;
			expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
		});

		it("throws GitHubApiError on 401 Unauthorized", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Bad credentials" }, 401, false),
			);

			await expect(fetchLatestWorkflowRun("owner", "repo", "bad_token")).rejects.toThrow(
				GitHubApiError,
			);
			await expect(fetchLatestWorkflowRun("owner", "repo", "bad_token")).rejects.toThrow(
				/Invalid or expired/,
			);
		});

		it("throws GitHubApiError on 403 rate limit", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse(
					{ message: "rate limit" },
					403,
					false,
					makeHeaders({ "x-ratelimit-remaining": "0" }),
				),
			);

			await expect(fetchLatestWorkflowRun("owner", "repo", "ghp_test")).rejects.toThrow(
				/rate limit exceeded/,
			);
		});

		it("throws GitHubApiError on 403 access denied", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Forbidden" }, 403, false),
			);

			await expect(fetchLatestWorkflowRun("owner", "repo", "ghp_test")).rejects.toThrow(
				/Access denied/,
			);
		});

		it("throws GitHubApiError on 404 Not Found", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Not Found" }, 404, false),
			);

			await expect(fetchLatestWorkflowRun("owner", "repo", "ghp_test")).rejects.toThrow(
				/not found or is private/,
			);
		});

		it("throws GitHubApiError on 500 Server Error", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Internal Server Error" }, 500, false),
			);

			await expect(fetchLatestWorkflowRun("owner", "repo", "ghp_test")).rejects.toThrow(
				GitHubApiError,
			);
		});

		it("handles in_progress workflow run", async () => {
			const runData = makeWorkflowRunData({ status: "in_progress", conclusion: null });
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 1, workflow_runs: [runData] }),
			);

			const result = await fetchLatestWorkflowRun("owner", "repo", "ghp_test");
			expect(result!.status).toBe("in_progress");
			expect(result!.conclusion).toBeNull();
		});

		it("URL-encodes special characters in owner and repo", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ total_count: 0, workflow_runs: [] }),
			);

			await fetchLatestWorkflowRun("my org", "my repo", "ghp_test");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("my%20org");
			expect(url).toContain("my%20repo");
		});
	});

	// ── fetchLatestDeploymentStatus ─────────────

	describe("fetchLatestDeploymentStatus", () => {
		it("fetches latest deployment with its status", async () => {
			// First call: list deployments, second call: deployment statuses
			vi.mocked(globalThis.fetch)
				.mockResolvedValueOnce(
					mockFetchResponse([
						{
							id: 100,
							environment: "production",
							description: "Deploy to prod",
							created_at: "2024-01-15T10:00:00Z",
						},
					]),
				)
				.mockResolvedValueOnce(
					mockFetchResponse([
						{
							state: "success",
							description: "Deployment finished",
							environment: "production",
							created_at: "2024-01-15T10:05:00Z",
							log_url: "https://example.com/logs",
						},
					]),
				);

			const result = await fetchLatestDeploymentStatus("owner", "repo", "ghp_test");

			expect(result).not.toBeNull();
			expect(result!.id).toBe(100);
			expect(result!.state).toBe("success");
			expect(result!.environment).toBe("production");
			expect(result!.log_url).toBe("https://example.com/logs");
		});

		it("returns null when no deployments exist", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

			const result = await fetchLatestDeploymentStatus("owner", "repo", "ghp_test");
			expect(result).toBeNull();
		});

		it("returns pending status when deployment has no statuses", async () => {
			vi.mocked(globalThis.fetch)
				.mockResolvedValueOnce(
					mockFetchResponse([
						{
							id: 200,
							environment: "staging",
							description: "Deploy to staging",
							created_at: "2024-01-15T10:00:00Z",
						},
					]),
				)
				.mockResolvedValueOnce(mockFetchResponse([]));

			const result = await fetchLatestDeploymentStatus("owner", "repo", "ghp_test");

			expect(result).not.toBeNull();
			expect(result!.state).toBe("pending");
			expect(result!.environment).toBe("staging");
		});

		it("appends environment filter when specified", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

			await fetchLatestDeploymentStatus("owner", "repo", "ghp_test", "production");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("environment=production");
		});

		it("handles in_progress deployment status", async () => {
			vi.mocked(globalThis.fetch)
				.mockResolvedValueOnce(
					mockFetchResponse([
						{
							id: 300,
							environment: "production",
							description: "",
							created_at: "2024-01-15T10:00:00Z",
						},
					]),
				)
				.mockResolvedValueOnce(
					mockFetchResponse([
						{
							state: "in_progress",
							description: "Deploying...",
							environment: "production",
							created_at: "2024-01-15T10:01:00Z",
							log_url: "",
						},
					]),
				);

			const result = await fetchLatestDeploymentStatus("owner", "repo", "ghp_test");
			expect(result!.state).toBe("in_progress");
		});

		it("throws on 401 Unauthorized", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Bad credentials" }, 401, false),
			);

			await expect(
				fetchLatestDeploymentStatus("owner", "repo", "bad_token"),
			).rejects.toThrow(GitHubApiError);
		});
	});

	// ── fetchPendingDeployments ─────────────────

	describe("fetchPendingDeployments", () => {
		function makePending(overrides?: Record<string, unknown>) {
			return {
				environment: { id: 1, name: "prod" },
				wait_timer: 0,
				wait_timer_started_at: null,
				current_user_can_approve: true,
				reviewers: [{ type: "User", reviewer: { login: "sandrosuter" } }],
				...overrides,
			};
		}

		it("queries the run's pending_deployments endpoint", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

			await fetchPendingDeployments("owner", "repo", 12345, "ghp_test");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("/repos/owner/repo/actions/runs/12345/pending_deployments");
		});

		it("maps environment, approval right and reviewers", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([makePending()]));

			const result = await fetchPendingDeployments("owner", "repo", 1, "ghp_test");

			expect(result).toHaveLength(1);
			expect(result[0].environment).toBe("prod");
			expect(result[0].currentUserCanApprove).toBe(true);
			expect(result[0].reviewers).toEqual(["sandrosuter"]);
		});

		it("reads team reviewers, which carry name instead of login", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse([
					makePending({
						reviewers: [
							{ type: "Team", reviewer: { name: "platform" } },
							{ type: "User", reviewer: { login: "alice" } },
						],
					}),
				]),
			);

			const result = await fetchPendingDeployments("owner", "repo", 1, "ghp_test");

			expect(result[0].reviewers).toEqual(["platform", "alice"]);
		});

		it("returns an empty list when nothing is pending", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

			expect(await fetchPendingDeployments("owner", "repo", 1, "ghp_test")).toEqual([]);
		});

		it("reports several blocked environments in order", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse([
					makePending({ environment: { name: "prod" } }),
					makePending({ environment: { name: "demo" }, current_user_can_approve: false }),
				]),
			);

			const result = await fetchPendingDeployments("owner", "repo", 1, "ghp_test");

			expect(result.map((p) => p.environment)).toEqual(["prod", "demo"]);
			expect(result[1].currentUserCanApprove).toBe(false);
		});

		it("carries the wait timer through", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse([makePending({ wait_timer: 30, reviewers: [] })]),
			);

			const result = await fetchPendingDeployments("owner", "repo", 1, "ghp_test");

			expect(result[0].waitTimerMinutes).toBe(30);
			expect(result[0].reviewers).toEqual([]);
		});

		it("tolerates a missing reviewers array", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse([{ environment: { name: "prod" }, current_user_can_approve: false }]),
			);

			const result = await fetchPendingDeployments("owner", "repo", 1, "ghp_test");

			expect(result[0].reviewers).toEqual([]);
			expect(result[0].waitTimerMinutes).toBe(0);
		});

		it("throws on 403, which a token without the right scope gets", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Forbidden" }, 403, false),
			);

			await expect(
				fetchPendingDeployments("owner", "repo", 1, "ghp_test"),
			).rejects.toThrow(GitHubApiError);
		});
	});

	// ── fetchWorkflowInfo ───────────────────────

	describe("fetchWorkflowInfo", () => {
		it("fetches both workflow runs and deployments in parallel", async () => {
			const runData = makeWorkflowRunData();

			// Workflow runs call
			vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
				const urlStr = url as string;
				if (urlStr.includes("/actions/runs")) {
					return mockFetchResponse({ total_count: 1, workflow_runs: [runData] });
				}
				if (urlStr.includes("/deployments") && !urlStr.includes("/statuses")) {
					return mockFetchResponse([
						{ id: 100, environment: "production", description: "", created_at: "2024-01-15T10:00:00Z" },
					]);
				}
				if (urlStr.includes("/statuses")) {
					return mockFetchResponse([
						{ state: "success", description: "Done", environment: "production", created_at: "2024-01-15T10:05:00Z", log_url: "" },
					]);
				}
				return mockFetchResponse({});
			});

			const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");

			expect(info.latestRun).not.toBeNull();
			expect(info.latestRun!.name).toBe("CI");
			expect(info.deployment).not.toBeNull();
			expect(info.deployment!.state).toBe("success");
		});

		it("returns null for both when no data exists", async () => {
			vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
				const urlStr = url as string;
				if (urlStr.includes("/actions/runs")) {
					return mockFetchResponse({ total_count: 0, workflow_runs: [] });
				}
				return mockFetchResponse([]);
			});

			const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");
			expect(info.latestRun).toBeNull();
			expect(info.deployment).toBeNull();
			expect(info.pendingDeployments).toEqual([]);
		});

		// The pending-deployments lookup is an extra request, so it may only
		// happen for the one status that can actually be blocked.
		describe("pending deployments", () => {
			function mockRun(status: string) {
				vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
					const urlStr = url as string;
					if (urlStr.includes("/pending_deployments")) {
						return mockFetchResponse([
							{
								environment: { name: "prod" },
								current_user_can_approve: true,
								reviewers: [{ type: "User", reviewer: { login: "sandrosuter" } }],
							},
						]);
					}
					if (urlStr.includes("/actions/")) {
						return mockFetchResponse({
							total_count: 1,
							workflow_runs: [makeWorkflowRunData({ status, conclusion: null })],
						});
					}
					return mockFetchResponse([]);
				});
			}

			function pendingCalls(): string[] {
				return vi.mocked(globalThis.fetch).mock.calls
					.map((c) => c[0] as string)
					.filter((u) => u.includes("/pending_deployments"));
			}

			it("looks them up for a waiting run", async () => {
				mockRun("waiting");

				const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");

				expect(pendingCalls()).toHaveLength(1);
				expect(info.pendingDeployments).toHaveLength(1);
				expect(info.pendingDeployments[0].environment).toBe("prod");
			});

			it("skips the request for a completed run", async () => {
				mockRun("completed");

				const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");

				expect(pendingCalls()).toHaveLength(0);
				expect(info.pendingDeployments).toEqual([]);
			});

			it("skips the request for a queued run", async () => {
				mockRun("queued");

				await fetchWorkflowInfo("owner", "repo", "ghp_test");

				expect(pendingCalls()).toHaveLength(0);
			});

			it("still returns the run when the lookup fails", async () => {
				vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
					const urlStr = url as string;
					if (urlStr.includes("/pending_deployments")) {
						return mockFetchResponse({ message: "Forbidden" }, 403, false);
					}
					if (urlStr.includes("/actions/")) {
						return mockFetchResponse({
							total_count: 1,
							workflow_runs: [makeWorkflowRunData({ status: "waiting", conclusion: null })],
						});
					}
					return mockFetchResponse([]);
				});

				const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");

				expect(info.latestRun).not.toBeNull();
				expect(info.pendingDeployments).toEqual([]);
			});
		});

		it("propagates workflow run errors but catches deployment errors", async () => {
			vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
				const urlStr = url as string;
				if (urlStr.includes("/actions/runs")) {
					return mockFetchResponse({ message: "Server Error" }, 500, false);
				}
				return mockFetchResponse([]);
			});

			// Workflow run errors should propagate (not silently become null)
			await expect(fetchWorkflowInfo("owner", "repo", "ghp_test")).rejects.toThrow();
		});

		it("returns workflow run data when deployment fetch fails", async () => {
			const runData = makeWorkflowRunData();

			vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
				const urlStr = url as string;
				if (urlStr.includes("/actions/runs")) {
					return mockFetchResponse({ total_count: 1, workflow_runs: [runData] });
				}
				// Deployment calls fail
				return mockFetchResponse({ message: "Server Error" }, 500, false);
			});

			const info = await fetchWorkflowInfo("owner", "repo", "ghp_test");
			// Workflow run succeeds, deployment error caught gracefully
			expect(info.latestRun).not.toBeNull();
			expect(info.latestRun!.name).toBe("CI");
			expect(info.deployment).toBeNull();
		});

		it("passes options to underlying calls", async () => {
			vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
				const urlStr = url as string;
				if (urlStr.includes("/actions/workflows/deploy.yml")) {
					return mockFetchResponse({ total_count: 0, workflow_runs: [] });
				}
				if (urlStr.includes("/deployments") && !urlStr.includes("/statuses")) {
					return mockFetchResponse([]);
				}
				return mockFetchResponse({});
			});

			await fetchWorkflowInfo("owner", "repo", "ghp_test", {
				branch: "main",
				workflowFile: "deploy.yml",
				environment: "production",
			});

			const calls = vi.mocked(globalThis.fetch).mock.calls;
			const urls = calls.map((c) => c[0] as string);

			expect(urls.some((u) => u.includes("deploy.yml"))).toBe(true);
			expect(urls.some((u) => u.includes("branch=main"))).toBe(true);
			expect(urls.some((u) => u.includes("environment=production"))).toBe(true);
		});
	});

	// ── getWorkflowDisplayStatus ────────────────

	describe("getWorkflowDisplayStatus", () => {
		it("returns conclusion when status is completed and conclusion is set", () => {
			const run: WorkflowRun = {
				id: 1,
				name: "CI",
				status: "completed",
				conclusion: "failure",
				head_branch: "main",
				event: "push",
				display_title: "Test",
				run_number: 1,
				html_url: "",
				created_at: "",
				updated_at: "",
			};
			expect(getWorkflowDisplayStatus(run)).toBe("failure");
		});

		it("returns 'completed' when conclusion is null", () => {
			const run: WorkflowRun = {
				id: 1,
				name: "CI",
				status: "completed",
				conclusion: null,
				head_branch: "main",
				event: "push",
				display_title: "Test",
				run_number: 1,
				html_url: "",
				created_at: "",
				updated_at: "",
			};
			expect(getWorkflowDisplayStatus(run)).toBe("completed");
		});

		it("returns status when not completed", () => {
			const run: WorkflowRun = {
				id: 1,
				name: "CI",
				status: "in_progress",
				conclusion: null,
				head_branch: "main",
				event: "push",
				display_title: "Test",
				run_number: 1,
				html_url: "",
				created_at: "",
				updated_at: "",
			};
			expect(getWorkflowDisplayStatus(run)).toBe("in_progress");
		});

		it("returns queued status", () => {
			const run: WorkflowRun = {
				id: 1,
				name: "CI",
				status: "queued",
				conclusion: null,
				head_branch: "main",
				event: "push",
				display_title: "Test",
				run_number: 1,
				html_url: "",
				created_at: "",
				updated_at: "",
			};
			expect(getWorkflowDisplayStatus(run)).toBe("queued");
		});
	});

	// ── getWorkflowStatusLabel ──────────────────

	describe("getWorkflowStatusLabel", () => {
		it("returns 'Success' for success", () => {
			expect(getWorkflowStatusLabel("success")).toBe("Success");
		});

		it("returns 'Failed' for failure", () => {
			expect(getWorkflowStatusLabel("failure")).toBe("Failed");
		});

		it("returns 'Running' for in_progress", () => {
			expect(getWorkflowStatusLabel("in_progress")).toBe("Running");
		});

		it("returns 'Queued' for queued", () => {
			expect(getWorkflowStatusLabel("queued")).toBe("Queued");
		});

		it("returns 'Cancelled' for cancelled", () => {
			expect(getWorkflowStatusLabel("cancelled")).toBe("Cancelled");
		});

		it("returns 'Timed Out' for timed_out", () => {
			expect(getWorkflowStatusLabel("timed_out")).toBe("Timed Out");
		});

		it("returns 'Waiting' for waiting", () => {
			expect(getWorkflowStatusLabel("waiting")).toBe("Waiting");
		});

		it("returns 'Pending' for pending", () => {
			expect(getWorkflowStatusLabel("pending")).toBe("Pending");
		});

		it("returns raw status for unknown values", () => {
			expect(getWorkflowStatusLabel("custom_status")).toBe("custom_status");
		});
	});

	// ── triggerWorkflowDispatch ─────────────────

	describe("triggerWorkflowDispatch", () => {
		it("sends a POST request with correct URL and body", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 204,
				headers: makeHeaders(),
			} as unknown as Response);

			await triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test");

			expect(globalThis.fetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/owner/repo/actions/workflows/deploy.yml/dispatches",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ ref: "main" }),
					headers: expect.objectContaining({
						Authorization: "Bearer ghp_test",
						"Content-Type": "application/json",
					}),
				}),
			);
		});

		it("encodes owner, repo, and workflow file in URL", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 204,
				headers: makeHeaders(),
			} as unknown as Response);

			await triggerWorkflowDispatch("my org", "my repo", "ci build.yml", "main", "ghp_test");

			const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(calledUrl).toContain("my%20org");
			expect(calledUrl).toContain("my%20repo");
			expect(calledUrl).toContain("ci%20build.yml");
		});

		it("resolves without error on 204 success", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 204,
				headers: makeHeaders(),
			} as unknown as Response);

			await expect(
				triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test"),
			).resolves.toBeUndefined();
		});

		it("throws GitHubApiError with permission message on 403", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 403,
				headers: makeHeaders(),
			} as unknown as Response);

			await expect(
				triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test"),
			).rejects.toThrow(GitHubApiError);

			await expect(
				triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test"),
			).rejects.toThrow("Actions: Write permission");
		});

		it("throws GitHubApiError with status code on other errors", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 404,
				headers: makeHeaders(),
			} as unknown as Response);

			await expect(
				triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test"),
			).rejects.toThrow("404");
		});

		it("throws GitHubApiError with correct status property on 422", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 422,
				headers: makeHeaders(),
			} as unknown as Response);

			try {
				await triggerWorkflowDispatch("owner", "repo", "deploy.yml", "main", "ghp_test");
				expect.fail("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				expect((err as GitHubApiError).status).toBe(422);
			}
		});

		it("uses the provided ref in the request body", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 204,
				headers: makeHeaders(),
			} as unknown as Response);

			await triggerWorkflowDispatch("owner", "repo", "deploy.yml", "release/v2", "ghp_test");

			const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
			const body = JSON.parse(callArgs[1]?.body as string);
			expect(body.ref).toBe("release/v2");
		});
	});
});
