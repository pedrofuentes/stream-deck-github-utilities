/**
 * Shared test fixtures for integration tests.
 *
 * Provides realistic mock API responses matching the exact shapes expected
 * by the coordinator, extractors, and renderers.
 */

import type { GraphQLRepoNode, GraphQLRepoResponse, GraphQLSearchResponse } from "../../src/types";
import type { RepoStats, WorkflowRun, WorkflowInfo, ReleaseInfo, BranchInfo, SecurityAlertSummary, BranchComparison, CommitActivityWeek, ReviewRequestedPR } from "../../src/utils/github-api";

// ─── Test constants ──────────────────────────────────────────────────────────

export const TOKEN = "ghp_testtoken123456789012345678901234";
export const REPO = "facebook/react";
export const OWNER = "facebook";
export const REPO_NAME = "react";

// ─── GraphQL Response Builders ───────────────────────────────────────────────

/** Creates a realistic GraphQL repository node with all fields populated. */
export function makeGraphQLRepoNode(overrides?: Partial<GraphQLRepoNode>): GraphQLRepoNode {
	return {
		stargazerCount: 42000,
		forkCount: 5200,
		watchers: { totalCount: 1800 },
		primaryLanguage: { name: "JavaScript" },
		diskUsage: 256000,
		licenseInfo: { spdxId: "MIT", name: "MIT License" },
		defaultBranchRef: { name: "main" },
		isPrivate: false,
		isFork: false,
		description: "The library for web and native user interfaces.",
		nameWithOwner: "facebook/react",
		url: "https://github.com/facebook/react",
		openPRs: { totalCount: 120 },
		closedPRs: { totalCount: 4500 },
		mergedPRs: { totalCount: 3200 },
		openIssues: { totalCount: 850 },
		closedIssues: { totalCount: 12000 },
		latestRelease: {
			tagName: "v18.3.1",
			name: "React 18.3.1",
			publishedAt: "2024-04-26T00:00:00Z",
			isPrerelease: false,
			isDraft: false,
			url: "https://github.com/facebook/react/releases/tag/v18.3.1",
		},
		releases: {
			nodes: [
				{
					tagName: "v19.0.0-rc.1",
					name: "React 19.0.0 RC1",
					publishedAt: "2024-12-01T00:00:00Z",
					isPrerelease: true,
					isDraft: false,
					url: "https://github.com/facebook/react/releases/tag/v19.0.0-rc.1",
				},
			],
		},
		refs: {
			nodes: [
				{ name: "main", target: { oid: "abc123def456" } },
				{ name: "canary", target: { oid: "def456ghi789" } },
				{ name: "experimental", target: { oid: "ghi789jkl012" } },
			],
		},
		vulnerabilityAlerts: {
			totalCount: 3,
			nodes: [
				{ securityVulnerability: { severity: "CRITICAL" } },
				{ securityVulnerability: { severity: "HIGH" } },
				{ securityVulnerability: { severity: "LOW" } },
			],
		},
		discussions: {
			totalCount: 250,
			nodes: [
				{ title: "RFC: React Server Components", isAnswered: true, createdAt: "2024-01-15T00:00:00Z", url: "https://github.com/facebook/react/discussions/1" },
				{ title: "Help with useEffect", isAnswered: false, createdAt: "2024-06-01T00:00:00Z", url: "https://github.com/facebook/react/discussions/2" },
			],
		},
		projectsV2: {
			nodes: [
				{
					title: "React 19 Roadmap",
					shortDescription: "Tracking React 19 features",
					closed: false,
					number: 1,
					url: "https://github.com/orgs/facebook/projects/1",
					items: { totalCount: 42 },
				},
			],
		},
		...overrides,
	};
}

/** Wraps a GraphQL repo node in the standard response envelope. */
export function makeGraphQLRepoResponse(overrides?: Partial<GraphQLRepoNode>): { data: GraphQLRepoResponse["data"] } {
	return {
		data: {
			repository: makeGraphQLRepoNode(overrides),
		},
	};
}

/** Creates a GraphQL search response for review-requested PRs. */
export function makeGraphQLSearchResponse(
	prCount = 3,
): { data: GraphQLSearchResponse["data"] } {
	const nodes = Array.from({ length: prCount }, (_, i) => ({
		number: i + 100,
		title: `Fix issue #${i + 100}`,
		url: `https://github.com/facebook/react/pull/${i + 100}`,
		createdAt: "2024-06-15T10:00:00Z",
		author: { login: `contributor-${i}` },
		repository: { nameWithOwner: "facebook/react" },
	}));

	return {
		data: {
			search: {
				issueCount: prCount,
				nodes,
			},
		},
	};
}

