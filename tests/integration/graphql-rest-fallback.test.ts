/**
 * Integration tests: GraphQL failure → REST fallback equivalence
 *
 * Verifies that when the GraphQL API fails, the coordinator falls back
 * to REST API calls and produces equivalent data. Also tests stale cache
 * fallback when both APIs fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLQueryCoordinator } from "../../src/utils/graphql-query-coordinator";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import type { DataSubscription } from "../../src/types";
import {
	TOKEN,
	REPO,
	makeGraphQLRepoResponse,
	makeRESTRepoResponse,
	makeWorkflowInfo,
	makeWorkflowRun,
	makeBranchComparison,
	makeCommitActivityWeeks,
	mockResponse,
	mockErrorResponse,
} from "./fixtures";

vi.mock("@elgato/streamdeck", () => ({
	default: {
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
			trace: vi.fn(),
		},
	},
}));

function baseSub(overrides: Partial<DataSubscription> = {}): DataSubscription {
	return {
		actionId: "test-action-1",
		repo: REPO,
		fragments: ["repoMetadata"],
		maxAgeSec: 300,
		...overrides,
	};
}

describe("Coordinator: GraphQL failure → REST fallback", () => {
	let coordinator: GraphQLQueryCoordinator;
	let cache: RepoDataCache;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
		cache = new RepoDataCache();
		coordinator = new GraphQLQueryCoordinator(cache);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("falls back to REST when GraphQL returns HTTP 403", async () => {
		const restStats = makeRESTRepoResponse({ stargazers_count: 42500 });

		const fetchSpy = vi.spyOn(globalThis, "fetch")
			// First call: GraphQL fails with 403
			.mockResolvedValueOnce(mockErrorResponse(403))
			// Second call: REST fetchRepoStats succeeds
			.mockResolvedValueOnce(mockResponse(restStats))
			// Third call: REST fetchOpenPullRequestCount (search API)
			.mockResolvedValueOnce(mockResponse({ total_count: 120 }));

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		expect(result.repoMetadata!.stargazers_count).toBe(42500);
		// At least 2 calls: GraphQL attempt + REST fallback(s)
		expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("falls back to REST when GraphQL returns network error", async () => {
		const restStats = makeRESTRepoResponse({ stargazers_count: 99000 });

		vi.spyOn(globalThis, "fetch")
			// GraphQL: network error
			.mockRejectedValueOnce(new Error("Network error"))
			// REST fallback
			.mockResolvedValueOnce(mockResponse(restStats))
			.mockResolvedValueOnce(mockResponse({ total_count: 50 }));

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		expect(result.repoMetadata!.stargazers_count).toBe(99000);
	});

	it("uses stale cache when both GraphQL and REST fail", async () => {
		// Pre-populate cache with data, then invalidate it
		const graphqlResponse = makeGraphQLRepoResponse({ stargazerCount: 10000 });
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockResponse(graphqlResponse));

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"], maxAgeSec: 60 }));
		const firstResult = await coordinator.fetchData("test-action-1", TOKEN);
		expect(firstResult.repoMetadata!.stargazers_count).toBe(10000);

		// Advance time past maxAgeSec to make cache stale
		vi.advanceTimersByTime(61_000);

		// Now both GraphQL and REST fail with non-retryable errors
		// Use 403 for REST (non-retryable, so fetchWithRetry won't hang with fake timers)
		vi.restoreAllMocks();
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockErrorResponse(403)) // GraphQL 403
			.mockResolvedValueOnce(mockErrorResponse(404)) // REST fetchRepoStats 404
			.mockResolvedValueOnce(mockErrorResponse(404)); // REST fetchOpenPullRequestCount 404

		const result = await coordinator.fetchData("test-action-1", TOKEN);

		// Should return stale data as fallback
		expect(result.repoMetadata).toBeDefined();
		expect(result.repoMetadata!.stargazers_count).toBe(10000);
		expect(result.errors).toBeDefined();
		expect(result.errors!.repoMetadata).toContain("stale");
	});

	it("returns 'No data available' error when no cache and all APIs fail", async () => {
		// Use non-retryable errors (403/404) to avoid fetchWithRetry delays with fake timers
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockErrorResponse(403)) // GraphQL 403
			.mockResolvedValueOnce(mockErrorResponse(404)) // REST fetchRepoStats 404
			.mockResolvedValueOnce(mockErrorResponse(404)); // REST fetchOpenPullRequestCount 404

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeUndefined();
		expect(result.errors).toBeDefined();
		expect(result.errors!.repoMetadata).toContain("No data");
	});

	it("REST-only fragments (workflowRuns) fetch via REST directly", async () => {
		const workflowInfo = makeWorkflowInfo();
		// Workflow runs response (list)
		const fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse({
				workflow_runs: [{
					id: 12345,
					name: "CI",
					status: "completed",
					conclusion: "success",
					html_url: "https://github.com/facebook/react/actions/runs/12345",
					created_at: "2024-06-15T10:00:00Z",
					updated_at: "2024-06-15T10:05:00Z",
				}],
			}));

		coordinator.subscribe(baseSub({
			fragments: ["workflowRuns"],
			params: { workflowFile: "ci.yml" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.workflowRuns).toBeDefined();
		expect(result.workflowRuns!.latestRun).toBeDefined();
		expect(result.workflowRuns!.latestRun!.name).toBe("CI");
		// Should NOT have called GraphQL endpoint
		const urls = fetchSpy.mock.calls.map(c => String(c[0]));
		expect(urls.every(u => !u.includes("graphql"))).toBe(true);
	});

	it("REST-only branchComparison fetches directly", async () => {
		const comparison = makeBranchComparison({ ahead_by: 10, behind_by: 2 });
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse(comparison));

		coordinator.subscribe(baseSub({
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "develop" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.branchComparison).toBeDefined();
		expect(result.branchComparison!.ahead_by).toBe(10);
		expect(result.branchComparison!.behind_by).toBe(2);
	});

	it("REST-only commitActivity fetches directly", async () => {
		const weeks = makeCommitActivityWeeks();
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse(weeks));

		coordinator.subscribe(baseSub({ fragments: ["commitActivity"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.commitActivity).toBeDefined();
		expect(result.commitActivity).toHaveLength(2);
		expect(result.commitActivity![0].total).toBe(21);
	});

	it("mixed GraphQL + REST fragments: GraphQL fails, both get REST fallback", async () => {
		const restStats = makeRESTRepoResponse();

		vi.spyOn(globalThis, "fetch")
			// GraphQL batch fails
			.mockRejectedValueOnce(new Error("GraphQL error"))
			// REST fallback for repoMetadata: fetchRepoStats
			.mockResolvedValueOnce(mockResponse(restStats))
			// REST fallback for repoMetadata: fetchOpenPullRequestCount
			.mockResolvedValueOnce(mockResponse({ total_count: 120 }))
			// REST for workflowRuns
			.mockResolvedValueOnce(mockResponse({
				workflow_runs: [{
					id: 99,
					name: "Deploy",
					status: "completed",
					conclusion: "failure",
					html_url: "https://github.com/facebook/react/actions/runs/99",
					created_at: "2024-06-15T10:00:00Z",
					updated_at: "2024-06-15T10:05:00Z",
				}],
			}));

		coordinator.subscribe(baseSub({
			fragments: ["repoMetadata", "workflowRuns"],
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		expect(result.repoMetadata!.stargazers_count).toBe(42000);
		expect(result.workflowRuns).toBeDefined();
	});
});
