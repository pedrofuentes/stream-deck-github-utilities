/**
 * Tests for touch-strip-renderer.ts
 *
 * Validates SVG output for Stream Deck+ touch strip rendering.
 */

import { describe, it, expect } from "vitest";
import {
	renderStatStrip,
	renderWorkflowStrip,
	renderPRQueueStrip,
	renderBranchNetworkStrip,
	renderStripLoading,
	renderStripError,
	renderStripUnconfigured,
} from "../../src/utils/touch-strip-renderer";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract the raw SVG string (no data URI prefix needed — touch strip uses raw SVG). */
function assertValidSvg(svg: string): void {
	expect(svg).toContain("<svg");
	expect(svg).toContain("</svg>");
	expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	expect(svg).toContain('width="200"');
	expect(svg).toContain('height="100"');
}

// ── renderStatStrip ────────────────────────────────────────────────────────

describe("renderStatStrip", () => {
	it("should return a valid 200×100 SVG", () => {
		const svg = renderStatStrip("12.4k", "stars");
		assertValidSvg(svg);
	});

	it("should include the stat value in the SVG", () => {
		const svg = renderStatStrip("1,847", "forks");
		expect(svg).toContain("1,847");
	});

	it("should include the stat label", () => {
		const svg = renderStatStrip("23", "pull_requests");
		expect(svg).toContain("PRS");
	});

	it("should use the correct accent color for stars", () => {
		const svg = renderStatStrip("100", "stars");
		expect(svg).toContain("#e3b341");
	});

	it("should use the correct accent color for forks", () => {
		const svg = renderStatStrip("50", "forks");
		expect(svg).toContain("#58a6ff");
	});

	it("should use the correct accent color for issues", () => {
		const svg = renderStatStrip("10", "issues");
		expect(svg).toContain("#3fb950");
	});

	it("should render a sparkline when trend data is provided", () => {
		const svg = renderStatStrip("100", "stars", [10, 20, 30, 40, 50]);
		expect(svg).toContain("<path");
		expect(svg).toContain("circle");
	});

	it("should not render a sparkline when no trend data is provided", () => {
		const svg = renderStatStrip("100", "stars");
		expect(svg).not.toContain("sparkline");
		// Should have no path elements (no sparkline curve)
		expect(svg).not.toContain("<path d=\"M");
	});

	it("should not render a sparkline with fewer than 2 data points", () => {
		const svg = renderStatStrip("100", "stars", [42]);
		expect(svg).not.toContain("<path d=\"M");
	});

	it("should include the repo name when provided", () => {
		const svg = renderStatStrip("100", "stars", undefined, "owner/repo");
		expect(svg).toContain("owner/repo");
	});

	it("should not include repo name when not provided", () => {
		const svg = renderStatStrip("100", "stars");
		expect(svg).not.toContain("owner/repo");
	});

	it("should escape XML special characters in value", () => {
		const svg = renderStatStrip("<script>", "language");
		expect(svg).not.toContain("<script>");
		expect(svg).toContain("&lt;script&gt;");
	});

	it("should use smaller font for long values", () => {
		const svg = renderStatStrip("1234567890", "stars");
		expect(svg).toContain('font-size="20"');
	});

	it("should use larger font for short values", () => {
		const svg = renderStatStrip("42", "stars");
		expect(svg).toContain('font-size="36"');
	});

	it("should include the accent bar on the left edge", () => {
		const svg = renderStatStrip("10", "stars");
		// 3px wide accent bar at x=0
		expect(svg).toContain('width="3"');
	});

	it("should include the ambient glow rectangle", () => {
		const svg = renderStatStrip("10", "stars");
		expect(svg).toContain('fill-opacity="0.07"');
	});

	it("should handle all stat types without errors", () => {
		const statTypes = [
			"stars", "issues", "forks", "watchers", "pull_requests",
			"language", "size", "license", "default_branch", "visibility",
		] as const;
		for (const st of statTypes) {
			const svg = renderStatStrip("42", st);
			assertValidSvg(svg);
		}
	});
});

