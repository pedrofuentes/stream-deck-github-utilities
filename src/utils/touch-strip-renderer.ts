/**
 * SVG-based touch strip renderer for Stream Deck+ encoder actions.
 *
 * Generates 200×100 SVG images for the Stream Deck+ touch strip using a
 * single `pixmap` layout item covering the full canvas. Design language:
 *
 * - True black (#000) background (OLED-optimized)
 * - Hero numbers at 36–48px for maximum glanceability
 * - Tufte sparklines: smooth Bézier curves with area fill and endpoint dot
 * - Ambient accent color from left edge identifies data type
 * - Run history dots: Tufte small-multiples (each dot = one data point)
 * - Atmospheric status glow: flat color fill at low opacity tints the strip
 *
 * Encoding: the SVG string is passed directly to `setFeedback({ canvas: svg })`
 * via a `pixmap` layout item in `github-full-canvas.json`.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { COLORS, escapeXml, getWorkflowStatusColor } from "./button-renderer";

// ── SVG Encoding ───────────────────────────────────────────────────────────

/**
 * Encodes an SVG string as a data URI for use with `setFeedback()` pixmap items.
 * Uses the same `data:image/svg+xml,` + encodeURIComponent pattern that works
 * for `setImage()` on keys — confirmed working on Stream Deck hardware.
 */
function encodeSvgDataUri(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Touch strip canvas dimensions */
const WIDTH = 200;
const HEIGHT = 100;

/** Font stack matching button renderer */
const FONT = "Arial,Helvetica,sans-serif";

/** Touch strip specific palette (true black background for OLED) */
const STRIP_BG = "#000000";
const STRIP_TEXT = "#e6edf3";
const STRIP_MUTED = "#8b949e";
const STRIP_DIM = "#484f58";
const STRIP_SURFACE = "#0d1117";

// ── Stat label map ─────────────────────────────────────────────────────────

const STAT_LABELS: Record<string, string> = {
	stars: "★ STARS",
	issues: "◉ ISSUES",
	forks: "⑂ FORKS",
	watchers: "◉ WATCHERS",
	pull_requests: "⊘ PRS",
	language: "⟨⟩ LANG",
	size: "◫ SIZE",
	license: "⊜ LICENSE",
	default_branch: "⑂ BRANCH",
	visibility: "◉ VISIBILITY",
	releases: "⏷ RELEASES",
	commits: "⊙ COMMITS",
	branches: "⑂ BRANCHES",
};

// ── SVG Helpers ────────────────────────────────────────────────────────────

/** Get accent color for a stat type, with fallback. */
function getStatAccent(statType: string): string {
	return COLORS.accent[statType] ?? STRIP_MUTED;
}

/**
 * Convert a hex opacity (0–1) to a 2-char hex string.
 * Used for appending alpha to hex colors: `color + hexAlpha(0.5)` → `#3fb95080`
 */
export function hexAlpha(opacity: number): string {
	return Math.round(Math.max(0, Math.min(1, opacity)) * 255)
		.toString(16)
		.padStart(2, "0");
}

/**
 * Generate a smooth SVG path (Bézier curve) from data points.
 * Returns just the `d` attribute value for a `<path>`.
 */
function sparklinePath(
	data: number[],
	x: number,
	y: number,
	w: number,
	h: number,
): string {
	if (data.length < 2) return "";
	const max = Math.max(...data, 1);
	const min = Math.min(...data, 0);
	const range = max - min || 1;
	const step = w / (data.length - 1);

	const points = data.map((v, i) => ({
		x: x + i * step,
		y: y + h - ((v - min) / range) * h,
	}));

	// Start with move, then smooth quadratic curves
	const dParts: string[] = [`M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`];
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		const cpx = (prev.x + curr.x) / 2;
		const cpy = (prev.y + curr.y) / 2;
		dParts.push(` Q${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${cpy.toFixed(1)}`);
	}
	// Final line to last point
	const last = points[points.length - 1];
	dParts.push(` L${last.x.toFixed(1)},${last.y.toFixed(1)}`);

	return dParts.join("");
}

/**
 * Generate a closed area path for sparkline fill (curve + baseline).
 */
