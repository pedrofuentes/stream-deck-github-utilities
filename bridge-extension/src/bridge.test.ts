import { describe, it, expect } from "vitest";

import { buildBridgePayload, getDefaultBridgePath, parseGitHubRemote } from "./bridge";

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
	it("produces the expected schema", () => {
		const payload = buildBridgePayload({
			workspacePath: "/Users/x/projects/demo",
			repo: "owner/demo",
			remoteUrl: "git@github.com:owner/demo.git",
			sourceApp: "Cursor",
			now: new Date("2026-04-23T22:10:00.000Z"),
		});

		expect(payload).toEqual({
			version: 1,
			sourceApp: "Cursor",
			workspacePath: "/Users/x/projects/demo",
			repo: "owner/demo",
			remoteUrl: "git@github.com:owner/demo.git",
			updatedAt: "2026-04-23T22:10:00.000Z",
		});
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
