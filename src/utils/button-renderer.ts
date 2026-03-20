/**
 * SVG-based key image renderer for Stream Deck buttons.
 *
 * Generates 144×144 SVG images with:
 * - Color-coded accent bar at the top (6 px)
 * - Up to 3 lines of text with controlled sizing
 * - High contrast for OLED displays
 * - Safe XML escaping
 *
 * Encoding: data:image/svg+xml,{encodeURIComponent(svg)}
 * (same approach as the Cloudflare Utilities plugin — confirmed working on device)
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { StatType } from "./github-api";

// ── Color Palette — GitHub dark theme ──────────────────────────────────────

export const COLORS = {
	background: "#0d1117",
	surface: "#161b22",
	text: "#e6edf3",
	textMuted: "#8b949e",
	border: "#30363d",
	accent: {
		stars: "#e3b341",
		issues: "#3fb950",
		forks: "#58a6ff",
		watchers: "#d2a8ff",
		pull_requests: "#3fb950",
		language: "#f78166",
		size: "#8b949e",
		license: "#d29922",
		default_branch: "#58a6ff",
		visibility: "#8b949e",
		releases: "#a371f7",
		commits: "#f78166",
		branches: "#58a6ff",
		discussions: "#a371f7",
		projects: "#3fb950",
	} as Record<string, string>,
	error: "#f85149",
	workflow: {
		success: "#3fb950",
		failure: "#f85149",
		cancelled: "#8b949e",
		in_progress: "#d29922",
		queued: "#58a6ff",
		pending: "#58a6ff",
		waiting: "#d29922",
		skipped: "#8b949e",
		timed_out: "#f85149",
		action_required: "#d29922",
		neutral: "#8b949e",
		stale: "#8b949e",
		requested: "#58a6ff",
		deploying: "#a371f7",
	},
} as const;

const FONT = "Arial,Helvetica,sans-serif";

// ── Spinner constants ──────────────────────────────────────────────────────

/** @deprecated Frame-based spinner replaced by native SVG animation. Kept for backwards compat. */
export const SPINNER_FRAME_COUNT = 8;

/** @deprecated Frame-based spinner replaced by native SVG animation. Kept for backwards compat. */
export const SPINNER_INTERVAL_MS = 150;

const SPINNER_RADIUS = 18;
const SPINNER_CX = 72;
const SPINNER_CY = 62;
const SPINNER_CIRCUMFERENCE = 2 * Math.PI * SPINNER_RADIUS;
const SPINNER_ARC_LEN = SPINNER_CIRCUMFERENCE / 3;
const SPINNER_GAP_LEN = SPINNER_CIRCUMFERENCE - SPINNER_ARC_LEN;

// ── Status Icons (SVG path data, drawn in a 36×36 viewBox) ────────────────

/**
 * SVG path data for workflow status icons.
 * Each icon is designed for a 36×36 coordinate space, centered at (18, 18).
 */
const STATUS_ICONS: Record<string, string> = {
	// ✓ Checkmark
	success: `<polyline points="8,19 15,26 28,12" fill="none" stroke="%%COLOR%%" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
	// ✗ X mark
	failure: `<line x1="10" y1="10" x2="26" y2="26" stroke="%%COLOR%%" stroke-width="3.5" stroke-linecap="round"/><line x1="26" y1="10" x2="10" y2="26" stroke="%%COLOR%%" stroke-width="3.5" stroke-linecap="round"/>`,
	// ⟳ Circular arrow (in progress)
	in_progress: `<path d="M18,6 A12,12 0 1,1 6,18" fill="none" stroke="%%COLOR%%" stroke-width="3" stroke-linecap="round"/><polygon points="6,12 6,20 11,16" fill="%%COLOR%%"/>`,
	// ⊘ Circle with slash (cancelled)
	cancelled: `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><line x1="10" y1="26" x2="26" y2="10" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/>`,
	// ◎ Clock (queued)
	queued: `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><line x1="18" y1="11" x2="18" y2="18" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="18" x2="24" y2="18" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/>`,
	// ⏳ Hourglass (pending)
	pending: `<circle cx="8" cy="18" r="3" fill="%%COLOR%%"/><circle cx="18" cy="18" r="3" fill="%%COLOR%%"/><circle cx="28" cy="18" r="3" fill="%%COLOR%%"/>`,
	// ◷ Clock (waiting, same as queued)
	waiting: `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><line x1="18" y1="11" x2="18" y2="18" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="18" x2="24" y2="18" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/>`,
	// → Forward arrow (skipped)
	skipped: `<line x1="8" y1="18" x2="28" y2="18" stroke="%%COLOR%%" stroke-width="3" stroke-linecap="round"/><polyline points="20,10 28,18 20,26" fill="none" stroke="%%COLOR%%" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
	// ⏱ Clock with X (timed out)
	timed_out: `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><line x1="14" y1="14" x2="22" y2="22" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/><line x1="22" y1="14" x2="14" y2="22" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/>`,
	// ⚠ Exclamation triangle (action required)
	action_required: `<polygon points="18,6 32,30 4,30" fill="none" stroke="%%COLOR%%" stroke-width="2.5" stroke-linejoin="round"/><line x1="18" y1="15" x2="18" y2="22" stroke="%%COLOR%%" stroke-width="2.5" stroke-linecap="round"/><circle cx="18" cy="26" r="1.5" fill="%%COLOR%%"/>`,
	// — Dash (neutral)
	neutral: `<line x1="8" y1="18" x2="28" y2="18" stroke="%%COLOR%%" stroke-width="3" stroke-linecap="round"/>`,
	// — Dash (stale)
	stale: `<line x1="8" y1="18" x2="28" y2="18" stroke="%%COLOR%%" stroke-width="3" stroke-linecap="round"/>`,
	// ○ Open circle (requested)
	requested: `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><circle cx="18" cy="18" r="4" fill="%%COLOR%%"/>`,
	// ▲ Rocket / up arrow (deploying)
	deploying: `<polygon points="18,6 28,28 18,22 8,28" fill="%%COLOR%%"/>`,
};

