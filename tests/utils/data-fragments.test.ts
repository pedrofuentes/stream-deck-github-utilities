/**
 * Tests for data fragment extractors.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";
import type { GraphQLRepoNode, GraphQLSearchResponse } from "../../src/types";
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
} from "../../src/utils/data-fragments";

// ─── Test Fixtures ───────────────────────────────────────────────────

/** Fully populated GraphQL repo node for happy-path tests */
const fullNode: GraphQLRepoNode = {
	stargazerCount: 1250,
	forkCount: 340,
	watchers: { totalCount: 89 },
	primaryLanguage: { name: "TypeScript" },
	diskUsage: 4096,
	licenseInfo: { spdxId: "MIT", name: "MIT License" },
	defaultBranchRef: { name: "develop" },
	isPrivate: false,
	isFork: false,
	description: "A GitHub utilities plugin for Stream Deck",
	nameWithOwner: "pedrofuentes/stream-deck-github-utilities",
	url: "https://github.com/pedrofuentes/stream-deck-github-utilities",
	openPRs: { totalCount: 5 },
	closedPRs: { totalCount: 20 },
	mergedPRs: { totalCount: 80 },
	openIssues: { totalCount: 12 },
	closedIssues: { totalCount: 45 },
	latestRelease: {
		tagName: "v1.2.0",
		name: "Version 1.2.0",
		publishedAt: "2024-01-15T10:00:00Z",
		isPrerelease: false,
		isDraft: false,
		url: "https://github.com/pedrofuentes/stream-deck-github-utilities/releases/tag/v1.2.0",
	},
	releases: {
		nodes: [
			{
				tagName: "v1.3.0-beta.1",
				name: "Version 1.3.0 Beta 1",
				publishedAt: "2024-02-01T10:00:00Z",
				isPrerelease: true,
				isDraft: false,
				url: "https://github.com/pedrofuentes/stream-deck-github-utilities/releases/tag/v1.3.0-beta.1",
			},
			{
				tagName: "v1.2.0",
				name: "Version 1.2.0",
				publishedAt: "2024-01-15T10:00:00Z",
				isPrerelease: false,
				isDraft: false,
				url: "https://github.com/pedrofuentes/stream-deck-github-utilities/releases/tag/v1.2.0",
			},
		],
	},
	refs: {
		nodes: [
			{ name: "main", target: { oid: "abc123def456" } },
			{ name: "develop", target: { oid: "789ghi012jkl" } },
			{ name: "feature/new-action", target: { oid: "mno345pqr678" } },
		],
	},
	vulnerabilityAlerts: {
		totalCount: 5,
		nodes: [
			{ securityVulnerability: { severity: "CRITICAL" } },
			{ securityVulnerability: { severity: "HIGH" } },
			{ securityVulnerability: { severity: "HIGH" } },
			{ securityVulnerability: { severity: "MEDIUM" } },
			{ securityVulnerability: { severity: "LOW" } },
		],
	},
	discussions: {
		totalCount: 15,
		nodes: [
			{ title: "How to configure token?", isAnswered: true, createdAt: "2024-01-10T08:00:00Z", url: "https://github.com/pedrofuentes/stream-deck-github-utilities/discussions/1" },
			{ title: "Feature request: dark mode", isAnswered: false, createdAt: "2024-01-11T09:00:00Z", url: "https://github.com/pedrofuentes/stream-deck-github-utilities/discussions/2" },
			{ title: "Bug with refresh", isAnswered: true, createdAt: "2024-01-12T10:00:00Z", url: "https://github.com/pedrofuentes/stream-deck-github-utilities/discussions/3" },
		],
	},
	projectsV2: {
		nodes: [
			{
				title: "Roadmap",
				shortDescription: "Product roadmap",
				closed: false,
				number: 1,
				url: "https://github.com/orgs/pedrofuentes/projects/1",
				items: { totalCount: 24 },
			},
			{
				title: "Sprint 5",
				shortDescription: "Current sprint",
				closed: false,
				number: 2,
				url: "https://github.com/orgs/pedrofuentes/projects/2",
				items: { totalCount: 8 },
			},
		],
	},
};

