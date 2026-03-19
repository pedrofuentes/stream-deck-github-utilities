/**
 * GitHub REST API client for fetching repository data.
 * Uses Node.js native fetch (available in Node 20+).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { JsonValue } from "@elgato/utils";

/** Stat types supported by the plugin */
export type StatType = "stars" | "issues" | "forks" | "watchers" | "pull_requests" | "language" | "size" | "license" | "default_branch" | "visibility";

/** Ordered list of all stat types (used for cycling on short press) */
export const STAT_TYPES: readonly StatType[] = ["stars", "issues", "forks", "watchers", "pull_requests", "language", "size", "license", "default_branch", "visibility"] as const;

/** Stat types that display a numeric count */
export type NumericStatType = "stars" | "issues" | "forks" | "watchers" | "pull_requests";

/** Subset of the GitHub repository response we care about */
export interface RepoStats {
	stargazers_count: number;
	open_issues_count: number;
	forks_count: number;
	watchers_count: number;
	full_name: string;
	description: string | null;
	visibility: string;
	html_url: string;
	language: string | null;
	size: number;
	license: string | null;
	default_branch: string;
	open_pull_request_count?: number;
}

/** Rate limit information from response headers */
export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: Date;
	used: number;
}

/** Summary of a PR requesting the user's review */
export interface ReviewRequestedPR {
	number: number;
	title: string;
	user_login: string;
	html_url: string;
	created_at: string;
}

/** Structured error from the GitHub API */
export class GitHubApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly rateLimitInfo?: RateLimitInfo,
		/** Seconds to wait before retrying (from Retry-After header or rate limit reset). */
		public readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "GitHubApiError";
	}
}

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

/**
 * Extracts rate limit information from GitHub API response headers.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
	return {
		limit: parseInt(headers.get("x-ratelimit-limit") ?? "0", 10),
		remaining: parseInt(headers.get("x-ratelimit-remaining") ?? "0", 10),
		reset: new Date(parseInt(headers.get("x-ratelimit-reset") ?? "0", 10) * 1000),
		used: parseInt(headers.get("x-ratelimit-used") ?? "0", 10),
	};
}

/**
 * Builds the standard headers for GitHub API requests.
 */
function buildHeaders(token?: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": GITHUB_API_VERSION,
		"User-Agent": "stream-deck-github-utilities/1.0",
	};

	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	return headers;
}

/**
 * Fetches repository statistics from the GitHub API.
 *
 * @deprecated Use coordinator.fetchData() with "repoMetadata" fragment instead.
 *
 * @param owner - Repository owner (user or organization)
 * @param repo - Repository name
 * @param token - Optional GitHub personal access token for authenticated requests
 * @returns Repository statistics
 * @throws {GitHubApiError} on API errors (401, 403, 404, rate limit, etc.)
 */
export async function fetchRepoStats(
	owner: string,
	repo: string,
	token?: string,
): Promise<RepoStats> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		const errorBody = await response.text().catch(() => "Unknown error");

		if (response.status === 401) {
			throw new GitHubApiError("Invalid or expired GitHub token", response.status, rateLimitInfo);
		}

		if (response.status === 403 && rateLimitInfo.remaining === 0) {
			const resetTime = rateLimitInfo.reset.toLocaleTimeString();
			throw new GitHubApiError(
				`GitHub API rate limit exceeded. Resets at ${resetTime}`,
				response.status,
				rateLimitInfo,
			);
		}

		if (response.status === 403) {
			throw new GitHubApiError("Access denied. Check token permissions.", response.status, rateLimitInfo);
		}

		if (response.status === 404) {
			throw new GitHubApiError(
				`Repository "${owner}/${repo}" not found or is private`,
				response.status,
				rateLimitInfo,
			);
		}

		throw new GitHubApiError(
			`GitHub API error (${response.status}): ${errorBody}`,
			response.status,
			rateLimitInfo,
		);
	}

	const data = (await response.json()) as Record<string, unknown>;

	// Extract license SPDX ID if available
	const licenseObj = data.license as Record<string, unknown> | null;
	const licenseId = licenseObj?.spdx_id as string | null;

	return {
		stargazers_count: (data.stargazers_count as number) ?? 0,
		open_issues_count: (data.open_issues_count as number) ?? 0,
		forks_count: (data.forks_count as number) ?? 0,
		watchers_count: (data.watchers_count as number) ?? 0,
		full_name: (data.full_name as string) ?? `${owner}/${repo}`,
		description: (data.description as string | null) ?? null,
		visibility: (data.visibility as string) ?? "unknown",
		html_url: (data.html_url as string) ?? `https://github.com/${owner}/${repo}`,
		language: (data.language as string | null) ?? null,
		size: (data.size as number) ?? 0,
		license: licenseId && licenseId !== "NOASSERTION" ? licenseId : null,
		default_branch: (data.default_branch as string) ?? "main",
	};
}

/**
 * Extracts the count for a numeric stat type from repo stats.
 */
export function getStatValue(stats: RepoStats, statType: StatType): number {
	switch (statType) {
		case "stars":
			return stats.stargazers_count;
		case "issues":
			return stats.open_issues_count;
		case "forks":
			return stats.forks_count;
		case "watchers":
			return stats.watchers_count;
		case "pull_requests":
			return stats.open_pull_request_count ?? 0;
		case "size":
			return stats.size;
		default:
			return 0;
	}
}

