/**
 * Shared type definitions for the GitHub Utilities plugin.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { JsonValue } from "@elgato/utils";
import type {
	StatType,
	RepoStats,
	ReleaseInfo,
	BranchInfo,
	BranchComparison,
	CommitActivityWeek,
	SecurityAlertSummary,
	ReviewRequestedPR,
	WorkflowInfo,
} from "./utils/github-api";

// ─── GraphQL Query Coordinator Types ─────────────────────────────────

/**
 * Names of data fragments that the coordinator can fetch and cache.
 * Each fragment represents a logical unit of data from GitHub's API.
 *
 * GraphQL-capable fragments: repoMetadata, prCount, issueCount, latestRelease,
 * branches, vulnerabilityAlerts, reviewRequestedPRs, discussions, projectsV2.
 *
 * REST-only fragments: workflowRuns, commitActivity, branchComparison.
 */
export type DataFragmentName =
	| "repoMetadata"
	| "prCount"
	| "issueCount"
	| "latestRelease"
	| "branches"
	| "vulnerabilityAlerts"
	| "reviewRequestedPRs"
	| "workflowRuns"
	| "commitActivity"
	| "branchComparison"
	| "discussions"
	| "projectsV2";

/** Fragments that can be fetched via GraphQL */
export type GraphQLFragmentName = Extract<DataFragmentName,
	| "repoMetadata"
	| "prCount"
	| "issueCount"
	| "latestRelease"
	| "branches"
	| "vulnerabilityAlerts"
	| "reviewRequestedPRs"
	| "discussions"
	| "projectsV2"
>;

/** Fragments that require REST API */
export type RESTFragmentName = Extract<DataFragmentName,
	| "workflowRuns"
	| "commitActivity"
	| "branchComparison"
>;

/** Fragments that are scoped to a repository (batched by repo) */
export type RepoScopedFragmentName = Exclude<DataFragmentName, "reviewRequestedPRs">;

/** Data source used to satisfy a cache entry */
export type DataSource = "graphql" | "rest";

/** A cached piece of data with metadata */
export interface CacheEntry<T = unknown> {
	/** The cached data */
	data: T;
	/** Timestamp (ms) when data was fetched */
	fetchedAt: number;
	/** Whether this was fetched via GraphQL or REST */
	source: DataSource;
}

/** Parameters for a data subscription — extra context needed to fetch specific fragments */
export interface FragmentParams {
	/** PR state filter (for prCount fragment) */
	prState?: "open" | "closed" | "all";
	/** Issue state filter (for issueCount fragment) */
	issueState?: "open" | "closed" | "all";
	/** Whether to include pre-releases (for latestRelease fragment) */
	includePreReleases?: boolean;
	/** Workflow file name (for workflowRuns fragment) */
	workflowFile?: string;
	/** Branch name (for workflowRuns/commitActivity fragments) */
	branch?: string;
	/** Environment name (for workflowRuns fragment) */
	environment?: string;
	/** Base branch (for branchComparison fragment) */
	baseBranch?: string;
	/** Head branch (for branchComparison fragment) */
	headBranch?: string;
	/** Time range for commit activity */
	timeRange?: "24h" | "7d" | "30d";
}

/** An action's subscription to data through the coordinator */
export interface DataSubscription {
	/** Unique action instance ID */
	actionId: string;
	/** Repository in "owner/repo" format (empty for cross-repo queries like reviewRequestedPRs) */
	repo: string;
	/** Which data fragments this action needs */
	fragments: DataFragmentName[];
	/** Maximum acceptable age of cached data in seconds */
	maxAgeSec: number;
	/** Additional parameters for fragment-specific queries */
	params?: FragmentParams;
}

/** Map of fragment names to their resolved data */
export interface CoordinatorResult {
	repoMetadata?: RepoStats;
	prCount?: number;
	issueCount?: number;
	latestRelease?: ReleaseInfo | null;
	branches?: BranchInfo[];
	vulnerabilityAlerts?: SecurityAlertSummary;
	reviewRequestedPRs?: { total_count: number; items: ReviewRequestedPR[] };
	workflowRuns?: WorkflowInfo;
	commitActivity?: CommitActivityWeek[] | null;
	branchComparison?: BranchComparison;
	discussions?: DiscussionsData;
	projectsV2?: ProjectsV2Data;
	/** Per-fragment errors (fragment still returned if available from cache) */
	errors?: Partial<Record<DataFragmentName, string>>;
}