function sparklineAreaPath(
	data: number[],
	x: number,
	y: number,
	w: number,
	h: number,
): string {
	if (data.length < 2) return "";
	const linePath = sparklinePath(data, x, y, w, h);
	const endX = x + w;
	const baseY = y + h;
	return `${linePath} L${endX.toFixed(1)},${baseY.toFixed(1)} L${x.toFixed(1)},${baseY.toFixed(1)} Z`;
}

/**
 * Get the endpoint position of a sparkline (last data point coordinates).
 */
function sparklineEndpoint(
	data: number[],
	x: number,
	y: number,
	w: number,
	h: number,
): { x: number; y: number } {
	if (data.length === 0) return { x, y: y + h };
	const max = Math.max(...data, 1);
	const min = Math.min(...data, 0);
	const range = max - min || 1;
	const lastVal = data[data.length - 1];
	return {
		x: x + w,
		y: y + h - ((lastVal - min) / range) * h,
	};
}

// ── Render Functions ───────────────────────────────────────────────────────

/**
 * Render a repo stat on the touch strip.
 *
 * Layout: accent bar (left edge) + hero number + sparkline trend.
 * The accent color identifies the stat type at a glance.
 *
 * @param value - Formatted stat value (e.g., "12.4k", "1,847")
 * @param statType - The stat type (for color and label)
 * @param trend - Array of recent values for sparkline (optional)
 * @param repoName - Repository name for ghost label (optional)
 * @returns SVG string for touch strip pixmap
 */
export function renderStatStrip(
	value: string,
	statType: string,
	trend?: number[],
	repoName?: string,
	badge?: string,
): string {
	const accent = getStatAccent(statType);
	const label = STAT_LABELS[statType] ?? statType.toUpperCase();
	const safeValue = escapeXml(value);
	const safeLabel = escapeXml(label);
	const safeRepo = repoName ? escapeXml(repoName) : "";
	const safeBadge = badge ? escapeXml(badge) : "";

	// Dynamic font sizing for value
	let valueFontSize = 36;
	if (value.length > 9) valueFontSize = 20;
	else if (value.length > 6) valueFontSize = 24;
	else if (value.length > 4) valueFontSize = 30;

	// Sparkline SVG elements
	let sparkSvg = "";
	if (trend && trend.length >= 2) {
		const sx = 12, sy = 68, sw = 176, sh = 24;
		const areaPath = sparklineAreaPath(trend, sx, sy, sw, sh);
		const linePath = sparklinePath(trend, sx, sy, sw, sh);
		const endpoint = sparklineEndpoint(trend, sx, sy, sw, sh);

		sparkSvg = `
		<path d="${areaPath}" fill="${accent}" fill-opacity="0.08"/>
		<path d="${linePath}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
		<circle cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="2.5" fill="${accent}"/>
		<circle cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="5" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="1"/>`;
	}

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${HEIGHT}" fill="${accent}"/>
	<rect x="0" y="0" width="70" height="${HEIGHT}" fill="${accent}" fill-opacity="0.07"/>
	<text x="12" y="14" fill="${accent}" fill-opacity="0.75" font-size="12" font-weight="500" font-family="${FONT}">${safeLabel}</text>
	${safeBadge ? `<text x="190" y="12" text-anchor="end" fill="${STRIP_DIM}" font-size="11" font-weight="600" font-family="${FONT}">${safeBadge}</text>` : ""}
	<text x="12" y="${valueFontSize <= 24 ? 44 : 54}" fill="${STRIP_TEXT}" font-size="${valueFontSize}" font-weight="800" font-family="${FONT}">${safeValue}</text>
	${sparkSvg}
	${safeRepo ? `<text x="188" y="96" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.3" font-size="9" font-family="${FONT}">${safeRepo}</text>` : ""}
</svg>`);
}

/**
 * Render a workflow status on the touch strip.
 *
 * Layout: atmospheric radial glow + status word + workflow/branch info + run history dots.
 * The entire strip "breathes" the status color.
 *
 * @param status - Status label (e.g., "Success", "Failed", "Running…")
 * @param displayStatus - Raw status key for color lookup
 * @param workflowName - Workflow filename (e.g., "deploy.yml")
 * @param branch - Branch name
 * @param time - Relative time string (e.g., "2m ago")
 * @param runHistory - Array of status strings for recent runs (newest first)
 * @returns SVG string for touch strip pixmap
 */
export function renderWorkflowStrip(
	status: string,
	displayStatus: string,
	workflowName: string,
	branch: string,
	time: string,
	runHistory?: string[],
): string {
	const color = getWorkflowStatusColor(displayStatus);
	const safeStatus = escapeXml(status);
	const safeWf = escapeXml(workflowName);
	const safeBranch = escapeXml(branch);
	const safeTime = escapeXml(time);

	// Dynamic font sizing for status
	let statusFontSize = 20;
	if (status.length <= 7) statusFontSize = 20;
	else if (status.length <= 10) statusFontSize = 17;
	else statusFontSize = 14;

	// Run history dots
	const dotsParts: string[] = [];
	if (runHistory && runHistory.length > 0) {
		const maxDots = Math.min(runHistory.length, 12);
		const dotR = 2.5;
		const dotGap = 7;
		let dx = 12;
		const dy = 88;

		for (let i = 0; i < maxDots; i++) {
			const dotColor = getWorkflowStatusColor(runHistory[i]);
			const opacity = i === 0 ? 1 : 0.35;
			dotsParts.push(`<circle cx="${dx + dotR}" cy="${dy}" r="${dotR}" fill="${dotColor}" fill-opacity="${opacity}"/>`);
			if (i === 0) {
				dotsParts.push(`<circle cx="${dx + dotR}" cy="${dy}" r="${dotR + 2.5}" fill="none" stroke="${dotColor}" stroke-opacity="0.3" stroke-width="1"/>`);
			}
			dx += dotR * 2 + dotGap;
		}
	}

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${color}" fill-opacity="0.06"/>
	<rect x="0" y="0" width="${WIDTH}" height="1" fill="${color}" fill-opacity="0.35"/>
	<text x="12" y="20" fill="${color}" font-size="${statusFontSize}" font-weight="800" font-family="${FONT}">${safeStatus}</text>
	<text x="12" y="36" fill="#aaaaaa" font-size="12" font-weight="500" font-family="${FONT}">${safeWf}</text>
	<text x="12" y="50" fill="${STRIP_DIM}" font-size="10" font-family="${FONT}">${safeBranch}</text>
	<text x="188" y="14" text-anchor="end" fill="${STRIP_DIM}" font-size="10" font-family="${FONT}">${safeTime}</text>
	${dotsParts.join("")}
</svg>`);
}