/**
 * Returns the display string for a stat type.
 * Numeric stats get formatted with formatCount; text stats return the raw value.
 */
export function getStatDisplay(stats: RepoStats, statType: StatType, formatCountFn: (n: number) => string): string {
	switch (statType) {
		case "stars":
		case "issues":
		case "forks":
		case "watchers":
		case "pull_requests":
			return formatCountFn(getStatValue(stats, statType));
		case "language":
			return stats.language ?? "None";
		case "size":
			return formatRepoSize(stats.size);
		case "license":
			return stats.license ?? "None";
		case "default_branch":
			return stats.default_branch;
		case "visibility":
			return stats.visibility === "private" ? "Private" : "Public";
	}
}

/**
 * Formats a repository size (in KB from the GitHub API) to a human-readable string.
 */
export function formatRepoSize(sizeKb: number): string {
	if (sizeKb < 1024) return `${sizeKb} KB`;
	const mb = sizeKb / 1024;
	if (mb < 1024) return `${mb.toFixed(1)} MB`;
	const gb = mb / 1024;
	return `${gb.toFixed(1)} GB`;
}

/**
 * Returns a human-readable label for a stat type.
 */
export function getStatLabel(statType: StatType): string {
	switch (statType) {
		case "stars":
			return "Stars";
		case "issues":
			return "Issues";
		case "forks":
			return "Forks";
		case "watchers":
			return "Watchers";
		case "pull_requests":
			return "Pull Requests";
		case "language":
			return "Language";
		case "size":
			return "Size";
		case "license":
			return "License";
		case "default_branch":
			return "Branch";
		case "visibility":
			return "Visibility";
	}
}

/**
 * Returns the GitHub web URL for a specific stat type's detail page.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param statType - Which stat to link to
 * @returns The URL to open in the browser
 */
export function getStatUrl(owner: string, repo: string, statType: StatType): string {
	const base = `https://github.com/${owner}/${repo}`;
	switch (statType) {
		case "stars":
			return `${base}/stargazers`;
		case "issues":
			return `${base}/issues`;
		case "forks":
			return `${base}/forks`;
		case "watchers":
			return `${base}/watchers`;
		case "pull_requests":
			return `${base}/pulls`;
		case "language":
			return `${base}`;
		case "size":
			return `${base}`;
		case "license":
			return `${base}`;
		case "default_branch":
			return `${base}`;
		case "visibility":
			return `${base}/settings`;
	}
}

/**
 * Fetches the count of open pull requests for a repository.
 * Uses the GitHub Search API with `type:pr` for reliable counting.
 *
 * @deprecated Use coordinator.fetchData() with "prCount" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Number of open pull requests
 */
export async function fetchOpenPullRequestCount(
	owner: string,
	repo: string,
	token?: string,
): Promise<number> {
	const query = `repo:${owner}/${repo} type:pr is:open`;
	const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });

	if (!response.ok) {
		return 0; // Graceful fallback — PR count is supplementary data
	}

	const data = (await response.json()) as { total_count: number };
	return data.total_count;
}

/**
 * Fetches pull request count for a repository with a given state filter.
 * Uses the GitHub Search API with `type:pr` for reliable counting.
 *
 * @deprecated Use coordinator.fetchData() with "prCount" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param state - PR state filter: "open", "closed", or "all"
 * @returns Number of pull requests matching the filter
 * @throws {GitHubApiError} on API errors
 */
export async function fetchPullRequestCount(
	owner: string,
	repo: string,
	token?: string,
	state: "open" | "closed" | "all" = "open",
): Promise<number> {
	const stateQualifier = state === "all" ? "" : ` is:${state}`;
	const query = `repo:${owner}/${repo} type:pr${stateQualifier}`;
	const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const data = (await response.json()) as { total_count: number };
	return data.total_count;
}

/**
 * Fetches PRs that are requesting the authenticated user's review.
 * Uses the Search API with the review-requested qualifier.
 *
 * @deprecated Use coordinator.fetchData() with "reviewRequestedPRs" fragment instead.
 *
 * @param token - GitHub personal access token
 * @param repo - Optional "owner/repo" filter (shows all repos if omitted)
 * @returns Object with total_count and array of PR summary objects
 * @throws {GitHubApiError} on API errors
 */
export async function fetchReviewRequestedPRs(
	token: string,
	repo?: string,
): Promise<{ total_count: number; items: ReviewRequestedPR[] }> {
	let query = "is:open is:pr review-requested:@me";
	if (repo) {
		query += ` repo:${repo}`;
	}

	const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=10&sort=created&order=desc`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		if (response.status === 401) {
			throw new GitHubApiError("Invalid or expired GitHub token", response.status, rateLimitInfo);
		}
		if (response.status === 422) {
			throw new GitHubApiError("Search query error — token may lack permissions", response.status, rateLimitInfo);
		}
		if (response.status === 429) {
			const retryAfterSeconds = parseRetryAfter(response.headers);
			const waitSec = retryAfterSeconds ?? Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 60);
			throw new GitHubApiError(
				`GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
				response.status,
				rateLimitInfo,
				waitSec,
			);
		}
		if (response.status === 403 && rateLimitInfo.remaining === 0) {
			const resetTime = rateLimitInfo.reset.toLocaleTimeString();
			const waitSec = Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 0);
			throw new GitHubApiError(
				`GitHub API rate limit exceeded. Resets at ${resetTime}`,
				response.status,
				rateLimitInfo,
				waitSec > 0 ? waitSec : undefined,
			);
		}
		if (response.status === 403) {
			throw new GitHubApiError("Access denied. Check token permissions.", response.status, rateLimitInfo);
		}
		throw new GitHubApiError(`GitHub API error (${response.status})`, response.status, rateLimitInfo);
	}

	const data = (await response.json()) as Record<string, unknown>;
	const items = (data.items as Record<string, unknown>[] ?? []).map((item) => ({
		number: item.number as number,
		title: item.title as string,
		user_login: ((item.user as Record<string, unknown>)?.login as string) ?? "",
		html_url: item.html_url as string,
		created_at: item.created_at as string,
	}));

	return {
		total_count: (data.total_count as number) ?? 0,
		items,
	};
}

