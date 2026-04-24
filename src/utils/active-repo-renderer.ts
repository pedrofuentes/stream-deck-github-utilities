/**
 * SVG renderers for the Active Repo action.
 *
 * Two controller contexts:
 *   - Keypad (144×144)   — compact summary on the button face
 *   - Encoder (200×100)  — two view modes cycled by dial rotate:
 *       · Mode A (branch + sync)
 *       · Mode B (working tree)
 *
 * Design language matches the existing `button-renderer` / `touch-strip-renderer`
 * pairings: rounded card on keypad, true-black canvas on dial, 3 px left accent
 * bar (dial) / 6 px top accent bar (key) whose color encodes overall git status.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { COLORS, escapeXml } from "./button-renderer";
import type { ActiveRepoGitState } from "./active-repo-source";

// ── Constants ──────────────────────────────────────────────────────────────

const FONT = "Arial,Helvetica,sans-serif";

const KEY_WIDTH = 144;
const KEY_HEIGHT = 144;
const DIAL_WIDTH = 200;
const DIAL_HEIGHT = 100;

const STRIP_BG = "#000000";
const STRIP_TEXT = "#e6edf3";
const STRIP_MUTED = "#8b949e";
const STRIP_DIM = "#484f58";

/** Status colors — all drawn from COLORS.workflow for palette consistency. */
const STATUS_COLORS = {
	clean: COLORS.workflow.success, // green
	dirty: COLORS.workflow.in_progress, // yellow
	ahead: "#f78166", // orange (orange accent from COLORS.accent.language)
	behind: COLORS.workflow.failure, // red
	conflict: COLORS.workflow.failure, // red
	unknown: COLORS.textMuted, // gray
} as const;

export type OverallStatus = keyof typeof STATUS_COLORS;

// ── Helpers ────────────────────────────────────────────────────────────────

