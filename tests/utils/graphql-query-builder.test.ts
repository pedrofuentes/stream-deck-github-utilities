/**
 * Tests for the dynamic GraphQL query builder (src/utils/graphql-query-builder.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";
import {
	buildRepoQuery,
	buildSearchQuery,
	isGraphQLFragment,
	GRAPHQL_FRAGMENTS,
} from "../../src/utils/graphql-query-builder";
import type { DataFragmentName, GraphQLFragmentName } from "../../src/types";

// ---------------------------------------------------------------------------
// GRAPHQL_FRAGMENTS constant
// ---------------------------------------------------------------------------

describe("GRAPHQL_FRAGMENTS", () => {
	const expectedFragments: GraphQLFragmentName[] = [
		"repoMetadata",
		"prCount",
		"issueCount",
		"latestRelease",
		"branches",
		"vulnerabilityAlerts",
		"reviewRequestedPRs",
		"discussions",
		"projectsV2",
	];

	it("should contain an entry for every GraphQLFragmentName", () => {
		for (const name of expectedFragments) {
			expect(GRAPHQL_FRAGMENTS).toHaveProperty(name);
			expect(typeof GRAPHQL_FRAGMENTS[name]).toBe("string");
			expect(GRAPHQL_FRAGMENTS[name].length).toBeGreaterThan(0);
		}
	});

	it("should use aliases for prCount to avoid pullRequests field conflicts", () => {
		const prFragment = GRAPHQL_FRAGMENTS.prCount;
		expect(prFragment).toContain("openPRs: pullRequests");
		expect(prFragment).toContain("closedPRs: pullRequests");
		expect(prFragment).toContain("mergedPRs: pullRequests");
	});

	it("should use aliases for issueCount to avoid issues field conflicts", () => {
		const issueFragment = GRAPHQL_FRAGMENTS.issueCount;
		expect(issueFragment).toContain("openIssues: issues");
		expect(issueFragment).toContain("closedIssues: issues");
	});

	it("should include expected repoMetadata fields", () => {
		const meta = GRAPHQL_FRAGMENTS.repoMetadata;
		expect(meta).toContain("stargazerCount");
		expect(meta).toContain("forkCount");
		expect(meta).toContain("watchers { totalCount }");
		expect(meta).toContain("primaryLanguage { name }");
		expect(meta).toContain("diskUsage");
		expect(meta).toContain("licenseInfo { spdxId name }");
		expect(meta).toContain("defaultBranchRef { name }");
		expect(meta).toContain("isPrivate");
		expect(meta).toContain("isFork");
		expect(meta).toContain("description");
		expect(meta).toContain("nameWithOwner");
		expect(meta).toContain("url");
	});
});

// ---------------------------------------------------------------------------
// buildRepoQuery
// ---------------------------------------------------------------------------

describe("buildRepoQuery", () => {
	it("should wrap fields in the standard RepoData query envelope", () => {
		const query = buildRepoQuery(["repoMetadata"]);
		expect(query).toContain("query RepoData($owner: String!, $name: String!)");
		expect(query).toContain("repository(owner: $owner, name: $name)");
	});

	// --- Individual fragment tests ---

	it("should include repoMetadata fields", () => {
		const query = buildRepoQuery(["repoMetadata"]);
		expect(query).toContain("stargazerCount");
		expect(query).toContain("forkCount");
		expect(query).toContain("nameWithOwner");
	});

	it("should include prCount fields with aliases", () => {
		const query = buildRepoQuery(["prCount"]);
		expect(query).toContain("openPRs: pullRequests(states: [OPEN])");
		expect(query).toContain("closedPRs: pullRequests(states: [CLOSED])");
		expect(query).toContain("mergedPRs: pullRequests(states: [MERGED])");
	});

	it("should include issueCount fields with aliases", () => {
		const query = buildRepoQuery(["issueCount"]);
		expect(query).toContain("openIssues: issues(states: [OPEN])");
		expect(query).toContain("closedIssues: issues(states: [CLOSED])");
	});

	it("should include latestRelease fields", () => {
		const query = buildRepoQuery(["latestRelease"]);
		expect(query).toContain("latestRelease {");
		expect(query).toContain("tagName");
		expect(query).toContain("releases(first: 1");
	});

	it("should include branches fields", () => {
		const query = buildRepoQuery(["branches"]);
		expect(query).toContain('refs(refPrefix: "refs/heads/"');
		expect(query).toContain("... on Commit { oid }");
	});

	it("should include vulnerabilityAlerts fields", () => {
		const query = buildRepoQuery(["vulnerabilityAlerts"]);
		expect(query).toContain("vulnerabilityAlerts(first: 100, states: [OPEN])");
		expect(query).toContain("securityVulnerability { severity }");
	});

	it("should include discussions fields", () => {
		const query = buildRepoQuery(["discussions"]);
		expect(query).toContain("discussions(first: 10");
		expect(query).toContain("isAnswered");
		expect(query).toContain("totalCount");
	});

	it("should include projectsV2 fields", () => {
		const query = buildRepoQuery(["projectsV2"]);
		expect(query).toContain("projectsV2(first: 10)");
		expect(query).toContain("shortDescription");
		expect(query).toContain("items { totalCount }");
	});

	// --- Combined fragment tests ---

	it("should combine all repo-scoped fragments into a single query", () => {
		const allRepoFragments: GraphQLFragmentName[] = [
			"repoMetadata",
			"prCount",
			"issueCount",
			"latestRelease",
			"branches",
			"vulnerabilityAlerts",
			"discussions",
			"projectsV2",
		];
		const query = buildRepoQuery(allRepoFragments);

		// Verify envelope appears exactly once
		const envelopeMatches = query.match(/query RepoData/g);
		expect(envelopeMatches).toHaveLength(1);

		const repoMatches = query.match(/repository\(/g);
		expect(repoMatches).toHaveLength(1);

		// Verify fields from each fragment are present
		expect(query).toContain("stargazerCount");
		expect(query).toContain("openPRs: pullRequests");
		expect(query).toContain("openIssues: issues");
		expect(query).toContain("latestRelease {");
		expect(query).toContain("refs(refPrefix:");
		expect(query).toContain("vulnerabilityAlerts(");
		expect(query).toContain("discussions(");
		expect(query).toContain("projectsV2(");
	});

	it("should combine prCount and issueCount without field conflicts", () => {
		const query = buildRepoQuery(["prCount", "issueCount"]);

		// Both use aliases, so no bare pullRequests or issues fields
		expect(query).toContain("openPRs: pullRequests");
		expect(query).toContain("openIssues: issues");

		// The query should not have bare "pullRequests(" without alias
		const bareFieldMatches = query.match(/^\s+pullRequests\(/gm);
		expect(bareFieldMatches).toBeNull();
	});

	// --- Edge cases ---

	it("should throw when given an empty array", () => {
		expect(() => buildRepoQuery([])).toThrow(
			"At least one repo-scoped fragment is required",
		);
	});

	it("should throw when given only reviewRequestedPRs (not repo-scoped)", () => {
		expect(() => buildRepoQuery(["reviewRequestedPRs"])).toThrow(
			"At least one repo-scoped fragment is required",
		);
	});

	it("should silently ignore reviewRequestedPRs alongside repo-scoped fragments", () => {
		const query = buildRepoQuery(["repoMetadata", "reviewRequestedPRs"]);
		expect(query).toContain("stargazerCount");
		// reviewRequestedPRs fields should NOT appear in repo query
		expect(query).not.toContain("author { login }");
	});

	it("should deduplicate repeated fragment names", () => {
		const query = buildRepoQuery(["prCount", "prCount", "prCount"]);

		// The alias should appear exactly once
		const openPRMatches = query.match(/openPRs: pullRequests/g);
		expect(openPRMatches).toHaveLength(1);
	});

	// --- Structural validity ---

	it("should produce properly nested braces", () => {
		const query = buildRepoQuery(["repoMetadata", "prCount"]);

		let depth = 0;
		for (const char of query) {
			if (char === "{") depth++;
			if (char === "}") depth--;
			expect(depth).toBeGreaterThanOrEqual(0);
		}
		expect(depth).toBe(0);
	});

	it("should not contain duplicate top-level fields", () => {
		const query = buildRepoQuery([
			"repoMetadata",
			"prCount",
			"issueCount",
			"latestRelease",
		]);

		// Extract lines inside repository { ... } that are top-level fields
		const repoBlock = query
			.split("repository(owner: $owner, name: $name) {")[1]
			?.split(/^}/m)[0];
		expect(repoBlock).toBeDefined();

		// Get field names (first word of each trimmed non-empty line)
		const fieldNames = repoBlock!
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !line.startsWith("}"))
			.map((line) => line.split(/[\s({]/)[0]);

		const uniqueFields = new Set(fieldNames);
		expect(fieldNames.length).toBe(uniqueFields.size);
	});
});

// ---------------------------------------------------------------------------
// buildSearchQuery
// ---------------------------------------------------------------------------

describe("buildSearchQuery", () => {
	it("should return a SearchPRs query with the correct envelope", () => {
		const query = buildSearchQuery();
		expect(query).toContain("query SearchPRs($query: String!)");
		expect(query).toContain("search(query: $query, type: ISSUE, first: 50)");
	});

	it("should include issueCount in the search result", () => {
		const query = buildSearchQuery();
		expect(query).toContain("issueCount");
	});

	it("should include PullRequest inline fragment fields", () => {
		const query = buildSearchQuery();
		expect(query).toContain("... on PullRequest");
		expect(query).toContain("number");
		expect(query).toContain("title");
		expect(query).toContain("url");
		expect(query).toContain("createdAt");
		expect(query).toContain("author { login }");
		expect(query).toContain("repository { nameWithOwner }");
	});

	it("should produce properly nested braces", () => {
		const query = buildSearchQuery();

		let depth = 0;
		for (const char of query) {
			if (char === "{") depth++;
			if (char === "}") depth--;
			expect(depth).toBeGreaterThanOrEqual(0);
		}
		expect(depth).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// isGraphQLFragment
// ---------------------------------------------------------------------------

describe("isGraphQLFragment", () => {
	const graphqlFragments: DataFragmentName[] = [
		"repoMetadata",
		"prCount",
		"issueCount",
		"latestRelease",
		"branches",
		"vulnerabilityAlerts",
		"reviewRequestedPRs",
		"discussions",
		"projectsV2",
	];

	const restOnlyFragments: DataFragmentName[] = [
		"workflowRuns",
		"commitActivity",
		"branchComparison",
	];

	for (const name of graphqlFragments) {
		it(`should return true for "${name}"`, () => {
			expect(isGraphQLFragment(name)).toBe(true);
		});
	}

	for (const name of restOnlyFragments) {
		it(`should return false for REST-only fragment "${name}"`, () => {
			expect(isGraphQLFragment(name)).toBe(false);
		});
	}

	it("should narrow the type when used as a type guard", () => {
		const name: DataFragmentName = "prCount";
		if (isGraphQLFragment(name)) {
			// TypeScript should allow indexing GRAPHQL_FRAGMENTS with the narrowed type
			const fields: string = GRAPHQL_FRAGMENTS[name];
			expect(fields).toBeDefined();
		}
	});
});