/** Default icon (question mark) for unknown statuses */
const DEFAULT_ICON = `<circle cx="18" cy="18" r="11" fill="none" stroke="%%COLOR%%" stroke-width="2.5"/><text x="18" y="24" text-anchor="middle" fill="%%COLOR%%" font-size="18" font-weight="bold" font-family="Arial">?</text>`;

/**
 * Returns the SVG markup for a status icon, colorized.
 * The icon is rendered in a 36×36 space.
 */
export function getStatusIcon(status: string, color: string): string {
	const template = STATUS_ICONS[status] ?? DEFAULT_ICON;
	return template.replace(/%%COLOR%%/g, color);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type KeyImageOptions = {
	/** Line 1: identifier / name (top, dimmed, 18 px) */
	line1?: string;
	/** Line 2: main status label (center, bold, white, 30 px default) */
	line2: string;
	/** Line 3: metadata / detail (bottom, dimmed, 15 px) */
	line3?: string;
	/** Color for the accent bar at the top */
	statusColor: string;
	/** Optional font size override for line2 (default: 30) */
	line2FontSize?: number;
};

export type KeyIconImageOptions = {
	/** Line 1: identifier / name (top, dimmed, 18 px) */
	line1?: string;
	/** Workflow status key (e.g. "success", "failure") — renders as icon */
	status: string;
	/** Line 3: metadata / detail (bottom, dimmed, 15 px) */
	line3?: string;
	/** Color for the accent bar at the top */
	statusColor: string;
};

// ── Core renderer ──────────────────────────────────────────────────────────

/**
 * Renders a data URI for a 144×144 SVG key image.
 *
 * Layout:
 *   ┌════════════════════════┐  ← colored accent bar (6 px)
 *   │                        │
 *   │     line1 (18 px)      │  ← identifier, dimmed
 *   │                        │
 *   │     LINE2 (30 px)      │  ← main status, bold, white
 *   │                        │
 *   │     line3 (15 px)      │  ← metadata, dimmed
 *   │                        │
 *   └────────────────────────┘
 */
export function renderKeyImage(options: KeyImageOptions): string {
	const line1 = options.line1 ? escapeXml(truncate(options.line1, 14)) : "";
	const line2FontSize = options.line2FontSize ?? 30;
	const maxLine2Chars = line2FontSize <= 22 ? 16 : 12;
	const line2 = escapeXml(truncate(options.line2, maxLine2Chars));
	const line3 = options.line3 ? escapeXml(truncate(options.line3, 18)) : "";

	const hasLine1 = !!options.line1;
	const hasLine3 = !!options.line3;

	// Vertical positioning based on which lines are present
	let line1Y: number, line2Y: number, line3Y: number;

	if (hasLine1 && hasLine3) {
		line1Y = 46;
		line2Y = 88;
		line3Y = 124;
	} else if (hasLine1) {
		line1Y = 56;
		line2Y = 100;
		line3Y = 0;
	} else if (hasLine3) {
		line1Y = 0;
		line2Y = 70;
		line3Y = 112;
	} else {
		line1Y = 0;
		line2Y = 86;
		line3Y = 0;
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="144" height="6" rx="3" fill="${options.statusColor}"/>
  ${hasLine1 ? `<text x="72" y="${line1Y}" text-anchor="middle" fill="${COLORS.textMuted}" font-size="18" font-family="${FONT}">${line1}</text>` : ""}
  <text x="72" y="${line2Y}" text-anchor="middle" fill="${COLORS.text}" font-size="${line2FontSize}" font-weight="bold" font-family="${FONT}">${line2}</text>
  ${hasLine3 ? `<text x="72" y="${line3Y}" text-anchor="middle" fill="${COLORS.textMuted}" font-size="15" font-family="${FONT}">${line3}</text>` : ""}
</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Renders a data URI for a 144×144 SVG key image with a centered icon.
 *
 * Layout:
 *   ┌════════════════════════┐  ← colored accent bar (6 px)
 *   │                        │
 *   │     line1 (18 px)      │  ← identifier, dimmed
 *   │                        │
 *   │       [ICON 40px]      │  ← status icon, colored
 *   │                        │
 *   │     line3 (15 px)      │  ← metadata, dimmed
 *   │                        │
 *   └────────────────────────┘
 */
export function renderIconKeyImage(options: KeyIconImageOptions): string {
	const line1 = options.line1 ? escapeXml(truncate(options.line1, 14)) : "";
	const line3 = options.line3 ? escapeXml(truncate(options.line3, 18)) : "";

	const hasLine1 = !!options.line1;
	const hasLine3 = !!options.line3;

	const iconColor = getWorkflowStatusColor(options.status);
	const iconSvg = getStatusIcon(options.status, iconColor);

	// Icon positioning (center of the 40×40 icon area)
	let line1Y: number, iconY: number, line3Y: number;

	if (hasLine1 && hasLine3) {
		line1Y = 36;
		iconY = 50;   // icon top
		line3Y = 120;
	} else if (hasLine1) {
		line1Y = 40;
		iconY = 56;
		line3Y = 0;
	} else if (hasLine3) {
		line1Y = 0;
		iconY = 36;
		line3Y = 114;
	} else {
		line1Y = 0;
		iconY = 46;
		line3Y = 0;
	}

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="144" height="6" rx="3" fill="${options.statusColor}"/>
  ${hasLine1 ? `<text x="72" y="${line1Y}" text-anchor="middle" fill="${COLORS.textMuted}" font-size="18" font-family="${FONT}">${line1}</text>` : ""}
  <g transform="translate(52,${iconY}) scale(${(40 / 36).toFixed(4)})">${iconSvg}</g>
  ${hasLine3 ? `<text x="72" y="${line3Y}" text-anchor="middle" fill="${COLORS.textMuted}" font-size="15" font-family="${FONT}">${line3}</text>` : ""}
</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── Convenience renderers ──────────────────────────────────────────────────

/**
 * Display labels for stat types on Stream Deck keys.
 * Uses `satisfies` to ensure compile-time exhaustiveness — adding a new
 * {@link StatType} without a label here will cause a type error.
 *
 * See also: `STAT_LABELS` in `touch-strip-renderer.ts` for the
 * touch-strip variant with Unicode glyphs.
 */
export const STAT_LABELS = {
	stars: "Stars",
	issues: "Issues",
	forks: "Forks",
	watchers: "Watchers",
	pull_requests: "Pull Requests",
	language: "Language",
	size: "Size",
	license: "License",
	default_branch: "Branch",
	visibility: "Visibility",
} as const satisfies Record<StatType, string>;

/**
 * Renders a repo stat image.
 * Layout: repo name / display value / stat label
 * Adjusts font size dynamically for longer text values.
 */
export function renderStatImage(displayValue: string, statType: StatType, repoName?: string): string {
	// Determine font size based on value length (text stats can be longer)
	let fontSize = 30;
	if (displayValue.length > 9) fontSize = 18;
	else if (displayValue.length > 6) fontSize = 22;
	else if (displayValue.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: displayValue,
		line3: STAT_LABELS[statType],
		statusColor: COLORS.accent[statType] ?? COLORS.textMuted,
		line2FontSize: fontSize,
	});
}

/**
 * Renders a workflow status image with an icon.
 * Layout: repo name / [status icon] / deploy info (optional)
 */
export function renderWorkflowImage(
	statusLabel: string,
	status: string,
	repoName?: string,
	deployLabel?: string,
): string {
	return renderIconKeyImage({
		line1: repoName,
		status,
		line3: deployLabel ?? statusLabel,
		statusColor: getWorkflowStatusColor(status),
	});
}

/**
 * Renders a deploying state image with an icon.
 * Layout: repo name / [deploying icon] / environment name
 */
export function renderDeployingImage(envName: string, _state: string, repoName?: string): string {
	return renderIconKeyImage({
		line1: repoName,
		status: "deploying",
		line3: envName,
		statusColor: COLORS.workflow.deploying,
	});
}

/** Renders a loading image with a native SVG animated spinner. No timer needed. */
export function renderLoadingImage(): string {
	return renderAnimatedSpinner();
}

/**
 * Renders a loading spinner using native SVG `<animateTransform>`.
 *
 * Stream Deck hardware supports SVG SMIL animations (<animate>, <animateTransform>),
 * so the spinner rotates natively without needing frame-by-frame setImage() calls.
 * This eliminates the SpinnerAnimator timer entirely — one setImage() call is enough.
 *
 * Layout:
 *   ┌════════════════════════┐  ← dim accent bar (6 px)
 *   │                        │
 *   │       ╭───╮            │  ← track circle (dim)
 *   │      /  ⌒  \           │  ← spinner arc (rotating via animateTransform)
 *   │      \     /           │
 *   │       ╰───╯            │
 *   │                        │
 *   │      Loading           │  ← label text
 *   │                        │
 *   └────────────────────────┘
 *
 * @param accentColor Optional color for the spinner arc (default: blue #58a6ff)
 */
export function renderAnimatedSpinner(accentColor?: string): string {
	const color = accentColor ?? "#58a6ff";

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="144" height="6" rx="3" fill="${COLORS.border}"/>
  <circle cx="${SPINNER_CX}" cy="${SPINNER_CY}" r="${SPINNER_RADIUS}" fill="none" stroke="${COLORS.border}" stroke-width="3"/>
  <circle cx="${SPINNER_CX}" cy="${SPINNER_CY}" r="${SPINNER_RADIUS}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${SPINNER_ARC_LEN.toFixed(1)} ${SPINNER_GAP_LEN.toFixed(1)}">
    <animateTransform attributeName="transform" type="rotate" from="0 ${SPINNER_CX} ${SPINNER_CY}" to="360 ${SPINNER_CX} ${SPINNER_CY}" dur="1s" repeatCount="indefinite"/>
  </circle>
  <text x="72" y="108" text-anchor="middle" fill="${COLORS.textMuted}" font-size="16" font-family="${FONT}">Loading</text>
</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Renders a static spinner frame for loading states.
 *
 * @deprecated Use {@link renderAnimatedSpinner} instead — it uses native SVG animation
 * and doesn't require a timer. This function is kept for backwards compatibility with tests.
 *
 * @param frame Frame index (0–7), each advances the arc by 45°
 * @param accentColor Optional color for the spinner arc (default: blue #58a6ff)
 */
export function renderSpinnerFrame(frame = 0, accentColor?: string): string {
	const angle = -90 + (frame % SPINNER_FRAME_COUNT) * (360 / SPINNER_FRAME_COUNT);
	const color = accentColor ?? "#58a6ff";

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="144" height="6" rx="3" fill="${COLORS.border}"/>
  <circle cx="${SPINNER_CX}" cy="${SPINNER_CY}" r="${SPINNER_RADIUS}" fill="none" stroke="${COLORS.border}" stroke-width="3"/>
  <circle cx="${SPINNER_CX}" cy="${SPINNER_CY}" r="${SPINNER_RADIUS}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${SPINNER_ARC_LEN.toFixed(1)} ${SPINNER_GAP_LEN.toFixed(1)}" transform="rotate(${angle}, ${SPINNER_CX}, ${SPINNER_CY})"/>
  <text x="72" y="108" text-anchor="middle" fill="${COLORS.textMuted}" font-size="16" font-family="${FONT}">Loading</text>
</svg>`;

	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Renders an error image.
 * Layout: error message / "Press to retry"
 */
export function renderErrorImage(message?: string): string {
	return renderKeyImage({
		line2: message ?? "Error",
		line3: "Press to retry",
		statusColor: COLORS.error,
	});
}

/** Renders an unconfigured / setup image shown when token or settings are missing. */
export function renderUnconfiguredImage(): string {
	return renderKeyImage({
		line2: "Setup",
		line3: "Open Settings",
		statusColor: COLORS.textMuted,
	});
}

/**
 * Renders a PR counter image.
 * Layout: repo name / PR count / state label
 */
export function renderPRCountImage(count: string, stateLabel: string, repoName?: string): string {
	let fontSize = 30;
	if (count.length > 6) fontSize = 22;
	else if (count.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: count,
		line3: stateLabel,
		statusColor: COLORS.accent.pull_requests,
		line2FontSize: fontSize,
	});
}

/**
 * Renders an issue counter image.
 * Layout: repo name / issue count / state label
 */
export function renderIssueCountImage(count: string, stateLabel: string, repoName?: string): string {
	let fontSize = 30;
	if (count.length > 6) fontSize = 22;
	else if (count.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: count,
		line3: stateLabel,
		statusColor: COLORS.accent.issues,
		line2FontSize: fontSize,
	});
}

/**
 * Renders a release monitor image.
 * Layout: repo name / version tag / relative time or "Pre-release"
 */
export function renderReleaseImage(tag: string, detail: string, repoName?: string): string {
	let fontSize = 30;
	if (tag.length > 9) fontSize = 18;
	else if (tag.length > 6) fontSize = 22;
	else if (tag.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: tag,
		line3: detail,
		statusColor: COLORS.accent.releases,
		line2FontSize: fontSize,
	});
}

/**
 * Renders a commit activity image.
 * Layout: repo name / commit count / time range label
 */
export function renderCommitActivityImage(count: string, rangeLabel: string, repoName?: string): string {
	let fontSize = 30;
	if (count.length > 6) fontSize = 22;
	else if (count.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: count,
		line3: rangeLabel,
		statusColor: COLORS.accent.commits,
		line2FontSize: fontSize,
	});
}

/**
 * Renders a discussions monitor image.
 * Layout: repo name / discussion count / label (or answered count)
 */
export function renderDiscussionsImage(count: string, label: string, repoName?: string): string {
	let fontSize = 30;
	if (count.length > 6) fontSize = 22;
	else if (count.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: count,
		line3: label,
		statusColor: "#A371F7",
		line2FontSize: fontSize,
	});
}

/**
 * Renders a branch comparison image.
 * Layout: repo name / ahead/behind display / branch names
 */
export function renderBranchComparisonImage(
	comparison: string,
	branchLabel: string,
	repoName?: string,
	statusColor?: string,
): string {
	let fontSize = 30;
	if (comparison.length > 9) fontSize = 18;
	else if (comparison.length > 6) fontSize = 22;
	else if (comparison.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: repoName,
		line2: comparison,
		line3: branchLabel,
		statusColor: statusColor ?? COLORS.accent.default_branch,
		line2FontSize: fontSize,
	});
}

/**
 * Renders a Projects V2 board image.
 * Layout:
 *   - 0 projects: "No Projects" centered
 *   - 1 project: project title / item count / "Project"
 *   - Multiple: project count / first project title / "Projects"
 */
export function renderProjectsBoardImage(projects: Array<{ title: string; totalItems: number }>): string {
	const PROJECTS_GREEN = "#3FB950";

	if (!projects || projects.length === 0) {
		return renderKeyImage({
			line2: "No Projects",
			statusColor: PROJECTS_GREEN,
			line2FontSize: 22,
		});
	}

	if (projects.length === 1) {
		const project = projects[0];
		const title = project.title;
		let fontSize = 30;
		if (title.length > 9) fontSize = 18;
		else if (title.length > 6) fontSize = 22;
		else if (title.length > 4) fontSize = 26;

		return renderKeyImage({
			line1: `${project.totalItems} items`,
			line2: title,
			line3: "Project",
			statusColor: PROJECTS_GREEN,
			line2FontSize: fontSize,
		});
	}

	const count = String(projects.length);
	let fontSize = 30;
	if (count.length > 6) fontSize = 22;
	else if (count.length > 4) fontSize = 26;

	return renderKeyImage({
		line1: projects[0].title,
		line2: count,
		line3: "Projects",
		statusColor: PROJECTS_GREEN,
		line2FontSize: fontSize,
	});
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the appropriate color for a workflow status.
 */
export function getWorkflowStatusColor(status: string): string {
	return (COLORS.workflow as Record<string, string>)[status] ?? COLORS.textMuted;
}

/**
 * Escapes a string for safe inclusion in XML/SVG.
 */
export function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Truncates a string if it exceeds maxLen, appending "..". */
function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, maxLen - 2) + "..";
}

