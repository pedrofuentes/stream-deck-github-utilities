import { describe, it, expect } from "vitest";
import {
	hexAlpha,
	renderStatStrip,
	renderWorkflowStrip,
	renderStripLoading,
	renderStripError,
	renderStripUnconfigured,
	renderPRQueueStrip,
	renderHeatmapStrip,
	renderFleetStrip,
	renderNetworkGraphStrip,
	renderSecurityArcStrip,
} from "../../src/utils/touch-strip-renderer.js";
import type { NetworkGraphRenderData } from "../../src/utils/touch-strip-renderer.js";

// ── Touch strip renderer snapshots ─────────────────────────────────────────

describe("Touch strip renderer snapshots", () => {

	// ── Stat strip ─────────────────────────────────────────────────────────

	describe("renderStatStrip", () => {
		it("stars with sparkline trend", () => {
			const trend = [10, 15, 12, 20, 18, 25, 22, 30, 28, 35, 32, 40, 38, 42];
			expect(renderStatStrip("42K", "stars", trend, "owner/repo")).toMatchSnapshot();
		});

		it("forks without trend", () => {
			expect(renderStatStrip("8.2K", "forks", undefined, "torvalds/linux")).toMatchSnapshot();
		});

		it("language with badge", () => {
			expect(renderStatStrip("TypeScript", "language", undefined, "owner/repo", "TS")).toMatchSnapshot();
		});

		it("without repo name or trend", () => {
			expect(renderStatStrip("1,234", "issues")).toMatchSnapshot();
		});

		it("empty trend array", () => {
			expect(renderStatStrip("500", "watchers", [], "owner/repo")).toMatchSnapshot();
		});
	});

	// ── Workflow strip ─────────────────────────────────────────────────────

	describe("renderWorkflowStrip", () => {
		it("success with run history", () => {
			const history = ["success", "success", "failure", "success", "success"];
			expect(renderWorkflowStrip(
				"success", "Success", "CI Build", "main", "2m ago", history
			)).toMatchSnapshot();
		});

		it("failure without run history", () => {
			expect(renderWorkflowStrip(
				"failure", "Failed", "Deploy", "production", "5m ago"
			)).toMatchSnapshot();
		});

		it("in_progress", () => {
			expect(renderWorkflowStrip(
				"in_progress", "Running", "Test Suite", "develop", "just now"
			)).toMatchSnapshot();
		});

		it("cancelled", () => {
			expect(renderWorkflowStrip(
				"cancelled", "Cancelled", "Release", "main", "1h ago"
			)).toMatchSnapshot();
		});
	});

	// ── State strips ───────────────────────────────────────────────────────

	describe("renderStripLoading", () => {
		it("default message", () => {
			expect(renderStripLoading()).toMatchSnapshot();
		});

		it("custom message", () => {
			expect(renderStripLoading("Fetching data…")).toMatchSnapshot();
		});
	});

	describe("renderStripError", () => {
		it("default message", () => {
			expect(renderStripError()).toMatchSnapshot();
		});

		it("rate limited", () => {
			expect(renderStripError("Rate Limited")).toMatchSnapshot();
		});

		it("custom message", () => {
			expect(renderStripError("Token Invalid")).toMatchSnapshot();
		});
	});

	describe("renderStripUnconfigured", () => {
		it("default", () => {
			expect(renderStripUnconfigured()).toMatchSnapshot();
		});
	});

	// ── PR queue strip ─────────────────────────────────────────────────────

	describe("renderPRQueueStrip", () => {
		it("with PRs and repo name", () => {
			expect(renderPRQueueStrip(12, "owner/repo")).toMatchSnapshot();
		});

		it("zero PRs", () => {
			expect(renderPRQueueStrip(0, "owner/repo")).toMatchSnapshot();
		});

		it("without repo name", () => {
			expect(renderPRQueueStrip(5)).toMatchSnapshot();
		});

		it("large count", () => {
			expect(renderPRQueueStrip(999, "org/project")).toMatchSnapshot();
		});
	});

	// ── Heatmap strip ──────────────────────────────────────────────────────

	describe("renderHeatmapStrip", () => {
		it("basic weekly data", () => {
			const weeklyData = [
				[0, 1, 2, 3, 0, 1, 0],
				[2, 3, 4, 1, 0, 2, 1],
				[1, 0, 0, 5, 3, 2, 0],
				[0, 2, 1, 0, 4, 3, 2],
			];
			expect(renderHeatmapStrip(weeklyData)).toMatchSnapshot();
		});

		it("with offset", () => {
			const weeklyData = [
				[1, 2, 3, 4, 5, 6, 7],
				[0, 0, 0, 0, 0, 0, 0],
			];
			expect(renderHeatmapStrip(weeklyData, 2)).toMatchSnapshot();
		});

		it("with summary", () => {
			const weeklyData = [
				[3, 5, 2, 7, 1, 4, 6],
				[2, 0, 8, 1, 3, 5, 4],
			];
			expect(renderHeatmapStrip(weeklyData, 0, 128, true)).toMatchSnapshot();
		});

		it("empty data", () => {
			expect(renderHeatmapStrip([])).toMatchSnapshot();
		});
	});

	// ── Fleet strip ────────────────────────────────────────────────────────

	describe("renderFleetStrip", () => {
		it("healthy repo overview", () => {
			const trend = [10, 12, 8, 15, 20, 18, 25, 22, 30, 28];
			expect(renderFleetStrip(
				"owner/repo", "Success", "#3fb950", 5, trend
			)).toMatchSnapshot();
		});

		it("failing repo with no PRs", () => {
			const trend = [5, 3, 2, 1, 0, 0, 0, 0, 0, 0];
			expect(renderFleetStrip(
				"org/project", "Failed", "#f85149", 0, trend
			)).toMatchSnapshot();
		});
	});

	// ── Network graph strip ───────────────────────────────────────────────

	describe("renderNetworkGraphStrip", () => {
		const linearData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
				[{ char: "│", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
				[{ char: "│", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
			],
			gridCols: 2,
			branches: [
				{ name: "main", column: 0, color: "#58a6ff", firstRow: 0 },
			],
		};

		const branchingData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#f85149" }],
				[{ char: "○", color: "#58a6ff" }, { char: "<", color: "#f85149" }, { char: "╮", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "│", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: "●", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "├", color: "#58a6ff" }, { char: "─", color: "#f85149" }, { char: "╯", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#f85149" }],
			],
			gridCols: 4,
			branches: [
				{ name: "main", column: 0, color: "#58a6ff", firstRow: 0 },
				{ name: "develop", column: 2, color: "#f85149", firstRow: 2 },
			],
		};

		it("linear history", () => {
			expect(renderNetworkGraphStrip(linearData)).toMatchSnapshot();
		});

		it("branching history", () => {
			expect(renderNetworkGraphStrip(branchingData)).toMatchSnapshot();
		});

		it("with horizontal scroll offset", () => {
			expect(renderNetworkGraphStrip(linearData, "horizontal", 50)).toMatchSnapshot();
		});

		it("with both scroll offsets", () => {
			expect(renderNetworkGraphStrip(branchingData, "horizontal", 20, 10)).toMatchSnapshot();
		});

		it("empty commits", () => {
			expect(renderNetworkGraphStrip({ grid: [], gridCols: 0, branches: [] })).toMatchSnapshot();
		});

		// Reverse mode uses the same normal grid — reverseCommitOrder is always false.
		// The renderer handles direction via CCW coordinate mapping.

		it("horizontal-reverse branching history", () => {
			expect(renderNetworkGraphStrip(branchingData, "horizontal-reverse")).toMatchSnapshot();
		});

		it("horizontal-reverse with scroll offset", () => {
			expect(renderNetworkGraphStrip(branchingData, "horizontal-reverse", 20, 5)).toMatchSnapshot();
		});

		it("horizontal-reverse linear history", () => {
			expect(renderNetworkGraphStrip(linearData, "horizontal-reverse")).toMatchSnapshot();
		});

		// Grid with T_DOWN (┬) and CROSS (┼) characters for coverage
		const complexData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#f85149" }],
				[{ char: "┼", color: "#58a6ff" }, { char: "─", color: "#f85149" }, { char: "┬", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "│", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: "●", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#f85149" }],
			],
			gridCols: 4,
			branches: [
				{ name: "main", column: 0, color: "#58a6ff", firstRow: 0 },
				{ name: "feature", column: 2, color: "#f85149", firstRow: 2 },
			],
		};

		it("complex graph with ┬ and ┼ characters", () => {
			expect(renderNetworkGraphStrip(complexData)).toMatchSnapshot();
		});

		it("horizontal-reverse complex graph with ┬ and ┼", () => {
			expect(renderNetworkGraphStrip(complexData, "horizontal-reverse")).toMatchSnapshot();
		});
	});

	// ── Security arc strip ─────────────────────────────────────────────────

	describe("renderSecurityArcStrip", () => {
		it("excellent security", () => {
			expect(renderSecurityArcStrip("A+", 98, {
				critical: 0, high: 0, medium: 1, low: 3,
			})).toMatchSnapshot();
		});

		it("poor security", () => {
			expect(renderSecurityArcStrip("D", 35, {
				critical: 5, high: 12, medium: 8, low: 20,
			})).toMatchSnapshot();
		});

		it("perfect score", () => {
			expect(renderSecurityArcStrip("A+", 100, {
				critical: 0, high: 0, medium: 0, low: 0,
			})).toMatchSnapshot();
		});

		it("zero score", () => {
			expect(renderSecurityArcStrip("F", 0, {
				critical: 50, high: 100, medium: 200, low: 300,
			})).toMatchSnapshot();
		});
	});

	// ── Utility functions ──────────────────────────────────────────────────

	describe("hexAlpha", () => {
		it("full opacity", () => {
			expect(hexAlpha(1)).toMatchSnapshot();
		});

		it("half opacity", () => {
			expect(hexAlpha(0.5)).toMatchSnapshot();
		});

		it("zero opacity", () => {
			expect(hexAlpha(0)).toMatchSnapshot();
		});

		it("quarter opacity", () => {
			expect(hexAlpha(0.25)).toMatchSnapshot();
		});
	});
});
