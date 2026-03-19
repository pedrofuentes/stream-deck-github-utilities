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
 * - Atmospheric status glow: radial gradient fills strip with status color
 *
 * Encoding: the SVG string is passed directly to `setFeedback({ canvas: svg })`
 * via a `pixmap` layout item in `github-full-canvas.json`.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { COLORS, escapeXml, getWorkflowStatusColor } from "./button-renderer";

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
	let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
	for (let i = 1; i < points.length; i++) {
		const prev = points[i - 1];
		const curr = points[i];
		const cpx = (prev.x + curr.x) / 2;
		const cpy = (prev.y + curr.y) / 2;
		d += ` Q${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${cpx.toFixed(1)},${cpy.toFixed(1)}`;
	}
	// Final line to last point
	const last = points[points.length - 1];
	d += ` L${last.x.toFixed(1)},${last.y.toFixed(1)}`;

	return d;
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
): string {
	const accent = getStatAccent(statType);
	const label = STAT_LABELS[statType] ?? statType.toUpperCase();
	const safeValue = escapeXml(value);
	const safeLabel = escapeXml(label);
	const safeRepo = repoName ? escapeXml(repoName) : "";

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
		<defs>
			<linearGradient id="sf" x1="0" y1="${sy}" x2="0" y2="${sy + sh}" gradientUnits="userSpaceOnUse">
				<stop offset="0" stop-color="${accent}" stop-opacity="0.15"/>
				<stop offset="1" stop-color="${accent}" stop-opacity="0.02"/>
			</linearGradient>
		</defs>
		<path d="${areaPath}" fill="url(#sf)"/>
		<path d="${linePath}" fill="none" stroke="${accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
		<circle cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="2.5" fill="${accent}"/>
		<circle cx="${endpoint.x.toFixed(1)}" cy="${endpoint.y.toFixed(1)}" r="5" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="1"/>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${HEIGHT}" fill="${accent}"/>
	<rect x="0" y="0" width="70" height="${HEIGHT}" fill="${accent}" fill-opacity="0.07"/>
	<text x="12" y="16" fill="${accent}" fill-opacity="0.75" font-size="10" font-weight="500" font-family="${FONT}">${safeLabel}</text>
	<text x="12" y="${valueFontSize <= 24 ? 40 : 48}" fill="${STRIP_TEXT}" font-size="${valueFontSize}" font-weight="800" font-family="${FONT}">${safeValue}</text>
	${sparkSvg}
	${safeRepo ? `<text x="188" y="96" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.3" font-size="7" font-family="${FONT}">${safeRepo}</text>` : ""}
</svg>`;
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
	let dotsSvg = "";
	if (runHistory && runHistory.length > 0) {
		const maxDots = Math.min(runHistory.length, 12);
		const dotR = 2.5;
		const dotGap = 7;
		let dx = 12;
		const dy = 88;

		for (let i = 0; i < maxDots; i++) {
			const dotColor = getWorkflowStatusColor(runHistory[i]);
			const opacity = i === 0 ? 1 : 0.35;
			dotsSvg += `<circle cx="${dx + dotR}" cy="${dy}" r="${dotR}" fill="${dotColor}" fill-opacity="${opacity}"/>`;
			if (i === 0) {
				dotsSvg += `<circle cx="${dx + dotR}" cy="${dy}" r="${dotR + 2.5}" fill="none" stroke="${dotColor}" stroke-opacity="0.3" stroke-width="1"/>`;
			}
			dx += dotR * 2 + dotGap;
		}
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<defs>
		<radialGradient id="wg" cx="70" cy="40" r="110" gradientUnits="userSpaceOnUse">
			<stop offset="0" stop-color="${color}" stop-opacity="0.12"/>
			<stop offset="1" stop-color="${color}" stop-opacity="0"/>
		</radialGradient>
	</defs>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wg)"/>
	<rect x="0" y="0" width="${WIDTH}" height="1" fill="${color}" fill-opacity="0.35"/>
	<text x="12" y="20" fill="${color}" font-size="${statusFontSize}" font-weight="800" font-family="${FONT}">${safeStatus}</text>
	<text x="12" y="36" fill="#aaaaaa" font-size="10" font-weight="500" font-family="${FONT}">${safeWf}</text>
	<text x="12" y="50" fill="${STRIP_DIM}" font-size="8" font-family="${FONT}">${safeBranch}</text>
	<text x="188" y="14" text-anchor="end" fill="${STRIP_DIM}" font-size="8" font-family="${FONT}">${safeTime}</text>
	${dotsSvg}
</svg>`;
}