/** Minimal node with null/missing optional fields */
const minimalNode: GraphQLRepoNode = {
	stargazerCount: 0,
	forkCount: 0,
	watchers: { totalCount: 0 },
	primaryLanguage: null,
	diskUsage: 0,
	licenseInfo: null,
	defaultBranchRef: null,
	isPrivate: true,
	isFork: true,
	description: null,
	nameWithOwner: "user/empty-repo",
	url: "https://github.com/user/empty-repo",
};

/** Full search response fixture */
const fullSearchResponse: GraphQLSearchResponse = {
	data: {
		search: {
			issueCount: 3,
			nodes: [
				{
					number: 42,
					title: "Fix login flow",
					url: "https://github.com/org/repo/pull/42",
					createdAt: "2024-01-20T12:00:00Z",
					author: { login: "alice" },
					repository: { nameWithOwner: "org/repo" },
				},
				{
					number: 99,
					title: "Update dependencies",
					url: "https://github.com/org/other/pull/99",
					createdAt: "2024-01-21T14:00:00Z",
					author: { login: "bob" },
					repository: { nameWithOwner: "org/other" },
				},
				{
					number: 7,
					title: "Add tests",
					url: "https://github.com/org/repo/pull/7",
					createdAt: "2024-01-22T16:00:00Z",
				},
			],
		},
	},
};

// ─── extractRepoMetadata ─────────────────────────────────────────────

describe("extractRepoMetadata", () => {
	it("maps all fields from a fully populated node", () => {
		const result = extractRepoMetadata(fullNode);

		expect(result).toEqual({
			stargazers_count: 1250,
			forks_count: 340,
			watchers_count: 89,
			language: "TypeScript",
			size: 4096,
			license: "MIT",
			default_branch: "develop",
			visibility: "public",
			description: "A GitHub utilities plugin for Stream Deck",
			full_name: "pedrofuentes/stream-deck-github-utilities",
			html_url: "https://github.com/pedrofuentes/stream-deck-github-utilities",
			open_issues_count: 12,
			open_pull_request_count: 5,
		});
	});

	it("handles null primaryLanguage", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.language).toBeNull();
	});

	it("handles null licenseInfo", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.license).toBeNull();
	});

	it("falls back to 'main' when defaultBranchRef is null", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.default_branch).toBe("main");
	});

	it("maps isPrivate true to 'private' visibility", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.visibility).toBe("private");
	});

	it("maps isPrivate false to 'public' visibility", () => {
		const result = extractRepoMetadata(fullNode);
		expect(result.visibility).toBe("public");
	});

	it("handles null description", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.description).toBeNull();
	});

	it("defaults open_issues_count to 0 when openIssues is missing", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.open_issues_count).toBe(0);
	});

	it("leaves open_pull_request_count as undefined when openPRs is missing", () => {
		const result = extractRepoMetadata(minimalNode);
		expect(result.open_pull_request_count).toBeUndefined();
	});

	it("uses spdxId for license (not full name)", () => {
		const nodeWithLicense: GraphQLRepoNode = {
			...minimalNode,
			licenseInfo: { spdxId: "Apache-2.0", name: "Apache License 2.0" },
		};
		const result = extractRepoMetadata(nodeWithLicense);
		expect(result.license).toBe("Apache-2.0");
	});
});

// ─── extractPRCount ──────────────────────────────────────────────────