/**
 * Fetches issue count for a repository with a given state filter.
 * For "open" state, uses repo stats minus open PRs.
 * For "closed" or "all", uses the GitHub Search API with `type:issue` qualifier
 * which returns an exact count excluding PRs.
 *
 * @deprecated Use coordinator.fetchData() with "issueCount" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param state - Issue state filter: "open", "closed", or "all"
 * @returns Number of issues (excluding PRs) matching the filter
 * @throws {GitHubApiError} on API errors
 */
export async function fetchIssueCount(
	owner: string,
	repo: string,
	token?: string,
	state: "open" | "closed" | "all" = "open",
): Promise<number> {
	// For "open" state, use the repo's open_issues_count and subtract open PRs
	// This is more accurate and saves an API call
	if (state === "open") {
		const [stats, prCount] = await Promise.all([
			fetchRepoStats(owner, repo, token),
			fetchPullRequestCount(owner, repo, token, "open"),
		]);
		// GitHub's open_issues_count includes PRs, so subtract open PR count
		return Math.max(stats.open_issues_count - prCount, 0);
	}

	// For "closed" or "all", use the GitHub Search API with type:issue qualifier.
	// This returns total_count which accurately excludes PRs in a single call,
	// avoiding unreliable pagination-based counting via Link headers.
	const stateQualifier = state === "all" ? "" : ` is:${state}`;
	const query = `repo:${owner}/${repo} type:issue${stateQualifier}`;
	const url = `${GITHUB_API_BASE}/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const data = (await response.json()) as { total_count: number };
	return data.total_count;
}

/** Release information from the GitHub API */
export interface ReleaseInfo {
	tag_name: string;
	name: string;
	html_url: string;
	published_at: string;
	prerelease: boolean;
	draft: boolean;
}

/**
 * Fetches the latest release for a repository.
 *
 * @deprecated Use coordinator.fetchData() with "latestRelease" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param includePreReleases - Whether to include pre-releases (default: false)
 * @returns Latest release info, or null if no releases
 * @throws {GitHubApiError} on API errors (except 404)
 */
export async function fetchLatestRelease(
	owner: string,
	repo: string,
	token?: string,
	includePreReleases = false,
): Promise<ReleaseInfo | null> {
	const headers = buildHeaders(token);

	if (!includePreReleases) {
		// GET /repos/{owner}/{repo}/releases/latest — skips pre-releases and drafts
		const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
		const response = await fetch(url, { headers });
		const rateLimitInfo = parseRateLimitHeaders(response.headers);

		if (response.status === 404) {
			return null; // No releases
		}

		if (!response.ok) {
			handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
		}

		const data = (await response.json()) as Record<string, unknown>;
		return {
			tag_name: (data.tag_name as string) ?? "",
			name: (data.name as string) ?? "",
			html_url: (data.html_url as string) ?? "",
			published_at: (data.published_at as string) ?? "",
			prerelease: (data.prerelease as boolean) ?? false,
			draft: (data.draft as boolean) ?? false,
		};
	}

	// Include pre-releases: get the first release (most recent)
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=1`;
	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const releases = (await response.json()) as Array<Record<string, unknown>>;
	if (!releases || releases.length === 0) {
		return null;
	}

	const data = releases[0];
	return {
		tag_name: (data.tag_name as string) ?? "",
		name: (data.name as string) ?? "",
		html_url: (data.html_url as string) ?? "",
		published_at: (data.published_at as string) ?? "",
		prerelease: (data.prerelease as boolean) ?? false,
		draft: (data.draft as boolean) ?? false,
	};
}

/**
 * Formats a relative time string from an ISO date (e.g. "2d ago", "3h ago").
 *
 * @param isoDate - ISO 8601 date string
 * @returns Human-readable relative time
 */
export function formatRelativeTime(isoDate: string): string {
	if (!isoDate) return "";
	const date = new Date(isoDate);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMin = Math.floor(diffMs / 60000);
	const diffHr = Math.floor(diffMs / 3600000);
	const diffDay = Math.floor(diffMs / 86400000);
	const diffWeek = Math.floor(diffDay / 7);
	const diffMonth = Math.floor(diffDay / 30);
	const diffYear = Math.floor(diffDay / 365);

	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHr < 24) return `${diffHr}h ago`;
	if (diffDay < 7) return `${diffDay}d ago`;
	if (diffWeek < 5) return `${diffWeek}w ago`;
	if (diffMonth < 12) return `${diffMonth}mo ago`;
	return `${diffYear}y ago`;
}

