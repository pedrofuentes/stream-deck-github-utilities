/**
 * Tests for the Active Repo renderer (src/utils/active-repo-renderer.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";

import {
	overallStatus,
	renderActiveRepoDialModeA,
	renderActiveRepoDialModeB,
	renderActiveRepoDialNoGit,
	renderActiveRepoDialUnconfigured,
	renderActiveRepoKey,
	renderActiveRepoKeyNoGit,
	renderActiveRepoKeyUnconfigured,
	statusSummary,
} from "../../src/utils/active-repo-renderer";
import type { ActiveRepoGitState } from "../../src/utils/active-repo-source";

/** Decode a data:image/svg+xml URL back to an SVG string for assertions. */
function decode(dataUri: string): string {
	expect(dataUri.startsWith("data:image/svg+xml,")).toBe(true);
	return decodeURIComponent(dataUri.slice("data:image/svg+xml,".length));
}

const clean: ActiveRepoGitState = {
	branch: "main",
	headSha: "a3f91c0",
	upstream: "origin/main",
	ahead: 0,
	behind: 0,
	staged: 0,
	unstaged: 0,
	untracked: 0,
	conflicts: 0,
	isDirty: false,
};

const dirty: ActiveRepoGitState = {
	...clean,
	staged: 2,
	unstaged: 5,
	untracked: 1,
	isDirty: true,
};

const aheadOnly: ActiveRepoGitState = { ...clean, ahead: 3 };
const behindOnly: ActiveRepoGitState = { ...clean, behind: 1 };
const conflictState: ActiveRepoGitState = { ...clean, conflicts: 2 };

// ───────────────────────────────────────────────────────────────────────────
describe("overallStatus", () => {
	it("returns 'unknown' when git is null or undefined", () => {
		expect(overallStatus(null)).toBe("unknown");
		expect(overallStatus(undefined)).toBe("unknown");
	});

	it("returns 'clean' when everything is zero", () => {
		expect(overallStatus(clean)).toBe("clean");
	});

	it("returns 'dirty' when only working-tree changes exist", () => {
		expect(overallStatus(dirty)).toBe("dirty");
	});

	it("prefers 'ahead' over 'dirty'", () => {
		expect(overallStatus({ ...dirty, ahead: 1 })).toBe("ahead");
	});

	it("prefers 'behind' over everything except 'conflict'", () => {
		expect(overallStatus({ ...dirty, ahead: 1, behind: 1 })).toBe("behind");
	});

	it("returns 'conflict' whenever there are merge conflicts", () => {
		expect(overallStatus(conflictState)).toBe("conflict");
		expect(overallStatus({ ...dirty, behind: 2, conflicts: 1 })).toBe("conflict");
	});

	it("treats isDirty:true with zero counts as dirty", () => {
		expect(overallStatus({ ...clean, isDirty: true })).toBe("dirty");
	});
});

// ───────────────────────────────────────────────────────────────────────────
describe("statusSummary", () => {
	it("returns '✓ clean' when nothing is pending", () => {
		expect(statusSummary(clean)).toBe("✓ clean");
	});

	it("includes ahead/behind/dirty counts", () => {
		const summary = statusSummary({ ...dirty, ahead: 3, behind: 1 });
		expect(summary).toContain("3↑");
		expect(summary).toContain("1↓");
		expect(summary).toContain("⚠");
	});

	it("prefers conflicts-first messaging", () => {
		expect(statusSummary(conflictState)).toMatch(/conflict/);
	});

	it("returns 'no data' when git state is missing", () => {
		expect(statusSummary(null)).toBe("no data");
	});
});

