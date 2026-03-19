/**
 * Data fragment extractors for the GraphQL query coordinator.
 *
 * These functions bridge the gap between raw GraphQL response shapes
 * and the existing interface types that actions use for rendering.
 * This allows actions to migrate to GraphQL without changing their
 * rendering logic.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { GraphQLRepoNode, GraphQLSearchResponse, DiscussionsData, ProjectsV2Data } from "../types";
import type { RepoStats, ReleaseInfo, BranchInfo, SecurityAlertSummary, ReviewRequestedPR } from "./github-api";

/**
 * Extracts repository metadata from a GraphQL repo node into the existing
 * {@link RepoStats} interface shape used by the repo-stats action.
 *
 * @param node - Raw GraphQL repository node
 * @returns Mapped {@link RepoStats} object
 */
export function extractRepoMetadata(node: GraphQLRepoNode): RepoStats {
	return {
		stargazers_count: node.stargazerCount,
		forks_count: node.forkCount,
		watchers_count: node.watchers.totalCount,
		language: node.primaryLanguage?.name ?? null,
		size: node.diskUsage,
		license: node.licenseInfo?.spdxId ?? null,
		default_branch: node.defaultBranchRef?.name ?? "main",
		visibility: node.isPrivate ? "private" : "public",
		description: node.description,
		full_name: node.nameWithOwner,
		html_url: node.url,
		open_issues_count: node.openIssues?.totalCount ?? 0,
		open_pull_request_count: node.openPRs?.totalCount,
	};
}

/**
 * Extracts pull request count from a GraphQL repo node filtered by state.
 *
 * For the "closed" state, merged PRs are included in the count since GitHub
 * considers merged PRs as a subset of closed PRs.
 *
 * @param node - Raw GraphQL repository node
 * @param state - PR state filter: "open", "closed", or "all"
 * @returns PR count for the requested state
 */
export function extractPRCount(node: GraphQLRepoNode, state: "open" | "closed" | "all"): number {
	const open = node.openPRs?.totalCount ?? 0;
	const closed = node.closedPRs?.totalCount ?? 0;
	const merged = node.mergedPRs?.totalCount ?? 0;

	switch (state) {
		case "open":
			return open;
		case "closed":
			return closed + merged;
		case "all":
			return open + closed + merged;
	}
}

/**
 * Extracts issue count from a GraphQL repo node filtered by state.
 *
 * @param node - Raw GraphQL repository node
 * @param state - Issue state filter: "open", "closed", or "all"
 * @returns Issue count for the requested state
 */
export function extractIssueCount(node: GraphQLRepoNode, state: "open" | "closed" | "all"): number {
	const open = node.openIssues?.totalCount ?? 0;
	const closed = node.closedIssues?.totalCount ?? 0;

	switch (state) {
		case "open":
			return open;
		case "closed":
			return closed;
		case "all":
			return open + closed;
	}
}

/**
 * Extracts the latest release from a GraphQL repo node.
 *
 * When `includePreReleases` is true, uses the `releases.nodes[0]` field which
 * includes all releases ordered by date. When false, uses `latestRelease` which
 * GitHub filters to exclude pre-releases and drafts.
 *
 * @param node - Raw GraphQL repository node
 * @param includePreReleases - Whether to include pre-releases in the search
 * @returns Mapped {@link ReleaseInfo} or null if no release found
 */
export function extractLatestRelease(node: GraphQLRepoNode, includePreReleases: boolean): ReleaseInfo | null {
	const source = includePreReleases
		? node.releases?.nodes[0] ?? null
		: node.latestRelease ?? null;

	if (!source) {
		return null;
	}

	return {
		tag_name: source.tagName,
		name: source.name,
		html_url: source.url,
		published_at: source.publishedAt,
		prerelease: source.isPrerelease,
		draft: source.isDraft,
	};
}

/**
 * Extracts branch information from a GraphQL repo node.
 *
 * @param node - Raw GraphQL repository node
 * @returns Array of {@link BranchInfo} objects, empty if no refs data
 */
export function extractBranches(node: GraphQLRepoNode): BranchInfo[] {
	if (!node.refs?.nodes) {
		return [];
	}

	return node.refs.nodes.map((ref) => ({
		name: ref.name,
		commitSha: ref.target.oid,
	}));
}

/**
 * Extracts security alert summary from a GraphQL repo node.
 *
 * Counts vulnerability alerts by severity level (case-insensitive).
 * Unknown severity values default to "low".
 *
 * @param node - Raw GraphQL repository node
 * @returns {@link SecurityAlertSummary} with counts per severity level
 */
export function extractSecurityAlerts(node: GraphQLRepoNode): SecurityAlertSummary {
	const summary: SecurityAlertSummary = {
		critical: 0,
		high: 0,
		medium: 0,
		low: 0,
		total: 0,
	};

	const alerts = node.vulnerabilityAlerts?.nodes;
	if (!alerts || alerts.length === 0) {
		return summary;
	}

	for (const alert of alerts) {
		const severity = alert.securityVulnerability.severity.toLowerCase();
		switch (severity) {
			case "critical":
				summary.critical++;
				break;
			case "high":
				summary.high++;
				break;
			case "medium":
				summary.medium++;
				break;
			case "low":
				summary.low++;
				break;
			default:
				summary.low++;
				break;
		}
	}

	summary.total = summary.critical + summary.high + summary.medium + summary.low;

	return summary;
}

/**
 * Extracts review-requested PRs from a GraphQL search response into the
 * shape expected by the PR review queue action.
 *
 * @param searchData - The `data` property from a {@link GraphQLSearchResponse}
 * @returns Object with total_count and mapped {@link ReviewRequestedPR} items
 */
export function extractReviewRequestedPRs(
	searchData: GraphQLSearchResponse["data"],
): { total_count: number; items: ReviewRequestedPR[] } {
	if (!searchData) {
		return { total_count: 0, items: [] };
	}

	return {
		total_count: searchData.search.issueCount,
		items: searchData.search.nodes.map((node) => ({
			number: node.number,
			title: node.title,
			user_login: node.author?.login ?? "unknown",
			html_url: node.url,
			created_at: node.createdAt,
		})),
	};
}

/**
 * Extracts discussions data from a GraphQL repo node.
 *
 * @param node - Raw GraphQL repository node
 * @returns {@link DiscussionsData} with total count, answered count, and items
 */
export function extractDiscussions(node: GraphQLRepoNode): DiscussionsData {
	const nodes = node.discussions?.nodes ?? [];

	return {
		totalCount: node.discussions?.totalCount ?? 0,
		answeredCount: nodes.filter((d) => d.isAnswered).length,
		items: nodes,
	};
}

/**
 * Extracts Projects V2 data from a GraphQL repo node.
 *
 * @param node - Raw GraphQL repository node
 * @returns {@link ProjectsV2Data} with mapped project entries
 */
export function extractProjectsV2(node: GraphQLRepoNode): ProjectsV2Data {
	const nodes = node.projectsV2?.nodes;
	if (!nodes) {
		return { projects: [] };
	}

	return {
		projects: nodes.map((p) => ({
			title: p.title,
			shortDescription: p.shortDescription,
			closed: p.closed,
			number: p.number,
			url: p.url,
			totalItems: p.items.totalCount,
		})),
	};
}