/**
 * Formats a workflow run duration from created_at → updated_at.
 * Returns a compact duration string like "3m 42s", "1h 5m", or "" if unavailable.
 *
 * @param createdAt - ISO 8601 start time
 * @param updatedAt - ISO 8601 end time
 * @returns Formatted duration string or empty string
 */
export function formatRunDuration(createdAt: string, updatedAt: string): string {
	if (!createdAt || !updatedAt) return "";
	const start = new Date(createdAt).getTime();
	const end = new Date(updatedAt).getTime();
	const diffMs = end - start;
	if (diffMs <= 0 || isNaN(diffMs)) return "";

	const totalSec = Math.floor(diffMs / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

/** Commit activity data from the GitHub stats API */
export interface CommitActivityWeek {
	/** Unix timestamp of the start of this week */
	total: number;
	/** Start of week as Unix timestamp */
	week: number;
	/** Daily commit counts (Sun=0 ... Sat=6) */
	days: number[];
}

/**
 * Fetches commit activity (weekly commit counts) for a repository.
 * Uses the stats/commit_activity endpoint which returns the last 52 weeks.
 *
 * @deprecated Use coordinator.fetchData() with "commitActivity" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @param timeRange - "24h", "7d", or "30d"
 * @returns Commit count for the specified time range
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCommitActivity(
	owner: string,
	repo: string,
	token?: string,
	timeRange: "24h" | "7d" | "30d" = "7d",
): Promise<number> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	// Stats endpoints return 202 while computing — treat as "data not ready"
	if (response.status === 202) {
		return -1; // Signal to show "Computing…"
	}

	if (response.status === 204) {
		return 0; // Empty repo — no commits
	}

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const weeks = (await response.json()) as CommitActivityWeek[];
	if (!Array.isArray(weeks) || weeks.length === 0) {
		return 0;
	}

	const now = new Date();
	const nowMs = now.getTime();

	if (timeRange === "24h") {
		// Get today's day index within the most recent week
		const latestWeek = weeks[weeks.length - 1];
		const weekStartMs = latestWeek.week * 1000;
		const dayOfWeek = Math.floor((nowMs - weekStartMs) / 86400000);
		if (dayOfWeek >= 0 && dayOfWeek < 7) {
			return latestWeek.days[dayOfWeek] ?? 0;
		}
		return 0;
	}

	if (timeRange === "7d") {
		// Sum the most recent week
		const latestWeek = weeks[weeks.length - 1];
		return latestWeek.total;
	}

	// 30d — sum the last ~4 weeks
	const weeksToSum = Math.min(4, weeks.length);
	let total = 0;
	for (let i = weeks.length - weeksToSum; i < weeks.length; i++) {
		total += weeks[i].total;
	}
	return total;
}

/**
 * Fetches raw weekly commit activity data for a repository.
 * Returns the full 52-week history with daily breakdowns, suitable for
 * rendering contribution heatmaps.
 *
 * @deprecated Use coordinator.fetchData() with "commitActivity" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of weekly commit data, or null if still computing
 * @throws {GitHubApiError} on API errors
 */
export async function fetchCommitActivityWeeks(
	owner: string,
	repo: string,
	token?: string,
): Promise<CommitActivityWeek[] | null> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/stats/commit_activity`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	// Stats endpoints return 202 while computing — data not ready yet
	if (response.status === 202) {
		return null;
	}

	if (response.status === 204) {
		return [];
	}

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const weeks = (await response.json()) as CommitActivityWeek[];
	if (!Array.isArray(weeks)) {
		return [];
	}
	return weeks;
}

/** Branch comparison data */
export interface BranchComparison {
	ahead_by: number;
	behind_by: number;
	total_commits: number;
	html_url: string;
	status: "ahead" | "behind" | "diverged" | "identical";
}

/**
 * Fetches branch comparison (ahead/behind counts) between two branches.
 *
 * @deprecated Use coordinator.fetchData() with "branches" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param base - Base branch (e.g. "main")
 * @param head - Head branch to compare (e.g. "develop")
 * @param token - GitHub personal access token
 * @returns Branch comparison info
 * @throws {GitHubApiError} on API errors
 */
export async function fetchBranchComparison(
	owner: string,
	repo: string,
	base: string,
	head: string,
	token?: string,
): Promise<BranchComparison> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const data = (await response.json()) as Record<string, unknown>;
	return {
		ahead_by: (data.ahead_by as number) ?? 0,
		behind_by: (data.behind_by as number) ?? 0,
		total_commits: (data.total_commits as number) ?? 0,
		html_url: (data.html_url as string) ?? `https://github.com/${owner}/${repo}/compare/${base}...${head}`,
		status: (data.status as BranchComparison["status"]) ?? "identical",
	};
}

// ─── Branch Network API ──────────────────────────────────────

/** Branch info with latest commit for network visualization */
export interface BranchInfo {
	name: string;
	commitSha: string;
}

/**
 * Fetches branch info for network visualization.
 * Returns the list of branches with their latest commit SHA.
 *
 * @deprecated Use coordinator.fetchData() with "branches" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of branch info
 * @throws {GitHubApiError} on API errors
 */
