import { describe, it, expect } from "vitest";

import {
	BRIDGE_SCHEMA_VERSION,
	buildBridgePayload,
	getDefaultBridgePath,
	parseGitHubRemote,
	payloadsEquivalent,
} from "./bridge";

describe("parseGitHubRemote", () => {
	it("parses SSH remotes with .git suffix", () => {
		expect(parseGitHubRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
	});

	it("parses SSH remotes without .git suffix", () => {
		expect(parseGitHubRemote("git@github.com:owner/repo")).toBe("owner/repo");
	});

	it("parses HTTPS remotes with and without .git suffix", () => {
		expect(parseGitHubRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
		expect(parseGitHubRemote("https://github.com/owner/repo")).toBe("owner/repo");
	});

	it("handles a trailing slash on HTTPS remotes", () => {
		expect(parseGitHubRemote("https://github.com/owner/repo/")).toBe("owner/repo");
	});

	it("returns null for non-GitHub hosts", () => {
		expect(parseGitHubRemote("git@gitlab.com:owner/repo.git")).toBeNull();
		expect(parseGitHubRemote("https://bitbucket.org/owner/repo.git")).toBeNull();
	});

	it("returns null for blank input", () => {
		expect(parseGitHubRemote("")).toBeNull();
		expect(parseGitHubRemote("   ")).toBeNull();
	});
});

describe("getDefaultBridgePath", () => {
	it("ends with active-repo.json", () => {
		expect(getDefaultBridgePath()).toMatch(/active-repo\.json$/);
	});

	it("includes the plugin slug", () => {
		expect(getDefaultBridgePath()).toContain("stream-deck-github-utilities");
	});

	it("returns an absolute path", () => {
		const p = getDefaultBridgePath();
		expect(p.startsWith("/") || /^[A-Za-z]:\\/.test(p)).toBe(true);
	});
});

describe("buildBridgePayload", () => {
	it("produces the v2 schema without git state", () => {
		const payload = buildBridgePayload({
			workspacePath: "/Users/x/projects/demo",
			repo: "owner/demo",
			remoteUrl: "git@github.com:owner/demo.git",
			sourceApp: "Cursor",
			now: new Date("2026-04-23T22:10:00.000Z"),
		});

		expect(payload).toEqual({
			version: BRIDGE_SCHEMA_VERSION,
			sourceApp: "Cursor",
			workspacePath: "/Users/x/projects/demo",
			repo: "owner/demo",
			remoteUrl: "git@github.com:owner/demo.git",
			updatedAt: "2026-04-23T22:10:00.000Z",
		});
	});

	it("merges git state fields when provided", () => {
		const payload = buildBridgePayload({
			workspacePath: "/x",
			repo: "a/b",
			remoteUrl: "https://github.com/a/b",
			sourceApp: "Visual Studio Code",
			now: new Date("2026-04-23T22:10:00.000Z"),
			git: {
				branch: "main",
				headSha: "a3f91c0",
				upstream: "origin/main",
				ahead: 3,
				behind: 1,
				staged: 2,
				unstaged: 5,
				untracked: 1,
				conflicts: 0,
				isDirty: true,
			},
		});

		expect(payload.branch).toBe("main");
		expect(payload.ahead).toBe(3);
		expect(payload.behind).toBe(1);
		expect(payload.isDirty).toBe(true);
		expect(payload.version).toBe(BRIDGE_SCHEMA_VERSION);
	});

	it("uses the current time when no date is provided", () => {
		const before = Date.now();
		const payload = buildBridgePayload({
			workspacePath: "/x",
			repo: "a/b",
			remoteUrl: "https://github.com/a/b",
			sourceApp: "Visual Studio Code",
		});
		const updatedAt = Date.parse(payload.updatedAt);
		const after = Date.now();
		expect(updatedAt).toBeGreaterThanOrEqual(before);
		expect(updatedAt).toBeLessThanOrEqual(after);
	});
});

describe("payloadsEquivalent", () => {
	const base = buildBridgePayload({
		workspacePath: "/x",
		repo: "a/b",
		remoteUrl: "https://github.com/a/b",
		sourceApp: "Cursor",
		git: { branch: "main", staged: 0, unstaged: 0, isDirty: false },
		now: new Date("2026-04-23T22:10:00.000Z"),
	});

	it("returns false when prior payload is null", () => {
		expect(payloadsEquivalent(null, base)).toBe(false);
	});

	it("returns true when only updatedAt differs", () => {
		const later = buildBridgePayload({
			workspacePath: "/x",
			repo: "a/b",
			remoteUrl: "https://github.com/a/b",
			sourceApp: "Cursor",
			git: { branch: "main", staged: 0, unstaged: 0, isDirty: false },
			now: new Date("2026-04-23T22:15:00.000Z"),
		});
		expect(payloadsEquivalent(base, later)).toBe(true);
	});

	it("returns false when git state has changed", () => {
		const dirty = buildBridgePayload({
			workspacePath: "/x",
			repo: "a/b",
			remoteUrl: "https://github.com/a/b",
			sourceApp: "Cursor",
			git: { branch: "main", staged: 0, unstaged: 1, isDirty: true },
			now: new Date("2026-04-23T22:15:00.000Z"),
		});
		expect(payloadsEquivalent(base, dirty)).toBe(false);
	});

	it("returns false when branch has changed", () => {
		const branchSwitch = buildBridgePayload({
			workspacePath: "/x",
			repo: "a/b",
			remoteUrl: "https://github.com/a/b",
			sourceApp: "Cursor",
			git: { branch: "feat/x", staged: 0, unstaged: 0, isDirty: false },
			now: new Date("2026-04-23T22:15:00.000Z"),
		});
		expect(payloadsEquivalent(base, branchSwitch)).toBe(false);
	});
});
