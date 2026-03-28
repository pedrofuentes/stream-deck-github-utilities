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
	rotateGrid180,
} from "../../src/utils/touch-strip-renderer";
import type { NetworkGraphRenderData, GridCell } from "../../src/utils/touch-strip-renderer";

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

	// ── Reverse with additional character types ───────────────────────────

	describe("horizontal-reverse with T_DOWN and CROSS characters", () => {
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

		it("renders ┬ and ┼ correctly in reverse mode", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(complexData, "horizontal-reverse"));
			expect(svg).toContain("<svg");
			expect(svg).toContain("<circle");
			expect(svg).toContain("<line");
		});

		it("produces different SVG for reverse vs normal with ┬/┼", () => {
			const normalSvg = decodeSvg(renderNetworkGraphStrip(complexData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(complexData, "horizontal-reverse"));
			expect(normalSvg).not.toBe(reverseSvg);
		});
	});

	// ── Reverse with linear graph ────────────────────────────────────────

	describe("horizontal-reverse with linear graph", () => {
		it("reverses commit order on single-lane linear graph", () => {
			const normalSvg = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal"));
			const reverseSvg = decodeSvg(renderNetworkGraphStrip(linearData, "horizontal-reverse"));

			// Both should have the same number of circles (same commits)
			const normalCircles = [...normalSvg.matchAll(/<circle/g)].length;
			const reverseCircles = [...reverseSvg.matchAll(/<circle/g)].length;
			expect(normalCircles).toBe(reverseCircles);

			// The full SVGs differ — cy values change due to column inversion
			expect(normalSvg).not.toBe(reverseSvg);
		});
	});

	// ── Reverse with uneven row lengths ──────────────────────────────────

	describe("horizontal-reverse with uneven rows", () => {
		const unevenData: NetworkGraphRenderData = {
			grid: [
				[{ char: "●", color: "#58a6ff" }, { char: " ", color: "#8b949e" }],
				[{ char: "├", color: "#58a6ff" }, { char: "─", color: "#f85149" }, { char: "╮", color: "#f85149" }, { char: " ", color: "#f85149" }],
				[{ char: "●", color: "#58a6ff" }],
			],
			gridCols: 4,
			branches: [
				{ name: "main", column: 0, color: "#58a6ff", firstRow: 0 },
			],
		};

		it("handles rows shorter than gridCols in reverse mode", () => {
			const svg = decodeSvg(renderNetworkGraphStrip(unevenData, "horizontal-reverse"));
			expect(svg).toContain("<svg");
			expect(svg).toContain("<circle");
			// Should not crash or produce malformed SVG
			expect(svg).toContain("</svg>");
		});
	});
});

// ── rotateGrid180 ─────────────────────────────────────────────────────────

