/**
 * Cache key construction for data fragments.
 *
 * Several fragments are parameterised: the same repository can be queried in
 * more than one way depending on the action's settings (which branches to
 * compare, which workflow/environment to watch, whether to count open or closed
 * pull requests, …). Keying the cache by repository alone makes those queries
 * collide, so every action watching a repository ends up rendering whichever
 * variant happened to be fetched first.
 *
 * {@link fragmentCacheKey} appends a discriminator derived from the
 * {@link FragmentParams} that actually shape the request, so each variant gets
 * its own cache entry. Fragments whose result does not depend on any parameter
 * keep the plain repository identifier as their key.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { DataFragmentName, FragmentParams } from "../types";

/**
 * Default values applied when a parameter is not supplied.
 *
 * Shared by the fragment strategies (which use them when building the actual
 * request) and by the cache key discriminators below, so that an omitted
 * parameter and its explicit default always resolve to the same cache entry.
 */
export const FRAGMENT_PARAM_DEFAULTS = {
	prState: "open",
	issueState: "open",
	includePreReleases: false,
	baseBranch: "main",
	headBranch: "develop",
	maxCommits: 100,
} as const;

/** Separator between the repository identifier and the parameter discriminator. */
const KEY_SEPARATOR = "#";

/** Derives the parameter discriminator for a single fragment. */
type CacheDiscriminator = (params?: FragmentParams) => string;

/**
 * Discriminators for the fragments whose result depends on {@link FragmentParams}.
 *
 * Fragments absent from this table (`repoMetadata`, `branches`,
 * `vulnerabilityAlerts`, `discussions`, `projectsV2`, `reviewRequestedPRs`) are
 * fully determined by the repository, and `commitActivity` always fetches the
 * full weekly history — its `timeRange` parameter only affects rendering.
 */
const cacheDiscriminators: Partial<Record<DataFragmentName, CacheDiscriminator>> = {
	prCount: (params) => params?.prState ?? FRAGMENT_PARAM_DEFAULTS.prState,
	issueCount: (params) => params?.issueState ?? FRAGMENT_PARAM_DEFAULTS.issueState,
	latestRelease: (params) =>
		(params?.includePreReleases ?? FRAGMENT_PARAM_DEFAULTS.includePreReleases) ? "pre" : "stable",
	workflowRuns: (params) =>
		[params?.workflowFile ?? "", params?.branch ?? "", params?.environment ?? ""].join("|"),
	branchComparison: (params) =>
		`${params?.baseBranch ?? FRAGMENT_PARAM_DEFAULTS.baseBranch}...${params?.headBranch ?? FRAGMENT_PARAM_DEFAULTS.headBranch}`,
	networkCommits: (params) => String(params?.maxCommits ?? FRAGMENT_PARAM_DEFAULTS.maxCommits),
};

/**
 * Builds the cache key for a fragment of a repository.
 *
 * Returns the plain repository identifier for parameter-independent fragments,
 * and `"owner/repo#<discriminator>"` for parameterised ones. The repository
 * identifier is always the part before the first separator, which lets
 * {@link RepoDataCache.cleanup} map a key back to its repository.
 *
 * @param repo - Repository identifier ("owner/repo")
 * @param fragment - The data fragment being cached
 * @param params - The parameters the fragment was (or will be) fetched with
 */
export function fragmentCacheKey(
	repo: string,
	fragment: DataFragmentName,
	params?: FragmentParams,
): string {
	const discriminator = cacheDiscriminators[fragment]?.(params);
	return discriminator === undefined ? repo : `${repo}${KEY_SEPARATOR}${discriminator}`;
}

/**
 * Extracts the repository identifier from a cache key produced by
 * {@link fragmentCacheKey}.
 *
 * @param cacheKey - A key as stored in {@link RepoDataCache}
 */
export function repoFromCacheKey(cacheKey: string): string {
	const separatorIndex = cacheKey.indexOf(KEY_SEPARATOR);
	return separatorIndex === -1 ? cacheKey : cacheKey.slice(0, separatorIndex);
}