describe("extractPRCount", () => {
	it("returns open PR count for 'open' state", () => {
		expect(extractPRCount(fullNode, "open")).toBe(5);
	});

	it("returns closed + merged for 'closed' state", () => {
		expect(extractPRCount(fullNode, "closed")).toBe(100);
	});

	it("returns open + closed + merged for 'all' state", () => {
		expect(extractPRCount(fullNode, "all")).toBe(105);
	});

	it("returns 0 for all states when PR fields are missing", () => {
		expect(extractPRCount(minimalNode, "open")).toBe(0);
		expect(extractPRCount(minimalNode, "closed")).toBe(0);
		expect(extractPRCount(minimalNode, "all")).toBe(0);
	});

	it("handles node with only open PRs", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			openPRs: { totalCount: 3 },
		};
		expect(extractPRCount(node, "open")).toBe(3);
		expect(extractPRCount(node, "closed")).toBe(0);
		expect(extractPRCount(node, "all")).toBe(3);
	});

	it("handles node with only merged PRs", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			mergedPRs: { totalCount: 15 },
		};
		expect(extractPRCount(node, "open")).toBe(0);
		expect(extractPRCount(node, "closed")).toBe(15);
		expect(extractPRCount(node, "all")).toBe(15);
	});
});

// ─── extractIssueCount ───────────────────────────────────────────────

describe("extractIssueCount", () => {
	it("returns open issue count for 'open' state", () => {
		expect(extractIssueCount(fullNode, "open")).toBe(12);
	});

	it("returns closed issue count for 'closed' state", () => {
		expect(extractIssueCount(fullNode, "closed")).toBe(45);
	});

	it("returns open + closed for 'all' state", () => {
		expect(extractIssueCount(fullNode, "all")).toBe(57);
	});

	it("returns 0 for all states when issue fields are missing", () => {
		expect(extractIssueCount(minimalNode, "open")).toBe(0);
		expect(extractIssueCount(minimalNode, "closed")).toBe(0);
		expect(extractIssueCount(minimalNode, "all")).toBe(0);
	});

	it("handles node with only open issues", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			openIssues: { totalCount: 7 },
		};
		expect(extractIssueCount(node, "open")).toBe(7);
		expect(extractIssueCount(node, "closed")).toBe(0);
		expect(extractIssueCount(node, "all")).toBe(7);
	});
});

// ─── extractLatestRelease ────────────────────────────────────────────

describe("extractLatestRelease", () => {
	it("returns stable release when includePreReleases is false", () => {
		const result = extractLatestRelease(fullNode, false);

		expect(result).toEqual({
			tag_name: "v1.2.0",
			name: "Version 1.2.0",
			html_url: "https://github.com/pedrofuentes/stream-deck-github-utilities/releases/tag/v1.2.0",
			published_at: "2024-01-15T10:00:00Z",
			prerelease: false,
			draft: false,
		});
	});

	it("returns pre-release when includePreReleases is true", () => {
		const result = extractLatestRelease(fullNode, true);

		expect(result).toEqual({
			tag_name: "v1.3.0-beta.1",
			name: "Version 1.3.0 Beta 1",
			html_url: "https://github.com/pedrofuentes/stream-deck-github-utilities/releases/tag/v1.3.0-beta.1",
			published_at: "2024-02-01T10:00:00Z",
			prerelease: true,
			draft: false,
		});
	});

	it("returns null when latestRelease is null and includePreReleases is false", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			latestRelease: null,
		};
		expect(extractLatestRelease(node, false)).toBeNull();
	});

	it("returns null when no releases exist and includePreReleases is true", () => {
		expect(extractLatestRelease(minimalNode, true)).toBeNull();
	});

	it("returns null when releases.nodes is empty and includePreReleases is true", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			releases: { nodes: [] },
		};
		expect(extractLatestRelease(node, true)).toBeNull();
	});

	it("returns null when latestRelease is undefined and includePreReleases is false", () => {
		expect(extractLatestRelease(minimalNode, false)).toBeNull();
	});

	it("falls back correctly when includePreReleases is true but only latestRelease exists", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			latestRelease: {
				tagName: "v1.0.0",
				name: "v1.0.0",
				publishedAt: "2024-01-01T00:00:00Z",
				isPrerelease: false,
				isDraft: false,
				url: "https://github.com/user/repo/releases/tag/v1.0.0",
			},
		};
		// With includePreReleases=true, we use releases.nodes[0] which is undefined
		expect(extractLatestRelease(node, true)).toBeNull();
	});
});

// ─── extractBranches ─────────────────────────────────────────────────