/**
 * Render a loading/unconfigured state on the touch strip.
 *
 * @param message - Optional message (default: "Loading…")
 * @returns SVG string for touch strip pixmap
 */
export function renderStripLoading(message = "Loading…"): string {
	const safeMsg = escapeXml(message);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="12" y="20" width="90" height="12" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="40" width="60" height="8" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="56" width="140" height="6" rx="3" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="70" width="100" height="6" rx="3" fill="${STRIP_SURFACE}"/>
	<text x="188" y="38" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.5" font-size="7" font-family="${FONT}">${safeMsg}</text>
</svg>`;
}

/**
 * Render an error state on the touch strip.
 *
 * @param message - Error message
 * @returns SVG string for touch strip pixmap
 */
export function renderStripError(message = "Error"): string {
	const safeMsg = escapeXml(message);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${HEIGHT}" fill="${COLORS.error}"/>
	<text x="12" y="40" fill="${COLORS.error}" font-size="12" font-weight="700" font-family="${FONT}">${safeMsg}</text>
	<text x="12" y="58" fill="${STRIP_DIM}" font-size="8" font-family="${FONT}">Tap to retry</text>
</svg>`;
}

/**
 * Render an unconfigured state on the touch strip.
 *
 * @returns SVG string for touch strip pixmap
 */
export function renderStripUnconfigured(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<text x="100" y="40" text-anchor="middle" fill="${STRIP_DIM}" font-size="11" font-weight="600" font-family="${FONT}">Setup Required</text>
	<text x="100" y="58" text-anchor="middle" fill="${STRIP_DIM}" fill-opacity="0.5" font-size="8" font-family="${FONT}">Configure in Property Inspector</text>
</svg>`;
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
		return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<text x="100" y="38" text-anchor="middle" fill="${color}" fill-opacity="0.4" font-size="36" font-weight="300" font-family="${FONT}">✓</text>
	<text x="100" y="64" text-anchor="middle" fill="${STRIP_DIM}" font-size="10" font-weight="500" font-family="${FONT}">No reviews pending</text>
	<text x="100" y="80" text-anchor="middle" fill="${STRIP_DIM}" fill-opacity="0.5" font-size="7" font-family="${FONT}">All clear</text>
</svg>`;
	}

	const fontSize = count >= 10 ? 42 : 54;
	const label = count === 1 ? "review" : "reviews";

	// Urgency bar at bottom — fills proportionally (capped at 8)
	const barFillPct = Math.min(1, count / 8);
	const barW = Math.max(8, 176 * barFillPct);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<defs>
		<radialGradient id="prg" cx="100" cy="40" r="110" gradientUnits="userSpaceOnUse">
			<stop offset="0" stop-color="${color}" stop-opacity="0.1"/>
			<stop offset="1" stop-color="${color}" stop-opacity="0"/>
		</radialGradient>
	</defs>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#prg)"/>
	<text x="100" y="${fontSize <= 42 ? 50 : 55}" text-anchor="middle" fill="${color}" font-size="${fontSize}" font-weight="900" font-family="${FONT}">${count}</text>
	<text x="100" y="70" text-anchor="middle" fill="${STRIP_MUTED}" font-size="10" font-weight="400" font-family="${FONT}">${label}</text>
	<rect x="12" y="86" width="176" height="4" rx="2" fill="${STRIP_SURFACE}"/>
	<rect x="12" y="86" width="${barW.toFixed(0)}" height="4" rx="2" fill="${color}"/>
	${safeRepo ? `<text x="188" y="96" text-anchor="end" fill="${STRIP_DIM}" fill-opacity="0.3" font-size="7" font-family="${FONT}">${safeRepo}</text>` : ""}
