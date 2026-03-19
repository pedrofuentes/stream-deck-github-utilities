/**
 * GraphQL Query Coordinator — centralized data fetching layer.
 *
 * Batches GraphQL queries across multiple actions watching the same repository,
 * caches results with per-fragment staleness tracking, and falls back to REST
 * API calls when GraphQL is unavailable or fails.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type {
	CoordinatorResult,
	DataFragmentName,
	DataSubscription,
	FragmentParams,
	GraphQLFragmentName,
	GraphQLRepoNode,
	GraphQLRepoResponse,
	GraphQLSearchResponse,
} from "../types";
import { RepoDataCache } from "./repo-data-cache";
import { buildRepoQuery, buildSearchQuery, isGraphQLFragment } from "./graphql-query-builder";
import { executeGraphQLQuery } from "./github-graphql";
import {
	extractRepoMetadata,
	extractPRCount,
	extractIssueCount,
	extractLatestRelease,
	extractBranches,
	extractSecurityAlerts,
	extractReviewRequestedPRs,
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
	fetchReviewRequestedPRs,
	fetchWorkflowInfo,
	fetchCommitActivityWeeks,
	fetchBranchComparison,
} from "./github-api";
import { parseRepoIdentifier } from "./github";

/**
 * Centralized data fetching coordinator for Stream Deck actions.
 *
 * Manages subscriptions from actions, batches GraphQL queries per-repo,
 * caches results with per-fragment staleness, and falls back to REST
 * when GraphQL is unavailable.
 */
export class GraphQLQueryCoordinator {
	private cache: RepoDataCache;
	private subscriptions: Map<string, DataSubscription>;

	constructor(cache?: RepoDataCache) {
		this.cache = cache ?? new RepoDataCache();
		this.subscriptions = new Map();
	}

	/**
	 * Register an action's data needs.
	 * Call in onWillAppear.
	 */
	subscribe(subscription: DataSubscription): void {
		this.subscriptions.set(subscription.actionId, subscription);
	}

	/**
	 * Remove an action's subscription.
	 * Call in onWillDisappear. Triggers cache cleanup.
	 */
	unsubscribe(actionId: string): void {
		this.subscriptions.delete(actionId);
		this.cache.cleanup(this.getActiveRepos());
	}

	/**
	 * Fetch data for an action. Cache-first: returns cached data if fresh,
	 * otherwise fetches stale fragments (batched GraphQL + REST).
	 *
	 * This is the main entry point called by actions on each poll tick.
	 */
	async fetchData(actionId: string, token: string): Promise<CoordinatorResult> {
		const subscription = this.subscriptions.get(actionId);
		if (!subscription) {
			throw new Error(`No subscription found for action "${actionId}"`);
		}

		const { repo, fragments, maxAgeSec, params } = subscription;

		const staleFragments = this.cache.getStaleFragments(repo, fragments, maxAgeSec);

		if (staleFragments.length === 0) {
			return this.buildResult(repo, fragments, maxAgeSec, params);
		}

		await this.fetchStaleFragments(repo, staleFragments, token, params);

		return this.buildResult(repo, fragments, maxAgeSec, params);
	}

	/**
	 * Invalidate cached data for an action's fragments and fetch fresh.
	 * Used for force-refresh (double-click).
	 */
	async invalidateAndFetch(actionId: string, token: string): Promise<CoordinatorResult> {
		const subscription = this.subscriptions.get(actionId);
		if (!subscription) {
			throw new Error(`No subscription found for action "${actionId}"`);
		}

		this.cache.invalidate(subscription.repo, subscription.fragments);

		return this.fetchData(actionId, token);
	}

	/**
	 * Get all unique repos that have active subscribers.
	 */
	getActiveRepos(): Set<string> {
		const repos = new Set<string>();
		for (const sub of this.subscriptions.values()) {
			if (sub.repo) {
				repos.add(sub.repo);
			}
		}
		return repos;
	}

