/**
 * Security alerts, branch operations, and commit activity functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	GITHUB_API_BASE,
	buildHeaders,
	fetchWithTimeout,
	handleApiError,
	parseRateLimitHeaders,
	parseRetryAfter,
} from "./core";

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
	const response = await fetchWithTimeout(url, { headers }, "fetchDependabotAlerts");

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

// ─── Branch Network API ──────────────────────────────────────

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

	const response = await fetchWithTimeout(url, { headers }, "fetchBranchComparison");
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

	const response = await fetchWithTimeout(url, { headers }, "fetchBranchNetwork");
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

// ─── Commit Activity API ─────────────────────────────────────

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

	const response = await fetchWithTimeout(url, { headers }, "fetchCommitActivity");
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

	const response = await fetchWithTimeout(url, { headers }, "fetchCommitActivityWeeks");
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