function encodeSvgDataUri(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

/** Strip the owner prefix and truncate. Used for the "short" label mode. */
function shortRepoLabel(repo: string, maxLen: number): string {
	const slash = repo.indexOf("/");
	const name = slash >= 0 ? repo.slice(slash + 1) : repo;
	return truncate(name, maxLen);
}

/**
 * Compute the single "worst" status color for the left accent bar / key bar.
 * Priority (highest wins): conflict → behind → ahead → dirty → clean.
 */
export function overallStatus(git: ActiveRepoGitState | null | undefined): OverallStatus {
	if (!git) return "unknown";
	if ((git.conflicts ?? 0) > 0) return "conflict";
	if ((git.behind ?? 0) > 0) return "behind";
	if ((git.ahead ?? 0) > 0) return "ahead";
	const dirtyCount = (git.staged ?? 0) + (git.unstaged ?? 0) + (git.untracked ?? 0);
	if (dirtyCount > 0 || git.isDirty === true) return "dirty";
	return "clean";
}

/** Produce a short one-line status summary for the keypad. */
export function statusSummary(git: ActiveRepoGitState | null | undefined): string {
	if (!git) return "no data";
	const ahead = git.ahead ?? 0;
	const behind = git.behind ?? 0;
	const dirty = (git.staged ?? 0) + (git.unstaged ?? 0) + (git.untracked ?? 0);
	const conflicts = git.conflicts ?? 0;

	if (conflicts > 0) return `⚠ ${conflicts} conflict${conflicts === 1 ? "" : "s"}`;

	const parts: string[] = [];
	if (ahead > 0) parts.push(`${ahead}↑`);
	if (behind > 0) parts.push(`${behind}↓`);
	if (dirty > 0) parts.push(`⚠${dirty}`);

	if (parts.length === 0) return "✓ clean";
	return parts.join("  ");
}

// ── Keypad (144×144) ───────────────────────────────────────────────────────

export interface ActiveRepoKeyOptions {
	repo: string;
	git?: ActiveRepoGitState | null;
	showOwner?: boolean;
}

/**
 * Compact summary for the keypad:
 *   ┌────────────────┐
 *   │ ▬▬▬▬▬▬▬▬▬▬▬▬ │ ← 6px accent bar (overall status)
 *   │ owner/repo     │ 14px muted
 *   │                │
 *   │  feat/branch   │ 22–26px bold
 *   │                │
 *   │  3↑ 1↓ ⚠5      │ 16px, color matches status
 *   └────────────────┘
 */
export function renderActiveRepoKey(options: ActiveRepoKeyOptions): string {
	const status = overallStatus(options.git);
	const accent = STATUS_COLORS[status];
	const summaryColor = status === "clean" ? STATUS_COLORS.clean : accent;

	const repoLabel = options.showOwner === false
		? shortRepoLabel(options.repo, 14)
		: truncate(options.repo, 14);

	const branchRaw = options.git?.branch ?? (options.git?.headSha ? `@${options.git.headSha}` : "");
	const branch = branchRaw ? truncate(branchRaw, 12) : "—";
	const branchLen = branch.length;
	// Match Repo Stats renderKeyImage sizing: hero line at 30px max, tightens for longer values.
	let branchFontSize = 30;
	if (branchLen > 4) branchFontSize = 26;
	if (branchLen > 6) branchFontSize = 22;
	if (branchLen > 9) branchFontSize = 18;

	const summary = statusSummary(options.git);

	// Layout: 6 px accent bar (status color) / repo (18 px muted) / branch (hero) / summary (15 px accent).
	// Mirrors renderKeyImage positional constants in button-renderer.ts.
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_WIDTH}" height="${KEY_HEIGHT}" viewBox="0 0 ${KEY_WIDTH} ${KEY_HEIGHT}">
	<rect width="${KEY_WIDTH}" height="${KEY_HEIGHT}" rx="16" fill="${COLORS.background}"/>
	<rect y="0" width="${KEY_WIDTH}" height="6" rx="3" fill="${accent}"/>
	<text x="72" y="46" text-anchor="middle" fill="${COLORS.textMuted}" font-size="18" font-family="${FONT}">${escapeXml(repoLabel)}</text>
	<text x="72" y="88" text-anchor="middle" fill="${COLORS.text}" font-size="${branchFontSize}" font-weight="bold" font-family="${FONT}">${escapeXml(branch)}</text>
	<text x="72" y="124" text-anchor="middle" fill="${summaryColor}" font-size="15" font-weight="600" font-family="${FONT}">${escapeXml(summary)}</text>
</svg>`;

	return encodeSvgDataUri(svg);
}

// ── Dial — Mode A (Branch + sync) ──────────────────────────────────────────

export interface ActiveRepoDialOptions {
	repo: string;
	git?: ActiveRepoGitState | null;
	showOwner?: boolean;
}

export function renderActiveRepoDialModeA(options: ActiveRepoDialOptions): string {
	const status = overallStatus(options.git);
	const accent = STATUS_COLORS[status];

	const repoLabel = options.showOwner === false
		? shortRepoLabel(options.repo, 26)
		: truncate(options.repo, 26);

	const branchRaw = options.git?.branch ?? (options.git?.headSha ? `@${options.git.headSha}` : "—");
	const branch = truncate(branchRaw, 24);
	const branchLen = branch.length;
	// Hero line — sized to fit. Tightens for longer branch names so `feat/really-long-name`
	// still reads on the dial.
	let branchFontSize = 28;
	if (branchLen > 8) branchFontSize = 24;
	if (branchLen > 12) branchFontSize = 20;
	if (branchLen > 16) branchFontSize = 17;
	if (branchLen > 20) branchFontSize = 14;

	const ahead = options.git?.ahead ?? 0;
	const behind = options.git?.behind ?? 0;
	const dirty = (options.git?.staged ?? 0) + (options.git?.unstaged ?? 0) + (options.git?.untracked ?? 0);
	const conflicts = options.git?.conflicts ?? 0;
	const upstream = options.git?.upstream;

	const parts: string[] = [];
	if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts === 1 ? "" : "s"}`);
	else {
		if (ahead > 0) parts.push(`${ahead}↑`);
		if (behind > 0) parts.push(`${behind}↓`);
		if (dirty > 0) parts.push(`⚠${dirty}`);
	}
	if (parts.length === 0) parts.push("✓ clean");

	let statusLine = parts.join("  ");
	if (upstream) statusLine += `  ·  ${upstream}`;
	statusLine = truncate(statusLine, 32);

	// Repo on top (prominent), branch in the middle (hero), status line below.
	// Matches the Keypad hierarchy so both controllers read the same.
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" viewBox="0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}">
	<rect width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${DIAL_HEIGHT}" fill="${accent}"/>
	<text x="12" y="22" fill="${STRIP_TEXT}" font-size="14" font-weight="700" font-family="${FONT}">${escapeXml(repoLabel)}</text>
	<text x="12" y="58" fill="${STRIP_TEXT}" font-size="${branchFontSize}" font-weight="800" font-family="${FONT}">⑂ ${escapeXml(branch)}</text>
	<text x="12" y="84" fill="${accent}" font-size="11" font-weight="600" font-family="${FONT}">${escapeXml(statusLine)}</text>