/**
 * Render a loading/unconfigured state on the touch strip.
 *
 * @param message - Optional message (default: "Loading…")
 * @returns SVG string for touch strip pixmap
 */
export function renderStripLoading(message = "Loading…"): string {
	const safeMsg = escapeXml(message);
	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="12" y="20" width="90" height="12" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="40" width="60" height="8" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="56" width="140" height="6" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="70" width="100" height="6" rx="3" fill="${STRIP_SURFACE}"/>
	<text x="188" y="38" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.5" font-size="9" font-family="${FONT}">${safeMsg}</text>
</svg>`);
}

/**
 * Render an error state on the touch strip.
 *
 * @param message - Error message
 * @returns SVG string for touch strip pixmap
 */
export function renderStripError(message = "Error"): string {
	const safeMsg = escapeXml(message);
	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${HEIGHT}" fill="${COLORS.error}"/>
	<text x="12" y="40" fill="${COLORS.error}" font-size="14" font-weight="700" font-family="${FONT}">${safeMsg}</text>
	<text x="12" y="58" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">Tap to retry</text>
</svg>`);
}

/**
 * Render an unconfigured state on the touch strip.
 *
 * @returns SVG string for touch strip pixmap
 */
export function renderStripUnconfigured(): string {
	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<text x="100" y="38" text-anchor="middle" fill="${STRIP_DIM}" font-size="14" font-weight="600" font-family="${FONT}">Setup Required</text>
	<text x="100" y="58" text-anchor="middle" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">Open Property Inspector</text>
</svg>`);
}

/**
 * Render PR review queue count on the touch strip.
 * Color shifts from green (0) → blue (1–2) → amber (3–4) → red (5+) for urgency.
 *
 * @param count - Number of PRs awaiting review
 * @param repoName - Optional repository name for ghost label
 * @returns SVG string for touch strip pixmap
 */
export function renderPRQueueStrip(count: number, repoName?: string): string {
	let color: string;
	if (count === 0) color = "#3fb950";        // green = all clear
	else if (count <= 2) color = "#58a6ff";     // blue = low
	else if (count <= 4) color = "#d29922";     // amber = medium
	else color = "#f85149";                     // red = high urgency

	const safeRepo = repoName ? escapeXml(repoName) : "";

	if (count === 0) {
		return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<text x="100" y="36" text-anchor="middle" fill="${color}" fill-opacity="0.4" font-size="36" font-weight="300" font-family="${FONT}">✓</text>
	<text x="100" y="62" text-anchor="middle" fill="${STRIP_MUTED}" font-size="14" font-weight="500" font-family="${FONT}">No reviews pending</text>
	<text x="100" y="80" text-anchor="middle" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">All clear</text>
</svg>`);
	}

	const fontSize = count >= 10 ? 42 : 54;
	const label = count === 1 ? "review" : "reviews";

	// Urgency bar at bottom — fills proportionally (capped at 8)
	const barFillPct = Math.min(1, count / 8);
	const barW = Math.max(8, 176 * barFillPct);

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${color}" fill-opacity="0.06"/>
	<text x="100" y="${fontSize <= 42 ? 50 : 55}" text-anchor="middle" fill="${color}" font-size="${fontSize}" font-weight="900" font-family="${FONT}">${count}</text>
	<text x="100" y="70" text-anchor="middle" fill="${STRIP_MUTED}" font-size="12" font-weight="400" font-family="${FONT}">${label}</text>
	<rect x="12" y="86" width="176" height="4" rx="2" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="86" width="${barW.toFixed(0)}" height="4" rx="2" fill="${color}"/>
	${safeRepo ? `<text x="188" y="96" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.3" font-size="9" font-family="${FONT}">${safeRepo}</text>` : ""}