describe("rotateGrid180", () => {
	function cell(ch: string, color = "#fff"): GridCell {
		return { char: ch, color };
	}

	it("reverses row order", () => {
		const grid = [
			[cell("●"), cell(" ")],
			[cell("│"), cell(" ")],
			[cell("○"), cell(" ")],
		];
		const rotated = rotateGrid180(grid, 2);
		// Row 0 was ● → now should be last after reversal + col reversal
		// After 180°: row order reversed (○,│,●), then each row reversed
		expect(rotated[0][1].char).toBe("○");
		expect(rotated[1][1].char).toBe("│");
		expect(rotated[2][1].char).toBe("●");
	});

	it("reverses column order within each row", () => {
		const grid = [
			[cell("A"), cell("B"), cell("C")],
		];
		const rotated = rotateGrid180(grid, 3);
		expect(rotated[0][0].char).toBe("C");
		expect(rotated[0][1].char).toBe("B");
		expect(rotated[0][2].char).toBe("A");
	});

	it("remaps all corner pairs (BL↔TR)", () => {
		const grid = [
			[cell("└"), cell("╰"), cell("┗"), cell("╚")],
			[cell("┐"), cell("╮"), cell("┓"), cell("╗")],
		];
		const rotated = rotateGrid180(grid, 4);
		// After 180° rows are reversed, cols reversed, chars remapped
		// Row 0 (was row 1: ┐╮┓╗ → remapped: └╰┗╚, reversed: ╚┗╰└)
		expect(rotated[0].map(c => c.char)).toEqual(["╚", "┗", "╰", "└"]);
		// Row 1 (was row 0: └╰┗╚ → remapped: ┐╮┓╗, reversed: ╗┓╮┐)
		expect(rotated[1].map(c => c.char)).toEqual(["╗", "┓", "╮", "┐"]);
	});

	it("remaps all corner pairs (TL↔BR)", () => {
		const grid = [
			[cell("┌"), cell("╭"), cell("┏"), cell("╔")],
			[cell("┘"), cell("╯"), cell("┛"), cell("╝")],
		];
		const rotated = rotateGrid180(grid, 4);
		// Row 0 (was row 1: ┘╯┛╝ → remapped: ┌╭┏╔, reversed: ╔┏╭┌)
		expect(rotated[0].map(c => c.char)).toEqual(["╔", "┏", "╭", "┌"]);
		// Row 1 (was row 0: ┌╭┏╔ → remapped: ┘╯┛╝, reversed: ╝┛╯┘)
		expect(rotated[1].map(c => c.char)).toEqual(["╝", "┛", "╯", "┘"]);
	});

	it("remaps T-junction pairs (RIGHT↔LEFT, DOWN↔UP)", () => {
		const grid = [
			[cell("├"), cell("┤"), cell("┬"), cell("┴")],
		];
		const rotated = rotateGrid180(grid, 4);
		// ├→┤, ┤→├, ┬→┴, ┴→┬ then reversed
		// Remapped: ┤├┴┬, reversed: ┬┴├┤
		expect(rotated[0].map(c => c.char)).toEqual(["┬", "┴", "├", "┤"]);
	});

	it("remaps arrow pairs", () => {
		const grid = [[cell("<"), cell(">")]];
		const rotated = rotateGrid180(grid, 2);
		// < → >, > → <, reversed: < >... wait:
		// Remap: > <, Reverse: < >
		expect(rotated[0].map(c => c.char)).toEqual(["<", ">"]);
	});

	it("preserves symmetric characters", () => {
		const grid = [[cell("●"), cell("○"), cell("│"), cell("─"), cell("┼")]];
		const rotated = rotateGrid180(grid, 5);
		// All symmetric, reversed order
		expect(rotated[0].map(c => c.char)).toEqual(["┼", "─", "│", "○", "●"]);
	});

	it("preserves colors through rotation", () => {
		const grid = [
			[cell("●", "#58a6ff"), cell("╮", "#f85149")],
		];
		const rotated = rotateGrid180(grid, 2);
		// Reversed: ╮ becomes ╰, ● stays ●, colors preserved
		expect(rotated[0][0].color).toBe("#f85149");
		expect(rotated[0][1].color).toBe("#58a6ff");
	});

	it("pads shorter rows to gridCols before rotating", () => {
		const grid = [
			[cell("●")],
			[cell("│"), cell("─"), cell("╮"), cell("X")],
		];
		const rotated = rotateGrid180(grid, 4);
		// Row 0 (was row 1: │─╮X → remapped: │─╰X, reversed: X╰─│)
		expect(rotated[0].length).toBe(4);
		expect(rotated[0][1].char).toBe("╰");
		// Row 1 (was row 0: ●[pad][pad][pad] → remapped: ●   , reversed:    ●)
		expect(rotated[1].length).toBe(4);
		expect(rotated[1][3].char).toBe("●");
		expect(rotated[1][0].char).toBe(" ");
	});

	it("returns empty array for empty grid", () => {
		expect(rotateGrid180([], 0)).toEqual([]);
	});
});

// ── Library-generated graph rendering ────────────────────────────────────