// ─── REST Response Builders ──────────────────────────────────────────────────

/** Creates a realistic REST repo stats response. */
export function makeRESTRepoResponse(overrides?: Partial<RepoStats>): RepoStats {
	return {
		stargazers_count: 42000,
		forks_count: 5200,
		watchers_count: 1800,
		open_issues_count: 850,
		full_name: "facebook/react",
		description: "The library for web and native user interfaces.",
		visibility: "public",
		html_url: "https://github.com/facebook/react",
		language: "JavaScript",
		size: 256000,
		license: "MIT",
		default_branch: "main",
		open_pull_request_count: 120,
		...overrides,
	};
}

/** Creates a realistic workflow run object. */
export function makeWorkflowRun(overrides?: Partial<WorkflowRun>): WorkflowRun {
	return {
		id: 12345,
		name: "CI",
		status: "completed",
		conclusion: "success",
		html_url: "https://github.com/facebook/react/actions/runs/12345",
		created_at: "2024-06-15T10:00:00Z",
		updated_at: "2024-06-15T10:05:00Z",
		...overrides,
	};
}

/** Creates a realistic workflow info object. */
export function makeWorkflowInfo(overrides?: Partial<WorkflowInfo>): WorkflowInfo {
	return {
		latestRun: makeWorkflowRun(),
		deployment: undefined,
		...overrides,
	};
}

/** Creates a realistic release info object. */
export function makeReleaseInfo(overrides?: Partial<ReleaseInfo>): ReleaseInfo {
	return {
		tag_name: "v18.3.1",
		name: "React 18.3.1",
		html_url: "https://github.com/facebook/react/releases/tag/v18.3.1",
		published_at: "2024-04-26T00:00:00Z",
		prerelease: false,
		draft: false,
		...overrides,
	};
}

/** Creates a branch info array. */
export function makeBranches(): BranchInfo[] {
	return [
		{ name: "main", commitSha: "abc123" },
		{ name: "develop", commitSha: "def456" },
	];
}

/** Creates a security alert summary. */
export function makeSecurityAlerts(overrides?: Partial<SecurityAlertSummary>): SecurityAlertSummary {
	return {
		critical: 1,
		high: 2,
		medium: 3,
		low: 1,
		total: 7,
		...overrides,
	};
}

/** Creates a branch comparison result. */
export function makeBranchComparison(overrides?: Partial<BranchComparison>): BranchComparison {
	return {
		ahead_by: 5,
		behind_by: 3,
		total_commits: 8,
		...overrides,
	};
}

/** Creates commit activity weeks. */
export function makeCommitActivityWeeks(): CommitActivityWeek[] {
	return [
		{ week: 1718582400, days: [2, 3, 5, 4, 6, 1, 0], total: 21 },
		{ week: 1719187200, days: [1, 2, 3, 2, 4, 0, 0], total: 12 },
	];
}

/** Creates a review-requested PR list. */
export function makeReviewRequestedPRs(count = 3): { total_count: number; items: ReviewRequestedPR[] } {
	const items: ReviewRequestedPR[] = Array.from({ length: count }, (_, i) => ({
		number: i + 100,
		title: `Fix issue #${i + 100}`,
		user_login: `contributor-${i}`,
		html_url: `https://github.com/facebook/react/pull/${i + 100}`,
		created_at: "2024-06-15T10:00:00Z",
	}));

	return { total_count: count, items };
}

// ─── Fetch Mock Helpers ──────────────────────────────────────────────────────

/** Creates a mock Response object matching the fetch API. */
export function mockResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
	const headersObj = new Headers(headers);
	if (!headersObj.has("x-ratelimit-limit")) headersObj.set("x-ratelimit-limit", "5000");
	if (!headersObj.has("x-ratelimit-remaining")) headersObj.set("x-ratelimit-remaining", "4999");
	if (!headersObj.has("x-ratelimit-reset")) headersObj.set("x-ratelimit-reset", String(Math.floor(Date.now() / 1000) + 3600));
	if (!headersObj.has("x-ratelimit-used")) headersObj.set("x-ratelimit-used", "1");

	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		headers: headersObj,
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
		clone: () => mockResponse(body, status, headers),
	} as unknown as Response;
}

/** Creates an error Response with rate limit headers. */
export function mockErrorResponse(status: number, headers?: Record<string, string>): Response {
	const body = { message: `Error ${status}` };
	return mockResponse(body, status, headers);
}

// ─── SVG Decode Helper ───────────────────────────────────────────────────────

/** Decodes an SVG data URI produced by the button renderer. */
export function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}
