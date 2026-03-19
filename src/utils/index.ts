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
	fetchReviewRequestedPRs,
	fetchIssueCount,
	fetchLatestRelease,
	fetchCommitActivity,
	fetchBranchComparison,
	fetchBranchNetwork,
	formatRelativeTime,
	formatRunDuration,
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
	triggerWorkflowDispatch,
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
	type BranchInfo,
	type ReviewRequestedPR,
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
	renderAnimatedSpinner,
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
export {
	PollingCoordinator,
} from "./polling-coordinator";
export {
	renderStatStrip,
	renderWorkflowStrip,
	renderPRQueueStrip,
	renderBranchNetworkStrip,
	renderStripLoading,
	renderStripError,
	renderStripUnconfigured,
} from "./touch-strip-renderer";