</svg>`);
}

/**
 * Render a contribution heatmap on the touch strip.
 * Shows weekly commit data as a grid with color intensity = commits per day.
 * Supports contiguous rendering with offset for multi-quarter layouts.
 *
 * @param weeklyData - Array of weekly data, each with daily counts (7 per week)
 * @param offset - Pixel offset for multi-quarter contiguous rendering (default: 0)
 * @param totalCommits - Total commit count for the summary display
 * @returns SVG string for touch strip pixmap
 */
export function renderHeatmapStrip(
	weeklyData: number[][],
	offset = 0,
	totalCommits = 0,
	showSummary = false,
): string {
	const cellSize = 10;
	const gap = 2;
	const gridTop = 6;
	const colW = cellSize + gap;
	const days = ["M", "T", "W", "T", "F", "S", "S"];
	const accent = "#3fb950";

	// Summary panel width (commit count + labels + day labels)
	const summaryW = 80;

	// Find max for intensity scaling
	const allValues = weeklyData.flat();
	const max = Math.max(...allValues, 1);

	// Grid layout:
	// - Cells positioned at globalX = summaryW + w * colW (week 0 right after summary)
	// - localX = globalX - offset (transform to this quarter's viewport)
	// - Most recent week is at the highest x, naturally on the right
	// - For standalone (offset=0), ~10 most recent weeks fit after the summary

	const cellParts: string[] = [];

	// Heatmap cells
	weeklyData.forEach((week, w) => {
		const localX = summaryW + w * colW - offset;

		// Skip cells outside this quarter's 200px viewport
		if (localX + cellSize < 0 || localX > WIDTH) return;
		// On first quarter, skip cells under the summary panel
		if (showSummary && localX < summaryW) return;

		week.forEach((v, d) => {
			const y = gridTop + d * colW;
			const fill = v === 0 ? "#0a0f14" : accent;
			const opacity = v === 0 ? "1" : (0.15 + (v / max) * 0.85).toFixed(2);
			cellParts.push(`<rect x="${localX.toFixed(1)}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${fill}" fill-opacity="${opacity}"/>`);
		});
	});

	// Summary panel (fixed overlay on first quarter)
	const summaryParts: string[] = [];
	if (showSummary) {
		summaryParts.push(`<rect x="0" y="0" width="${summaryW}" height="${HEIGHT}" fill="${STRIP_BG}"/>`);
		summaryParts.push(`<text x="6" y="20" fill="${STRIP_TEXT}" font-size="26" font-weight="800" font-family="${FONT}">${totalCommits}</text>`);
		summaryParts.push(`<text x="6" y="36" fill="${accent}" fill-opacity="0.7" font-size="12" font-weight="400" font-family="${FONT}">commits</text>`);
		summaryParts.push(`<text x="6" y="52" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">${weeklyData.length}w</text>`);

		days.forEach((d, i) => {
			if (i % 2 === 0) {
				summaryParts.push(`<text x="${summaryW - 10}" y="${gridTop + i * colW + cellSize - 1}" fill="${STRIP_DIM}" font-size="10" font-family="${FONT}">${d}</text>`);
			}
		});
	}

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	${cellParts.join("")}
	${summaryParts.join("")}
