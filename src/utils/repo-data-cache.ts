/**
 * Per-repository data cache with field-level staleness tracking.
 *
 * Stores fetched data (GraphQL or REST) keyed by repository and data fragment name.
 * Each fragment has its own timestamp, allowing the coordinator to selectively
 * refresh only stale data while serving fresh data from cache.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { CacheEntry, DataFragmentName, DataSource } from "../types";

/**
 * Per-repository data cache with field-level staleness tracking.
 *
 * The outer map is keyed by repository identifier ("owner/repo"),
 * and the inner map is keyed by {@link DataFragmentName}. Each entry
 * carries its own timestamp so the coordinator can selectively refresh
 * only the fragments that have gone stale.
 */
export class RepoDataCache {
	private cache = new Map<string, Map<DataFragmentName, CacheEntry>>();
	/** Last time each repo was touched (subscribed or had data set). Drives retention-aware cleanup. */
	private lastSubscribedAt = new Map<string, number>();

	/**
	 * Stamp a repo as actively in use. Coordinator should call on `subscribe()`
	 * so that flipping editor focus A → B → A within the retention window
	 * reuses cached fragments instead of refetching.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 */
	touch(repo: string): void {
		this.lastSubscribedAt.set(repo, Date.now());
	}

	/**
	 * Gets cached data for a fragment if it's fresh enough.
	 * Returns `null` if no cache exists or data is stale.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragment - The data fragment to retrieve
	 * @param maxAgeSec - Maximum age in seconds before data is considered stale
	 */
	get<T = unknown>(repo: string, fragment: DataFragmentName, maxAgeSec: number): CacheEntry<T> | null {
		const entry = this.cache.get(repo)?.get(fragment);
		if (!entry) return null;

		const ageSec = (Date.now() - entry.fetchedAt) / 1000;
		if (ageSec > maxAgeSec) return null;

		return entry as CacheEntry<T>;
	}

	/**
	 * Stores data for a fragment, recording the current time and data source.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragment - The data fragment to store
	 * @param data - The data payload
	 * @param source - Whether data came from GraphQL or REST
	 */
	set(repo: string, fragment: DataFragmentName, data: unknown, source: DataSource): void {
		let repoMap = this.cache.get(repo);
		if (!repoMap) {
			repoMap = new Map();
			this.cache.set(repo, repoMap);
		}
		repoMap.set(fragment, { data, fetchedAt: Date.now(), source });
		this.lastSubscribedAt.set(repo, Date.now());
	}

	/**
	 * Marks specific fragments (or all) as stale by setting `fetchedAt` to 0.
	 * Does **not** delete the data — stale data can still be returned as fallback
	 * via {@link getStale}.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragments - Fragments to invalidate; omit to invalidate all
	 */
	invalidate(repo: string, fragments?: DataFragmentName[]): void {
		const repoMap = this.cache.get(repo);
		if (!repoMap) return;

		const targets = fragments ?? Array.from(repoMap.keys());
		for (const frag of targets) {
			const entry = repoMap.get(frag);
			if (entry) {
				entry.fetchedAt = 0;
			}
		}
	}

	/**
	 * Returns which of the given fragments need refreshing because they are
	 * missing or older than `maxAgeSec`.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragments - The set of fragments to check
	 * @param maxAgeSec - Maximum age in seconds before data is considered stale
	 */
	getStaleFragments(repo: string, fragments: DataFragmentName[], maxAgeSec: number): DataFragmentName[] {
		return fragments.filter((f) => this.get(repo, f, maxAgeSec) === null);
	}

	/**
	 * Removes cache entries for repos not in the active set.
	 *
	 * With `retentionMs > 0`, repos that just lost their last subscriber are kept
	 * warm for the retention window so that a quick return (e.g. editor focus
	 * flipping between projects) avoids a round-trip to GitHub. Pass `0` for
	 * immediate eviction — the original behavior.
	 *
	 * @param activeRepos - Set of repository identifiers currently in use
	 * @param retentionMs - Grace period (ms) to keep orphaned repos warm. Default 0.
	 */
	cleanup(activeRepos: Set<string>, retentionMs = 0): void {
		const now = Date.now();
		for (const repo of this.cache.keys()) {
			if (activeRepos.has(repo)) continue;

			if (retentionMs > 0) {
				const lastSeen = this.lastSubscribedAt.get(repo) ?? 0;
				if (now - lastSeen <= retentionMs) continue;
			}

			this.cache.delete(repo);
			this.lastSubscribedAt.delete(repo);
		}
	}

	/**
	 * Returns `true` if the cache has **any** data for the fragment, even if stale.
	 * Useful for deciding whether fallback data is available during errors.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragment - The data fragment to check
	 */
	has(repo: string, fragment: DataFragmentName): boolean {
		return this.cache.get(repo)?.has(fragment) ?? false;
	}

	/**
	 * Gets cached data regardless of staleness (for error fallback).
	 * Returns `null` only if no data has ever been cached for this fragment.
	 *
	 * @param repo - Repository identifier ("owner/repo")
	 * @param fragment - The data fragment to retrieve
	 */
	getStale<T = unknown>(repo: string, fragment: DataFragmentName): CacheEntry<T> | null {
		const entry = this.cache.get(repo)?.get(fragment);
		return entry ? (entry as CacheEntry<T>) : null;
	}

	/** Number of repositories currently in the cache. */
	get size(): number {
		return this.cache.size;
	}

	/** Clears all cached data. */
	clear(): void {
		this.cache.clear();
		this.lastSubscribedAt.clear();
	}
}
