/**
 * Integration tests: API data → transformation → rendered SVG
 *
 * Verifies the complete data rendering pipeline: real data objects
 * go through real transformation functions and real SVG renderers,
 * producing SVG images that contain the expected visual content.
 */

import { describe, it, expect, vi } from "vitest";
import {
	getStatDisplay,
	getStatLabel,
	getWorkflowDisplayStatus,
	getWorkflowStatusLabel,
} from "../../src/utils/github-api";
import {
	renderStatImage,
	renderWorkflowImage,
	renderDeployingImage,
	renderPRCountImage,
	renderIssueCountImage,
	renderReleaseImage,
	renderCommitActivityImage,
	renderBranchComparisonImage,
	renderDiscussionsImage,
	renderErrorImage,
	renderUnconfiguredImage,
	STAT_LABELS,
	COLORS,
} from "../../src/utils/button-renderer";
import { formatCount } from "../../src/utils/github";
import {
	makeRESTRepoResponse,
	makeWorkflowRun,
	makeReleaseInfo,
	decodeSvg,
} from "./fixtures";
import type { StatType, RepoStats } from "../../src/utils/github-api";

// Mock @elgato/streamdeck
vi.mock("@elgato/streamdeck", () => ({
	default: {
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
			trace: vi.fn(),
		},
	},
}));

