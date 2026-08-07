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
import { extractReviewRequestedPRs } from "./data-fragments";
import { fetchReviewRequestedPRs } from "./github-api";
import { parseRepoIdentifier } from "./github";
import { fragmentRegistry } from "./fragment-strategies";
import { fragmentCacheKey } from "./fragment-cache-key";
import streamDeck from "@elgato/streamdeck";

/** Cache key for `reviewRequestedPRs` when no repository is configured. */
const GLOBAL_CACHE_KEY = "__global__";

/** A repo-scoped GraphQL fragment together with the params to extract it with. */
interface GraphQLFragmentTarget {
	fragment: GraphQLFragmentName;
	params?: FragmentParams;
}

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
	private refreshCallbacks: Map<string, () => Promise<void>>;

	constructor(cache?: RepoDataCache) {
		this.cache = cache ?? new RepoDataCache();
		this.subscriptions = new Map();
		this.refreshCallbacks = new Map();
	}

	/**
	 * Register an action's data needs.
	 * Call in onWillAppear.
	 *
	 * @param subscription - The action's data subscription.
	 * @param onSiblingRefresh - Optional callback fired when a sibling action
	 *   (same repo) force-refreshes. Use to re-render with fresh cached data.
	 */
	subscribe(subscription: DataSubscription, onSiblingRefresh?: () => Promise<void>): void {
		this.subscriptions.set(subscription.actionId, subscription);
		if (onSiblingRefresh) {
			this.refreshCallbacks.set(subscription.actionId, onSiblingRefresh);
		} else {
			this.refreshCallbacks.delete(subscription.actionId);
		}
	}

	/**
	 * Remove an action's subscription.
	 * Call in onWillDisappear. Triggers cache cleanup.
	 */
	unsubscribe(actionId: string): void {
		this.subscriptions.delete(actionId);
		this.refreshCallbacks.delete(actionId);
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

		const staleFragments = fragments.filter(
			(frag) => this.cache.get(this.cacheKeyFor(repo, frag, params), frag, maxAgeSec) === null,
		);

		if (staleFragments.length === 0) {
			return this.buildResult(repo, fragments, maxAgeSec, params);
		}

		await this.fetchStaleFragments(repo, staleFragments, token, params);

		return this.buildResult(repo, fragments, maxAgeSec, params);
	}

	/**
	 * Invalidate cached data for an action's fragments and fetch fresh.
	 * Used for force-refresh (double-click, touch tap, dial rotate).
	 * After fetching, notifies sibling actions watching the same repo
	 * so they can re-render with the fresh cached data.
	 */
	async invalidateAndFetch(actionId: string, token: string): Promise<CoordinatorResult> {
		const subscription = this.subscriptions.get(actionId);
		if (!subscription) {
			throw new Error(`No subscription found for action "${actionId}"`);
		}

		for (const frag of subscription.fragments) {
			this.cache.invalidate(this.cacheKeyFor(subscription.repo, frag, subscription.params), [frag]);
		}

		const result = await this.fetchData(actionId, token);

		this.notifySiblings(actionId);

		return result;
	}

	/**
	 * Notify sibling actions watching the same repo to re-render.
	 * Called after invalidateAndFetch so siblings pick up fresh cached data.
	 */
	private notifySiblings(triggerActionId: string): void {
		const subscription = this.subscriptions.get(triggerActionId);
		if (!subscription) return;

		for (const [otherId, otherSub] of this.subscriptions) {
			if (otherId !== triggerActionId && otherSub.repo === subscription.repo) {
				const callback = this.refreshCallbacks.get(otherId);
				if (callback) {
					callback().catch(() => {});
				}
			}
		}
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
	 * Resolves the cache key a fragment is stored under.
	 *
	 * Delegates to {@link fragmentCacheKey}, which separates entries whose
	 * content depends on the subscriber's params, and handles the one fragment
	 * that is not repo-scoped: `reviewRequestedPRs` queries across repositories
	 * and falls back to a global key when no repo is configured.
	 */
	private cacheKeyFor(repo: string, fragment: DataFragmentName, params?: FragmentParams): string {
		if (fragment === "reviewRequestedPRs") return repo || GLOBAL_CACHE_KEY;
		return fragmentCacheKey(repo, fragment, params);
	}

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
			const targets = this.getRepoScopedGraphQLTargets(repo);
			graphqlFailed = !(await this.fetchGraphQLBatch(repo, targets, token));
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
	 * Gets every repo-scoped GraphQL fragment a repo's subscribers need, paired
	 * with the params to extract it with.
	 *
	 * The same fragment appears more than once when subscribers request it with
	 * different params — two PR counters showing open and closed counts, say.
	 * Each variant is cached separately, so each one has to be extracted
	 * separately; the batched query itself is unaffected, since the response
	 * carries the data for all of them. Targets resolving to the same cache
	 * entry are deduplicated.
	 */
	private getRepoScopedGraphQLTargets(repo: string): GraphQLFragmentTarget[] {
		const targets = new Map<string, GraphQLFragmentTarget>();

		for (const sub of this.subscriptions.values()) {
			if (sub.repo !== repo) continue;

			for (const frag of sub.fragments) {
				if (!isGraphQLFragment(frag) || frag === "reviewRequestedPRs") continue;
				const key = `${frag}@${this.cacheKeyFor(repo, frag, sub.params)}`;
				if (!targets.has(key)) {
					targets.set(key, { fragment: frag, params: sub.params });
				}
			}
		}

		return [...targets.values()];
	}

	/**
	 * Builds and executes a batched GraphQL query for repo-scoped fragments.
	 * Returns true on success, false on failure.
	 */
	private async fetchGraphQLBatch(
		repo: string,
		targets: GraphQLFragmentTarget[],
		token: string,
	): Promise<boolean> {
		if (targets.length === 0) return true;

		const parsed = parseRepoIdentifier(repo);
		if (!parsed) return false;

		const queryFragments = [...new Set(targets.map((t) => t.fragment))];

		try {
			const query = buildRepoQuery(queryFragments);
			const result = await executeGraphQLQuery<GraphQLRepoResponse["data"]>(
				token,
				query,
				{ owner: parsed.owner, name: parsed.repo },
			);

			const node = result.data?.repository;
			if (!node) return false;

			// Extract and cache each fragment variant individually
			for (const { fragment, params } of targets) {
				try {
					this.extractAndCacheFragment(repo, fragment, node, params);
				} catch (err) {
					// Individual extractor failed — try REST fallback for this fragment
					streamDeck.logger.debug(`Fragment extraction failed for ${fragment} on ${repo}, falling back to REST: ${err instanceof Error ? err.message : "unknown"}`);
					await this.fetchRESTFragment(repo, fragment, token, params);
				}
			}

			return true;
		} catch (err) {
			// Total GraphQL failure — caller will fall back to REST
			streamDeck.logger.debug(`GraphQL batch failed for ${repo}: ${err instanceof Error ? err.message : "unknown"}`);
			return false;
		}
	}

	/**
	 * Extracts data from a GraphQL repo node and caches it.
	 * Delegates to the registered {@link FragmentStrategy} for the fragment.
	 */
	private extractAndCacheFragment(
		repo: string,
		fragment: GraphQLFragmentName,
		node: GraphQLRepoNode,
		params?: FragmentParams,
	): void {
		const strategy = fragmentRegistry.get(fragment);
		if (strategy?.supportsGraphQL && strategy.extractFromGraphQL) {
			strategy.extractFromGraphQL(this.cache, repo, node, params);
		}
	}

	/**
	 * Fetches a single fragment via REST API and caches the result.
	 * Delegates to the registered {@link FragmentStrategy} for the fragment.
	 */
	private async fetchRESTFragment(
		repo: string,
		fragment: DataFragmentName,
		token: string,
		params?: FragmentParams,
	): Promise<void> {
		const strategy = fragmentRegistry.get(fragment);
		if (!strategy) return;

		try {
			await strategy.fetchViaREST(this.cache, repo, token, params);
		} catch (err) {
			// REST also failed — stale cache data (if any) will be used as fallback
			streamDeck.logger.debug(`REST fallback failed for ${fragment} on ${repo}: ${err instanceof Error ? err.message : "unknown"}`);
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
		const cacheKey = this.cacheKeyFor(repo, "reviewRequestedPRs");

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
		params?: FragmentParams,
	): CoordinatorResult {
		const result: CoordinatorResult = {};
		const errors: Record<string, string> = {};

		for (const frag of fragments) {
			const cacheKey = this.cacheKeyFor(repo, frag, params);
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
	 * Delegates to the registered {@link FragmentStrategy} for the fragment.
	 */
	private assignFragmentToResult(
		result: CoordinatorResult,
		fragment: DataFragmentName,
		data: unknown,
	): void {
		const strategy = fragmentRegistry.get(fragment);
		if (strategy) {
			strategy.assignToResult(result, data);
		}
	}
}