</svg>`;

	return encodeSvgDataUri(svg);
}

// ── Dial — Mode B (Working tree) ───────────────────────────────────────────

export function renderActiveRepoDialModeB(options: ActiveRepoDialOptions): string {
	const status = overallStatus(options.git);
	const accent = STATUS_COLORS[status];

	const repoLabel = options.showOwner === false
		? shortRepoLabel(options.repo, 26)
		: truncate(options.repo, 26);

	const branchRaw = options.git?.branch ?? (options.git?.headSha ? `@${options.git.headSha}` : "—");
	const branch = truncate(branchRaw, 28);

	const staged = options.git?.staged ?? 0;
	const unstaged = options.git?.unstaged ?? 0;
	const untracked = options.git?.untracked ?? 0;

	// Three count columns, spread across the full canvas width so labels
	// ("STAGED", "UNSTAGED", "UNTRACK") don't overlap at small sizes.
	const colX = [44, 104, 168] as const;
	const counts = [staged, unstaged, untracked];
	const labels = ["STAGED", "UNSTAGED", "UNTRACK"];
	const dotColors = [
		staged > 0 ? STATUS_COLORS.dirty : STATUS_COLORS.clean,
		unstaged > 0 ? STATUS_COLORS.ahead : STATUS_COLORS.clean,
		untracked > 0 ? STATUS_COLORS.behind : STATUS_COLORS.clean,
	];

	// Repo + branch at the top; three count columns span the full width below.
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" viewBox="0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}">
	<rect width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" fill="${STRIP_BG}"/>
	<rect x="0" y="0" width="3" height="${DIAL_HEIGHT}" fill="${accent}"/>
	<text x="12" y="22" fill="${STRIP_TEXT}" font-size="14" font-weight="700" font-family="${FONT}">${escapeXml(repoLabel)}</text>
	<text x="12" y="38" fill="${STRIP_MUTED}" font-size="11" font-family="${FONT}">⑂ ${escapeXml(branch)}</text>
	${counts.map((count, i) => `
	<text x="${colX[i]}" y="60" text-anchor="middle" fill="${STRIP_DIM}" fill-opacity="0.85" font-size="8" font-weight="500" font-family="${FONT}" letter-spacing="0.5">${labels[i]}</text>
	<text x="${colX[i]}" y="82" text-anchor="middle" fill="${count > 0 ? STRIP_TEXT : STRIP_DIM}" font-size="20" font-weight="800" font-family="${FONT}">${count}</text>
	<circle cx="${colX[i]}" cy="94" r="3" fill="${dotColors[i]}"/>`).join("")}
</svg>`;

	return encodeSvgDataUri(svg);
}

// ── Setup-required / error states ──────────────────────────────────────────

