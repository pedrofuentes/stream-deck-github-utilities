/**
 * Fragment strategy implementations for the GraphQL query coordinator.
 *
 * Each strategy encapsulates how to extract, fetch, and assign data for a
 * single DataFragmentName. The coordinator delegates to these strategies
 * instead of using switch statements, making it trivial to add new fragments.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type {
	CoordinatorResult,
	DataFragmentName,
	FragmentParams,
	GraphQLRepoNode,
} from "../types";
import type { RepoDataCache } from "./repo-data-cache";
import {
	extractRepoMetadata,
	extractPRCount,
	extractIssueCount,
	extractLatestRelease,
	extractBranches,
	extractSecurityAlerts,
	extractDiscussions,
	extractProjectsV2,
} from "./data-fragments";
import {
	fetchRepoStats,
	fetchOpenPullRequestCount,
	fetchPullRequestCount,
	fetchIssueCount,
	fetchLatestRelease,
	fetchBranchNetwork,
	fetchDependabotAlerts,
	fetchWorkflowInfo,
	fetchCommitActivityWeeks,
	fetchBranchComparison,
} from "./github-api";
import { parseRepoIdentifier } from "./github";

/**
 * Strategy for fetching, extracting, and assigning a single data fragment.
 *
 * Each {@link DataFragmentName} has a corresponding strategy that knows how to:
 * - Extract data from a batched GraphQL response (if supported)
 * - Fetch data via REST API (fallback or primary for REST-only fragments)
 * - Assign cached data to the appropriate field on a {@link CoordinatorResult}
 */
export interface FragmentStrategy {
	/** The fragment name this strategy handles. */
	readonly name: DataFragmentName;
	/** Whether this fragment can be extracted from a batched GraphQL response. */
	readonly supportsGraphQL: boolean;
	/** Extract this fragment's data from a GraphQL repository node and cache it. */
	extractFromGraphQL?(cache: RepoDataCache, repo: string, node: GraphQLRepoNode, params?: FragmentParams): void;
	/** Fetch this fragment's data via REST API and cache it. */
	fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void>;
	/** Assign data to the appropriate field on a {@link CoordinatorResult}. */
	assignToResult(result: CoordinatorResult, data: unknown): void;
}

// ─── Strategy implementations ────────────────────────────────────────────────