	/**
	 * Get all fragment names needed by any subscriber for a given repo.
	 */
	getAllFragmentsForRepo(repo: string): DataFragmentName[] {
		const fragments = new Set<DataFragmentName>();
		for (const sub of this.subscriptions.values()) {
			if (sub.repo === repo) {
				for (const f of sub.fragments) {
					fragments.add(f);
				}
			}
		}
		return [...fragments];
	}

	/**
	 * Check if an action is currently subscribed.
	 */
	isSubscribed(actionId: string): boolean {
		return this.subscriptions.has(actionId);
	}

	/** Number of active subscriptions */
	get subscriptionCount(): number {
		return this.subscriptions.size;
	}

	// ─── Private helpers ─────────────────────────────────────────────────

	/**
	 * Fetches stale fragments for a repo using GraphQL + REST as appropriate.
	 */
	private async fetchStaleFragments(
		repo: string,
		staleFragments: DataFragmentName[],
		token: string,
		params?: FragmentParams,
	): Promise<void> {
		const graphqlFragments: GraphQLFragmentName[] = [];
		const restFragments: DataFragmentName[] = [];

		for (const frag of staleFragments) {
			if (frag === "reviewRequestedPRs") {
				// Handled separately — search-based, not repo-scoped
				await this.fetchReviewRequestedPRs(repo, token, params);
			} else if (isGraphQLFragment(frag)) {
				graphqlFragments.push(frag);
			} else {
				restFragments.push(frag);
			}
		}

		// For GraphQL fragments: batch ALL repo-scoped GraphQL fragments from ALL subscribers
		let graphqlFailed = false;
		if (graphqlFragments.length > 0) {
			const allRepoGraphQLFragments = this.getAllRepoScopedGraphQLFragments(repo);
			graphqlFailed = !(await this.fetchGraphQLBatch(repo, allRepoGraphQLFragments, token, params));
		}

		// Fall back to REST for GraphQL fragments that failed
		if (graphqlFailed) {
			for (const frag of graphqlFragments) {
				await this.fetchRESTFragment(repo, frag, token, params);
			}
		}

		// REST-only fragments always use REST
		for (const frag of restFragments) {
			await this.fetchRESTFragment(repo, frag, token, params);
		}
	}

	/**
	 * Gets all repo-scoped GraphQL fragment names for a repo from ALL subscribers.
	 */
	private getAllRepoScopedGraphQLFragments(repo: string): GraphQLFragmentName[] {
		const allFragments = this.getAllFragmentsForRepo(repo);
		return allFragments.filter(
			(f): f is GraphQLFragmentName => isGraphQLFragment(f) && f !== "reviewRequestedPRs",
		);
	}

	/**
	 * Builds and executes a batched GraphQL query for repo-scoped fragments.
	 * Returns true on success, false on failure.
	 */
	private async fetchGraphQLBatch(
		repo: string,
		fragments: GraphQLFragmentName[],
		token: string,
		params?: FragmentParams,
	): Promise<boolean> {
		if (fragments.length === 0) return true;

		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return false;

		const repoScopedFragments = fragments.filter((f) => f !== "reviewRequestedPRs");
		if (repoScopedFragments.length === 0) return true;

		try {
			const query = buildRepoQuery(repoScopedFragments);
			const result = await executeGraphQLQuery<GraphQLRepoResponse["data"]>(
				token,
				query,
				{ owner: parsed.owner, name: parsed.repo },
			);

			const node = result.data?.repository;
			if (!node) return false;

			// Extract and cache each fragment individually
			for (const frag of repoScopedFragments) {
				try {
					this.extractAndCacheFragment(repo, frag, node, params);
				} catch {
					// Individual extractor failed — try REST fallback for this fragment
					await this.fetchRESTFragment(repo, frag, token, params);
				}
			}

			return true;
		} catch {
			// Total GraphQL failure — caller will fall back to REST
			return false;
		}
	}