export async function fetchBranchNetwork(
	owner: string,
	repo: string,
	token: string,
): Promise<BranchInfo[]> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=10`;
	const headers = buildHeaders(token);

	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const data = (await response.json()) as Array<{ name: string; commit: { sha: string } }>;
	return data.map((b) => ({
		name: b.name,
		commitSha: b.commit.sha,
	}));
}

// ─── Workflow Status API ─────────────────────────────────────

/** Possible workflow run statuses from the GitHub API */
export type WorkflowRunStatus =
	| "completed"
	| "action_required"
	| "cancelled"
	| "failure"
	| "neutral"
	| "skipped"
	| "stale"
	| "success"
	| "timed_out"
	| "in_progress"
	| "queued"
	| "requested"
	| "waiting"
	| "pending";

/** Possible workflow run conclusions */
export type WorkflowRunConclusion =
	| "success"
	| "failure"
	| "cancelled"
	| "skipped"
	| "timed_out"
	| "action_required"
	| "neutral"
	| "stale"
	| null;

/** Possible deployment status states */
export type DeploymentState =
	| "error"
	| "failure"
	| "inactive"
	| "in_progress"
	| "queued"
	| "pending"
	| "success";

/** Subset of workflow run data we care about */
export interface WorkflowRun {
	id: number;
	name: string;
	status: WorkflowRunStatus;
	conclusion: WorkflowRunConclusion;
	head_branch: string;
	event: string;
	display_title: string;
	run_number: number;
	html_url: string;
	created_at: string;
	updated_at: string;
}

/** Deployment status info */
export interface DeploymentStatus {
	id: number;
	state: DeploymentState;
	description: string;
	environment: string;
	created_at: string;
	log_url: string;
}

/** Combined workflow + deployment info for the button */
export interface WorkflowInfo {
	latestRun: WorkflowRun | null;
	deployment: DeploymentStatus | null;
}

/**
 * Fetches the latest workflow runs for a repository.
 *
 * @deprecated Use coordinator.fetchData() with workflow-specific queries instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT (required for Actions read permission)
 * @param branch - Optional branch filter
 * @param workflowFile - Optional workflow file name (e.g. "deploy.yml")
 * @returns The most recent workflow run, or null if none found
 * @throws {GitHubApiError} on API errors
 */
export async function fetchLatestWorkflowRun(
	owner: string,
	repo: string,
	token?: string,
	branch?: string,
	workflowFile?: string,
): Promise<WorkflowRun | null> {
	let url: string;
	if (workflowFile) {
		url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/runs?per_page=1`;
	} else {
		url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?per_page=1`;
	}

	if (branch) {
		url += `&branch=${encodeURIComponent(branch)}`;
	}

	const headers = buildHeaders(token);
	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const data = (await response.json()) as Record<string, unknown>;
	const runs = data.workflow_runs as Record<string, unknown>[];

	if (!runs || runs.length === 0) {
		return null;
	}

	const run = runs[0];
	return {
		id: (run.id as number) ?? 0,
		name: (run.name as string) ?? "Unknown",
		status: (run.status as WorkflowRunStatus) ?? "completed",
		conclusion: (run.conclusion as WorkflowRunConclusion) ?? null,
		head_branch: (run.head_branch as string) ?? "",
		event: (run.event as string) ?? "",
		display_title: (run.display_title as string) ?? "",
		run_number: (run.run_number as number) ?? 0,
		html_url: (run.html_url as string) ?? "",
		created_at: (run.created_at as string) ?? "",
		updated_at: (run.updated_at as string) ?? "",
	};
}

/**
 * Fetches the latest deployment status for a repository.
 *
 * @deprecated Use coordinator.fetchData() with deployment-specific queries instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @param environment - Optional environment filter (e.g. "production")
 * @returns Latest deployment status, or null if no deployments
 * @throws {GitHubApiError} on API errors
 */
export async function fetchLatestDeploymentStatus(
	owner: string,
	repo: string,
	token?: string,
	environment?: string,
): Promise<DeploymentStatus | null> {
	let url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments?per_page=1`;

	if (environment) {
		url += `&environment=${encodeURIComponent(environment)}`;
	}

	const headers = buildHeaders(token);
	const response = await fetch(url, { headers });
	const rateLimitInfo = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const deployments = (await response.json()) as Record<string, unknown>[];

	if (!deployments || deployments.length === 0) {
		return null;
	}

	const deployment = deployments[0];
	const deploymentId = deployment.id as number;

	// Fetch the latest status for this deployment
	const statusUrl = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments/${deploymentId}/statuses?per_page=1`;
	const statusResponse = await fetch(statusUrl, { headers });
	const statusRateLimitInfo = parseRateLimitHeaders(statusResponse.headers);

	if (!statusResponse.ok) {
		handleApiError(statusResponse.status, statusRateLimitInfo, owner, repo, parseRetryAfter(statusResponse.headers));
	}

	const statuses = (await statusResponse.json()) as Record<string, unknown>[];

	if (!statuses || statuses.length === 0) {
		return {
			id: deploymentId,
			state: "pending",
			description: (deployment.description as string) ?? "",
			environment: (deployment.environment as string) ?? "",
			created_at: (deployment.created_at as string) ?? "",
			log_url: "",
		};
	}

	const status = statuses[0];
	return {
		id: deploymentId,
		state: (status.state as DeploymentState) ?? "pending",
		description: (status.description as string) ?? "",
		environment: (status.environment as string) ?? (deployment.environment as string) ?? "",
		created_at: (status.created_at as string) ?? "",
		log_url: (status.log_url as string) ?? "",
	};
}

/**
 * Fetches combined workflow run + deployment info for a repository.
 *
 * @deprecated Use coordinator.fetchData() with workflow-specific queries instead.
 */
export async function fetchWorkflowInfo(
	owner: string,
	repo: string,
	token?: string,
	options?: {
		branch?: string;
		workflowFile?: string;
		environment?: string;
	},
): Promise<WorkflowInfo> {
	// Fetch the primary workflow run — let errors propagate for proper error display.
	// Fetch the secondary deployment status — catch errors so partial results still work.
	const [latestRun, deployment] = await Promise.all([
		fetchLatestWorkflowRun(owner, repo, token, options?.branch, options?.workflowFile),
		fetchLatestDeploymentStatus(owner, repo, token, options?.environment).catch(() => null),
	]);

	return { latestRun, deployment };
}

/**
 * Triggers a workflow dispatch event for the specified workflow.
 * Requires the token to have `Actions: Write` permission.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param workflowFile - Workflow filename (e.g., "deploy.yml")
 * @param ref - Branch or tag to run the workflow on
 * @param token - GitHub PAT with Actions write permission
 * @throws GitHubApiError if the request fails (e.g., 403 for missing permissions)
 */
export async function triggerWorkflowDispatch(
	owner: string,
	repo: string,
	workflowFile: string,
	ref: string,
	token: string,
): Promise<void> {
	const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflowFile)}/dispatches`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ref }),
	});

	if (!response.ok) {
		const rateLimitInfo = parseRateLimitHeaders(response.headers);
		if (response.status === 403) {
			throw new GitHubApiError(
				"Workflow dispatch requires Actions: Write permission on your token",
				403,
				rateLimitInfo,
			);
		}
		throw new GitHubApiError(
			`Failed to trigger workflow dispatch: ${response.status}`,
			response.status,
			rateLimitInfo,
		);
	}
}