class RepoMetadataStrategy implements FragmentStrategy {
	readonly name = "repoMetadata" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode): void {
		cache.set(repo, "repoMetadata", extractRepoMetadata(node), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const [stats, openPRCount] = await Promise.all([
			fetchRepoStats(parsed.owner, parsed.repo, token),
			fetchOpenPullRequestCount(parsed.owner, parsed.repo, token),
		]);
		stats.open_pull_request_count = openPRCount;
		cache.set(repo, "repoMetadata", stats, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.repoMetadata = data as CoordinatorResult["repoMetadata"];
	}
}

class PRCountStrategy implements FragmentStrategy {
	readonly name = "prCount" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode, params?: FragmentParams): void {
		cache.set(repo, "prCount", extractPRCount(node, (params?.prState ?? "open") as "open" | "closed" | "all"), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const count = await fetchPullRequestCount(parsed.owner, parsed.repo, token, params?.prState ?? "open");
		cache.set(repo, "prCount", count, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.prCount = data as CoordinatorResult["prCount"];
	}
}

class IssueCountStrategy implements FragmentStrategy {
	readonly name = "issueCount" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode, params?: FragmentParams): void {
		cache.set(repo, "issueCount", extractIssueCount(node, (params?.issueState ?? "open") as "open" | "closed" | "all"), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const count = await fetchIssueCount(parsed.owner, parsed.repo, token, params?.issueState ?? "open");
		cache.set(repo, "issueCount", count, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.issueCount = data as CoordinatorResult["issueCount"];
	}
}

class LatestReleaseStrategy implements FragmentStrategy {
	readonly name = "latestRelease" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode, params?: FragmentParams): void {
		cache.set(repo, "latestRelease", extractLatestRelease(node, params?.includePreReleases ?? false), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const release = await fetchLatestRelease(parsed.owner, parsed.repo, token, params?.includePreReleases ?? false);
		cache.set(repo, "latestRelease", release, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.latestRelease = data as CoordinatorResult["latestRelease"];
	}
}

class BranchesStrategy implements FragmentStrategy {
	readonly name = "branches" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode): void {
		cache.set(repo, "branches", extractBranches(node), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const branches = await fetchBranchNetwork(parsed.owner, parsed.repo, token);
		cache.set(repo, "branches", branches, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.branches = data as CoordinatorResult["branches"];
	}
}

class VulnerabilityAlertsStrategy implements FragmentStrategy {
	readonly name = "vulnerabilityAlerts" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode): void {
		cache.set(repo, "vulnerabilityAlerts", extractSecurityAlerts(node), "graphql");
	}

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const alerts = await fetchDependabotAlerts(parsed.owner, parsed.repo, token);
		cache.set(repo, "vulnerabilityAlerts", alerts, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.vulnerabilityAlerts = data as CoordinatorResult["vulnerabilityAlerts"];
	}
}

class DiscussionsStrategy implements FragmentStrategy {
	readonly name = "discussions" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode): void {
		cache.set(repo, "discussions", extractDiscussions(node), "graphql");
	}

	async fetchViaREST(): Promise<void> {
		// No REST fallback — discussions are GraphQL-only
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.discussions = data as CoordinatorResult["discussions"];
	}
}

class ProjectsV2Strategy implements FragmentStrategy {
	readonly name = "projectsV2" as const;
	readonly supportsGraphQL = true;

	extractFromGraphQL(cache: RepoDataCache, repo: string, node: GraphQLRepoNode): void {
		cache.set(repo, "projectsV2", extractProjectsV2(node), "graphql");
	}

	async fetchViaREST(): Promise<void> {
		// No REST fallback — Projects V2 are GraphQL-only
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.projectsV2 = data as CoordinatorResult["projectsV2"];
	}
}

class WorkflowRunsStrategy implements FragmentStrategy {
	readonly name = "workflowRuns" as const;
	readonly supportsGraphQL = false;

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const info = await fetchWorkflowInfo(parsed.owner, parsed.repo, token, {
			branch: params?.branch,
			workflowFile: params?.workflowFile,
			environment: params?.environment,
		});
		cache.set(repo, "workflowRuns", info, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.workflowRuns = data as CoordinatorResult["workflowRuns"];
	}
}

class CommitActivityStrategy implements FragmentStrategy {
	readonly name = "commitActivity" as const;
	readonly supportsGraphQL = false;

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const weeks = await fetchCommitActivityWeeks(parsed.owner, parsed.repo, token);
		cache.set(repo, "commitActivity", weeks, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.commitActivity = data as CoordinatorResult["commitActivity"];
	}
}

class BranchComparisonStrategy implements FragmentStrategy {
	readonly name = "branchComparison" as const;
	readonly supportsGraphQL = false;

	async fetchViaREST(cache: RepoDataCache, repo: string, token: string, params?: FragmentParams): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;
		const base = params?.baseBranch ?? "main";
		const head = params?.headBranch ?? "develop";
		const comparison = await fetchBranchComparison(parsed.owner, parsed.repo, base, head, token);
		cache.set(repo, "branchComparison", comparison, "rest");
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.branchComparison = data as CoordinatorResult["branchComparison"];
	}
}

class ReviewRequestedPRsStrategy implements FragmentStrategy {
	readonly name = "reviewRequestedPRs" as const;
	readonly supportsGraphQL = false;

	async fetchViaREST(): Promise<void> {
		// Handled by dedicated fetchReviewRequestedPRs flow in the coordinator
	}

	assignToResult(result: CoordinatorResult, data: unknown): void {
		result.reviewRequestedPRs = data as CoordinatorResult["reviewRequestedPRs"];
	}
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Registry mapping each {@link DataFragmentName} to its strategy implementation. */
export const fragmentRegistry = new Map<DataFragmentName, FragmentStrategy>();

[
	new RepoMetadataStrategy(),
	new PRCountStrategy(),
	new IssueCountStrategy(),
	new LatestReleaseStrategy(),
	new BranchesStrategy(),
	new VulnerabilityAlertsStrategy(),
	new DiscussionsStrategy(),
	new ProjectsV2Strategy(),
	new WorkflowRunsStrategy(),
	new CommitActivityStrategy(),
	new BranchComparisonStrategy(),
	new ReviewRequestedPRsStrategy(),
].forEach(s => fragmentRegistry.set(s.name, s));