</svg>`);
}

/**
 * Render a compact fleet monitor quarter on the touch strip.
 * Shows: repo name + workflow status badge + PR count + activity sparkline.
 * Designed to be placed 4-across for fleet monitoring.
 *
 * @param repoName - Short repository name (e.g., "my-repo")
 * @param workflowStatus - Human-readable status label (e.g., "Success", "Failed")
 * @param workflowColor - Hex color for the workflow status
 * @param prCount - Number of open pull requests
 * @param trend - Array of recent weekly commit totals for sparkline
 * @returns SVG string for touch strip pixmap
 */
export function renderFleetStrip(
	repoName: string,
	workflowStatus: string,
	workflowColor: string,
	prCount: number,
	trend: number[],
): string {
	const safeName = escapeXml(repoName.length > 18 ? repoName.slice(0, 16) + ".." : repoName);
	const safeStatus = escapeXml(workflowStatus);

	// Top status bar (full width, colored by workflow status)
	const topBar = `<rect x="0" y="0" width="200" height="2" fill="${workflowColor}" fill-opacity="0.5"/>
	<rect x="0" y="0" width="200" height="2" fill="${workflowColor}"/>`;

	// Repo name
	const nameEl = `<text x="10" y="18" fill="#ddd" font-size="13" font-weight="700" font-family="${FONT}">${safeName}</text>`;

	// Status badge
	const badgeW = safeStatus.length * 5 + 12;
	const badge = `<rect x="10" y="24" width="${badgeW}" height="12" rx="3" fill="${workflowColor}" fill-opacity="0.2"/>
	<text x="${10 + badgeW / 2}" y="33" text-anchor="middle" fill="${workflowColor}" font-size="9" font-weight="600" font-family="${FONT}">${safeStatus}</text>`;

	// PR count
	const prLabel = `<text x="${14 + badgeW}" y="33" fill="#666" font-size="9" font-family="${FONT}">${prCount} PRs</text>`;

	// Sparkline (bottom half)
	let sparkEl = "";
	if (trend.length >= 2) {
		const max = Math.max(...trend, 1);
		const min = Math.min(...trend, 0);
		const range = max - min || 1;
		const sx = 10, sy = 44, sw = 180, sh = 44;
		const step = sw / (trend.length - 1);
		const pts = trend.map((v, i) => ({
			x: sx + i * step,
			y: sy + sh - ((v - min) / range) * sh,
		}));

		// Area fill
		const areaParts: string[] = [`M${pts[0].x.toFixed(1)},${(sy + sh).toFixed(1)}`];
		pts.forEach((p) => { areaParts.push(` L${p.x.toFixed(1)},${p.y.toFixed(1)}`); });
		areaParts.push(` L${pts[pts.length - 1].x.toFixed(1)},${(sy + sh).toFixed(1)} Z`);
		const areaD = areaParts.join("");

		// Line
		const lineParts: string[] = [`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`];
		for (let i = 1; i < pts.length; i++) {
			lineParts.push(` L${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`);
		}
		const lineD = lineParts.join("");

		const last = pts[pts.length - 1];
		sparkEl = `
		<path d="${areaD}" fill="${workflowColor}" fill-opacity="0.08"/>
		<path d="${lineD}" fill="none" stroke="${workflowColor}" stroke-width="1.5" stroke-linejoin="round"/>
		<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2.5" fill="${workflowColor}"/>`;
	}

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	${topBar}
	${nameEl}
	${badge}
	${prLabel}
	${sparkEl}