/**
 * Returns the effective display status string for a workflow run.
 */
export function getWorkflowDisplayStatus(run: WorkflowRun): string {
	if (run.status === "completed") {
		return run.conclusion ?? "completed";
	}
	return run.status;
}

/**
 * Returns a human-friendly label for a workflow status.
 */
export function getWorkflowStatusLabel(status: string): string {
	const labels: Record<string, string> = {
		success: "Success",
		failure: "Failed",
		cancelled: "Cancelled",
		skipped: "Skipped",
		timed_out: "Timed Out",
		action_required: "Action Req.",
		neutral: "Neutral",
		stale: "Stale",
		in_progress: "Running",
		queued: "Queued",
		requested: "Requested",
		waiting: "Waiting",
		pending: "Pending",
		completed: "Completed",
	};
	return labels[status] ?? status;
}

/**
 * Parses the Retry-After header value into seconds.
 * Supports both delay-seconds (integer) and HTTP-date formats.
 *
 * @param headers - Response headers
 * @returns Seconds to wait, or undefined if header is missing/invalid
 */
function parseRetryAfter(headers: Headers): number | undefined {
	const raw = headers.get("retry-after");
	if (!raw) return undefined;

	// Try as integer seconds first
	const seconds = parseInt(raw, 10);
	if (!isNaN(seconds) && seconds >= 0) return seconds;

	// Try as HTTP-date
	const date = new Date(raw);
	if (!isNaN(date.getTime())) {
		const delta = Math.ceil((date.getTime() - Date.now()) / 1000);
		return Math.max(delta, 0);
	}

	return undefined;
}

/**
 * Centralized error handler for GitHub API responses.
 * @throws {GitHubApiError} always
 */
