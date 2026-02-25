/**
 * Shared type definitions for the GitHub Utilities plugin.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { JsonValue } from "@elgato/utils";
import type { StatType } from "./utils/github-api";

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
