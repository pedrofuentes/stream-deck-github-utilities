/**
 * Tests for the GraphQL Query Coordinator (src/utils/graphql-query-coordinator.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DataSubscription, GraphQLRepoNode } from "../../src/types";
import { RepoDataCache } from "../../src/utils/repo-data-cache";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
	executeGraphQLQuery: vi.fn(),
	fetchRepoStats: vi.fn(),
	fetchOpenPullRequestCount: vi.fn(),
	fetchPullRequestCount: vi.fn(),
	fetchIssueCount: vi.fn(),
	fetchLatestRelease: vi.fn(),
	fetchBranchNetwork: vi.fn(),
	fetchDependabotAlerts: vi.fn(),
	fetchReviewRequestedPRs: vi.fn(),
	fetchWorkflowInfo: vi.fn(),
	fetchCommitActivityWeeks: vi.fn(),
	fetchBranchComparison: vi.fn(),
	parseRepoIdentifier: vi.fn(),
}));

vi.mock("../../src/utils/github-graphql", () => ({
	executeGraphQLQuery: mocks.executeGraphQLQuery,
	GraphQLQueryError: class GraphQLQueryError extends Error {
		constructor(
			message: string,
			public readonly status: number,
			public readonly graphqlErrors?: unknown[],
			public readonly rateLimit?: unknown,
		) {
			super(message);
			this.name = "GraphQLQueryError";
		}
	},
	GITHUB_GRAPHQL_ENDPOINT: "https://api.github.com/graphql",
}));

vi.mock("../../src/utils/github-api", () => ({
	fetchRepoStats: mocks.fetchRepoStats,
	fetchOpenPullRequestCount: mocks.fetchOpenPullRequestCount,
	fetchPullRequestCount: mocks.fetchPullRequestCount,
	fetchIssueCount: mocks.fetchIssueCount,
	fetchLatestRelease: mocks.fetchLatestRelease,
	fetchBranchNetwork: mocks.fetchBranchNetwork,
	fetchDependabotAlerts: mocks.fetchDependabotAlerts,
	fetchReviewRequestedPRs: mocks.fetchReviewRequestedPRs,
	fetchWorkflowInfo: mocks.fetchWorkflowInfo,
	fetchCommitActivityWeeks: mocks.fetchCommitActivityWeeks,
	fetchBranchComparison: mocks.fetchBranchComparison,
}));

vi.mock("../../src/utils/github", () => ({
	parseRepoIdentifier: mocks.parseRepoIdentifier,
	isValidRepoIdentifier: vi.fn(() => true),
}));

import { GraphQLQueryCoordinator } from "../../src/utils/graphql-query-coordinator";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TOKEN = "ghp_testtoken123456789012345678901234";

function makeRepoNode(overrides: Partial<GraphQLRepoNode> = {}): GraphQLRepoNode {
	return {
		stargazerCount: 100,
		forkCount: 10,
		watchers: { totalCount: 50 },
		primaryLanguage: { name: "TypeScript" },
		diskUsage: 1024,
		licenseInfo: { spdxId: "MIT", name: "MIT License" },
		defaultBranchRef: { name: "main" },
		isPrivate: false,
		isFork: false,
		description: "A test repo",
		nameWithOwner: "owner/repo",
		url: "https://github.com/owner/repo",
		openPRs: { totalCount: 5 },
		closedPRs: { totalCount: 20 },
		mergedPRs: { totalCount: 15 },
		openIssues: { totalCount: 8 },
		closedIssues: { totalCount: 30 },
		latestRelease: {
			tagName: "v1.0.0",
			name: "Release 1.0.0",
			publishedAt: "2025-01-01T00:00:00Z",
			isPrerelease: false,
			isDraft: false,
			url: "https://github.com/owner/repo/releases/tag/v1.0.0",
		},
		refs: {
			nodes: [
				{ name: "main", target: { oid: "abc123" } },
				{ name: "develop", target: { oid: "def456" } },
			],
		},
		vulnerabilityAlerts: {
			totalCount: 2,
			nodes: [
				{ securityVulnerability: { severity: "HIGH" } },
				{ securityVulnerability: { severity: "LOW" } },
			],
		},
		...overrides,
	};
}

function baseSub(overrides: Partial<DataSubscription> = {}): DataSubscription {
	return {
		actionId: "action-1",
		repo: "owner/repo",
		fragments: ["prCount"],
		maxAgeSec: 300,
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GraphQLQueryCoordinator", () => {
	let coordinator: GraphQLQueryCoordinator;
	let cache: RepoDataCache;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
		cache = new RepoDataCache();
		coordinator = new GraphQLQueryCoordinator(cache);

		// Default: parseRepoIdentifier returns parsed owner/repo
		mocks.parseRepoIdentifier.mockImplementation((r: string) => {
			const parts = r.split("/");
			if (parts.length !== 2) return null;
			return { owner: parts[0], repo: parts[1] };
		});

		// Default: GraphQL succeeds with a full repo node
		mocks.executeGraphQLQuery.mockResolvedValue({
			data: { repository: makeRepoNode() },
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.resetAllMocks();
	});

	// ── Subscription management ──────────────────────────────────────────

	describe("Subscription management", () => {
		it("should add a subscription via subscribe()", () => {
			coordinator.subscribe(baseSub());
			expect(coordinator.isSubscribed("action-1")).toBe(true);
			expect(coordinator.subscriptionCount).toBe(1);
		});

		it("should remove a subscription via unsubscribe()", () => {
			coordinator.subscribe(baseSub());
			coordinator.unsubscribe("action-1");
			expect(coordinator.isSubscribed("action-1")).toBe(false);
			expect(coordinator.subscriptionCount).toBe(0);
		});

		it("should return correct active repos", () => {
			coordinator.subscribe(baseSub({ actionId: "a1", repo: "owner/repo" }));
			coordinator.subscribe(baseSub({ actionId: "a2", repo: "other/repo" }));
			coordinator.subscribe(baseSub({ actionId: "a3", repo: "owner/repo" }));

			const repos = coordinator.getActiveRepos();
			expect(repos.size).toBe(2);
			expect(repos.has("owner/repo")).toBe(true);
			expect(repos.has("other/repo")).toBe(true);
		});

		it("should aggregate fragments across subscribers for same repo", () => {
			coordinator.subscribe(baseSub({ actionId: "a1", repo: "owner/repo", fragments: ["prCount", "issueCount"] }));
			coordinator.subscribe(baseSub({ actionId: "a2", repo: "owner/repo", fragments: ["issueCount", "branches"] }));

			const fragments = coordinator.getAllFragmentsForRepo("owner/repo");
			expect(fragments).toContain("prCount");
			expect(fragments).toContain("issueCount");
			expect(fragments).toContain("branches");
			expect(new Set(fragments).size).toBe(3);
		});

		it("should return empty array for repo with no subscribers", () => {
			expect(coordinator.getAllFragmentsForRepo("nobody/repo")).toEqual([]);
		});

		it("should return false for isSubscribed with unknown actionId", () => {
			expect(coordinator.isSubscribed("nonexistent")).toBe(false);
		});

		it("should return 0 for subscriptionCount when empty", () => {
			expect(coordinator.subscriptionCount).toBe(0);
		});

		it("should update subscription when subscribing with same actionId", () => {
			coordinator.subscribe(baseSub({ actionId: "a1", fragments: ["prCount"] }));
			coordinator.subscribe(baseSub({ actionId: "a1", fragments: ["issueCount", "branches"] }));

			expect(coordinator.subscriptionCount).toBe(1);
			const fragments = coordinator.getAllFragmentsForRepo("owner/repo");
			expect(fragments).toContain("issueCount");
			expect(fragments).toContain("branches");
			expect(fragments).not.toContain("prCount");
		});

		it("should not include empty repos in getActiveRepos", () => {
			coordinator.subscribe(baseSub({ actionId: "a1", repo: "" }));
			expect(coordinator.getActiveRepos().size).toBe(0);
		});

		it("should be safe to unsubscribe unknown actionId", () => {
			expect(() => coordinator.unsubscribe("nonexistent")).not.toThrow();
		});
	});

	// ── Cache-first behavior ─────────────────────────────────────────────

	describe("Cache-first behavior", () => {
		it("should return cached data when all fragments are fresh", async () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBe(42);
			expect(mocks.executeGraphQLQuery).not.toHaveBeenCalled();
		});

		it("should fetch only stale fragments", async () => {
			// prCount is fresh, issueCount not cached
			cache.set("owner/repo", "prCount", 42, "graphql");
			coordinator.subscribe(baseSub({ fragments: ["prCount", "issueCount"] }));

			await coordinator.fetchData("action-1", TOKEN);

			// GraphQL should be called for issueCount (and batched with prCount for all subscribers)
			expect(mocks.executeGraphQLQuery).toHaveBeenCalledTimes(1);
		});

		it("should not refetch when all data is fresh within maxAge", async () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			cache.set("owner/repo", "issueCount", 10, "graphql");
			coordinator.subscribe(baseSub({ fragments: ["prCount", "issueCount"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBe(42);
			expect(result.issueCount).toBe(10);
			expect(mocks.executeGraphQLQuery).not.toHaveBeenCalled();
		});
	});

	// ── GraphQL fetching ─────────────────────────────────────────────────

	describe("GraphQL fetching", () => {
		it("should extract and cache prCount from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBe(5); // openPRs.totalCount from makeRepoNode
			expect(mocks.executeGraphQLQuery).toHaveBeenCalledTimes(1);
		});

		it("should extract and cache repoMetadata from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.repoMetadata).toBeDefined();
			expect(result.repoMetadata!.stargazers_count).toBe(100);
			expect(result.repoMetadata!.forks_count).toBe(10);
		});

		it("should extract and cache issueCount from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["issueCount"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.issueCount).toBe(8); // openIssues.totalCount from makeRepoNode
		});

		it("should extract and cache latestRelease from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["latestRelease"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.latestRelease).toBeDefined();
			expect(result.latestRelease!.tag_name).toBe("v1.0.0");
		});

		it("should extract and cache branches from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["branches"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.branches).toHaveLength(2);
			expect(result.branches![0].name).toBe("main");
		});

		it("should extract and cache vulnerabilityAlerts from GraphQL response", async () => {
			coordinator.subscribe(baseSub({ fragments: ["vulnerabilityAlerts"] }));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.vulnerabilityAlerts).toBeDefined();
			expect(result.vulnerabilityAlerts!.total).toBe(2);
			expect(result.vulnerabilityAlerts!.high).toBe(1);
			expect(result.vulnerabilityAlerts!.low).toBe(1);
		});

		it("should include fragments from other subscribers for the same repo (batching)", async () => {
			coordinator.subscribe(baseSub({ actionId: "a1", fragments: ["prCount"] }));
			coordinator.subscribe(baseSub({ actionId: "a2", repo: "owner/repo", fragments: ["issueCount"] }));

			// Fetch for a1 — should batch both prCount and issueCount
			await coordinator.fetchData("a1", TOKEN);

			// The GraphQL query should include both fragments
			const queryCall = mocks.executeGraphQLQuery.mock.calls[0];
			const queryStr = queryCall[1] as string;
			expect(queryStr).toContain("pullRequests");
			expect(queryStr).toContain("issues");
		});

		it("should pass correct variables to GraphQL query", async () => {
			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));

			await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.executeGraphQLQuery).toHaveBeenCalledWith(
				TOKEN,
				expect.any(String),
				{ owner: "owner", name: "repo" },
			);
		});

		it("should use prState param when extracting prCount", async () => {
			coordinator.subscribe(baseSub({
				fragments: ["prCount"],
				params: { prState: "all" },
			}));

			const result = await coordinator.fetchData("action-1", TOKEN);

			// all = open(5) + closed(20) + merged(15) = 40
			expect(result.prCount).toBe(40);
		});

		it("should use issueState param when extracting issueCount", async () => {
			coordinator.subscribe(baseSub({
				fragments: ["issueCount"],
				params: { issueState: "all" },
			}));

			const result = await coordinator.fetchData("action-1", TOKEN);

			// all = open(8) + closed(30) = 38
			expect(result.issueCount).toBe(38);
		});

		it("should use includePreReleases param when extracting latestRelease", async () => {
			const node = makeRepoNode({
				latestRelease: null,
				releases: {
					nodes: [{
						tagName: "v2.0.0-beta",
						name: "Beta 2.0",
						publishedAt: "2025-01-10T00:00:00Z",
						isPrerelease: true,
						isDraft: false,
						url: "https://github.com/owner/repo/releases/tag/v2.0.0-beta",
					}],
				},
			});
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: { repository: node },
			});

			coordinator.subscribe(baseSub({
				fragments: ["latestRelease"],
				params: { includePreReleases: true },
			}));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.latestRelease!.tag_name).toBe("v2.0.0-beta");
		});

		it("should extract discussions from GraphQL response", async () => {
			const node = makeRepoNode({
				discussions: {
					totalCount: 5,
					nodes: [
						{ title: "Q1", isAnswered: true, createdAt: "2025-01-01T00:00:00Z", url: "https://example.com/1" },
						{ title: "Q2", isAnswered: false, createdAt: "2025-01-02T00:00:00Z", url: "https://example.com/2" },
					],
				},
			});
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: { repository: node },
			});

			coordinator.subscribe(baseSub({ fragments: ["discussions"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.discussions).toBeDefined();
			expect(result.discussions!.totalCount).toBe(5);
			expect(result.discussions!.answeredCount).toBe(1);
		});

		it("should extract projectsV2 from GraphQL response", async () => {
			const node = makeRepoNode({
				projectsV2: {
					nodes: [{
						title: "Sprint 1",
						shortDescription: "Current sprint",
						closed: false,
						number: 1,
						url: "https://github.com/orgs/owner/projects/1",
						items: { totalCount: 10 },
					}],
				},
			});
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: { repository: node },
			});

			coordinator.subscribe(baseSub({ fragments: ["projectsV2"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.projectsV2).toBeDefined();
			expect(result.projectsV2!.projects).toHaveLength(1);
			expect(result.projectsV2!.projects[0].title).toBe("Sprint 1");
		});
	});

	// ── REST-only fragments ──────────────────────────────────────────────

	describe("REST-only fragments", () => {
		it("should use REST for workflowRuns", async () => {
			const workflowInfo = { latestRun: null, deployment: null };
			mocks.fetchWorkflowInfo.mockResolvedValue(workflowInfo);

			coordinator.subscribe(baseSub({ fragments: ["workflowRuns"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchWorkflowInfo).toHaveBeenCalledWith("owner", "repo", TOKEN, {
				branch: undefined,
				workflowFile: undefined,
				environment: undefined,
			});
			expect(result.workflowRuns).toEqual(workflowInfo);
			// GraphQL should NOT be called for REST-only fragments
			expect(mocks.executeGraphQLQuery).not.toHaveBeenCalled();
		});

		it("should use REST for commitActivity", async () => {
			const weeks = [{ total: 5, week: 1234567890, days: [0, 1, 2, 0, 0, 1, 1] }];
			mocks.fetchCommitActivityWeeks.mockResolvedValue(weeks);

			coordinator.subscribe(baseSub({ fragments: ["commitActivity"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchCommitActivityWeeks).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(result.commitActivity).toEqual(weeks);
		});

		it("should use REST for branchComparison", async () => {
			const comparison = { ahead_by: 3, behind_by: 1, total_commits: 4, html_url: "url", status: "ahead" as const };
			mocks.fetchBranchComparison.mockResolvedValue(comparison);

			coordinator.subscribe(baseSub({
				fragments: ["branchComparison"],
				params: { baseBranch: "main", headBranch: "feature" },
			}));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchBranchComparison).toHaveBeenCalledWith("owner", "repo", "main", "feature", TOKEN);
			expect(result.branchComparison).toEqual(comparison);
		});

		it("should pass workflow params to REST call", async () => {
			mocks.fetchWorkflowInfo.mockResolvedValue({ latestRun: null, deployment: null });

			coordinator.subscribe(baseSub({
				fragments: ["workflowRuns"],
				params: { branch: "main", workflowFile: "ci.yml", environment: "production" },
			}));
			await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchWorkflowInfo).toHaveBeenCalledWith("owner", "repo", TOKEN, {
				branch: "main",
				workflowFile: "ci.yml",
				environment: "production",
			});
		});

		it("should cache REST results", async () => {
			mocks.fetchWorkflowInfo.mockResolvedValue({ latestRun: null, deployment: null });

			coordinator.subscribe(baseSub({ fragments: ["workflowRuns"] }));
			await coordinator.fetchData("action-1", TOKEN);

			// Second fetch should use cache
			mocks.fetchWorkflowInfo.mockClear();
			await coordinator.fetchData("action-1", TOKEN);
			expect(mocks.fetchWorkflowInfo).not.toHaveBeenCalled();
		});

		it("should use default params for branchComparison when none specified", async () => {
			mocks.fetchBranchComparison.mockResolvedValue({
				ahead_by: 0, behind_by: 0, total_commits: 0, html_url: "url", status: "identical" as const,
			});

			coordinator.subscribe(baseSub({ fragments: ["branchComparison"] }));
			await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchBranchComparison).toHaveBeenCalledWith("owner", "repo", "main", "develop", TOKEN);
		});
	});

	// ── REST fallback on GraphQL failure ─────────────────────────────────

	describe("REST fallback on GraphQL failure", () => {
		it("should fall back to REST for all fragments when GraphQL throws", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL error"));
			mocks.fetchPullRequestCount.mockResolvedValue(42);
			mocks.fetchIssueCount.mockResolvedValue(10);

			coordinator.subscribe(baseSub({ fragments: ["prCount", "issueCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchPullRequestCount).toHaveBeenCalled();
			expect(mocks.fetchIssueCount).toHaveBeenCalled();
			expect(result.prCount).toBe(42);
			expect(result.issueCount).toBe(10);
		});

		it("should fall back to REST for individual fragment on extraction error", async () => {
			// GraphQL succeeds but node is missing data for branches
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: {
					repository: {
						...makeRepoNode(),
						refs: { nodes: [{ name: "main", target: null }] }, // null target will cause extractor error
					},
				},
			});
			mocks.fetchBranchNetwork.mockResolvedValue([
				{ name: "main", commitSha: "abc123" },
			]);

			coordinator.subscribe(baseSub({ fragments: ["branches"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			// Should have attempted REST fallback
			expect(mocks.fetchBranchNetwork).toHaveBeenCalled();
			expect(result.branches).toBeDefined();
		});

		it("should use REST for repoMetadata fallback correctly", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL error"));
			const stats = {
				stargazers_count: 50,
				open_issues_count: 3,
				forks_count: 5,
				watchers_count: 20,
				full_name: "owner/repo",
				description: "test",
				visibility: "public",
				html_url: "https://github.com/owner/repo",
				language: "TypeScript",
				size: 512,
				license: "MIT",
				default_branch: "main",
			};
			mocks.fetchRepoStats.mockResolvedValue(stats);
			mocks.fetchOpenPullRequestCount.mockResolvedValue(7);

			coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchRepoStats).toHaveBeenCalled();
			expect(mocks.fetchOpenPullRequestCount).toHaveBeenCalled();
			expect(result.repoMetadata).toBeDefined();
			expect(result.repoMetadata!.open_pull_request_count).toBe(7);
		});

		it("should fall back to REST for latestRelease", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL error"));
			mocks.fetchLatestRelease.mockResolvedValue({
				tag_name: "v1.0.0",
				name: "Release 1.0.0",
				html_url: "url",
				published_at: "2025-01-01",
				prerelease: false,
				draft: false,
			});

			coordinator.subscribe(baseSub({ fragments: ["latestRelease"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchLatestRelease).toHaveBeenCalledWith("owner", "repo", TOKEN, false);
			expect(result.latestRelease!.tag_name).toBe("v1.0.0");
		});

		it("should fall back to REST for vulnerabilityAlerts", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL error"));
			mocks.fetchDependabotAlerts.mockResolvedValue({
				critical: 0, high: 1, medium: 0, low: 0, total: 1,
			});

			coordinator.subscribe(baseSub({ fragments: ["vulnerabilityAlerts"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchDependabotAlerts).toHaveBeenCalled();
			expect(result.vulnerabilityAlerts!.total).toBe(1);
		});
	});

	// ── Search-based fragments (reviewRequestedPRs) ──────────────────────

	describe("Search-based fragments (reviewRequestedPRs)", () => {
		it("should use GraphQL search query for reviewRequestedPRs", async () => {
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: {
					search: {
						issueCount: 2,
						nodes: [
							{
								number: 1,
								title: "Fix bug",
								url: "https://github.com/owner/repo/pull/1",
								createdAt: "2025-01-01T00:00:00Z",
								author: { login: "alice" },
								repository: { nameWithOwner: "owner/repo" },
							},
						],
					},
				},
			});

			coordinator.subscribe(baseSub({ fragments: ["reviewRequestedPRs"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.reviewRequestedPRs).toBeDefined();
			expect(result.reviewRequestedPRs!.total_count).toBe(2);
			expect(result.reviewRequestedPRs!.items[0].title).toBe("Fix bug");
		});

		it("should include repo in search query when repo is set", async () => {
			mocks.executeGraphQLQuery.mockResolvedValue({
				data: {
					search: { issueCount: 0, nodes: [] },
				},
			});

			coordinator.subscribe(baseSub({
				repo: "owner/repo",
				fragments: ["reviewRequestedPRs"],
			}));
			await coordinator.fetchData("action-1", TOKEN);

			const callArgs = mocks.executeGraphQLQuery.mock.calls[0];
			const variables = callArgs[2] as Record<string, unknown>;
			expect(variables.query).toContain("repo:owner/repo");
		});

		it("should fall back to REST for reviewRequestedPRs on GraphQL failure", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL search failed"));
			mocks.fetchReviewRequestedPRs.mockResolvedValue({
				total_count: 1,
				items: [{ number: 1, title: "PR", user_login: "bob", html_url: "url", created_at: "2025-01-01" }],
			});

			coordinator.subscribe(baseSub({ fragments: ["reviewRequestedPRs"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchReviewRequestedPRs).toHaveBeenCalledWith(TOKEN, "owner/repo");
			expect(result.reviewRequestedPRs!.total_count).toBe(1);
		});

		it("should use empty string repo for cross-repo query REST fallback", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("fail"));
			mocks.fetchReviewRequestedPRs.mockResolvedValue({ total_count: 0, items: [] });

			coordinator.subscribe(baseSub({
				repo: "",
				fragments: ["reviewRequestedPRs"],
			}));
			await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.fetchReviewRequestedPRs).toHaveBeenCalledWith(TOKEN, undefined);
		});
	});

	// ── Force refresh ────────────────────────────────────────────────────

	describe("Force refresh (invalidateAndFetch)", () => {
		it("should invalidate cache and fetch fresh data", async () => {
			// Pre-populate cache
			cache.set("owner/repo", "prCount", 42, "graphql");
			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));

			// First fetch from cache
			const cached = await coordinator.fetchData("action-1", TOKEN);
			expect(cached.prCount).toBe(42);
			expect(mocks.executeGraphQLQuery).not.toHaveBeenCalled();

			// Force refresh
			const result = await coordinator.invalidateAndFetch("action-1", TOKEN);

			expect(mocks.executeGraphQLQuery).toHaveBeenCalled();
			expect(result.prCount).toBe(5); // Fresh from GraphQL
		});

		it("should throw for unknown actionId on invalidateAndFetch", async () => {
			await expect(coordinator.invalidateAndFetch("nonexistent", TOKEN))
				.rejects.toThrow('No subscription found for action "nonexistent"');
		});
	});

	// ── Error handling ───────────────────────────────────────────────────

	describe("Error handling", () => {
		it("should throw when fetchData called with unknown actionId", async () => {
			await expect(coordinator.fetchData("nonexistent", TOKEN))
				.rejects.toThrow('No subscription found for action "nonexistent"');
		});

		it("should return partial results with errors on partial failure", async () => {
			// GraphQL fails, REST fails for prCount but issueCount succeeds
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL down"));
			mocks.fetchPullRequestCount.mockRejectedValue(new Error("REST PR fail"));
			mocks.fetchIssueCount.mockResolvedValue(10);

			coordinator.subscribe(baseSub({ fragments: ["prCount", "issueCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.issueCount).toBe(10);
			expect(result.errors).toBeDefined();
			expect(result.errors!.prCount).toBeDefined();
		});

		it("should serve stale cache data when both GraphQL and REST fail", async () => {
			// Pre-populate cache then invalidate
			cache.set("owner/repo", "prCount", 99, "graphql");
			cache.invalidate("owner/repo", ["prCount"]);

			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL down"));
			mocks.fetchPullRequestCount.mockRejectedValue(new Error("REST fail"));

			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBe(99);
			expect(result.errors).toBeDefined();
			expect(result.errors!.prCount).toContain("stale");
		});

		it("should report 'No data available' when no cache exists at all", async () => {
			mocks.executeGraphQLQuery.mockRejectedValue(new Error("GraphQL down"));
			mocks.fetchPullRequestCount.mockRejectedValue(new Error("REST fail"));

			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBeUndefined();
			expect(result.errors!.prCount).toBe("No data available");
		});

		it("should handle invalid repo identifier gracefully", async () => {
			mocks.parseRepoIdentifier.mockReturnValue(null);

			coordinator.subscribe(baseSub({ repo: "invalid", fragments: ["prCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.errors).toBeDefined();
			expect(result.errors!.prCount).toBeDefined();
		});

		it("should handle GraphQL returning no repository node", async () => {
			mocks.executeGraphQLQuery.mockResolvedValue({ data: { repository: null } });
			mocks.fetchPullRequestCount.mockResolvedValue(42);

			coordinator.subscribe(baseSub({ fragments: ["prCount"] }));
			const result = await coordinator.fetchData("action-1", TOKEN);

			// Should fall back to REST
			expect(mocks.fetchPullRequestCount).toHaveBeenCalled();
			expect(result.prCount).toBe(42);
		});
	});

	// ── Cleanup ──────────────────────────────────────────────────────────

	describe("Cleanup", () => {
		it("should clean up cache for repos with no subscribers on unsubscribe", async () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			coordinator.subscribe(baseSub({ actionId: "a1", repo: "owner/repo" }));

			// Unsubscribe removes the last subscriber for owner/repo
			coordinator.unsubscribe("a1");

			expect(cache.has("owner/repo", "prCount")).toBe(false);
		});

		it("should preserve cache for repos with remaining subscribers", async () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			coordinator.subscribe(baseSub({ actionId: "a1", repo: "owner/repo" }));
			coordinator.subscribe(baseSub({ actionId: "a2", repo: "owner/repo" }));

			coordinator.unsubscribe("a1");

			// a2 is still subscribed to owner/repo
			expect(cache.has("owner/repo", "prCount")).toBe(true);
		});
	});

	// ── Mixed GraphQL + REST fragments ───────────────────────────────────

	describe("Mixed GraphQL + REST fragments", () => {
		it("should fetch GraphQL and REST fragments in same request", async () => {
			mocks.fetchWorkflowInfo.mockResolvedValue({ latestRun: null, deployment: null });

			coordinator.subscribe(baseSub({
				fragments: ["prCount", "workflowRuns"],
			}));
			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(mocks.executeGraphQLQuery).toHaveBeenCalledTimes(1);
			expect(mocks.fetchWorkflowInfo).toHaveBeenCalledTimes(1);
			expect(result.prCount).toBe(5);
			expect(result.workflowRuns).toEqual({ latestRun: null, deployment: null });
		});

		it("should handle all fragment types in one subscription", async () => {
			mocks.fetchWorkflowInfo.mockResolvedValue({ latestRun: null, deployment: null });
			mocks.fetchCommitActivityWeeks.mockResolvedValue([]);
			mocks.fetchBranchComparison.mockResolvedValue({
				ahead_by: 0, behind_by: 0, total_commits: 0, html_url: "url", status: "identical" as const,
			});

			coordinator.subscribe(baseSub({
				fragments: ["prCount", "issueCount", "workflowRuns", "commitActivity", "branchComparison"],
				params: { baseBranch: "main", headBranch: "dev" },
			}));

			const result = await coordinator.fetchData("action-1", TOKEN);

			expect(result.prCount).toBeDefined();
			expect(result.issueCount).toBeDefined();
			expect(result.workflowRuns).toBeDefined();
			expect(result.commitActivity).toBeDefined();
			expect(result.branchComparison).toBeDefined();
			expect(result.errors).toBeUndefined();
		});
	});
});
