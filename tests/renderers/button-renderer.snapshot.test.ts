import { describe, it, expect } from "vitest";
import {
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
	renderDiscussionsImage,
	renderBranchComparisonImage,
	renderProjectsBoardImage,
	getWorkflowStatusColor,
	getStatusIcon,
	escapeXml,
} from "../../src/utils/button-renderer.js";

// ── Core layout renderers ──────────────────────────────────────────────────

describe("Button renderer snapshots", () => {
	describe("renderKeyImage", () => {
		it("basic three-line layout", () => {
			const result = renderKeyImage({
				line1: "owner/repo",
				line2: "42K",
				line3: "Stars",
				statusColor: "#f0c000",
			});
			expect(result).toMatchSnapshot();
		});

		it("with custom line2 font size", () => {
			expect(renderKeyImage({
				line1: "org/project",
				line2: "TypeScript",
				line3: "Language",
				statusColor: "#3178c6",
				line2FontSize: 22,
			})).toMatchSnapshot();
		});

		it("line2 only (no optional lines)", () => {
			expect(renderKeyImage({
				line2: "Status",
				statusColor: "#58a6ff",
			})).toMatchSnapshot();
		});

		it("empty strings", () => {
			expect(renderKeyImage({
				line1: "",
				line2: "",
				line3: "",
				statusColor: "#000000",
			})).toMatchSnapshot();
		});
	});

	describe("renderIconKeyImage", () => {
		it("success icon", () => {
			expect(renderIconKeyImage({
				line1: "owner/repo",
				status: "success",
				line3: "CI Build",
				statusColor: "#3fb950",
			})).toMatchSnapshot();
		});

		it("failure icon", () => {
			expect(renderIconKeyImage({
				line1: "owner/repo",
				status: "failure",
				line3: "Deploy",
				statusColor: "#f85149",
			})).toMatchSnapshot();
		});

		it("without optional lines", () => {
			expect(renderIconKeyImage({
				status: "in_progress",
				statusColor: "#d29922",
			})).toMatchSnapshot();
		});
	});

	// ── Stat images ────────────────────────────────────────────────────────

	describe("renderStatImage", () => {
		it("stars", () => {
			expect(renderStatImage("42K", "stars", "facebook/react")).toMatchSnapshot();
		});

		it("forks", () => {
			expect(renderStatImage("8.2K", "forks", "torvalds/linux")).toMatchSnapshot();
		});

		it("issues", () => {
			expect(renderStatImage("1,234", "issues", "microsoft/vscode")).toMatchSnapshot();
		});

		it("watchers", () => {
			expect(renderStatImage("500", "watchers", "golang/go")).toMatchSnapshot();
		});

		it("pull_requests", () => {
			expect(renderStatImage("89", "pull_requests", "owner/repo")).toMatchSnapshot();
		});

		it("language", () => {
			expect(renderStatImage("TypeScript", "language", "microsoft/vscode")).toMatchSnapshot();
		});

		it("size", () => {
			expect(renderStatImage("45 MB", "size", "owner/repo")).toMatchSnapshot();
		});

		it("license", () => {
			expect(renderStatImage("MIT", "license", "owner/repo")).toMatchSnapshot();
		});

		it("default_branch", () => {
			expect(renderStatImage("main", "default_branch", "owner/repo")).toMatchSnapshot();
		});

		it("visibility", () => {
			expect(renderStatImage("Public", "visibility", "owner/repo")).toMatchSnapshot();
		});

		it("long value truncation", () => {
			expect(renderStatImage("1,234,567,890", "stars", "very-long-org/very-long-repo-name")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderStatImage("42K", "stars")).toMatchSnapshot();
		});

		it("XSS characters escaped", () => {
			expect(renderStatImage("<script>alert(1)</script>", "language", "evil/repo&co")).toMatchSnapshot();
		});
	});

	// ── Workflow status images ─────────────────────────────────────────────

	describe("renderWorkflowImage", () => {
		it("success", () => {
			expect(renderWorkflowImage("Success", "success", "owner/repo")).toMatchSnapshot();
		});

		it("failure", () => {
			expect(renderWorkflowImage("Failure", "failure", "owner/repo")).toMatchSnapshot();
		});

		it("in_progress", () => {
			expect(renderWorkflowImage("In Progress", "in_progress", "org/project")).toMatchSnapshot();
		});

		it("cancelled", () => {
			expect(renderWorkflowImage("Cancelled", "cancelled", "owner/repo")).toMatchSnapshot();
		});

		it("queued", () => {
			expect(renderWorkflowImage("Queued", "queued", "owner/repo")).toMatchSnapshot();
		});

		it("with deploy label", () => {
			expect(renderWorkflowImage("Success", "success", "owner/repo", "production")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderWorkflowImage("Failure", "failure")).toMatchSnapshot();
		});

		it("with branch and deploy label", () => {
			expect(renderWorkflowImage("Success", "success", "owner/repo", "prod: success", "main")).toMatchSnapshot();
		});

		it("with branch and no deploy label", () => {
			expect(renderWorkflowImage("Failure", "failure", "owner/repo", undefined, "develop")).toMatchSnapshot();
		});

		it("with branch and no repo name", () => {
			expect(renderWorkflowImage("Success", "success", undefined, "dev: success", "develop")).toMatchSnapshot();
		});
	});

	// ── Deploying image ────────────────────────────────────────────────────

	describe("renderDeployingImage", () => {
		it("production environment", () => {
			expect(renderDeployingImage("production", "in_progress", "owner/repo")).toMatchSnapshot();
		});

		it("staging environment", () => {
			expect(renderDeployingImage("staging", "queued", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderDeployingImage("preview", "pending")).toMatchSnapshot();
		});

		it("with branch", () => {
			expect(renderDeployingImage("production", "in_progress", "owner/repo", "main")).toMatchSnapshot();
		});
	});

	// ── State images ───────────────────────────────────────────────────────

	describe("renderLoadingImage", () => {
		it("default loading", () => {
			expect(renderLoadingImage()).toMatchSnapshot();
		});
	});

	describe("renderAnimatedSpinner", () => {
		it("default accent color", () => {
			expect(renderAnimatedSpinner()).toMatchSnapshot();
		});

		it("custom accent color", () => {
			expect(renderAnimatedSpinner("#f85149")).toMatchSnapshot();
		});
	});

	describe("renderSpinnerFrame", () => {
		it("frame 0 default", () => {
			expect(renderSpinnerFrame()).toMatchSnapshot();
		});

		it("frame 0 explicit", () => {
			expect(renderSpinnerFrame(0)).toMatchSnapshot();
		});

		it("frame 3", () => {
			expect(renderSpinnerFrame(3)).toMatchSnapshot();
		});

		it("frame 6", () => {
			expect(renderSpinnerFrame(6)).toMatchSnapshot();
		});

		it("custom accent color", () => {
			expect(renderSpinnerFrame(0, "#f85149")).toMatchSnapshot();
		});
	});

	describe("renderErrorImage", () => {
		it("default message", () => {
			expect(renderErrorImage()).toMatchSnapshot();
		});

		it("generic error", () => {
			expect(renderErrorImage("Error")).toMatchSnapshot();
		});

		it("rate limited", () => {
			expect(renderErrorImage("Rate Limited")).toMatchSnapshot();
		});

		it("custom message", () => {
			expect(renderErrorImage("Not Found")).toMatchSnapshot();
		});
	});

	describe("renderUnconfiguredImage", () => {
		it("default", () => {
			expect(renderUnconfiguredImage()).toMatchSnapshot();
		});
	});

	// ── Count images ───────────────────────────────────────────────────────

	describe("renderPRCountImage", () => {
		it("open PRs", () => {
			expect(renderPRCountImage("23", "open", "owner/repo")).toMatchSnapshot();
		});

		it("closed PRs", () => {
			expect(renderPRCountImage("156", "closed", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderPRCountImage("5", "open")).toMatchSnapshot();
		});
	});

	describe("renderIssueCountImage", () => {
		it("open issues", () => {
			expect(renderIssueCountImage("156", "open", "owner/repo")).toMatchSnapshot();
		});

		it("closed issues", () => {
			expect(renderIssueCountImage("1.2K", "closed", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderIssueCountImage("42", "open")).toMatchSnapshot();
		});
	});

	// ── Release image ──────────────────────────────────────────────────────

	describe("renderReleaseImage", () => {
		it("with relative time", () => {
			expect(renderReleaseImage("v2.1.0", "3 days ago", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderReleaseImage("v1.0.0-beta.1", "just now")).toMatchSnapshot();
		});
	});

	// ── Commit activity ────────────────────────────────────────────────────

	describe("renderCommitActivityImage", () => {
		it("7 day range", () => {
			expect(renderCommitActivityImage("127", "7d", "owner/repo")).toMatchSnapshot();
		});

		it("30 day range", () => {
			expect(renderCommitActivityImage("1.2K", "30d", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderCommitActivityImage("42", "24h")).toMatchSnapshot();
		});
	});

	// ── Discussions ────────────────────────────────────────────────────────

	describe("renderDiscussionsImage", () => {
		it("with answered count", () => {
			expect(renderDiscussionsImage("45", "12 answered", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderDiscussionsImage("0", "0 answered")).toMatchSnapshot();
		});
	});

	// ── Branch comparison ──────────────────────────────────────────────────

	describe("renderBranchComparisonImage", () => {
		it("ahead and behind", () => {
			expect(renderBranchComparisonImage("5 ahead", "main..dev", "owner/repo")).toMatchSnapshot();
		});

		it("with custom color", () => {
			expect(renderBranchComparisonImage("3 behind", "main", "owner/repo", "#f85149")).toMatchSnapshot();
		});

		it("long comparison string", () => {
			expect(renderBranchComparisonImage("125 ahead, 42 behind", "main..feature/long-branch-name", "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderBranchComparisonImage("even", "main")).toMatchSnapshot();
		});
	});

	// ── Projects board ─────────────────────────────────────────────────────

	describe("renderProjectsBoardImage", () => {
		it("no projects", () => {
			expect(renderProjectsBoardImage([])).toMatchSnapshot();
		});

		it("single project", () => {
			expect(renderProjectsBoardImage([
				{ title: "Sprint 1", totalItems: 24 },
			])).toMatchSnapshot();
		});

		it("multiple projects", () => {
			expect(renderProjectsBoardImage([
				{ title: "Sprint 1", totalItems: 24 },
				{ title: "Backlog", totalItems: 156 },
				{ title: "Q4 Goals", totalItems: 8 },
			])).toMatchSnapshot();
		});
	});

	// ── Utility functions ──────────────────────────────────────────────────

	describe("getWorkflowStatusColor", () => {
		it("all known statuses produce consistent colors", () => {
			const statuses = [
				"success", "failure", "in_progress", "cancelled",
				"queued", "pending", "waiting", "skipped",
				"timed_out", "action_required", "neutral",
				"stale", "requested", "deploying",
			];
			const result = Object.fromEntries(
				statuses.map(s => [s, getWorkflowStatusColor(s)])
			);
			expect(result).toMatchSnapshot();
		});

		it("unknown status", () => {
			expect(getWorkflowStatusColor("unknown_status")).toMatchSnapshot();
		});
	});

	describe("getStatusIcon", () => {
		it("success icon SVG", () => {
			expect(getStatusIcon("success", "#3fb950")).toMatchSnapshot();
		});

		it("failure icon SVG", () => {
			expect(getStatusIcon("failure", "#f85149")).toMatchSnapshot();
		});

		it("unknown status icon", () => {
			expect(getStatusIcon("nonexistent", "#ffffff")).toMatchSnapshot();
		});
	});

	describe("escapeXml", () => {
		it("escapes all special characters", () => {
			expect(escapeXml("<script>alert('xss' & \"hack\")</script>")).toMatchSnapshot();
		});
	});
});