describe("extractBranches", () => {
	it("maps all branches from refs.nodes", () => {
		const result = extractBranches(fullNode);

		expect(result).toEqual([
			{ name: "main", commitSha: "abc123def456" },
			{ name: "develop", commitSha: "789ghi012jkl" },
			{ name: "feature/new-action", commitSha: "mno345pqr678" },
		]);
	});

	it("returns empty array when refs is undefined", () => {
		expect(extractBranches(minimalNode)).toEqual([]);
	});

	it("returns empty array when refs.nodes is empty", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			refs: { nodes: [] },
		};
		expect(extractBranches(node)).toEqual([]);
	});

	it("handles a single branch", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			refs: {
				nodes: [{ name: "main", target: { oid: "aaa111" } }],
			},
		};
		expect(extractBranches(node)).toEqual([
			{ name: "main", commitSha: "aaa111" },
		]);
	});
});

// ─── extractSecurityAlerts ───────────────────────────────────────────

describe("extractSecurityAlerts", () => {
	it("counts alerts by severity from fully populated node", () => {
		const result = extractSecurityAlerts(fullNode);

		expect(result).toEqual({
			critical: 1,
			high: 2,
			medium: 1,
			low: 1,
			total: 5,
		});
	});

	it("returns all zeros when vulnerabilityAlerts is undefined", () => {
		const result = extractSecurityAlerts(minimalNode);

		expect(result).toEqual({
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			total: 0,
		});
	});

	it("returns all zeros when vulnerabilityAlerts.nodes is empty", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			vulnerabilityAlerts: { totalCount: 0, nodes: [] },
		};
		const result = extractSecurityAlerts(node);

		expect(result).toEqual({
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			total: 0,
		});
	});

	it("handles case-insensitive severity matching", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			vulnerabilityAlerts: {
				totalCount: 4,
				nodes: [
					{ securityVulnerability: { severity: "critical" } },
					{ securityVulnerability: { severity: "Critical" } },
					{ securityVulnerability: { severity: "CRITICAL" } },
					{ securityVulnerability: { severity: "High" } },
				],
			},
		};
		const result = extractSecurityAlerts(node);

		expect(result.critical).toBe(3);
		expect(result.high).toBe(1);
		expect(result.total).toBe(4);
	});

	it("defaults unknown severity to low", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			vulnerabilityAlerts: {
				totalCount: 2,
				nodes: [
					{ securityVulnerability: { severity: "UNKNOWN_LEVEL" } },
					{ securityVulnerability: { severity: "moderate" } },
				],
			},
		};
		const result = extractSecurityAlerts(node);

		expect(result.low).toBe(2);
		expect(result.total).toBe(2);
	});

	it("handles all critical alerts", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			vulnerabilityAlerts: {
				totalCount: 3,
				nodes: [
					{ securityVulnerability: { severity: "CRITICAL" } },
					{ securityVulnerability: { severity: "CRITICAL" } },
					{ securityVulnerability: { severity: "CRITICAL" } },
				],
			},
		};
		const result = extractSecurityAlerts(node);

		expect(result).toEqual({
			critical: 3,
			high: 0,
			medium: 0,
			low: 0,
			total: 3,
		});
	});
});

// ─── extractReviewRequestedPRs ───────────────────────────────────────

describe("extractReviewRequestedPRs", () => {
	it("maps all fields from a full search response", () => {
		const result = extractReviewRequestedPRs(fullSearchResponse.data);

		expect(result.total_count).toBe(3);
		expect(result.items).toHaveLength(3);
		expect(result.items[0]).toEqual({
			number: 42,
			title: "Fix login flow",
			user_login: "alice",
			html_url: "https://github.com/org/repo/pull/42",
			created_at: "2024-01-20T12:00:00Z",
		});
	});

	it("defaults user_login to 'unknown' when author is missing", () => {
		const result = extractReviewRequestedPRs(fullSearchResponse.data);

		// Third node has no author
		expect(result.items[2].user_login).toBe("unknown");
	});

	it("returns empty result when data is undefined", () => {
		const result = extractReviewRequestedPRs(undefined);

		expect(result).toEqual({ total_count: 0, items: [] });
	});

	it("handles empty search nodes", () => {
		const data: GraphQLSearchResponse["data"] = {
			search: { issueCount: 0, nodes: [] },
		};
		const result = extractReviewRequestedPRs(data);

		expect(result).toEqual({ total_count: 0, items: [] });
	});

	it("preserves all node fields correctly", () => {
		const result = extractReviewRequestedPRs(fullSearchResponse.data);

		expect(result.items[1]).toEqual({
			number: 99,
			title: "Update dependencies",
			user_login: "bob",
			html_url: "https://github.com/org/other/pull/99",
			created_at: "2024-01-21T14:00:00Z",
		});
	});
});

