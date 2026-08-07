/**
 * Integration tests: Multi-subscriber coordinator behavior
 *
 * Verifies that the coordinator correctly batches requests from multiple
 * actions watching the same repo, handles subscriptions/unsubscriptions,
 * and shares cache across subscribers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLQueryCoordinator } from "../../src/utils/graphql-query-coordinator";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import type { DataSubscription } from "../../src/types";
import {
	TOKEN,
	REPO,
	makeGraphQLRepoResponse,
	makeBranchComparison,
	makeWorkflowRun,
	mockResponse,
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

describe("Multi-subscriber coordinator behavior", () => {
	let coordinator: GraphQLQueryCoordinator;
	let cache: RepoDataCache;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

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

	it("two actions watching same repo share a single GraphQL batch", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "action-1",
			fragments: ["repoMetadata"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "action-2",
			fragments: ["prCount"],
			params: { prState: "open" },
		}));

		// First fetch includes both fragments in the batch
		const result1 = await coordinator.fetchData("action-1", TOKEN);
		expect(result1.repoMetadata).toBeDefined();

		// Second fetch uses cached data (no new fetch)
		const result2 = await coordinator.fetchData("action-2", TOKEN);
		expect(result2.prCount).toBeDefined();
		expect(result2.prCount).toBe(120);

		// Only 1 fetch call — both served from the same batch
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("actions on different repos make separate fetches", async () => {
		const reactResponse = makeGraphQLRepoResponse({ stargazerCount: 42000 });
		const nextResponse = makeGraphQLRepoResponse({
			stargazerCount: 120000,
			nameWithOwner: "vercel/next.js",
		});

		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse(reactResponse))
			.mockResolvedValueOnce(mockResponse(nextResponse));

		coordinator.subscribe(baseSub({
			actionId: "action-react",
			repo: "facebook/react",
			fragments: ["repoMetadata"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "action-next",
			repo: "vercel/next.js",
			fragments: ["repoMetadata"],
		}));

		const r1 = await coordinator.fetchData("action-react", TOKEN);
		expect(r1.repoMetadata!.stargazers_count).toBe(42000);

		const r2 = await coordinator.fetchData("action-next", TOKEN);
		expect(r2.repoMetadata!.stargazers_count).toBe(120000);

		// Two separate fetches (different repos)
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("subscription count tracks active subscriptions", () => {
		expect(coordinator.subscriptionCount).toBe(0);

		coordinator.subscribe(baseSub({ actionId: "a1" }));
		expect(coordinator.subscriptionCount).toBe(1);

		coordinator.subscribe(baseSub({ actionId: "a2" }));
		expect(coordinator.subscriptionCount).toBe(2);

		coordinator.unsubscribe("a1");
		expect(coordinator.subscriptionCount).toBe(1);

		coordinator.unsubscribe("a2");
		expect(coordinator.subscriptionCount).toBe(0);
	});

	it("isSubscribed returns correct status", () => {
		expect(coordinator.isSubscribed("a1")).toBe(false);

		coordinator.subscribe(baseSub({ actionId: "a1" }));
		expect(coordinator.isSubscribed("a1")).toBe(true);

		coordinator.unsubscribe("a1");
		expect(coordinator.isSubscribed("a1")).toBe(false);
	});

	it("getActiveRepos returns all repos with subscribers", () => {
		coordinator.subscribe(baseSub({ actionId: "a1", repo: "facebook/react" }));
		coordinator.subscribe(baseSub({ actionId: "a2", repo: "vercel/next.js" }));
		coordinator.subscribe(baseSub({ actionId: "a3", repo: "facebook/react" }));

		const repos = coordinator.getActiveRepos();
		expect(repos.size).toBe(2);
		expect(repos.has("facebook/react")).toBe(true);
		expect(repos.has("vercel/next.js")).toBe(true);
	});

	it("getAllFragmentsForRepo returns union of all subscriber fragments", () => {
		coordinator.subscribe(baseSub({
			actionId: "a1",
			repo: "facebook/react",
			fragments: ["repoMetadata", "prCount"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "a2",
			repo: "facebook/react",
			fragments: ["issueCount", "latestRelease"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "a3",
			repo: "facebook/react",
			fragments: ["repoMetadata"], // Duplicate — should be deduped
		}));

		const fragments = coordinator.getAllFragmentsForRepo("facebook/react");
		expect(fragments).toContain("repoMetadata");
		expect(fragments).toContain("prCount");
		expect(fragments).toContain("issueCount");
		expect(fragments).toContain("latestRelease");
		// No duplicates
		const unique = new Set(fragments);
		expect(unique.size).toBe(fragments.length);
	});

	it("re-subscribing same action updates fragments", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		// Initial subscription: stars only
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata"],
		}));

		const r1 = await coordinator.fetchData("a1", TOKEN);
		expect(r1.repoMetadata).toBeDefined();
		expect(r1.prCount).toBeUndefined();

		// Advance time to expire cache
		vi.advanceTimersByTime(301_000);

		// Re-subscribe with additional fragments
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata", "prCount"],
			params: { prState: "open" },
		}));

		const r2 = await coordinator.fetchData("a1", TOKEN);
		expect(r2.repoMetadata).toBeDefined();
		expect(r2.prCount).toBe(120);
	});

	it("result only contains requested fragments, not all cached data", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		// Action 1 requests many fragments
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata", "prCount", "issueCount", "branches"],
			params: { prState: "open", issueState: "open" },
		}));
		await coordinator.fetchData("a1", TOKEN);

		// Action 2 only requests repoMetadata
		coordinator.subscribe(baseSub({
			actionId: "a2",
			fragments: ["repoMetadata"],
		}));
		const result = await coordinator.fetchData("a2", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		// These were NOT requested by action-2
		expect(result.prCount).toBeUndefined();
		expect(result.issueCount).toBeUndefined();
		expect(result.branches).toBeUndefined();
	});

	it("cache entries track data source (graphql vs rest)", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub());
		await coordinator.fetchData("test-action-1", TOKEN);

		const entry = cache.getStale(REPO, "repoMetadata");
		expect(entry).not.toBeNull();
		expect(entry!.source).toBe("graphql");
	});
});

/**
 * Regression tests: several actions may watch the same repository while asking
 * different questions of it — comparing different branch pairs, following
 * different workflows, counting open versus closed pull requests. Each variant
 * needs its own cache entry, otherwise whichever one is fetched first is
 * rendered by all of them.
 */