describe("Data flow: API data → transformation → rendered SVG", () => {
	describe("Repo stats rendering pipeline", () => {
		const stats: RepoStats = makeRESTRepoResponse();

		it.each([
			["stars", "42k", "Stars"],
			["forks", "5.2k", "Forks"],
			["watchers", "1.8k", "Watchers"],
			["issues", "850", "Issues"],
			["pull_requests", "120", "Pull Requests"],
		] as [StatType, string, string][])("stat %s → display '%s' → SVG contains '%s'", (statType, expectedDisplay, expectedLabel) => {
			// Step 1: Transform data
			const display = getStatDisplay(stats, statType, formatCount);
			expect(display).toBe(expectedDisplay);

			// Step 2: Render SVG
			const svg = renderStatImage(display, statType, "react");
			expect(svg).toMatch(/^data:image\/svg\+xml,/);

			// Step 3: Verify SVG content
			const decoded = decodeSvg(svg);
			expect(decoded).toContain(expectedDisplay);
			expect(decoded).toContain(expectedLabel);
			expect(decoded).toContain("react");
		});

		it("text stat: language → 'JavaScript' → SVG", () => {
			const display = getStatDisplay(stats, "language", formatCount);
			expect(display).toBe("JavaScript");

			const svg = renderStatImage(display, "language", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("JavaScript");
			expect(decoded).toContain("Language");
		});

		it("text stat: license → 'MIT' → SVG", () => {
			const display = getStatDisplay(stats, "license", formatCount);
			expect(display).toBe("MIT");

			const svg = renderStatImage(display, "license", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("MIT");
			expect(decoded).toContain("License");
		});

		it("text stat: default_branch → 'main' → SVG", () => {
			const display = getStatDisplay(stats, "default_branch", formatCount);
			expect(display).toBe("main");

			const svg = renderStatImage(display, "default_branch", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("main");
			expect(decoded).toContain("Branch");
		});

		it("text stat: visibility → 'Public' → SVG", () => {
			const display = getStatDisplay(stats, "visibility", formatCount);
			expect(display).toBe("Public");

			const svg = renderStatImage(display, "visibility", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("Public");
			expect(decoded).toContain("Visibility");
		});

		it("size stat → formatted size → SVG", () => {
			const display = getStatDisplay(stats, "size", formatCount);
			expect(display).toBe("250.0 MB"); // 256000 KB ≈ 250 MB

			const svg = renderStatImage(display, "size", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("250.0 MB");
			expect(decoded).toContain("Size");
		});

		it("stat SVG uses correct accent color for each type", () => {
			const accentTypes: StatType[] = ["stars", "issues", "forks", "watchers"];
			for (const statType of accentTypes) {
				const display = getStatDisplay(stats, statType, formatCount);
				const svg = renderStatImage(display, statType);
				const decoded = decodeSvg(svg);
				const expectedColor = COLORS.accent[statType];
				expect(decoded).toContain(expectedColor);
			}
		});

		it("STAT_LABELS covers all stat types", () => {
			const expectedTypes: StatType[] = ["stars", "issues", "forks", "watchers", "pull_requests", "language", "size", "license", "default_branch", "visibility"];
			for (const type of expectedTypes) {
				expect(STAT_LABELS[type]).toBeDefined();
				expect(typeof STAT_LABELS[type]).toBe("string");
			}
		});

		it("null language → 'None' display", () => {
			const nullLangStats = makeRESTRepoResponse({ language: null });
			const display = getStatDisplay(nullLangStats, "language", formatCount);
			expect(display).toBe("None");
		});

		it("null license → 'None' display", () => {
			const noLicenseStats = makeRESTRepoResponse({ license: null });
			const display = getStatDisplay(noLicenseStats, "license", formatCount);
			expect(display).toBe("None");
		});
	});

	describe("Workflow status rendering pipeline", () => {
		it.each([
			["completed", "success", "Success"],
			["completed", "failure", "Failed"],
			["completed", "cancelled", "Cancelled"],
			["completed", "skipped", "Skipped"],
			["completed", "timed_out", "Timed Out"],
			["completed", "action_required", "Action Req."],
			["in_progress", null, "Running"],
			["queued", null, "Queued"],
		] as [string, string | null, string][])("status=%s conclusion=%s → label '%s' → valid SVG", (status, conclusion, expectedLabel) => {
			const run = makeWorkflowRun({
				status: status as "queued" | "in_progress" | "completed",
				conclusion: conclusion as "success" | "failure" | null,
			});

			// Step 1: Get display status
			const displayStatus = getWorkflowDisplayStatus(run);

			// Step 2: Get label
			const label = getWorkflowStatusLabel(displayStatus);
			expect(label).toBe(expectedLabel);

			// Step 3: Render SVG
			const svg = renderWorkflowImage(label, displayStatus, "react");
			expect(svg).toMatch(/^data:image\/svg\+xml,/);

			// Step 4: Verify SVG content
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("react");
		});

		it("deploying state renders deploying image", () => {
			const svg = renderDeployingImage("production", "in_progress", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("production");
			expect(decoded).toContain("react");
		});

		it("workflow SVG uses correct status color", () => {
			const statuses = ["success", "failure", "in_progress", "cancelled"];
			for (const status of statuses) {
				const label = getWorkflowStatusLabel(status);
				const svg = renderWorkflowImage(label, status, "react");
				const decoded = decodeSvg(svg);
				const expectedColor = COLORS.workflow[status as keyof typeof COLORS.workflow];
				expect(decoded).toContain(expectedColor);
			}
		});
	});

	describe("PR count rendering pipeline", () => {
		it("PR count → formatted number → button SVG", () => {
			const svg = renderPRCountImage("120", "Open", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("120");
			expect(decoded).toContain("Open");
			expect(decoded).toContain("react");
		});

		it("large PR count displays correctly", () => {
			const svg = renderPRCountImage("1.2K", "All", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("1.2K");
			expect(decoded).toContain("All");
		});
	});

	describe("Issue count rendering pipeline", () => {
		it("issue count → formatted number → button SVG", () => {
			const svg = renderIssueCountImage("850", "Open", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("850");
			expect(decoded).toContain("Open");
			expect(decoded).toContain("react");
		});
	});

	describe("Release rendering pipeline", () => {
		it("release info → version tag → button SVG", () => {
			const release = makeReleaseInfo();
			const svg = renderReleaseImage(release.tag_name, release.name, "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("v18.3.1");
			expect(decoded).toContain("React 18.3.1");
			expect(decoded).toContain("react");
		});

		it("pre-release renders correctly", () => {
			const release = makeReleaseInfo({
				tag_name: "v19.0.0-rc.1",
				name: "RC1",
				prerelease: true,
			});
			const svg = renderReleaseImage(release.tag_name, release.name, "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("v19.0.0-rc.1");
		});
	});

	describe("Commit activity rendering pipeline", () => {
		it("commit count → formatted → button SVG", () => {
			const svg = renderCommitActivityImage("33", "7 Days", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("33");
			expect(decoded).toContain("7 Days");
			expect(decoded).toContain("react");
		});
	});

	describe("Branch comparison rendering pipeline", () => {
		it("ahead/behind → button SVG", () => {
			const svg = renderBranchComparisonImage("5", "3", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("5");
			expect(decoded).toContain("3");
			expect(decoded).toContain("react");
		});
	});

	describe("Discussions rendering pipeline", () => {
		it("discussion count → button SVG", () => {
			const svg = renderDiscussionsImage("250", "Total", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("250");
			expect(decoded).toContain("Total");
			expect(decoded).toContain("react");
		});
	});

	describe("Special state rendering", () => {
		it("unconfigured image renders correctly", () => {
			const svg = renderUnconfiguredImage();
			expect(svg).toMatch(/^data:image\/svg\+xml,/);
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("144");
		});

		it("error image renders correctly", () => {
			const svg = renderErrorImage("Test Error");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("Test Error");
			expect(decoded).toContain("#f85149");
		});
	});

	describe("formatCount integration", () => {
		it.each([
			[0, "0"],
			[999, "999"],
			[1000, "1k"],
			[1500, "1.5k"],
			[42000, "42k"],
			[1200000, "1.2M"],
			[5200, "5.2k"],
		])("formatCount(%d) → '%s'", (input, expected) => {
			expect(formatCount(input)).toBe(expected);
		});

		it("formatted counts render correctly in stat images", () => {
			const value = formatCount(42000);
			const svg = renderStatImage(value, "stars", "react");
			const decoded = decodeSvg(svg);
			expect(decoded).toContain("42k");
		});
	});
});