</svg>`;
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
 * @returns SVG string for touch strip pixmap
 */
export function renderBranchNetworkStrip(
	branches: string[],
	offset = 0,
): string {
	const mainY = 50;
	const laneH = 18;
	const branchColors = ["#8b949e", "#58a6ff", "#3fb950", "#bc8cff", "#f85149", "#d29922", "#e3b341"];

	// Generate deterministic branch layout from names
	const mainBranch = branches.find((b) => b === "main" || b === "master") ?? branches[0] ?? "main";
	const featureBranches = branches.filter((b) => b !== mainBranch).slice(0, 4);

	let svgContent = "";

	// Main branch line
	const mainColor = branchColors[0];
	svgContent += `<line x1="${0 - offset}" y1="${mainY}" x2="${400 - offset}" y2="${mainY}" stroke="${mainColor}" stroke-width="2" stroke-linecap="round"/>`;

	// Main branch commits (evenly spaced)
	const mainCommitCount = 8;
	for (let i = 0; i < mainCommitCount; i++) {
		const cx = 25 + i * 45 - offset;
		if (cx >= -10 && cx <= 210) {
			svgContent += `<circle cx="${cx}" cy="${mainY}" r="2.5" fill="${mainColor}"/>`;
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
			svgContent += `<line x1="${startX}" y1="${mainY}" x2="${startX + 15}" y2="${branchY}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;

			// Branch line
			svgContent += `<line x1="${startX + 15}" y1="${branchY}" x2="${endX - (merged ? 15 : 0)}" y2="${branchY}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;

			// Commits on branch
			const commitSpacing = 25;
			for (let cx = startX + 25; cx < endX - 10; cx += commitSpacing) {
				if (cx >= -10 && cx <= 210) {
					svgContent += `<circle cx="${cx}" cy="${branchY}" r="2" fill="${color}"/>`;
				}
			}

			// Merge point (if merged)
			if (merged && endX >= -10 && endX <= 220) {
				svgContent += `<line x1="${endX - 15}" y1="${branchY}" x2="${endX}" y2="${mainY}" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>`;
				svgContent += `<circle cx="${endX}" cy="${mainY}" r="3.5" fill="${color}"/>`;
				svgContent += `<circle cx="${endX}" cy="${mainY}" r="5.5" fill="none" stroke="#fff" stroke-width="1" stroke-opacity="0.5"/>`;
			}

			// Branch label
			const labelX = startX + 18;
			const labelY = isAbove ? branchY - 6 : branchY + 12;
			if (labelX >= -30 && labelX <= 200) {
				const safeName = escapeXml(name.length > 14 ? name.slice(0, 12) + ".." : name);
				svgContent += `<rect x="${labelX - 2}" y="${labelY - 7}" width="${safeName.length * 5 + 6}" height="11" rx="2" fill="#000" fill-opacity="0.8"/>`;
				svgContent += `<text x="${labelX}" y="${labelY}" fill="${color}" fill-opacity="0.7" font-size="7" font-weight="500" font-family="${FONT}">${safeName}</text>`;
			}
		}
	});

	// Main branch label
	const mainLabelX = 5 - offset;
	if (mainLabelX >= -30 && mainLabelX <= 180) {
		const safeMain = escapeXml(mainBranch);
		svgContent += `<rect x="${mainLabelX - 2}" y="${mainY - 18}" width="${safeMain.length * 5 + 8}" height="12" rx="2" fill="${mainColor}"/>`;
		svgContent += `<text x="${mainLabelX + 2}" y="${mainY - 9}" fill="#000" font-size="7" font-weight="700" font-family="${FONT}">${safeMain}</text>`;
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
	<rect width="${WIDTH}" height="${HEIGHT}" fill="${STRIP_BG}"/>
	${svgContent}
</svg>`;
}