</svg>`);
}

/**
 * Render a git branch network (metro-map style) on the touch strip.
 *
 * Shows branches as colored horizontal lines with commit dots, fork/merge
 * points, and branch labels. Supports contiguous rendering with an offset
 * for multi-quarter layouts.
 *
 * @param branches - Array of branch names to visualize
 * @param offset - Horizontal pixel offset for contiguous multi-quarter rendering (default: 0)
 * @param verticalOffset - Vertical pixel offset for branch panning (default: 0)
 * @returns SVG string for touch strip pixmap
 */
export function renderBranchNetworkStrip(
	branches: string[],
	offset = 0,
	verticalOffset = 0,
): string {
	const virtualHeight = 200;
	const mainY = virtualHeight / 2 - verticalOffset;
	const laneH = 28;
	const branchColors = ["#8b949e", "#58a6ff", "#3fb950", "#bc8cff", "#f85149", "#d29922", "#e3b341"];

	// Generate deterministic branch layout from names
	const mainBranch = branches.find((b) => b === "main" || b === "master") ?? branches[0] ?? "main";
	const featureBranches = branches.filter((b) => b !== mainBranch).slice(0, 4);

	const svgParts: string[] = [];

	// Main branch line
	const mainColor = branchColors[0];
	svgParts.push(`<line x1="${0 - offset}" y1="${mainY}" x2="${400 - offset}" y2="${mainY}" stroke="${mainColor}" stroke-width="2.5" stroke-linecap="round"/>`);

	// Main branch commits (evenly spaced)
	const mainCommitCount = 8;
	for (let i = 0; i < mainCommitCount; i++) {
		const cx = 25 + i * 45 - offset;
		if (cx >= -10 && cx <= 210) {
			svgParts.push(`<circle cx="${cx}" cy="${mainY}" r="3.5" fill="${mainColor}"/>`);
		}
	}

	// Feature branches
	featureBranches.forEach((name, idx) => {
		const color = branchColors[(idx + 1) % branchColors.length];
		const isAbove = idx % 2 === 0;
		const yOffset = isAbove ? -laneH * (Math.floor(idx / 2) + 1) : laneH * (Math.floor(idx / 2) + 1);
		const branchY = mainY + yOffset;

		// Branch start and end positions (deterministic from name hash)
		const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
		const startX = 40 + (hash % 80) - offset;
		const endX = startX + 80 + (hash % 60);
		const merged = idx < 2;

		if (endX >= -20 && startX <= 220) {
			// Fork point
			svgParts.push(`<line x1="${startX}" y1="${mainY}" x2="${startX + 15}" y2="${branchY}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);

			// Branch line
			svgParts.push(`<line x1="${startX + 15}" y1="${branchY}" x2="${endX - (merged ? 15 : 0)}" y2="${branchY}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);

			// Commits on branch
			const commitSpacing = 25;
			for (let cx = startX + 25; cx < endX - 10; cx += commitSpacing) {
				if (cx >= -10 && cx <= 210) {
					svgParts.push(`<circle cx="${cx}" cy="${branchY}" r="3" fill="${color}"/>`);
				}
			}

			// Merge point (if merged)
			if (merged && endX >= -10 && endX <= 220) {
				svgParts.push(`<line x1="${endX - 15}" y1="${branchY}" x2="${endX}" y2="${mainY}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
				svgParts.push(`<circle cx="${endX}" cy="${mainY}" r="3.5" fill="${color}"/>`);
				svgParts.push(`<circle cx="${endX}" cy="${mainY}" r="5.5" fill="none" stroke="#fff" stroke-width="1" stroke-opacity="0.5"/>`);
			}

			// Branch label
			const labelX = startX + 18;
			const labelY = isAbove ? branchY - 6 : branchY + 12;
			if (labelX >= -30 && labelX <= 200) {
				const safeName = escapeXml(name.length > 14 ? name.slice(0, 12) + ".." : name);
				svgParts.push(`<rect x="${labelX - 2}" y="${labelY - 7}" width="${safeName.length * 5 + 6}" height="11" rx="2" fill="#000" fill-opacity="0.8"/>`);
				svgParts.push(`<text x="${labelX}" y="${labelY}" fill="${color}" fill-opacity="0.7" font-size="9" font-weight="500" font-family="${FONT}">${safeName}</text>`);
			}
		}
	});

	// Main branch label
	const mainLabelX = 5 - offset;
	if (mainLabelX >= -30 && mainLabelX <= 180) {
		const safeMain = escapeXml(mainBranch);
		svgParts.push(`<rect x="${mainLabelX - 2}" y="${mainY - 18}" width="${safeMain.length * 5 + 8}" height="12" rx="2" fill="${mainColor}"/>`);
		svgParts.push(`<text x="${mainLabelX + 2}" y="${mainY - 9}" fill="#000" font-size="9" font-weight="700" font-family="${FONT}">${safeMain}</text>`);
	}

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	${svgParts.join("")}
</svg>`);
}

/**
 * Render a security health arc gauge on the touch strip.
 * Semicircular arc fills from green→amber→red based on score.
 * Severity dots on the right show alert breakdown.
 *
 * @param grade - Letter grade (A–F)
 * @param score - Numeric score 0–100
 * @param alerts - Alert counts by severity
 * @returns SVG string for touch strip pixmap
 */
export function renderSecurityArcStrip(
	grade: string,
	score: number,
	alerts: { critical: number; high: number; medium: number; low: number },
): string {
	const safeGrade = escapeXml(grade);
	let gradeColor: string;
	if (score > 80) gradeColor = "#3fb950";
	else if (score > 50) gradeColor = "#d29922";
	else gradeColor = "#f85149";

	// Arc geometry (semicircle)
	const cx = 55, cy = 55, r = 40;
	const startAngle = Math.PI;
	const fillAngle = startAngle + Math.PI * (score / 100);

	// SVG arc path helper
	function arcPath(angle: number): string {
		const ex = cx + r * Math.cos(angle);
		const ey = cy + r * Math.sin(angle);
		return `${ex.toFixed(1)} ${ey.toFixed(1)}`;
	}

	// Background arc (full semicircle)
	const bgStart = arcPath(startAngle);
	const bgEnd = arcPath(2 * Math.PI);
	const bgArc = `M ${bgStart} A ${r} ${r} 0 1 1 ${bgEnd}`;

	// Fill arc (proportional to score)
	const fillStart = arcPath(startAngle);
	const fillEnd = arcPath(Math.min(fillAngle, 2 * Math.PI - 0.01));
	const largeArc = (fillAngle - startAngle) > Math.PI ? 1 : 0;
	const fillArcPath = score > 0 ? `M ${fillStart} A ${r} ${r} 0 ${largeArc} 1 ${fillEnd}` : "";

	// Severity dots legend
	const sevs = [
		{ label: "crit", count: alerts.critical, color: "#f85149" },
		{ label: "high", count: alerts.high, color: "#d29922" },
		{ label: "med", count: alerts.medium, color: "#58a6ff" },
		{ label: "low", count: alerts.low, color: "#555963" },
	];
	const dotsParts: string[] = [];
	sevs.forEach((s, i) => {
		const y = 12 + i * 20;
		const dotCol = s.count > 0 ? s.color : "#111";
		const textCol = s.count > 0 ? s.color : "#282828";
		dotsParts.push(`<circle cx="124" cy="${y + 5}" r="3" fill="${dotCol}"/>`);
		dotsParts.push(`<text x="134" y="${y + 8}" fill="${textCol}" font-size="12" font-weight="700" font-family="${FONT}">${s.count}</text>`);
		dotsParts.push(`<text x="155" y="${y + 8}" fill="#333" font-size="10" font-family="${FONT}">${s.label}</text>`);
	});

	return encodeSvgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${gradeColor}" fill-opacity="0.04"/>
	<path d="${bgArc}" fill="none" stroke="#111" stroke-width="8" stroke-linecap="round"/>
	${score > 0 ? `<path d="${fillArcPath}" fill="none" stroke="${gradeColor}" stroke-width="8" stroke-linecap="round"/>` : ""}
	${score > 0 ? `<path d="${fillArcPath}" fill="none" stroke="${gradeColor}" stroke-opacity="0.15" stroke-width="16" stroke-linecap="round"/>` : ""}
	<text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${gradeColor}" font-size="28" font-weight="800" font-family="${FONT}">${safeGrade}</text>
	<text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="#444" font-size="10" font-family="${FONT}">Security</text>
	${dotsParts.join("")}
</svg>`);
}