// ── renderWorkflowStrip ────────────────────────────────────────────────────

describe("renderWorkflowStrip", () => {
	it("should return a valid 200×100 SVG", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		assertValidSvg(svg);
	});

	it("should include the status text", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		expect(svg).toContain("Success");
	});

	it("should include workflow name", () => {
		const svg = renderWorkflowStrip("Failed", "failure", "ci.yml", "develop", "5m ago");
		expect(svg).toContain("ci.yml");
	});

	it("should include branch name", () => {
		const svg = renderWorkflowStrip("Running…", "in_progress", "build.yml", "feature/auth", "1m");
		expect(svg).toContain("feature/auth");
	});

	it("should include relative time", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		expect(svg).toContain("2m ago");
	});

	it("should use success color for successful workflows", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		expect(svg).toContain("#3fb950");
	});

	it("should use failure color for failed workflows", () => {
		const svg = renderWorkflowStrip("Failed", "failure", "ci.yml", "main", "5m ago");
		expect(svg).toContain("#f85149");
	});

	it("should use in_progress color for running workflows", () => {
		const svg = renderWorkflowStrip("Running…", "in_progress", "build.yml", "main", "1m");
		expect(svg).toContain("#d29922");
	});

	it("should include radial gradient for atmospheric glow", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		expect(svg).toContain("radialGradient");
	});

	it("should render run history dots when provided", () => {
		const history = ["success", "success", "failure", "success"];
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago", history);
		// Should have circles for dots
		const circleCount = (svg.match(/<circle/g) || []).length;
		expect(circleCount).toBeGreaterThanOrEqual(4);
	});

	it("should render the first dot with full opacity", () => {
		const history = ["success", "failure"];
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago", history);
		expect(svg).toContain('fill-opacity="1"');
	});

	it("should render subsequent dots with reduced opacity", () => {
		const history = ["success", "failure"];
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago", history);
		expect(svg).toContain('fill-opacity="0.35"');
	});

	it("should render active dot ring on first dot", () => {
		const history = ["success"];
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago", history);
		// Active dot has an additional circle with stroke
		expect(svg).toContain('stroke-opacity="0.3"');
	});

	it("should not render dots when no history provided", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago");
		expect(svg).not.toContain("<circle");
	});

	it("should limit dots to 12 maximum", () => {
		const history = Array(20).fill("success");
		const svg = renderWorkflowStrip("Success", "success", "deploy.yml", "main", "2m ago", history);
		// 12 fill dots + 1 ring for active = 13 circles max
		const circleCount = (svg.match(/<circle/g) || []).length;
		expect(circleCount).toBeLessThanOrEqual(13);
	});

	it("should escape XML special characters", () => {
		const svg = renderWorkflowStrip("Success", "success", "deploy & build.yml", "feat/<auth>", "2m ago");
		expect(svg).toContain("deploy &amp; build.yml");
		expect(svg).toContain("feat/&lt;auth&gt;");
	});

	it("should fall back to muted color for unknown status", () => {
		const svg = renderWorkflowStrip("Unknown", "nonexistent_status", "test.yml", "main", "1m");
		expect(svg).toContain("#8b949e");
	});
});

// ── renderStripLoading ─────────────────────────────────────────────────────

describe("renderStripLoading", () => {
	it("should return a valid SVG", () => {
		const svg = renderStripLoading();
		assertValidSvg(svg);
	});

	it("should show default loading message", () => {
		const svg = renderStripLoading();
		expect(svg).toContain("Loading…");
	});

	it("should show custom message", () => {
		const svg = renderStripLoading("Fetching data…");
		expect(svg).toContain("Fetching data…");
	});

	it("should contain skeleton placeholder rectangles", () => {
		const svg = renderStripLoading();
		const rectCount = (svg.match(/<rect/g) || []).length;
		// Background + at least 3 skeleton lines
		expect(rectCount).toBeGreaterThanOrEqual(4);
	});
});

