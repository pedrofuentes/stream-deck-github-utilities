/**
 * Per-repository data cache with field-level staleness tracking.
 *
 * Stores fetched data (GraphQL or REST) keyed by cache key and data fragment name.
 * Each fragment has its own timestamp, allowing the coordinator to selectively
 * refresh only stale data while serving fresh data from cache.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { CacheEntry, DataFragmentName, DataSource } from "../types";
import { repoFromCacheKey } from "./fragment-cache-key";

/**
 * Per-repository data cache with field-level staleness tracking.
 *
 * The outer map is keyed by the cache key produced by {@link fragmentCacheKey} —
 * the repository identifier ("owner/repo"), plus a discriminator for fragments
 * whose result depends on the requesting action's settings — and the inner map
 * is keyed by {@link DataFragmentName}. Each entry carries its own timestamp so
 * the coordinator can selectively refresh only the fragments that have gone stale.
 */
export class RepoDataCache {
	private cache = new Map<string, Map<DataFragmentName, CacheEntry>>();

	/**
	 * Gets cached data for a fragment if it's fresh enough.
	 * Returns `null` if no cache exists or data is stale.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragment - The data fragment to retrieve
	 * @param maxAgeSec - Maximum age in seconds before data is considered stale
	 */
	get<T = unknown>(cacheKey: string, fragment: DataFragmentName, maxAgeSec: number): CacheEntry<T> | null {
		const entry = this.cache.get(cacheKey)?.get(fragment);
		if (!entry) return null;

		const ageSec = (Date.now() - entry.fetchedAt) / 1000;
		if (ageSec > maxAgeSec) return null;

		return entry as CacheEntry<T>;
	}

	/**
	 * Stores data for a fragment, recording the current time and data source.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragment - The data fragment to store
	 * @param data - The data payload
	 * @param source - Whether data came from GraphQL or REST
	 */
	set(cacheKey: string, fragment: DataFragmentName, data: unknown, source: DataSource): void {
		let fragmentMap = this.cache.get(cacheKey);
		if (!fragmentMap) {
			fragmentMap = new Map();
			this.cache.set(cacheKey, fragmentMap);
		}
		fragmentMap.set(fragment, { data, fetchedAt: Date.now(), source });
	}

	/**
	 * Marks specific fragments (or all) as stale by setting `fetchedAt` to 0.
	 * Does **not** delete the data — stale data can still be returned as fallback
	 * via {@link getStale}.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragments - Fragments to invalidate; omit to invalidate all
	 */
	invalidate(cacheKey: string, fragments?: DataFragmentName[]): void {
		const fragmentMap = this.cache.get(cacheKey);
		if (!fragmentMap) return;

		const targets = fragments ?? Array.from(fragmentMap.keys());
		for (const frag of targets) {
			const entry = fragmentMap.get(frag);
			if (entry) {
				entry.fetchedAt = 0;
			}
		}
	}

	/**
	 * Returns which of the given fragments need refreshing because they are
	 * missing or older than `maxAgeSec`.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragments - The set of fragments to check
	 * @param maxAgeSec - Maximum age in seconds before data is considered stale
	 */
	getStaleFragments(cacheKey: string, fragments: DataFragmentName[], maxAgeSec: number): DataFragmentName[] {
		return fragments.filter((f) => this.get(cacheKey, f, maxAgeSec) === null);
	}

	/**
	 * Removes cache entries for repos not in the active set.
	 * Call periodically to prevent memory leaks when repos are removed
	 * from Stream Deck actions.
	 *
	 * A repository may hold several entries — one per parameter variant, see
	 * {@link fragmentCacheKey} — so keys are matched by their repository part
	 * rather than compared verbatim.
	 *
	 * @param activeRepos - Set of repository identifiers currently in use
	 */
	cleanup(activeRepos: Set<string>): void {
		for (const key of this.cache.keys()) {
			if (!activeRepos.has(repoFromCacheKey(key))) {
				this.cache.delete(key);
			}
		}
	}

	/**
	 * Returns `true` if the cache has **any** data for the fragment, even if stale.
	 * Useful for deciding whether fallback data is available during errors.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragment - The data fragment to check
	 */
	has(cacheKey: string, fragment: DataFragmentName): boolean {
		return this.cache.get(cacheKey)?.has(fragment) ?? false;
	}

	/**
	 * Gets cached data regardless of staleness (for error fallback).
	 * Returns `null` only if no data has ever been cached for this fragment.
	 *
	 * @param cacheKey - Cache key from {@link fragmentCacheKey}
	 * @param fragment - The data fragment to retrieve
	 */
	getStale<T = unknown>(cacheKey: string, fragment: DataFragmentName): CacheEntry<T> | null {
		const entry = this.cache.get(cacheKey)?.get(fragment);
		return entry ? (entry as CacheEntry<T>) : null;
	}

	/** Number of cache keys currently in the cache. */
	get size(): number {
		return this.cache.size;
	}

	/** Clears all cached data. */
	clear(): void {
		this.cache.clear();
	}
}