// ─── extractDiscussions ──────────────────────────────────────────────

describe("extractDiscussions", () => {
	it("extracts discussions with correct counts from full node", () => {
		const result = extractDiscussions(fullNode);

		expect(result.totalCount).toBe(15);
		expect(result.answeredCount).toBe(2);
		expect(result.items).toHaveLength(3);
	});

	it("returns correct items array", () => {
		const result = extractDiscussions(fullNode);

		expect(result.items[0]).toEqual({
			title: "How to configure token?",
			isAnswered: true,
			createdAt: "2024-01-10T08:00:00Z",
			url: "https://github.com/pedrofuentes/stream-deck-github-utilities/discussions/1",
		});
	});

	it("returns zeros and empty array when discussions is undefined", () => {
		const result = extractDiscussions(minimalNode);

		expect(result).toEqual({
			totalCount: 0,
			answeredCount: 0,
			items: [],
		});
	});

	it("handles discussions with no answered items", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			discussions: {
				totalCount: 2,
				nodes: [
					{ title: "Q1", isAnswered: false, createdAt: "2024-01-01T00:00:00Z", url: "https://example.com/1" },
					{ title: "Q2", isAnswered: false, createdAt: "2024-01-02T00:00:00Z", url: "https://example.com/2" },
				],
			},
		};
		const result = extractDiscussions(node);

		expect(result.totalCount).toBe(2);
		expect(result.answeredCount).toBe(0);
		expect(result.items).toHaveLength(2);
	});

	it("handles discussions with empty nodes array", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			discussions: { totalCount: 0, nodes: [] },
		};
		const result = extractDiscussions(node);

		expect(result).toEqual({
			totalCount: 0,
			answeredCount: 0,
			items: [],
		});
	});
});

// ─── extractProjectsV2 ──────────────────────────────────────────────

describe("extractProjectsV2", () => {
	it("maps all project fields from full node", () => {
		const result = extractProjectsV2(fullNode);

		expect(result.projects).toHaveLength(2);
		expect(result.projects[0]).toEqual({
			title: "Roadmap",
			shortDescription: "Product roadmap",
			closed: false,
			number: 1,
			url: "https://github.com/orgs/pedrofuentes/projects/1",
			totalItems: 24,
		});
	});

	it("maps items.totalCount to totalItems", () => {
		const result = extractProjectsV2(fullNode);

		expect(result.projects[1].totalItems).toBe(8);
	});

	it("returns empty projects array when projectsV2 is undefined", () => {
		const result = extractProjectsV2(minimalNode);

		expect(result).toEqual({ projects: [] });
	});

	it("handles empty projects nodes", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			projectsV2: { nodes: [] },
		};
		const result = extractProjectsV2(node);

		expect(result).toEqual({ projects: [] });
	});

	it("handles closed projects", () => {
		const node: GraphQLRepoNode = {
			...minimalNode,
			projectsV2: {
				nodes: [
					{
						title: "Archive",
						shortDescription: "Old project",
						closed: true,
						number: 10,
						url: "https://github.com/orgs/user/projects/10",
						items: { totalCount: 0 },
					},
				],
			},
		};
		const result = extractProjectsV2(node);

		expect(result.projects[0].closed).toBe(true);
		expect(result.projects[0].totalItems).toBe(0);
	});
});