describe("Parameterised fragments are cached per variant", () => {
	let coordinator: GraphQLQueryCoordinator;
	let cache: RepoDataCache;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

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

	// ── branchComparison ─────────────────────────────────────────────────

	it("keeps two branch comparisons on the same repo apart", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			if (url.includes("compare/main...develop")) {
				return Promise.resolve(mockResponse(makeBranchComparison({ ahead_by: 20, behind_by: 5 })));
			}
			if (url.includes("compare/main...Test")) {
				return Promise.resolve(mockResponse(makeBranchComparison({ ahead_by: 2, behind_by: 11 })));
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});

		coordinator.subscribe(baseSub({
			actionId: "compare-develop",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "develop" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "compare-test",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "Test" },
		}));

		const develop = await coordinator.fetchData("compare-develop", TOKEN);
		const test = await coordinator.fetchData("compare-test", TOKEN);

		expect(develop.branchComparison).toMatchObject({ ahead_by: 20, behind_by: 5 });
		expect(test.branchComparison).toMatchObject({ ahead_by: 2, behind_by: 11 });

		// Each pair is fetched on its own — neither is served the other's entry
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("serves each branch comparison from its own cache entry on refetch", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			const ahead = url.includes("compare/main...develop") ? 20 : 2;
			return Promise.resolve(mockResponse(makeBranchComparison({ ahead_by: ahead })));
		});

		coordinator.subscribe(baseSub({
			actionId: "compare-develop",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "develop" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "compare-test",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "Test" },
		}));

		await coordinator.fetchData("compare-develop", TOKEN);
		await coordinator.fetchData("compare-test", TOKEN);
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		// Both are fresh now, so a second round is served entirely from cache —
		// each action still getting its own numbers
		const develop = await coordinator.fetchData("compare-develop", TOKEN);
		const test = await coordinator.fetchData("compare-test", TOKEN);

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(develop.branchComparison!.ahead_by).toBe(20);
		expect(test.branchComparison!.ahead_by).toBe(2);
	});

	it("force-refreshing one branch comparison leaves the other's cache intact", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			const ahead = url.includes("compare/main...develop") ? 20 : 2;
			return Promise.resolve(mockResponse(makeBranchComparison({ ahead_by: ahead })));
		});

		coordinator.subscribe(baseSub({
			actionId: "compare-develop",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "develop" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "compare-test",
			fragments: ["branchComparison"],
			params: { baseBranch: "main", headBranch: "Test" },
		}));

		await coordinator.fetchData("compare-develop", TOKEN);
		await coordinator.fetchData("compare-test", TOKEN);
		fetchSpy.mockClear();

		await coordinator.invalidateAndFetch("compare-develop", TOKEN);

		// Only the develop comparison was refetched
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(String(fetchSpy.mock.calls[0][0])).toContain("compare/main...develop");

		// …and the Test comparison is still fresh in cache
		fetchSpy.mockClear();
		const test = await coordinator.fetchData("compare-test", TOKEN);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(test.branchComparison!.ahead_by).toBe(2);
	});

	// ── workflowRuns ─────────────────────────────────────────────────────

	it("keeps two workflow monitors on the same repo apart", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			if (url.includes("/deployments")) {
				return Promise.resolve(mockResponse([]));
			}
			if (url.includes("branch=main")) {
				return Promise.resolve(mockResponse({
					total_count: 1,
					workflow_runs: [makeWorkflowRun({ id: 111, run_number: 111, head_branch: "main" })],
				}));
			}
			if (url.includes("branch=develop")) {
				return Promise.resolve(mockResponse({
					total_count: 1,
					workflow_runs: [makeWorkflowRun({ id: 222, run_number: 222, head_branch: "develop" })],
				}));
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});

		coordinator.subscribe(baseSub({
			actionId: "workflow-main",
			fragments: ["workflowRuns"],
			params: { workflowFile: "ci.yml", branch: "main", environment: "production" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "workflow-develop",
			fragments: ["workflowRuns"],
			params: { workflowFile: "ci.yml", branch: "develop", environment: "develop" },
		}));

		const main = await coordinator.fetchData("workflow-main", TOKEN);
		const develop = await coordinator.fetchData("workflow-develop", TOKEN);

		expect(main.workflowRuns!.latestRun!.id).toBe(111);
		expect(develop.workflowRuns!.latestRun!.id).toBe(222);
	});

	it("separates workflow monitors that differ only by environment", async () => {
		const environments: string[] = [];
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
			const url = String(input);
			if (url.includes("/deployments")) {
				environments.push(new URL(url).searchParams.get("environment") ?? "");
				return Promise.resolve(mockResponse([]));
			}
			return Promise.resolve(mockResponse({ total_count: 1, workflow_runs: [makeWorkflowRun()] }));
		});

		coordinator.subscribe(baseSub({
			actionId: "workflow-prod",
			fragments: ["workflowRuns"],
			params: { workflowFile: "ci.yml", environment: "production" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "workflow-test",
			fragments: ["workflowRuns"],
			params: { workflowFile: "ci.yml", environment: "test" },
		}));

		const prod = await coordinator.fetchData("workflow-prod", TOKEN);
		const test = await coordinator.fetchData("workflow-test", TOKEN);

		expect(prod.workflowRuns!.latestRun).not.toBeNull();
		expect(test.workflowRuns!.latestRun).not.toBeNull();

		// Both environments were actually queried — the second action did not
		// simply reuse the first one's cached deployment
		expect(environments).toEqual(["production", "test"]);
	});

	// ── Batched GraphQL fragments ────────────────────────────────────────

	it("extracts open and closed PR counts from a single batched query", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "pr-open",
			fragments: ["prCount"],
			params: { prState: "open" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "pr-closed",
			fragments: ["prCount"],
			params: { prState: "closed" },
		}));

		const open = await coordinator.fetchData("pr-open", TOKEN);
		const closed = await coordinator.fetchData("pr-closed", TOKEN);

		expect(open.prCount).toBe(120);           // openPRs
		expect(closed.prCount).toBe(7700);        // closedPRs + mergedPRs

		// Both variants come out of the same batched request — the batching
		// optimisation is preserved, only the extraction is per-variant
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("separates issue counters that differ only by state", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "issues-open",
			fragments: ["issueCount"],
			params: { issueState: "open" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "issues-all",
			fragments: ["issueCount"],
			params: { issueState: "all" },
		}));

		const open = await coordinator.fetchData("issues-open", TOKEN);
		const all = await coordinator.fetchData("issues-all", TOKEN);

		expect(open.issueCount).toBe(850);
		expect(all.issueCount).toBe(12850);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("separates release monitors that differ only by pre-release inclusion", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "release-stable",
			fragments: ["latestRelease"],
			params: { includePreReleases: false },
		}));
		coordinator.subscribe(baseSub({
			actionId: "release-pre",
			fragments: ["latestRelease"],
			params: { includePreReleases: true },
		}));

		const stable = await coordinator.fetchData("release-stable", TOKEN);
		const pre = await coordinator.fetchData("release-pre", TOKEN);

		expect(stable.latestRelease!.tag_name).toBe("v18.3.1");
		expect(pre.latestRelease!.tag_name).toBe("v19.0.0-rc.1");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	// ── Cleanup ──────────────────────────────────────────────────────────

	it("cleans up every variant of a repo once its last subscriber leaves", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "pr-open",
			fragments: ["prCount"],
			params: { prState: "open" },
		}));
		coordinator.subscribe(baseSub({
			actionId: "pr-closed",
			fragments: ["prCount"],
			params: { prState: "closed" },
		}));

		await coordinator.fetchData("pr-open", TOKEN);
		expect(cache.size).toBe(2);

		coordinator.unsubscribe("pr-open");
		// pr-closed still watches the repo, so both variants survive
		expect(cache.size).toBe(2);

		coordinator.unsubscribe("pr-closed");
		expect(cache.size).toBe(0);
	});
});