/** Rendered on the keypad when the bridge is missing / not configured. */
export function renderActiveRepoKeyUnconfigured(message = "Setup required"): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_WIDTH}" height="${KEY_HEIGHT}" viewBox="0 0 ${KEY_WIDTH} ${KEY_HEIGHT}">
  <rect width="${KEY_WIDTH}" height="${KEY_HEIGHT}" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="${KEY_WIDTH}" height="6" rx="3" fill="${COLORS.textMuted}"/>
  <text x="72" y="60" text-anchor="middle" fill="${COLORS.textMuted}" font-size="14" font-family="${FONT}">Active Repo</text>
  <text x="72" y="88" text-anchor="middle" fill="${COLORS.text}" font-size="16" font-weight="700" font-family="${FONT}">${escapeXml(truncate(message, 16))}</text>
  <text x="72" y="116" text-anchor="middle" fill="${COLORS.textMuted}" font-size="11" font-family="${FONT}">Install VS Code ext</text>
</svg>`;
	return encodeSvgDataUri(svg);
}

/** Rendered on the dial when the bridge is missing / not configured. */
export function renderActiveRepoDialUnconfigured(message = "No active repo"): string {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" viewBox="0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}">
  <rect width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" fill="${STRIP_BG}"/>
  <rect x="0" y="0" width="3" height="${DIAL_HEIGHT}" fill="${STRIP_MUTED}"/>
  <text x="12" y="34" fill="${STRIP_TEXT}" font-size="18" font-weight="700" font-family="${FONT}">Active Repo</text>
  <text x="12" y="58" fill="${STRIP_MUTED}" font-size="13" font-family="${FONT}">${escapeXml(truncate(message, 32))}</text>
  <text x="12" y="84" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">Install the VS Code / Cursor extension</text>
</svg>`;
	return encodeSvgDataUri(svg);
}

/**
 * When we have `repo` but the bridge file is v1 (no git state fields). Shows
 * just the repo name and a hint. This is the "upgrade your extension" path.
 */
export function renderActiveRepoDialNoGit(repo: string, showOwner = true): string {
	const repoLabel = showOwner ? truncate(repo, 28) : shortRepoLabel(repo, 28);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" viewBox="0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}">
  <rect width="${DIAL_WIDTH}" height="${DIAL_HEIGHT}" fill="${STRIP_BG}"/>
  <rect x="0" y="0" width="3" height="${DIAL_HEIGHT}" fill="${STRIP_MUTED}"/>
  <text x="12" y="32" fill="${STRIP_TEXT}" font-size="20" font-weight="700" font-family="${FONT}">${escapeXml(repoLabel)}</text>
  <text x="12" y="60" fill="${STRIP_MUTED}" font-size="12" font-family="${FONT}">git state unavailable</text>
  <text x="12" y="84" fill="${STRIP_DIM}" font-size="11" font-family="${FONT}">Upgrade bridge extension for branch/dirty</text>
</svg>`;
	return encodeSvgDataUri(svg);
}

export function renderActiveRepoKeyNoGit(repo: string, showOwner = true): string {
	const repoLabel = showOwner ? truncate(repo, 14) : shortRepoLabel(repo, 14);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_WIDTH}" height="${KEY_HEIGHT}" viewBox="0 0 ${KEY_WIDTH} ${KEY_HEIGHT}">
  <rect width="${KEY_WIDTH}" height="${KEY_HEIGHT}" rx="16" fill="${COLORS.background}"/>
  <rect y="0" width="${KEY_WIDTH}" height="6" rx="3" fill="${COLORS.textMuted}"/>
  <text x="72" y="40" text-anchor="middle" fill="${COLORS.textMuted}" font-size="14" font-family="${FONT}">Active Repo</text>
  <text x="72" y="82" text-anchor="middle" fill="${COLORS.text}" font-size="18" font-weight="700" font-family="${FONT}">${escapeXml(repoLabel)}</text>
  <text x="72" y="116" text-anchor="middle" fill="${COLORS.textMuted}" font-size="11" font-family="${FONT}">upgrade ext</text>
</svg>`;
	return encodeSvgDataUri(svg);
}