// ───────────────────────────────────────────────────────────────────────────
describe("renderActiveRepoKey", () => {
	it("renders a 144x144 SVG with the branch name and status summary", () => {
		const svg = decode(renderActiveRepoKey({ repo: "owner/demo", git: clean }));
		expect(svg).toContain(`width="144"`);
		expect(svg).toContain(`height="144"`);
		expect(svg).toContain("main");
		expect(svg).toContain("clean");
	});

	it("truncates a long repo owner/name rather than overflow", () => {
		const svg = decode(renderActiveRepoKey({ repo: "pedrofuentes/stream-deck-github-utilities", git: clean }));
		// 14-char truncate max — always ends with ellipsis
		expect(svg).toMatch(/pedrofuentes…|pedrofuentes\//);
	});

	it("omits the owner when showOwner is false", () => {
		const svg = decode(renderActiveRepoKey({ repo: "owner/very-long-repository-name", git: clean, showOwner: false }));
		expect(svg).toContain("very-long");
		expect(svg).not.toContain("owner/");
	});

	it("shows the short SHA when branch is detached HEAD", () => {
		const svg = decode(renderActiveRepoKey({ repo: "a/b", git: { ...clean, branch: undefined, headSha: "deadbee" } }));
		expect(svg).toContain("@deadbee");
	});

	it("uses the red accent bar for merge conflicts", () => {
		const svg = decode(renderActiveRepoKey({ repo: "a/b", git: conflictState }));
		expect(svg).toContain("#f85149");
	});

	it("uses the green accent bar when clean and synced", () => {
		const svg = decode(renderActiveRepoKey({ repo: "a/b", git: clean }));
		expect(svg).toContain("#3fb950");
	});
});

// ───────────────────────────────────────────────────────────────────────────
describe("renderActiveRepoDialModeA", () => {
	it("renders a 200x100 SVG with repo, branch, and upstream", () => {
		const svg = decode(renderActiveRepoDialModeA({ repo: "owner/demo", git: clean }));
		expect(svg).toContain(`width="200"`);
		expect(svg).toContain(`height="100"`);
		expect(svg).toContain("owner/demo");
		expect(svg).toContain("main");
		expect(svg).toContain("origin/main");
	});

	it("renders the repo name prominently on the top row (not as a dim corner watermark)", () => {
		const svg = decode(renderActiveRepoDialModeA({ repo: "owner/demo", git: clean }));
		// Top-row repo: left-aligned, large, bold, STRIP_TEXT color.
		expect(svg).toMatch(/x="12"\s+y="22"[^>]*font-size="14"[^>]*font-weight="700"[^>]*>owner\/demo/);
		// And definitely NOT the old dim-corner watermark.
		expect(svg).not.toMatch(/fill-opacity="0\.3"/);
	});

	it("shows ahead/behind counts when present", () => {
		const svg = decode(renderActiveRepoDialModeA({
			repo: "o/r",
			git: { ...clean, ahead: 3, behind: 1 },
		}));
		expect(svg).toContain("3↑");
		expect(svg).toContain("1↓");
	});

	it("uses the orange accent when only ahead", () => {
		const svg = decode(renderActiveRepoDialModeA({ repo: "o/r", git: aheadOnly }));
		expect(svg).toContain("#f78166"); // orange
	});

	it("uses the red accent when behind", () => {
		const svg = decode(renderActiveRepoDialModeA({ repo: "o/r", git: behindOnly }));
		expect(svg).toContain("#f85149"); // red
	});

	it("escapes angle brackets in a branch name", () => {
		const svg = decode(renderActiveRepoDialModeA({ repo: "o/r", git: { ...clean, branch: "fix/<script>" } }));
		expect(svg).not.toContain("<script>");
		expect(svg).toContain("&lt;script&gt;");
	});
});

// ───────────────────────────────────────────────────────────────────────────
describe("renderActiveRepoDialModeB", () => {
	it("renders three count columns for staged/unstaged/untracked", () => {
		const svg = decode(renderActiveRepoDialModeB({ repo: "o/r", git: dirty }));
		expect(svg).toContain("STAGED");
		expect(svg).toContain("UNSTAGED");
		expect(svg).toContain("UNTRACK"); // abbreviated in this layout to fit
		expect(svg).toContain(">2<"); // staged count
		expect(svg).toContain(">5<"); // unstaged count
		expect(svg).toContain(">1<"); // untracked count
	});

	it("shows zero counts in dim color but still renders the columns", () => {
		const svg = decode(renderActiveRepoDialModeB({ repo: "o/r", git: clean }));
		expect(svg).toContain("STAGED");
		expect(svg).toContain(">0<");
	});

	it("renders repo name prominently and branch in the header (both were missing before)", () => {
		const svg = decode(renderActiveRepoDialModeB({ repo: "owner/demo", git: clean }));
		// Repo prominent on top row.
		expect(svg).toMatch(/x="12"\s+y="22"[^>]*font-size="14"[^>]*font-weight="700"[^>]*>owner\/demo/);
		// Branch visible below the repo (was completely absent in old Mode B).
		expect(svg).toMatch(/x="12"\s+y="38"[^>]*>⑂ main/);
	});
});

// ───────────────────────────────────────────────────────────────────────────
describe("unconfigured / no-git-state fallbacks", () => {
	it("renders the keypad setup-required state", () => {
		const svg = decode(renderActiveRepoKeyUnconfigured());
		expect(svg).toContain("Active Repo");
		expect(svg).toContain("Setup required");
	});

	it("renders the dial setup-required state", () => {
		const svg = decode(renderActiveRepoDialUnconfigured());
		expect(svg).toContain("Active Repo");
		expect(svg).toContain("No active repo");
		expect(svg).toMatch(/extension/i);
	});

	it("renders the 'no git state' dial hint for v1 bridges", () => {
		const svg = decode(renderActiveRepoDialNoGit("owner/demo"));
		expect(svg).toContain("owner/demo");
		expect(svg).toMatch(/git state unavailable/i);
	});

	it("renders the 'no git state' keypad hint for v1 bridges", () => {
		const svg = decode(renderActiveRepoKeyNoGit("owner/demo"));
		expect(svg).toContain("owner/demo");
		expect(svg).toMatch(/upgrade/i);
	});
});