	/**
	 * Extracts data from a GraphQL repo node and caches it.
	 */
	private extractAndCacheFragment(
		repo: string,
		fragment: GraphQLFragmentName,
		node: GraphQLRepoNode,
		params?: FragmentParams,
	): void {
		switch (fragment) {
			case "repoMetadata":
				this.cache.set(repo, "repoMetadata", extractRepoMetadata(node), "graphql");
				break;
			case "prCount":
				this.cache.set(repo, "prCount", extractPRCount(node, params?.prState ?? "open"), "graphql");
				break;
			case "issueCount":
				this.cache.set(repo, "issueCount", extractIssueCount(node, params?.issueState ?? "open"), "graphql");
				break;
			case "latestRelease":
				this.cache.set(repo, "latestRelease", extractLatestRelease(node, params?.includePreReleases ?? false), "graphql");
				break;
			case "branches":
				this.cache.set(repo, "branches", extractBranches(node), "graphql");
				break;
			case "vulnerabilityAlerts":
				this.cache.set(repo, "vulnerabilityAlerts", extractSecurityAlerts(node), "graphql");
				break;
			case "discussions":
				this.cache.set(repo, "discussions", extractDiscussions(node), "graphql");
				break;
			case "projectsV2":
				this.cache.set(repo, "projectsV2", extractProjectsV2(node), "graphql");
				break;
		}
	}

	/**
	 * Fetches a single fragment via REST API and caches the result.
	 */
	private async fetchRESTFragment(
		repo: string,
		fragment: DataFragmentName,
		token: string,
		params?: FragmentParams,
	): Promise<void> {
		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return;

		const { owner, repo: repoName } = parsed;

		try {
			switch (fragment) {
				case "repoMetadata": {
					const [stats, openPRCount] = await Promise.all([
						fetchRepoStats(owner, repoName, token),
						fetchOpenPullRequestCount(owner, repoName, token),
					]);
					stats.open_pull_request_count = openPRCount;
					this.cache.set(repo, "repoMetadata", stats, "rest");
					break;
				}
				case "prCount": {
					const count = await fetchPullRequestCount(owner, repoName, token, params?.prState ?? "open");
					this.cache.set(repo, "prCount", count, "rest");
					break;
				}
				case "issueCount": {
					const count = await fetchIssueCount(owner, repoName, token, params?.issueState ?? "open");
					this.cache.set(repo, "issueCount", count, "rest");
					break;
				}
				case "latestRelease": {
					const release = await fetchLatestRelease(owner, repoName, token, params?.includePreReleases ?? false);
					this.cache.set(repo, "latestRelease", release, "rest");
					break;
				}
				case "branches": {
					const branches = await fetchBranchNetwork(owner, repoName, token);
					this.cache.set(repo, "branches", branches, "rest");
					break;
				}
				case "vulnerabilityAlerts": {
					const alerts = await fetchDependabotAlerts(owner, repoName, token);
					this.cache.set(repo, "vulnerabilityAlerts", alerts, "rest");
					break;
				}
				case "workflowRuns": {
					const info = await fetchWorkflowInfo(owner, repoName, token, {
						branch: params?.branch,
						workflowFile: params?.workflowFile,
						environment: params?.environment,
					});
					this.cache.set(repo, "workflowRuns", info, "rest");
					break;
				}
				case "commitActivity": {
					const weeks = await fetchCommitActivityWeeks(owner, repoName, token);
					this.cache.set(repo, "commitActivity", weeks, "rest");
					break;
				}
				case "branchComparison": {
					const base = params?.baseBranch ?? "main";
					const head = params?.headBranch ?? "develop";
					const comparison = await fetchBranchComparison(owner, repoName, base, head, token);
					this.cache.set(repo, "branchComparison", comparison, "rest");
					break;
				}
				// discussions and projectsV2 have no REST fallback
				case "discussions":
				case "projectsV2":
				case "reviewRequestedPRs":
					break;
			}
		} catch {
			// REST also failed — stale cache data (if any) will be used as fallback
		}
	}