function handleApiError(status: number, rateLimitInfo: RateLimitInfo, owner: string, repo: string, retryAfterSeconds?: number): never {
	if (status === 401) {
		throw new GitHubApiError("Invalid or expired GitHub token", status, rateLimitInfo);
	}

	if (status === 429) {
		const waitSec = retryAfterSeconds ?? Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 60);
		throw new GitHubApiError(
			`GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
			status,
			rateLimitInfo,
			waitSec,
		);
	}

	if (status === 403 && rateLimitInfo.remaining === 0) {
		const resetTime = rateLimitInfo.reset.toLocaleTimeString();
		const waitSec = Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 0);
		throw new GitHubApiError(
			`GitHub API rate limit exceeded. Resets at ${resetTime}`,
			status,
			rateLimitInfo,
			waitSec > 0 ? waitSec : undefined,
		);
	}

	if (status === 403) {
		throw new GitHubApiError("Access denied. Check token permissions.", status, rateLimitInfo);
	}

	if (status === 404) {
		throw new GitHubApiError(
			`Repository "${owner}/${repo}" not found or is private`,
			status,
			rateLimitInfo,
		);
	}

	throw new GitHubApiError(`GitHub API error (${status})`, status, rateLimitInfo);
}

// ─── Security Alert APIs ────────────────────────────────────────────

/** Dependabot alert severity levels */
export type AlertSeverity = "critical" | "high" | "medium" | "low";

/** Summary of security alerts for a repository */
export interface SecurityAlertSummary {
	critical: number;
	high: number;
	medium: number;
	low: number;
	total: number;
}

/**
 * Fetches open Dependabot alerts and summarizes by severity.
 * Requires `Dependabot alerts: Read` permission.
 *
 * @deprecated Use coordinator.fetchData() with "securityAlerts" fragment instead.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub PAT
 * @returns Alert summary with counts by severity
 * @throws {GitHubApiError} on API errors
 */
export async function fetchDependabotAlerts(
	owner: string,
	repo: string,
	token: string,
): Promise<SecurityAlertSummary> {
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dependabot/alerts?state=open&per_page=100`;
	const headers = buildHeaders(token);
	const response = await fetch(url, { headers });

	if (!response.ok) {
		const rateLimitInfo = parseRateLimitHeaders(response.headers);
		handleApiError(response.status, rateLimitInfo, owner, repo, parseRetryAfter(response.headers));
	}

	const alerts = await response.json() as Array<{ security_advisory?: { severity?: string } }>;
	const summary: SecurityAlertSummary = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
	for (const alert of alerts) {
		const severity = alert.security_advisory?.severity ?? "low";
		if (severity in summary && severity !== "total") {
			summary[severity as AlertSeverity]++;
		}
		summary.total++;
	}
	return summary;
}

// ─── Property Inspector Data Source APIs ────────────────────────────

/** Item shape expected by sdpi-components datasource */
export interface DataSourceItem {
	label: string;
	value: string;
	disabled?: boolean;
	[key: string]: JsonValue;
}

/**
 * Validates a GitHub token by calling the /user endpoint.
 * Returns detailed status: whether the token is valid, the user login,
 * token type (classic vs. fine-grained), and granted scopes.
 *
 * This gives the PI clear feedback to distinguish "token is invalid"
 * from "token is valid but lacks specific permissions".
 *
 * @param token - GitHub personal access token to validate
 * @returns DataSourceItem[] with validation results
 */
export async function validateTokenStatus(token?: string): Promise<DataSourceItem[]> {
	if (!token) {
		return [{ label: "Enter a GitHub token", value: "no-token" }];
	}

	let response: Response;
	try {
		response = await fetch(`${GITHUB_API_BASE}/user`, { headers: buildHeaders(token) });
	} catch {
		return [{ label: "⚠ Network error — check connection", value: "network-error", disabled: true }];
	}

	if (response.status === 401) {
		return [{ label: "⚠ Token is invalid or revoked", value: "invalid", disabled: true }];
	}

	if (response.status === 403) {
		const rateLimitInfo = parseRateLimitHeaders(response.headers);
		if (rateLimitInfo.remaining === 0) {
			const resetTime = rateLimitInfo.reset.toLocaleTimeString();
			return [{ label: `⚠ Rate limited — resets at ${resetTime}`, value: "rate-limited", disabled: true }];
		}
		return [{ label: "⚠ Token lacks basic API access", value: "forbidden", disabled: true }];
	}

	if (!response.ok) {
		return [{ label: `⚠ GitHub error (${response.status})`, value: "error", disabled: true }];
	}

	let user: { login: string };
	try {
		user = (await response.json()) as { login: string };
	} catch {
		return [{ label: "⚠ Invalid response from GitHub", value: "parse-error", disabled: true }];
	}

	const scopeHeader = response.headers.get("x-oauth-scopes");

	if (scopeHeader !== null) {
		// Classic personal access token — X-OAuth-Scopes header is present
		const scopes = scopeHeader
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);

		const items: DataSourceItem[] = [
			{ label: `✓ @${user.login} · classic token`, value: "valid" },
		];

		if (scopes.length > 0) {
			items.push({ label: `Scopes: ${scopes.join(", ")}`, value: "", disabled: true });
			// Check for scopes needed by this plugin
			if (!scopes.includes("repo") && !scopes.includes("public_repo")) {
				items.push({
					label: "⚠ Missing repo scope — enable the repo scope on your token",
					value: "",
					disabled: true,
				});
			} else if (scopes.includes("public_repo") && !scopes.includes("repo")) {
				items.push({
					label: "⚠ Only public_repo scope — private repos won't appear. Enable the full repo scope.",
					value: "",
					disabled: true,
				});
			}
		} else {
			items.push({
				label: "⚠ No scopes granted — token has very limited access",
				value: "",
				disabled: true,
			});
		}

		return items;
	}

	// Fine-grained personal access token — no X-OAuth-Scopes header
	return [
		{ label: `✓ @${user.login} · fine-grained token`, value: "valid" },
		{ label: "Check token settings for required permissions", value: "", disabled: true },
	];
}

/**
 * Fetches repositories accessible to the authenticated user.
 * Returns them as datasource items sorted by most recently pushed.
 *
 * @param token - GitHub personal access token (required)
 * @returns Array of repo items for the PI datasource dropdown
 */
