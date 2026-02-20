/**
 * GitHub REST API client for fetching repository data.
 * Uses Node.js native fetch (available in Node 20+).
 */

import type { JsonValue } from "@elgato/utils";

/** Stat types supported by the plugin */
export type StatType = "stars" | "issues" | "forks" | "watchers";

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
}

/** Rate limit information from response headers */
export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: Date;
	used: number;
}

/** Structured error from the GitHub API */
export class GitHubApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly rateLimitInfo?: RateLimitInfo,
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

	return {
		stargazers_count: (data.stargazers_count as number) ?? 0,
		open_issues_count: (data.open_issues_count as number) ?? 0,
		forks_count: (data.forks_count as number) ?? 0,
		watchers_count: (data.watchers_count as number) ?? 0,
		full_name: (data.full_name as string) ?? `${owner}/${repo}`,
		description: (data.description as string | null) ?? null,
		visibility: (data.visibility as string) ?? "unknown",
		html_url: (data.html_url as string) ?? `https://github.com/${owner}/${repo}`,
	};
}

/**
 * Extracts the count for a specific stat type from repo stats.
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
	}
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
	}
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
		handleApiError(response.status, rateLimitInfo, owner, repo);
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
		handleApiError(response.status, rateLimitInfo, owner, repo);
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
		handleApiError(statusResponse.status, statusRateLimitInfo, owner, repo);
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
 * Centralized error handler for GitHub API responses.
 * @throws {GitHubApiError} always
 */
function handleApiError(status: number, rateLimitInfo: RateLimitInfo, owner: string, repo: string): never {
	if (status === 401) {
		throw new GitHubApiError("Invalid or expired GitHub token", status, rateLimitInfo);
	}

	if (status === 403 && rateLimitInfo.remaining === 0) {
		const resetTime = rateLimitInfo.reset.toLocaleTimeString();
		throw new GitHubApiError(
			`GitHub API rate limit exceeded. Resets at ${resetTime}`,
			status,
			rateLimitInfo,
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
					label: "⚠ Missing repo scope — only public data accessible",
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
	const url = `${GITHUB_API_BASE}/user/repos?per_page=100&sort=pushed&direction=desc&affiliation=owner,collaborator,organization_member`;

	let response: Response;
	try {
		response = await fetch(url, { headers });
	} catch {
		return [{ label: "⚠ Network error — check connection", value: "", disabled: true }];
	}

	if (!response.ok) {
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
		return [{ label: "⚠ Invalid response from GitHub", value: "", disabled: true }];
	}

	if (!Array.isArray(repos) || repos.length === 0) {
		return [{ label: "No repositories found", value: "", disabled: true }];
	}

	return repos.map((r) => ({
		label: `${r.private ? "🔒 " : ""}${r.full_name}`,
		value: r.full_name,
	}));
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