	/**
	 * Fetches review-requested PRs (search-based, not repo-scoped).
	 */
	private async fetchReviewRequestedPRs(
		repo: string,
		token: string,
		_params?: FragmentParams,
	): Promise<void> {
		// Use the repo key for cache (even though the query is cross-repo)
		const cacheKey = repo || "__global__";

		try {
			const query = buildSearchQuery();
			const searchQuery = repo
				? `is:open is:pr review-requested:@me repo:${repo}`
				: "is:open is:pr review-requested:@me";

			const result = await executeGraphQLQuery<GraphQLSearchResponse["data"]>(
				token,
				query,
				{ query: searchQuery },
			);

			const data = extractReviewRequestedPRs(result.data);
			this.cache.set(cacheKey, "reviewRequestedPRs", data, "graphql");
		} catch {
			// GraphQL failed — try REST fallback
			try {
				const data = await fetchReviewRequestedPRs(token, repo || undefined);
				this.cache.set(cacheKey, "reviewRequestedPRs", data, "rest");
			} catch {
				// Both failed — stale cache (if any) will be used
			}
		}
	}

	/**
	 * Builds a CoordinatorResult from cached data for the requested fragments.
	 */
	private buildResult(
		repo: string,
		fragments: DataFragmentName[],
		maxAgeSec: number,
		_params?: FragmentParams,
	): CoordinatorResult {
		const result: CoordinatorResult = {};
		const errors: Record<string, string> = {};

		for (const frag of fragments) {
			const cacheKey = frag === "reviewRequestedPRs" ? (repo || "__global__") : repo;
			const entry = this.cache.get(cacheKey, frag, maxAgeSec);
			const staleEntry = entry ? null : this.cache.getStale(cacheKey, frag);

			if (entry) {
				this.assignFragmentToResult(result, frag, entry.data);
			} else if (staleEntry) {
				this.assignFragmentToResult(result, frag, staleEntry.data);
				errors[frag] = "Using stale data (refresh failed)";
			} else {
				errors[frag] = "No data available";
			}
		}

		if (Object.keys(errors).length > 0) {
			result.errors = errors as Partial<Record<DataFragmentName, string>>;
		}

		return result;
	}

	/**
	 * Assigns a fragment's data to the appropriate field on the result object.
	 */
	private assignFragmentToResult(
		result: CoordinatorResult,
		fragment: DataFragmentName,
		data: unknown,
	): void {
		switch (fragment) {
			case "repoMetadata":
				result.repoMetadata = data as CoordinatorResult["repoMetadata"];
				break;
			case "prCount":
				result.prCount = data as CoordinatorResult["prCount"];
				break;
			case "issueCount":
				result.issueCount = data as CoordinatorResult["issueCount"];
				break;
			case "latestRelease":
				result.latestRelease = data as CoordinatorResult["latestRelease"];
				break;
			case "branches":
				result.branches = data as CoordinatorResult["branches"];
				break;
			case "vulnerabilityAlerts":
				result.vulnerabilityAlerts = data as CoordinatorResult["vulnerabilityAlerts"];
				break;
			case "reviewRequestedPRs":
				result.reviewRequestedPRs = data as CoordinatorResult["reviewRequestedPRs"];
				break;
			case "workflowRuns":
				result.workflowRuns = data as CoordinatorResult["workflowRuns"];
				break;
			case "commitActivity":
				result.commitActivity = data as CoordinatorResult["commitActivity"];
				break;
			case "branchComparison":
				result.branchComparison = data as CoordinatorResult["branchComparison"];
				break;
			case "discussions":
				result.discussions = data as CoordinatorResult["discussions"];
				break;
			case "projectsV2":
				result.projectsV2 = data as CoordinatorResult["projectsV2"];
				break;
		}
	}
}

/** Singleton coordinator instance */
export const coordinator = new GraphQLQueryCoordinator();