/** GraphQL repository node — raw response shape from batched repo queries */
export interface GraphQLRepoNode {
	stargazerCount: number;
	forkCount: number;
	watchers: { totalCount: number };
	primaryLanguage: { name: string } | null;
	diskUsage: number;
	licenseInfo: { spdxId: string; name: string } | null;
	defaultBranchRef: { name: string } | null;
	isPrivate: boolean;
	isFork: boolean;
	description: string | null;
	nameWithOwner: string;
	url: string;
	openPRs?: { totalCount: number };
	closedPRs?: { totalCount: number };
	mergedPRs?: { totalCount: number };
	openIssues?: { totalCount: number };
	closedIssues?: { totalCount: number };
	latestRelease?: {
		tagName: string;
		name: string;
		publishedAt: string;
		isPrerelease: boolean;
		isDraft: boolean;
		url: string;
	} | null;
	releases?: {
		nodes: Array<{
			tagName: string;
			name: string;
			publishedAt: string;
			isPrerelease: boolean;
			isDraft: boolean;
			url: string;
		}>;
	};
	refs?: {
		nodes: Array<{
			name: string;
			target: { oid: string };
		}>;
	};
	vulnerabilityAlerts?: {
		totalCount: number;
		nodes: Array<{
			securityVulnerability: {
				severity: string;
			};
		}>;
	};
	discussions?: {
		totalCount: number;
		nodes: Array<{
			title: string;
			isAnswered: boolean;
			createdAt: string;
			url: string;
		}>;
	};
	projectsV2?: {
		nodes: Array<{
			title: string;
			shortDescription: string;
			closed: boolean;
			number: number;
			url: string;
			items: { totalCount: number };
		}>;
	};
}

/** Typed GraphQL response for repository queries */
export interface GraphQLRepoResponse {
	data?: {
		repository: GraphQLRepoNode;
	};
	errors?: GraphQLError[];
}

/** Typed GraphQL response for search queries */
export interface GraphQLSearchResponse {
	data?: {
		search: {
			issueCount: number;
			nodes: Array<{
				number: number;
				title: string;
				url: string;
				createdAt: string;
				author?: { login: string };
				repository?: { nameWithOwner: string };
			}>;
		};
	};
	errors?: GraphQLError[];
}

/** A single GraphQL error from the response */
export interface GraphQLError {
	message: string;
	type?: string;
	path?: string[];
	locations?: Array<{ line: number; column: number }>;
}

/** GraphQL rate limit info (point-based, separate from REST) */
export interface GraphQLRateLimit {
	limit: number;
	remaining: number;
	resetAt: Date;
	cost: number;
	nodeCount: number;
}

/** Discussions data returned by the coordinator */
export interface DiscussionsData {
	totalCount: number;
	answeredCount: number;
	items: Array<{
		title: string;
		isAnswered: boolean;
		createdAt: string;
		url: string;
	}>;
}

/** Projects V2 data returned by the coordinator */
export interface ProjectsV2Data {
	projects: Array<{
		title: string;
		shortDescription: string;
		closed: boolean;
		number: number;
		url: string;
		totalItems: number;
	}>;
}

/** Global settings shared across all actions — stored once at the plugin level */
export interface GlobalSettings {
	/** GitHub Personal Access Token (fine-grained or classic) */
	githubToken?: string;
	[key: string]: JsonValue;
}

/** Per-action settings for the Repo Stats action */
export interface RepoStatsSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Which stat to display on the button */
	statType?: StatType;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Workflow Status action */
export interface WorkflowStatusSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Optional workflow file name (e.g. "deploy.yml") to filter runs */
	workflowFile?: string;
	/** Optional branch to filter workflow runs */
	branch?: string;
	/** Optional deployment environment name (e.g. "production") */
	environment?: string;
	/** Auto-refresh interval in seconds (default: 60 = 1 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the PR Counter action */
export interface PullRequestCounterSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** PR state filter: open, closed, or all (default: open) */
	stateFilter?: "open" | "closed" | "all";
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the PR Review Queue action */
export interface PRReviewQueueSettings {
	/** Optional repository filter in "owner/repo" format (shows all repos if empty) */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Issue Counter action */
export interface IssueCounterSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Issue state filter: open, closed, or all (default: open) */
	stateFilter?: "open" | "closed" | "all";
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Release Monitor action */
export interface ReleaseMonitorSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Whether to include pre-releases (default: false) */
	includePreReleases?: boolean;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Commit Activity action */
export interface CommitActivitySettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Time range for commit count: 24h, 7d, or 30d (default: 7d) */
	timeRange?: "24h" | "7d" | "30d";
	/** Optional branch filter */
	branch?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Branch Network action */
export interface BranchNetworkSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Contribution Heatmap action */
export interface ContributionHeatmapSettings {
	/** Repository in "owner/repo" format (used for REST per-repo mode) */
	repo?: string;
	/** Data source: "repo" for per-repo commits, "user" for profile-level contributions */
	dataSource?: "repo" | "user";
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Fleet Monitor action */
export interface FleetMonitorSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Branch Comparison action */
export interface BranchComparisonSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Base branch (e.g. "main") */
	baseBranch?: string;
	/** Head branch to compare (e.g. "develop") */
	headBranch?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Security Health action */
export interface SecurityHealthSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Discussions Monitor action */
export interface DiscussionsMonitorSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Per-action settings for the Projects Board action */
export interface ProjectsBoardSettings {
	/** Repository in "owner/repo" format */
	repo?: string;
	/** Auto-refresh interval in seconds (default: 300 = 5 min) */
	refreshInterval?: number;
	[key: string]: JsonValue;
}