// ── renderStripError ───────────────────────────────────────────────────────

describe("renderStripError", () => {
	it("should return a valid SVG", () => {
		const svg = renderStripError();
		assertValidSvg(svg);
	});

	it("should show default error message", () => {
		const svg = renderStripError();
		expect(svg).toContain("Error");
	});

	it("should show custom error message", () => {
		const svg = renderStripError("Rate limited");
		expect(svg).toContain("Rate limited");
	});

	it("should use error color", () => {
		const svg = renderStripError();
		expect(svg).toContain("#f85149");
	});

	it("should include retry hint", () => {
		const svg = renderStripError();
		expect(svg).toContain("Tap to retry");
	});

	it("should include error accent bar", () => {
		const svg = renderStripError();
		// Red left bar
		expect(svg).toContain('width="3"');
	});
});

// ── renderStripUnconfigured ────────────────────────────────────────────────

describe("renderStripUnconfigured", () => {
	it("should return a valid SVG", () => {
		const svg = renderStripUnconfigured();
		assertValidSvg(svg);
	});

	it("should show setup message", () => {
		const svg = renderStripUnconfigured();
		expect(svg).toContain("Setup Required");
	});

	it("should include configuration hint", () => {
		const svg = renderStripUnconfigured();
		expect(svg).toContain("Property Inspector");
	});
});

// ── renderPRQueueStrip ─────────────────────────────────────────────────────

describe("renderPRQueueStrip", () => {
	it("should return a valid 200×100 SVG", () => {
		const svg = renderPRQueueStrip(3);
		assertValidSvg(svg);
	});

	it("should show zero state with checkmark", () => {
		const svg = renderPRQueueStrip(0);
		assertValidSvg(svg);
		expect(svg).toContain("✓");
		expect(svg).toContain("No reviews pending");
		// Green color for zero
		expect(svg).toContain("#3fb950");
	});

	it("should use blue for low count (1–2)", () => {
		const svg = renderPRQueueStrip(1);
		expect(svg).toContain("#58a6ff");
		expect(svg).toContain("1");
		expect(svg).toContain("review");
	});

	it("should use singular 'review' for count of 1", () => {
		const svg = renderPRQueueStrip(1);
		// Should say "review" not "reviews"
		expect(svg).toMatch(/\breview\b/);
	});

	it("should use plural 'reviews' for count > 1", () => {
		const svg = renderPRQueueStrip(3);
		expect(svg).toContain("reviews");
	});

	it("should use amber for medium count (3–4)", () => {
		const svg = renderPRQueueStrip(3);
		expect(svg).toContain("#d29922");
	});

	it("should use red for high count (5+)", () => {
		const svg = renderPRQueueStrip(5);
		expect(svg).toContain("#f85149");
	});

	it("should include repo name when provided", () => {
		const svg = renderPRQueueStrip(2, "my-repo");
		expect(svg).toContain("my-repo");
	});

	it("should not include repo label when not provided", () => {
		const svg = renderPRQueueStrip(2);
		expect(svg).not.toContain("text-anchor=\"end\"");
	});

	it("should use smaller font for double-digit counts", () => {
		const svg = renderPRQueueStrip(15);
		// fontSize should be 42 for >=10
		expect(svg).toContain('font-size="42"');
	});

	it("should include urgency bar", () => {
		const svg = renderPRQueueStrip(4);
		// Should have an urgency bar rect at y=86
		expect(svg).toContain('y="86"');
	});

	it("should escape special characters in repo name", () => {
		const svg = renderPRQueueStrip(1, "test<>&repo");
		expect(svg).not.toContain("<&");
		expect(svg).toContain("&lt;");
		expect(svg).toContain("&amp;");
	});
});
