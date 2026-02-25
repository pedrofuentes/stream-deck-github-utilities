/**
 * Barrel exports for shared utilities.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

export { isValidGitHubToken, maskToken, formatCount, isValidRepoIdentifier, parseRepoIdentifier } from "./github";
export {
	fetchRepoStats,
	fetchOpenPullRequestCount,
	fetchPullRequestCount,
	fetchIssueCount,
	fetchLatestRelease,
	fetchCommitActivity,
	fetchBranchComparison,
	formatRelativeTime,
	getStatValue,
	getStatLabel,
	getStatUrl,
	getStatDisplay,
	formatRepoSize,
	parseRateLimitHeaders,
	GitHubApiError,
	fetchLatestWorkflowRun,
	fetchLatestDeploymentStatus,
	fetchWorkflowInfo,
	getWorkflowDisplayStatus,
	getWorkflowStatusLabel,
	type StatType,
	type RepoStats,
	type RateLimitInfo,
	type WorkflowRun,
	type WorkflowRunStatus,
	type WorkflowRunConclusion,
	type DeploymentStatus,
	type DeploymentState,
	type WorkflowInfo,
	type DataSourceItem,
	type ReleaseInfo,
	type CommitActivityWeek,
	type BranchComparison,
	fetchUserRepos,
	fetchRepoWorkflows,
	fetchRepoBranches,
	fetchRepoEnvironments,
} from "./github-api";
export {
	handlePIDataRequest,
	PI_EVENTS,
	type PIDataRequest,
	type PIDataResponse,
} from "./pi-data-provider";
export {
	getWorkflowStatusColor,
	getStatusIcon,
	escapeXml,
	COLORS,
	renderKeyImage,
	renderIconKeyImage,
	renderStatImage,
	renderWorkflowImage,
	renderDeployingImage,
	renderLoadingImage,
	renderSpinnerFrame,
	renderErrorImage,
	renderUnconfiguredImage,
	renderPRCountImage,
	renderIssueCountImage,
	renderReleaseImage,
	renderCommitActivityImage,
	renderBranchComparisonImage,
	SPINNER_FRAME_COUNT,
	SPINNER_INTERVAL_MS,
	type KeyImageOptions,
	type KeyIconImageOptions,
} from "./button-renderer";
export {
	SpinnerAnimator,
	startLoadingSpinner,
	stopLoadingSpinner,
} from "./spinner-animator";
export {
	MarqueeController,
	MARQUEE_PAUSE_TICKS,
	MARQUEE_SEPARATOR,
} from "./marquee-controller";
