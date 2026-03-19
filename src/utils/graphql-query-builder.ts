/**
 * Dynamic GraphQL query builder for the batch query coordinator.
 *
 * Composes GraphQL queries from a set of data fragment names,
 * allowing the coordinator to build a single query that fetches
 * all data needed by multiple actions watching the same repository.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { DataFragmentName, GraphQLFragmentName } from "../types";

/**
 * Set of fragment names that can be fetched via GraphQL.
 * Used by the {@link isGraphQLFragment} type guard.
 */
const GRAPHQL_FRAGMENT_NAMES: ReadonlySet<string> = new Set<string>([
	"repoMetadata",
	"prCount",
	"issueCount",
	"latestRelease",
	"branches",
	"vulnerabilityAlerts",
	"reviewRequestedPRs",
	"discussions",
	"projectsV2",
]);

/**
 * Fragments that are scoped to a single repository and belong
 * inside the `repository(owner, name) { … }` block.
 *
 * `reviewRequestedPRs` is deliberately excluded — it uses
 * a global `search` query instead (see {@link buildSearchQuery}).
 */
const REPO_SCOPED_FRAGMENTS: ReadonlySet<GraphQLFragmentName> = new Set<GraphQLFragmentName>([
	"repoMetadata",
	"prCount",
	"issueCount",
	"latestRelease",
	"branches",
	"vulnerabilityAlerts",
	"discussions",
	"projectsV2",
]);

/**
 * Maps each GraphQL-capable fragment name to its field selection string.
 *
 * Repo-scoped fragments contain the fields that go inside
 * `repository { … }`. The `reviewRequestedPRs` entry contains
 * the fields used inside `... on PullRequest { … }` in the
 * search query.
 *
 * Aliases (e.g. `openPRs: pullRequests(…)`) prevent field conflicts
 * when multiple fragments query the same underlying connection with
 * different filter arguments.
 */
export const GRAPHQL_FRAGMENTS: Record<GraphQLFragmentName, string> = {
	repoMetadata: [
		"stargazerCount",
		"forkCount",
		"watchers { totalCount }",
		"primaryLanguage { name }",
		"diskUsage",
		"licenseInfo { spdxId name }",
		"defaultBranchRef { name }",
		"isPrivate",
		"isFork",
		"description",
		"nameWithOwner",
		"url",
	].join("\n"),

	prCount: [
		"openPRs: pullRequests(states: [OPEN]) { totalCount }",
		"closedPRs: pullRequests(states: [CLOSED]) { totalCount }",
		"mergedPRs: pullRequests(states: [MERGED]) { totalCount }",
	].join("\n"),

	issueCount: [
		"openIssues: issues(states: [OPEN]) { totalCount }",
		"closedIssues: issues(states: [CLOSED]) { totalCount }",
	].join("\n"),

	latestRelease: [
		"latestRelease { tagName name publishedAt isPrerelease isDraft url }",
		"releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { tagName name publishedAt isPrerelease isDraft url } }",
	].join("\n"),

	branches: "refs(refPrefix: \"refs/heads/\", first: 100) { nodes { name target { ... on Commit { oid } } } }",

	vulnerabilityAlerts: "vulnerabilityAlerts(first: 100, states: [OPEN]) { totalCount nodes { securityVulnerability { severity } } }",

	reviewRequestedPRs: [
		"number",
		"title",
		"url",
		"createdAt",
		"author { login }",
		"repository { nameWithOwner }",
	].join("\n"),

	discussions: "discussions(first: 10, states: [OPEN], orderBy: {field: CREATED_AT, direction: DESC}) { totalCount nodes { title isAnswered createdAt url } }",

	projectsV2: "projectsV2(first: 10) { nodes { title shortDescription closed number url items { totalCount } } }",
};

/**
 * Builds a GraphQL query that fetches repository-scoped data.
 *
 * Only the fragments listed in {@link REPO_SCOPED_FRAGMENTS} are
 * included. Non-repo fragments such as `reviewRequestedPRs` are
 * silently ignored — use {@link buildSearchQuery} for those.
 *
 * @param fragments - Array of fragment names to include in the query
 * @returns A complete GraphQL query string
 * @throws {Error} If no repo-scoped fragments remain after filtering
 */
export function buildRepoQuery(fragments: GraphQLFragmentName[]): string {
	const repoFragments = fragments.filter((f) => REPO_SCOPED_FRAGMENTS.has(f));

	if (repoFragments.length === 0) {
		throw new Error(
			"At least one repo-scoped fragment is required to build a repository query",
		);
	}

	// Deduplicate while preserving order
	const unique = [...new Set(repoFragments)];

	const fieldLines = unique
		.map((f) => GRAPHQL_FRAGMENTS[f])
		.join("\n")
		.split("\n")
		.map((line) => `\t\t${line}`)
		.join("\n");

	return [
		"query RepoData($owner: String!, $name: String!) {",
		"\trepository(owner: $owner, name: $name) {",
		fieldLines,
		"\t}",
		"}",
	].join("\n");
}

/**
 * Builds a GraphQL search query for pull requests awaiting review.
 *
 * This is used by the `reviewRequestedPRs` fragment, which is not
 * repository-scoped and therefore cannot be part of {@link buildRepoQuery}.
 *
 * @returns A complete GraphQL search query string
 */
export function buildSearchQuery(): string {
	return [
		"query SearchPRs($query: String!) {",
		"\tsearch(query: $query, type: ISSUE, first: 50) {",
		"\t\tissueCount",
		"\t\tnodes {",
		"\t\t\t... on PullRequest {",
		"\t\t\t\tnumber",
		"\t\t\t\ttitle",
		"\t\t\t\turl",
		"\t\t\t\tcreatedAt",
		"\t\t\t\tauthor { login }",
		"\t\t\t\trepository { nameWithOwner }",
		"\t\t\t}",
		"\t\t}",
		"\t}",
		"}",
	].join("\n");
}

/**
 * Type guard that checks whether a {@link DataFragmentName} can be
 * fetched via GraphQL.
 *
 * Returns `false` for REST-only fragments (`workflowRuns`,
 * `commitActivity`, `branchComparison`).
 *
 * @param name - The data fragment name to check
 * @returns `true` if the fragment is a {@link GraphQLFragmentName}
 */
export function isGraphQLFragment(name: DataFragmentName): name is GraphQLFragmentName {
	return GRAPHQL_FRAGMENT_NAMES.has(name);
}
