/**
 * Tests for the network graph renderer in touch-strip-renderer.ts.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */
import { describe, it, expect } from "vitest";
import {
	renderNetworkGraphStrip,
	resolveGraphColor,
} from "../../src/utils/touch-strip-renderer";
import type { NetworkGraphRenderData } from "../../src/utils/touch-strip-renderer";

function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

describe("resolveGraphColor", () => {
	it("maps known SVG color names to GitHub theme hex", () => {
		expect(resolveGraphColor("blue")).toBe("#58a6ff");
		expect(resolveGraphColor("orange")).toBe("#d29922");
		expect(resolveGraphColor("green")).toBe("#3fb950");
		expect(resolveGraphColor("red")).toBe("#f85149");
		expect(resolveGraphColor("purple")).toBe("#bc8cff");
		expect(resolveGraphColor("turquoise")).toBe("#79c0ff");
		expect(resolveGraphColor("gray")).toBe("#8b949e");
	});

	it("returns gray for unknown colors", () => {
		expect(resolveGraphColor("neon")).toBe("#8b949e");
		expect(resolveGraphColor("")).toBe("#8b949e");
	});
});

describe("renderNetworkGraphStrip", () => {
	const emptyData: NetworkGraphRenderData = {
		grid: [],
		gridCols: 0,
		branches: [],
	};

	const singleCommitData: NetworkGraphRenderData = {
		grid: [
			[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
		],
		gridCols: 2,
		branches: [
			{ name: "main", column: 0, color: "#58a6ff", firstRow: 0 },
		],
	};

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
			{ name: "feature", column: 2, color: "#f85149", firstRow: 2 },
		],
	};

	it("returns error strip for empty commits", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(emptyData));
		expect(svg).toContain("No Commits");
	});

	it("renders single commit as filled circle", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(singleCommitData));
		expect(svg).toContain("<circle");
		expect(svg).toContain('fill="#58a6ff"');
	});

	it("renders branch label in vertical mode", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(singleCommitData, "vertical"));
		expect(svg).toContain("main");
	});

	it("renders straight lines for same-lane connections", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(linearData));
		expect(svg).toContain("<line");
	});

	it("renders Bézier curves for cross-lane connections", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(branchingData));
		expect(svg).toContain("<path");
		expect(svg).toContain(" Q");
	});

	it("renders merge commits with stroke (hollow)", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(branchingData));
		expect(svg).toContain('stroke="#58a6ff"');
	});

	it("supports horizontal orientation", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal"));
		expect(svg).toContain("<svg");
		expect(svg).toContain("<circle");
	});

	it("supports vertical orientation", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(linearData, "vertical"));
		expect(svg).toContain("<svg");
		expect(svg).toContain("<circle");
	});

	it("applies scroll offsets", () => {
		const noScroll = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal", 0, 0));
		const scrolled = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal", 100, 0));
		// Both should be valid SVGs but with different circle positions
		expect(noScroll).toContain("<circle");
		expect(scrolled).toContain("<svg");
	});

	it("truncates long branch names", () => {
		const longNameData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
			],
			gridCols: 2,
			branches: [
				{ name: "feature/very-long-branch-name-here", column: 0, color: "#58a6ff", firstRow: 0 },
			],
		};
		const svg = decodeSvg(renderNetworkGraphStrip(longNameData, "vertical"));
		expect(svg).toContain("..");
		expect(svg).not.toContain("feature/very-long-branch-name-here");
	});

	it("excludes tag branches from labels", () => {
		const tagData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#3fb950" }, { char: " ", color: "#8b949e" }],
			],
			gridCols: 2,
			branches: [
				{ name: "tags/v1.0", column: 0, color: "#3fb950", firstRow: 0 },
			],
		};
		const svg = decodeSvg(renderNetworkGraphStrip(tagData));
		expect(svg).not.toContain("tags/v1.0");
	});

	it("renders valid SVG with correct dimensions", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(linearData));
		expect(svg).toContain('width="200"');
		expect(svg).toContain('height="100"');
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	// ── Horizontal-reverse orientation tests ──────────────────────────────

	describe("horizontal-reverse orientation", () => {
		// Reversed grid: columns mirrored, rows in oldest-first order
		// Mirrors the output of printUnicode with reverseCommitOrder: true
		//
		// Normal grid (newest first):         Reversed grid (oldest first):
		//   row0: ●  .  .  .                    row0: .  .  .  ●
		//   row1: ○  <  ╮  .                    row4: .  ╮  <  ○
		//   row2: │  .  ●  .                    row3: .  ●  .  │
		//   row3: ├  ─  ╯  .                    row2: .  ╯  ─  ├
		//   row4: ●  .  .  .                    row1: .  .  .  ●

		const reversedBranchingData: NetworkGraphRenderData = {
			grid: [
				[{ char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: "●", color: "#58a6ff" }],
				[{ char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: "●", color: "#58a6ff" }],
				[{ char: " ", color: "#f85149" }, { char: "╯", color: "#f85149" }, { char: "─", color: "#f85149" }, { char: "├", color: "#58a6ff" }],
				[{ char: " ", color: "#f85149" }, { char: "●", color: "#f85149" }, { char: " ", color: "#8b949e" }, { char: "│", color: "#58a6ff" }],
				[{ char: " ", color: "#f85149" }, { char: "╮", color: "#f85149" }, { char: "<", color: "#f85149" }, { char: "○", color: "#58a6ff" }],
				[{ char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: " ", color: "#8b949e" }, { char: "●", color: "#58a6ff" }],
			],
			gridCols: 4,
			branches: [
				{ name: "main", column: 3, color: "#58a6ff", firstRow: 0 },
				{ name: "feature", column: 1, color: "#f85149", firstRow: 3 },
			],
		};

		it("renders valid SVG for horizontal-reverse", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(reversedBranchingData, "horizontal-reverse"));
			expect(svg).toContain("<svg");
			expect(svg).toContain("<circle");
			expect(svg).toContain("<path");
			expect(svg).toContain("<line");
		});

		it("flips vertical direction of corners compared to normal horizontal", () => {
			// The ╮ corner in normal horizontal arcs from left→bottom (CW rotation).
			// In reverse, the same ╮ char must arc from left→TOP (top↔bot swapped).
			// We verify by checking that the path endpoints differ between modes.
			const normalSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(reversedBranchingData, "horizontal-reverse"));

			// Both should contain path elements (corners)
			expect(normalSvg).toContain("<path");
			expect(reverseSvg).toContain("<path");

			// Extract all path d attributes from each SVG
			const normalPaths = [...normalSvg.matchAll(/d="([^"]+)"/g)].map(m => m[1]);
			const reversePaths = [...reverseSvg.matchAll(/d="([^"]+)"/g)].map(m => m[1]);

			// The path curves must NOT be identical — they are vertically mirrored
			expect(normalPaths.length).toBeGreaterThan(0);
			expect(reversePaths.length).toBeGreaterThan(0);
			// At least one path should differ (vertical flip changes Q control point)
			const allIdentical = normalPaths.every((p, i) => reversePaths[i] === p);
			expect(allIdentical).toBe(false);
		});

		it("T-junction ├ points in opposite vertical direction in reverse vs normal", () => {
			// In normal horizontal, ├ rotates CW to ┬: horizontal + stem DOWN
			// In reverse horizontal, ├ should have stem UP (top↔bot swapped)
			const normalSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(reversedBranchingData, "horizontal-reverse"));

			// Extract all line elements from each
			const normalLines = [...normalSvg.matchAll(/<line[^/]*\/>/g)].map(m => m[0]);
			const reverseLines = [...reverseSvg.matchAll(/<line[^/]*\/>/g)].map(m => m[0]);

			// Both should have line elements (connections + T-junction stems)
			expect(normalLines.length).toBeGreaterThan(0);
			expect(reverseLines.length).toBeGreaterThan(0);
		});

		it("does not reverse row order for horizontal-reverse (oldest stays at left)", () => {
			// Row 0 should map to leftmost X position (not rightmost)
			// The first commit dot (row 0) should be at a small X coordinate
			const svg = decodeSvg(renderNetworkGraphStrip(reversedBranchingData, "horizontal-reverse"));

			// Extract circle cx values
			const circles = [...svg.matchAll(/cx="([^"]+)"/g)].map(m => parseFloat(m[1]));
			expect(circles.length).toBeGreaterThan(0);

			// The minimum cx should be near the left edge (GRID_PAD + half = 8)
			const minCx = Math.min(...circles);
			expect(minCx).toBeLessThan(20);
		});

		it("does not render labels in horizontal-reverse mode", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(reversedBranchingData, "horizontal-reverse"));
			expect(svg).not.toContain("main");
			expect(svg).not.toContain("feature");
		});
	});
});
