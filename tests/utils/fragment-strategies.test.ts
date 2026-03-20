/**
 * Tests for fragment strategies (src/utils/fragment-strategies.ts).
 *
 * Tests each of the 12 FragmentStrategy implementations individually
 * and verifies the registry is complete.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CoordinatorResult, GraphQLRepoNode, FragmentParams } from "../../src/types";
import { RepoDataCache } from "../../src/utils/repo-data-cache";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
	extractRepoMetadata: vi.fn(),
	extractPRCount: vi.fn(),
	extractIssueCount: vi.fn(),
	extractLatestRelease: vi.fn(),
	extractBranches: vi.fn(),
	extractSecurityAlerts: vi.fn(),
	extractDiscussions: vi.fn(),
	extractProjectsV2: vi.fn(),
	fetchRepoStats: vi.fn(),
	fetchOpenPullRequestCount: vi.fn(),
	fetchPullRequestCount: vi.fn(),
	fetchIssueCount: vi.fn(),
	fetchLatestRelease: vi.fn(),
	fetchBranchNetwork: vi.fn(),
	fetchDependabotAlerts: vi.fn(),
	fetchWorkflowInfo: vi.fn(),
	fetchCommitActivityWeeks: vi.fn(),
	fetchBranchComparison: vi.fn(),
	parseRepoIdentifier: vi.fn(),
}));

vi.mock("../../src/utils/data-fragments", () => ({
	extractRepoMetadata: mocks.extractRepoMetadata,
	extractPRCount: mocks.extractPRCount,
	extractIssueCount: mocks.extractIssueCount,
	extractLatestRelease: mocks.extractLatestRelease,
	extractBranches: mocks.extractBranches,
	extractSecurityAlerts: mocks.extractSecurityAlerts,
	extractDiscussions: mocks.extractDiscussions,
	extractProjectsV2: mocks.extractProjectsV2,
}));

vi.mock("../../src/utils/github-api", () => ({
	fetchRepoStats: mocks.fetchRepoStats,
	fetchOpenPullRequestCount: mocks.fetchOpenPullRequestCount,
	fetchPullRequestCount: mocks.fetchPullRequestCount,
	fetchIssueCount: mocks.fetchIssueCount,
	fetchLatestRelease: mocks.fetchLatestRelease,
	fetchBranchNetwork: mocks.fetchBranchNetwork,
	fetchDependabotAlerts: mocks.fetchDependabotAlerts,
	fetchWorkflowInfo: mocks.fetchWorkflowInfo,
	fetchCommitActivityWeeks: mocks.fetchCommitActivityWeeks,
	fetchBranchComparison: mocks.fetchBranchComparison,
}));

vi.mock("../../src/utils/github", () => ({
	parseRepoIdentifier: mocks.parseRepoIdentifier,
}));

import { fragmentRegistry, type FragmentStrategy } from "../../src/utils/fragment-strategies";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TOKEN = "ghp_testtoken123456789012345678901234";
const REPO = "owner/repo";

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

// ─── Helper ──────────────────────────────────────────────────────────────────

function getStrategy(name: string): FragmentStrategy {
	const strategy = fragmentRegistry.get(name as never);
	if (!strategy) throw new Error(`Strategy not found: ${name}`);
	return strategy;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Fragment Strategies", () => {
	let cache: RepoDataCache;

	beforeEach(() => {
		cache = new RepoDataCache();
		vi.resetAllMocks();

		mocks.parseRepoIdentifier.mockImplementation((r: string) => {
			const parts = r.split("/");
			if (parts.length !== 2) return null;
			return { owner: parts[0], repo: parts[1] };
		});
	});

	// ── Registry completeness ────────────────────────────────────────────

	describe("Registry", () => {
		it("should contain all 12 DataFragmentName entries", () => {
			const expected = [
				"repoMetadata",
				"prCount",
				"issueCount",
				"latestRelease",
				"branches",
				"vulnerabilityAlerts",
				"discussions",
				"projectsV2",
				"workflowRuns",
				"commitActivity",
				"branchComparison",
				"reviewRequestedPRs",
			];
			expect(fragmentRegistry.size).toBe(12);
			for (const name of expected) {
				expect(fragmentRegistry.has(name as never)).toBe(true);
			}
		});

		it("should have matching name property for each registered strategy", () => {
			for (const [name, strategy] of fragmentRegistry) {
				expect(strategy.name).toBe(name);
			}
		});
	});

	// ── repoMetadata ─────────────────────────────────────────────────────

	describe("RepoMetadataStrategy", () => {
		const strategy = getStrategy("repoMetadata");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
			expect(strategy.extractFromGraphQL).toBeDefined();
		});

		it("should extract from GraphQL and cache", () => {
			const node = makeRepoNode();
			const extracted = { stargazers_count: 100 };
			mocks.extractRepoMetadata.mockReturnValue(extracted);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractRepoMetadata).toHaveBeenCalledWith(node);
			expect(cache.getStale(REPO, "repoMetadata")?.data).toBe(extracted);
			expect(cache.getStale(REPO, "repoMetadata")?.source).toBe("graphql");
		});

		it("should fetch via REST and cache", async () => {
			const stats = { stargazers_count: 100, open_pull_request_count: undefined as number | undefined };
			mocks.fetchRepoStats.mockResolvedValue(stats);
			mocks.fetchOpenPullRequestCount.mockResolvedValue(5);

			await strategy.fetchViaREST(cache, REPO, TOKEN);

			expect(mocks.fetchRepoStats).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(mocks.fetchOpenPullRequestCount).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(stats.open_pull_request_count).toBe(5);
			expect(cache.getStale(REPO, "repoMetadata")?.data).toBe(stats);
			expect(cache.getStale(REPO, "repoMetadata")?.source).toBe("rest");
		});

		it("should skip REST fetch when repo is invalid", async () => {
			mocks.parseRepoIdentifier.mockReturnValue(null);
			await strategy.fetchViaREST(cache, "invalid", TOKEN);
			expect(mocks.fetchRepoStats).not.toHaveBeenCalled();
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const data = { stargazers_count: 100 };
			strategy.assignToResult(result, data);
			expect(result.repoMetadata).toBe(data);
		});
	});

	// ── prCount ──────────────────────────────────────────────────────────

	describe("PRCountStrategy", () => {
		const strategy = getStrategy("prCount");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
			expect(strategy.extractFromGraphQL).toBeDefined();
		});

		it("should extract from GraphQL with default state", () => {
			const node = makeRepoNode();
			mocks.extractPRCount.mockReturnValue(5);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractPRCount).toHaveBeenCalledWith(node, "open");
			expect(cache.getStale(REPO, "prCount")?.data).toBe(5);
		});

		it("should extract from GraphQL with custom state", () => {
			const node = makeRepoNode();
			mocks.extractPRCount.mockReturnValue(35);
			const params: FragmentParams = { prState: "all" };

			strategy.extractFromGraphQL!(cache, REPO, node, params);

			expect(mocks.extractPRCount).toHaveBeenCalledWith(node, "all");
		});

		it("should fetch via REST", async () => {
			mocks.fetchPullRequestCount.mockResolvedValue(10);
			await strategy.fetchViaREST(cache, REPO, TOKEN, { prState: "closed" });

			expect(mocks.fetchPullRequestCount).toHaveBeenCalledWith("owner", "repo", TOKEN, "closed");
			expect(cache.getStale(REPO, "prCount")?.data).toBe(10);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			strategy.assignToResult(result, 42);
			expect(result.prCount).toBe(42);
		});
	});

	// ── issueCount ───────────────────────────────────────────────────────

	describe("IssueCountStrategy", () => {
		const strategy = getStrategy("issueCount");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
			expect(strategy.extractFromGraphQL).toBeDefined();
		});

		it("should extract from GraphQL with default state", () => {
			const node = makeRepoNode();
			mocks.extractIssueCount.mockReturnValue(8);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractIssueCount).toHaveBeenCalledWith(node, "open");
		});

		it("should extract from GraphQL with custom state", () => {
			const node = makeRepoNode();
			mocks.extractIssueCount.mockReturnValue(38);

			strategy.extractFromGraphQL!(cache, REPO, node, { issueState: "all" });

			expect(mocks.extractIssueCount).toHaveBeenCalledWith(node, "all");
		});

		it("should fetch via REST", async () => {
			mocks.fetchIssueCount.mockResolvedValue(15);
			await strategy.fetchViaREST(cache, REPO, TOKEN, { issueState: "closed" });

			expect(mocks.fetchIssueCount).toHaveBeenCalledWith("owner", "repo", TOKEN, "closed");
			expect(cache.getStale(REPO, "issueCount")?.data).toBe(15);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			strategy.assignToResult(result, 99);
			expect(result.issueCount).toBe(99);
		});
	});

	// ── latestRelease ────────────────────────────────────────────────────

	describe("LatestReleaseStrategy", () => {
		const strategy = getStrategy("latestRelease");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
		});

		it("should extract from GraphQL with default params", () => {
			const node = makeRepoNode();
			const release = { tag_name: "v1.0.0" };
			mocks.extractLatestRelease.mockReturnValue(release);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractLatestRelease).toHaveBeenCalledWith(node, false);
		});

		it("should extract from GraphQL with includePreReleases", () => {
			const node = makeRepoNode();
			mocks.extractLatestRelease.mockReturnValue(null);

			strategy.extractFromGraphQL!(cache, REPO, node, { includePreReleases: true });

			expect(mocks.extractLatestRelease).toHaveBeenCalledWith(node, true);
		});

		it("should fetch via REST", async () => {
			const release = { tag_name: "v2.0.0" };
			mocks.fetchLatestRelease.mockResolvedValue(release);

			await strategy.fetchViaREST(cache, REPO, TOKEN, { includePreReleases: true });

			expect(mocks.fetchLatestRelease).toHaveBeenCalledWith("owner", "repo", TOKEN, true);
			expect(cache.getStale(REPO, "latestRelease")?.data).toBe(release);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const release = { tag_name: "v1.0.0" };
			strategy.assignToResult(result, release);
			expect(result.latestRelease).toBe(release);
		});
	});

	// ── branches ─────────────────────────────────────────────────────────

	describe("BranchesStrategy", () => {
		const strategy = getStrategy("branches");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
		});

		it("should extract from GraphQL", () => {
			const node = makeRepoNode();
			const branches = [{ name: "main", commitSha: "abc" }];
			mocks.extractBranches.mockReturnValue(branches);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractBranches).toHaveBeenCalledWith(node);
			expect(cache.getStale(REPO, "branches")?.data).toBe(branches);
		});

		it("should fetch via REST", async () => {
			const branches = [{ name: "main" }];
			mocks.fetchBranchNetwork.mockResolvedValue(branches);

			await strategy.fetchViaREST(cache, REPO, TOKEN);

			expect(mocks.fetchBranchNetwork).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(cache.getStale(REPO, "branches")?.data).toBe(branches);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const branches = [{ name: "main" }];
			strategy.assignToResult(result, branches);
			expect(result.branches).toBe(branches);
		});
	});

	// ── vulnerabilityAlerts ──────────────────────────────────────────────

	describe("VulnerabilityAlertsStrategy", () => {
		const strategy = getStrategy("vulnerabilityAlerts");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
		});

		it("should extract from GraphQL", () => {
			const node = makeRepoNode();
			const alerts = { critical: 0, high: 1, medium: 0, low: 1, total: 2 };
			mocks.extractSecurityAlerts.mockReturnValue(alerts);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractSecurityAlerts).toHaveBeenCalledWith(node);
			expect(cache.getStale(REPO, "vulnerabilityAlerts")?.data).toBe(alerts);
		});

		it("should fetch via REST", async () => {
			const alerts = { critical: 1, high: 0, medium: 0, low: 0, total: 1 };
			mocks.fetchDependabotAlerts.mockResolvedValue(alerts);

			await strategy.fetchViaREST(cache, REPO, TOKEN);

			expect(mocks.fetchDependabotAlerts).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(cache.getStale(REPO, "vulnerabilityAlerts")?.data).toBe(alerts);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const alerts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
			strategy.assignToResult(result, alerts);
			expect(result.vulnerabilityAlerts).toBe(alerts);
		});
	});

	// ── discussions (GraphQL-only) ───────────────────────────────────────

	describe("DiscussionsStrategy", () => {
		const strategy = getStrategy("discussions");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
		});

		it("should extract from GraphQL", () => {
			const node = makeRepoNode();
			const discussions = { totalCount: 5, answeredCount: 2, items: [] };
			mocks.extractDiscussions.mockReturnValue(discussions);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractDiscussions).toHaveBeenCalledWith(node);
			expect(cache.getStale(REPO, "discussions")?.data).toBe(discussions);
		});

		it("should be a no-op for REST (GraphQL-only)", async () => {
			await strategy.fetchViaREST(cache, REPO, TOKEN);
			expect(cache.getStale(REPO, "discussions")).toBeNull();
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const discussions = { totalCount: 3, answeredCount: 1, items: [] };
			strategy.assignToResult(result, discussions);
			expect(result.discussions).toBe(discussions);
		});
	});

	// ── projectsV2 (GraphQL-only) ───────────────────────────────────────

	describe("ProjectsV2Strategy", () => {
		const strategy = getStrategy("projectsV2");

		it("should support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(true);
		});

		it("should extract from GraphQL", () => {
			const node = makeRepoNode();
			const projects = { projects: [] };
			mocks.extractProjectsV2.mockReturnValue(projects);

			strategy.extractFromGraphQL!(cache, REPO, node);

			expect(mocks.extractProjectsV2).toHaveBeenCalledWith(node);
			expect(cache.getStale(REPO, "projectsV2")?.data).toBe(projects);
		});

		it("should be a no-op for REST (GraphQL-only)", async () => {
			await strategy.fetchViaREST(cache, REPO, TOKEN);
			expect(cache.getStale(REPO, "projectsV2")).toBeNull();
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const projects = { projects: [{ title: "Board" }] };
			strategy.assignToResult(result, projects);
			expect(result.projectsV2).toBe(projects);
		});
	});

	// ── workflowRuns (REST-only) ─────────────────────────────────────────

	describe("WorkflowRunsStrategy", () => {
		const strategy = getStrategy("workflowRuns");

		it("should NOT support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(false);
			expect(strategy.extractFromGraphQL).toBeUndefined();
		});

		it("should fetch via REST", async () => {
			const info = { latestRun: { id: 1, status: "completed" } };
			mocks.fetchWorkflowInfo.mockResolvedValue(info);

			await strategy.fetchViaREST(cache, REPO, TOKEN, {
				branch: "main",
				workflowFile: "ci.yml",
				environment: "production",
			});

			expect(mocks.fetchWorkflowInfo).toHaveBeenCalledWith("owner", "repo", TOKEN, {
				branch: "main",
				workflowFile: "ci.yml",
				environment: "production",
			});
			expect(cache.getStale(REPO, "workflowRuns")?.data).toBe(info);
		});

		it("should skip REST fetch when repo is invalid", async () => {
			mocks.parseRepoIdentifier.mockReturnValue(null);
			await strategy.fetchViaREST(cache, "invalid", TOKEN);
			expect(mocks.fetchWorkflowInfo).not.toHaveBeenCalled();
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const info = { latestRun: { id: 1 } };
			strategy.assignToResult(result, info);
			expect(result.workflowRuns).toBe(info);
		});
	});

	// ── commitActivity (REST-only) ───────────────────────────────────────

	describe("CommitActivityStrategy", () => {
		const strategy = getStrategy("commitActivity");

		it("should NOT support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(false);
			expect(strategy.extractFromGraphQL).toBeUndefined();
		});

		it("should fetch via REST", async () => {
			const weeks = [{ week: 1, total: 10 }];
			mocks.fetchCommitActivityWeeks.mockResolvedValue(weeks);

			await strategy.fetchViaREST(cache, REPO, TOKEN);

			expect(mocks.fetchCommitActivityWeeks).toHaveBeenCalledWith("owner", "repo", TOKEN);
			expect(cache.getStale(REPO, "commitActivity")?.data).toBe(weeks);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const weeks = [{ week: 1, total: 10 }];
			strategy.assignToResult(result, weeks);
			expect(result.commitActivity).toBe(weeks);
		});
	});

	// ── branchComparison (REST-only) ─────────────────────────────────────

	describe("BranchComparisonStrategy", () => {
		const strategy = getStrategy("branchComparison");

		it("should NOT support GraphQL", () => {
			expect(strategy.supportsGraphQL).toBe(false);
			expect(strategy.extractFromGraphQL).toBeUndefined();
		});

		it("should fetch via REST with default branches", async () => {
			const comparison = { ahead_by: 3, behind_by: 1 };
			mocks.fetchBranchComparison.mockResolvedValue(comparison);

			await strategy.fetchViaREST(cache, REPO, TOKEN);

			expect(mocks.fetchBranchComparison).toHaveBeenCalledWith("owner", "repo", "main", "develop", TOKEN);
			expect(cache.getStale(REPO, "branchComparison")?.data).toBe(comparison);
		});

		it("should fetch via REST with custom branches", async () => {
			const comparison = { ahead_by: 5, behind_by: 0 };
			mocks.fetchBranchComparison.mockResolvedValue(comparison);

			await strategy.fetchViaREST(cache, REPO, TOKEN, {
				baseBranch: "release",
				headBranch: "feature/x",
			});

			expect(mocks.fetchBranchComparison).toHaveBeenCalledWith("owner", "repo", "release", "feature/x", TOKEN);
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const comparison = { ahead_by: 2, behind_by: 0 };
			strategy.assignToResult(result, comparison);
			expect(result.branchComparison).toBe(comparison);
		});
	});

	// ── reviewRequestedPRs (special — coordinator-handled) ───────────────

	describe("ReviewRequestedPRsStrategy", () => {
		const strategy = getStrategy("reviewRequestedPRs");

		it("should NOT support GraphQL (search-based, handled by coordinator)", () => {
			expect(strategy.supportsGraphQL).toBe(false);
			expect(strategy.extractFromGraphQL).toBeUndefined();
		});

		it("should be a no-op for REST (handled by coordinator)", async () => {
			await strategy.fetchViaREST(cache, REPO, TOKEN);
			expect(cache.getStale(REPO, "reviewRequestedPRs")).toBeNull();
		});

		it("should assign to result", () => {
			const result: CoordinatorResult = {};
			const data = { total_count: 3, items: [{ number: 1, title: "Fix" }] };
			strategy.assignToResult(result, data);
			expect(result.reviewRequestedPRs).toBe(data);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	describe("Edge cases", () => {
		it("should handle null from parseRepoIdentifier gracefully across all REST strategies", async () => {
			mocks.parseRepoIdentifier.mockReturnValue(null);

			const restStrategies = [
				"repoMetadata", "prCount", "issueCount", "latestRelease",
				"branches", "vulnerabilityAlerts", "workflowRuns",
				"commitActivity", "branchComparison",
			];

			for (const name of restStrategies) {
				const strategy = getStrategy(name);
				// Should not throw
				await strategy.fetchViaREST(cache, "invalid-repo", TOKEN);
			}

			// None of the REST functions should have been called
			expect(mocks.fetchRepoStats).not.toHaveBeenCalled();
			expect(mocks.fetchPullRequestCount).not.toHaveBeenCalled();
			expect(mocks.fetchIssueCount).not.toHaveBeenCalled();
			expect(mocks.fetchLatestRelease).not.toHaveBeenCalled();
			expect(mocks.fetchBranchNetwork).not.toHaveBeenCalled();
			expect(mocks.fetchDependabotAlerts).not.toHaveBeenCalled();
			expect(mocks.fetchWorkflowInfo).not.toHaveBeenCalled();
			expect(mocks.fetchCommitActivityWeeks).not.toHaveBeenCalled();
			expect(mocks.fetchBranchComparison).not.toHaveBeenCalled();
		});

		it("should use correct cache source for GraphQL extraction", () => {
			const graphqlStrategies = [
				"repoMetadata", "prCount", "issueCount", "latestRelease",
				"branches", "vulnerabilityAlerts", "discussions", "projectsV2",
			];

			// Set up mocks to return dummy values
			mocks.extractRepoMetadata.mockReturnValue({});
			mocks.extractPRCount.mockReturnValue(0);
			mocks.extractIssueCount.mockReturnValue(0);
			mocks.extractLatestRelease.mockReturnValue(null);
			mocks.extractBranches.mockReturnValue([]);
			mocks.extractSecurityAlerts.mockReturnValue({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
			mocks.extractDiscussions.mockReturnValue({ totalCount: 0, answeredCount: 0, items: [] });
			mocks.extractProjectsV2.mockReturnValue({ projects: [] });

			const node = makeRepoNode();

			for (const name of graphqlStrategies) {
				const strategy = getStrategy(name);
				strategy.extractFromGraphQL!(cache, REPO, node);
				expect(cache.getStale(REPO, name as never)?.source).toBe("graphql");
			}
		});

		it("should use correct cache source for REST fetch", async () => {
			const restPairs: Array<{ name: string; mock: ReturnType<typeof vi.fn>; value: unknown }> = [
				{ name: "prCount", mock: mocks.fetchPullRequestCount, value: 5 },
				{ name: "issueCount", mock: mocks.fetchIssueCount, value: 3 },
				{ name: "branches", mock: mocks.fetchBranchNetwork, value: [] },
				{ name: "commitActivity", mock: mocks.fetchCommitActivityWeeks, value: [] },
			];

			for (const { name, mock, value } of restPairs) {
				mock.mockResolvedValue(value);
				const strategy = getStrategy(name);
				await strategy.fetchViaREST(cache, REPO, TOKEN);
				expect(cache.getStale(REPO, name as never)?.source).toBe("rest");
			}
		});
	});
});