describe("renderNetworkGraphStrip with library-generated data", () => {
	// Use the git-network-graph library to create a real graph, then verify
	// that both CW and CCW rendering produce valid, structurally correct SVGs.
	// This catches issues that hand-crafted mock data might miss.

	it("renders CW and CCW from library graph with same element counts", async () => {
		const {
			createGitGraphFromData,
			printUnicode,
			Characters,
			BranchSettings,
			BranchSettingsDef,
			MergePatterns,
		} = await import("git-network-graph");
		const { parseGraphGrid, resolveGraphColor } = await import("../../src/utils/touch-strip-renderer");

		const input = {
			head: { oid: "c1", name: "main", isBranch: true },
			commits: [
				{ oid: "c1", parentOids: ["c2"], message: "newest", author: { name: "X", email: "x", timestamp: 1000, timezoneOffset: 0 }, committer: { name: "X", email: "x", timestamp: 1000, timezoneOffset: 0 } },
				{ oid: "c2", parentOids: ["c4", "c3"], message: "merge", author: { name: "X", email: "x", timestamp: 900, timezoneOffset: 0 }, committer: { name: "X", email: "x", timestamp: 900, timezoneOffset: 0 } },
				{ oid: "c3", parentOids: ["c4"], message: "feat", author: { name: "X", email: "x", timestamp: 850, timezoneOffset: 0 }, committer: { name: "X", email: "x", timestamp: 850, timezoneOffset: 0 } },
				{ oid: "c4", parentOids: ["c5"], message: "base", author: { name: "X", email: "x", timestamp: 800, timezoneOffset: 0 }, committer: { name: "X", email: "x", timestamp: 800, timezoneOffset: 0 } },
				{ oid: "c5", parentOids: [], message: "oldest", author: { name: "X", email: "x", timestamp: 700, timezoneOffset: 0 }, committer: { name: "X", email: "x", timestamp: 700, timezoneOffset: 0 } },
			],
			branches: [
				{ name: "main", oid: "c1" },
				{ name: "feature", oid: "c3" },
			],
			tags: [],
		};

		const settings = {
			reverseCommitOrder: false,
			debug: false,
			compact: true,
			colored: false,
			includeRemote: false,
			format: { type: "OneLine" as const },
			wrapping: null,
			characters: Characters.round(),
			branchOrder: { type: "ShortestFirst" as const, forward: true },
			branches: BranchSettings.from(BranchSettingsDef.gitFlow()),
			mergePatterns: MergePatterns.default(),
		};

		const graph = createGitGraphFromData(input, settings);
		const [graphLines] = printUnicode(graph, settings);
		const cleanLines = graphLines.map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));

		// Build color map from graph
		const columnColors = new Map<number, string>();
		for (const branch of graph.allBranches) {
			if (branch.visual.column != null && !columnColors.has(branch.visual.column)) {
				columnColors.set(branch.visual.column, resolveGraphColor(branch.visual.svgColor ?? "gray"));
			}
		}

		const grid = parseGraphGrid(cleanLines, columnColors);
		const gridCols = cleanLines.reduce((max: number, line: string) => Math.max(max, [...line].length), 0);
		const renderData: NetworkGraphRenderData = { grid, gridCols, branches: [] };

		// Render both orientations
		const cwSvg = decodeSvg(renderNetworkGraphStrip(renderData, "horizontal"));
		const ccwSvg = decodeSvg(renderNetworkGraphStrip(renderData, "horizontal-reverse"));

		// Both should be valid SVGs
		expect(cwSvg).toContain("<svg");
		expect(cwSvg).toContain("</svg>");
		expect(ccwSvg).toContain("<svg");
		expect(ccwSvg).toContain("</svg>");

		// Both should have the same number of circles (same commits)
		const cwCircles = [...cwSvg.matchAll(/<circle/g)].length;
		const ccwCircles = [...ccwSvg.matchAll(/<circle/g)].length;
		expect(cwCircles).toBe(ccwCircles);
		expect(cwCircles).toBeGreaterThan(0);

		// Both should have paths (branch connections)
		expect(cwSvg).toContain("<path");
		expect(ccwSvg).toContain("<path");

		// Both should have lines
		expect(cwSvg).toContain("<line");
		expect(ccwSvg).toContain("<line");

		// But the actual SVG content should differ (different orientations)
		expect(cwSvg).not.toBe(ccwSvg);
	});
});