export async function fetchUserRepos(token?: string): Promise<DataSourceItem[]> {
	if (!token) {
		return [{ label: "⚠ Enter a GitHub token first", value: "", disabled: true }];
	}

	const headers = buildHeaders(token);
	let url: string | null = `${GITHUB_API_BASE}/user/repos?per_page=100&sort=pushed&direction=desc&visibility=all&affiliation=owner,collaborator,organization_member`;

	const allRepos: Array<{ full_name: string; private: boolean; description: string | null }> = [];

	// Paginate through all pages of results
	while (url) {
		let response: Response;
		try {
			response = await fetch(url, { headers });
		} catch {
			if (allRepos.length > 0) break; // Return what we have so far
			return [{ label: "⚠ Network error — check connection", value: "", disabled: true }];
		}

		if (!response.ok) {
			if (allRepos.length > 0) break; // Return what we have so far
			if (response.status === 401) {
				return [{ label: "⚠ Invalid or expired token", value: "", disabled: true }];
			}
			if (response.status === 403) {
				return [{ label: "⚠ Token lacks permission — enable Metadata read access", value: "", disabled: true }];
			}
			return [{ label: `⚠ GitHub API error (${response.status})`, value: "", disabled: true }];
		}

		let repos: Array<{ full_name: string; private: boolean; description: string | null }>;
		try {
			repos = (await response.json()) as typeof repos;
		} catch {
			if (allRepos.length > 0) break;
			return [{ label: "⚠ Invalid response from GitHub", value: "", disabled: true }];
		}

		if (Array.isArray(repos)) {
			allRepos.push(...repos);
		}

		// Parse Link header for next page
		url = parseNextPageUrl(response.headers.get("link"));
	}

	if (allRepos.length === 0) {
		return [{ label: "No repositories found", value: "", disabled: true }];
	}

	return allRepos.map((r) => ({
		label: `${r.private ? "🔒 " : ""}${r.full_name}`,
		value: r.full_name,
	}));
}

/**
 * Parses the GitHub `Link` header to extract the URL for the next page.
 * Returns null if there is no next page.
 */
function parseNextPageUrl(linkHeader: string | null): string | null {
	if (!linkHeader) return null;
	const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
	return match ? match[1] : null;
}

/**
 * Fetches workflows for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of workflow items
 */
export async function fetchRepoWorkflows(
	owner: string,
	repo: string,
	token?: string,
): Promise<DataSourceItem[]> {
	const headers = buildHeaders(token);
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows?per_page=100`;

	const response = await fetch(url, { headers });

	if (!response.ok) {
		if (response.status === 401) {
			return [{ label: "⚠ Invalid or expired token", value: "", disabled: true }];
		}
		if (response.status === 403) {
			return [{ label: "⚠ Token lacks Actions read permission", value: "", disabled: true }];
		}
		if (response.status === 404) {
			return [{ label: "⚠ Repository not found", value: "", disabled: true }];
		}
		return [{ label: `⚠ Could not load workflows (${response.status})`, value: "", disabled: true }];
	}

	const data = (await response.json()) as {
		total_count: number;
		workflows: Array<{ id: number; name: string; path: string; state: string }>;
	};

	if (data.workflows.length === 0) {
		return [{ label: "No workflows found", value: "", disabled: true }];
	}

	// First item: "All workflows" option (no filter)
	const items: DataSourceItem[] = [
		{ label: "All Workflows", value: "" },
	];

	for (const wf of data.workflows) {
		// Extract just the filename from full path (e.g. ".github/workflows/ci.yml" → "ci.yml")
		const fileName = wf.path.split("/").pop() ?? wf.path;
		items.push({
			label: `${wf.name} (${fileName})`,
			value: fileName,
		});
	}

	return items;
}

/**
 * Fetches branches for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of branch items
 */
export async function fetchRepoBranches(
	owner: string,
	repo: string,
	token?: string,
): Promise<DataSourceItem[]> {
	const headers = buildHeaders(token);
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`;

	const response = await fetch(url, { headers });

	if (!response.ok) {
		if (response.status === 401) {
			return [{ label: "⚠ Invalid or expired token", value: "", disabled: true }];
		}
		if (response.status === 403) {
			return [{ label: "⚠ Token lacks Contents/Metadata read permission", value: "", disabled: true }];
		}
		if (response.status === 404) {
			return [{ label: "⚠ Repository not found", value: "", disabled: true }];
		}
		return [{ label: `⚠ Could not load branches (${response.status})`, value: "", disabled: true }];
	}

	const branches = (await response.json()) as Array<{ name: string }>;

	// First item: "All branches" option (no filter)
	const items: DataSourceItem[] = [
		{ label: "All Branches", value: "" },
	];

	for (const b of branches) {
		items.push({ label: b.name, value: b.name });
	}

	return items;
}

/**
 * Fetches deployment environments for a given repository.
 * Returns them as datasource items for the PI dropdown.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param token - GitHub personal access token
 * @returns Array of environment items
 */
export async function fetchRepoEnvironments(
	owner: string,
	repo: string,
	token?: string,
): Promise<DataSourceItem[]> {
	const headers = buildHeaders(token);
	const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/environments`;

	const response = await fetch(url, { headers });

	if (!response.ok) {
		// 404 = no environments configured, 403 = no Environments permission
		if (response.status === 403) {
			return [
				{ label: "All Environments", value: "" },
				{ label: "⚠ Token lacks Environments read permission", value: "", disabled: true },
			];
		}
		return [{ label: "All Environments", value: "" }];
	}

	const data = (await response.json()) as {
		total_count: number;
		environments: Array<{ name: string; id: number }>;
	};

	// First item: "All environments" option (no filter)
	const items: DataSourceItem[] = [
		{ label: "All Environments", value: "" },
	];

	for (const env of data.environments) {
		items.push({ label: env.name, value: env.name });
	}

	return items;
}
