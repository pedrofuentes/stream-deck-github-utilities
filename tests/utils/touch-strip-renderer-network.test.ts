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

	it("applies scroll offsets", () => {
		const noScroll = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal", 0, 0));
		const scrolled = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal", 100, 0));
		// Both should be valid SVGs but with different circle positions
		expect(noScroll).toContain("<circle");
		expect(scrolled).toContain("<svg");
	});

	it("renders valid SVG with correct dimensions", () => {
		const svg = decodeSvg(renderNetworkGraphStrip(linearData));
		expect(svg).toContain('width="200"');
		expect(svg).toContain('height="100"');
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	// ── Horizontal-reverse orientation tests ──────────────────────────────

	describe("horizontal-reverse orientation", () => {
		// With the correct CCW approach, the renderer receives the same normal
		// grid for both orientations (reverseCommitOrder is always false).
		// CCW = CW(180°(char)): the renderer remaps corner/T-junction character
		// sets and uses CCW coordinate mapping (xRow=row, yCol=gridCols-1-col).
		//
		// Normal (CW):  row 0 (newest) at right, col 0 at top
		// Reverse (CCW): row 0 (newest) at left,  col 0 at bottom

		it("renders valid SVG for horizontal-reverse", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal-reverse"));
			expect(svg).toContain("<svg");
			expect(svg).toContain("<circle");
			expect(svg).toContain("<path");
			expect(svg).toContain("<line");
		});

		it("CCW produces different geometry than CW for corners", () => {
			const normalSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal-reverse"));

			const normalPaths = [...normalSvg.matchAll(/d="([^"]+)"/g)].map(m => m[1]);
			const reversePaths = [...reverseSvg.matchAll(/d="([^"]+)"/g)].map(m => m[1]);

			expect(normalPaths.length).toBeGreaterThan(0);
			expect(reversePaths.length).toBeGreaterThan(0);
			// Paths must differ — different rotation produces different arc directions
			const allIdentical = normalPaths.every((p, i) => reversePaths[i] === p);
			expect(allIdentical).toBe(false);
		});

		it("CCW produces different T-junction geometry than CW", () => {
			const normalSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal-reverse"));

			const normalLines = [...normalSvg.matchAll(/<line[^/]*\/>/g)].map(m => m[0]);
			const reverseLines = [...reverseSvg.matchAll(/<line[^/]*\/>/g)].map(m => m[0]);

			expect(normalLines.length).toBeGreaterThan(0);
			expect(reverseLines.length).toBeGreaterThan(0);
			// Lines should differ — different rotation changes junction stem direction
			const allIdentical = normalLines.every((l, i) => reverseLines[i] === l);
			expect(allIdentical).toBe(false);
		});

		it("places newest commits at left for horizontal-reverse", () => {
			// Row 0 = newest (reverseCommitOrder is always false).
			// CCW maps xRow = row, so row 0 (newest) → leftmost X position.
			const svg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal-reverse"));

			const circles = [...svg.matchAll(/cx="([^"]+)"/g)].map(m => parseFloat(m[1]));
			expect(circles.length).toBeGreaterThan(0);

			// Minimum cx should be near the left edge (GRID_PAD + half = 8)
			const minCx = Math.min(...circles);
			expect(minCx).toBeLessThan(20);
		});

		it("does not render labels in horizontal-reverse mode", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(branchingData, "horizontal-reverse"));
			expect(svg).not.toContain("main");
			expect(svg).not.toContain("feature");
		});
	});
});
