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
