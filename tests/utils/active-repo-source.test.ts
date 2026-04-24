/**
 * Tests for the active-editor repo bridge (src/utils/active-repo-source.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
	ACTIVE_REPO_SENTINEL,
	isActiveRepoSentinel,
	getDefaultBridgePath,
	extractRepoFromBridge,
	extractGitState,
	hasGitState,
	parseRemoteUrl,
	readBridgeFile,
	resolveRepoSelection,
	activeRepoWatcher,
	_resetBridgeCache,
} from "../../src/utils/active-repo-source";
import { parseRepoIdentifier } from "../../src/utils/github";

// ── fs mock ────────────────────────────────────────────────────────────────

const fsMock = vi.hoisted(() => ({
	stat: vi.fn(),
	readFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
	promises: fsMock,
	default: { promises: fsMock },
}));

beforeEach(() => {
	_resetBridgeCache();
	fsMock.stat.mockReset();
	fsMock.readFile.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// isActiveRepoSentinel
// ---------------------------------------------------------------------------
describe("isActiveRepoSentinel", () => {
	it("returns true only for the sentinel string", () => {
		expect(isActiveRepoSentinel(ACTIVE_REPO_SENTINEL)).toBe(true);
	});

	it("returns false for a real repo identifier", () => {
		expect(isActiveRepoSentinel("owner/repo")).toBe(false);
	});

	it("returns false for empty / undefined / null", () => {
		expect(isActiveRepoSentinel("")).toBe(false);
		expect(isActiveRepoSentinel(undefined)).toBe(false);
		expect(isActiveRepoSentinel(null)).toBe(false);
	});

	it("is rejected by parseRepoIdentifier — that's the guard that keeps callers honest", () => {
		expect(parseRepoIdentifier(ACTIVE_REPO_SENTINEL)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getDefaultBridgePath
// ---------------------------------------------------------------------------
describe("getDefaultBridgePath", () => {
	it("ends with the expected filename", () => {
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

// ---------------------------------------------------------------------------
// parseRemoteUrl
// ---------------------------------------------------------------------------
describe("parseRemoteUrl", () => {
	it("parses the SSH form with a .git suffix", () => {
		expect(parseRemoteUrl("git@github.com:owner/repo.git")).toBe("owner/repo");
	});

	it("parses the SSH form without a .git suffix", () => {
		expect(parseRemoteUrl("git@github.com:owner/repo")).toBe("owner/repo");
	});

	it("parses the HTTPS form", () => {
		expect(parseRemoteUrl("https://github.com/owner/repo.git")).toBe("owner/repo");
	});

	it("parses the HTTPS form without a .git suffix or trailing slash", () => {
		expect(parseRemoteUrl("https://github.com/owner/repo")).toBe("owner/repo");
	});

	it("handles a trailing slash on the HTTPS form", () => {
		expect(parseRemoteUrl("https://github.com/owner/repo/")).toBe("owner/repo");
	});

	it("returns null for non-GitHub remotes", () => {
		expect(parseRemoteUrl("git@gitlab.com:owner/repo.git")).toBeNull();
		expect(parseRemoteUrl("https://bitbucket.org/owner/repo.git")).toBeNull();
	});

	it("returns null for blank input", () => {
		expect(parseRemoteUrl("")).toBeNull();
		expect(parseRemoteUrl("   ")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// extractRepoFromBridge
// ---------------------------------------------------------------------------
describe("extractRepoFromBridge", () => {
	it("prefers an explicit repo field when present and valid", () => {
		expect(extractRepoFromBridge({ repo: "owner/repo" })).toBe("owner/repo");
	});

	it("falls back to remoteUrl when repo is absent", () => {
		expect(extractRepoFromBridge({ remoteUrl: "git@github.com:owner/repo.git" })).toBe("owner/repo");
	});

	it("falls back to remoteUrl when repo is present but malformed", () => {
		expect(extractRepoFromBridge({ repo: "not-a-repo", remoteUrl: "git@github.com:owner/repo.git" }))
			.toBe("owner/repo");
	});

	it("returns null when neither field yields a valid repo", () => {
		expect(extractRepoFromBridge({ repo: "no-slash" })).toBeNull();
		expect(extractRepoFromBridge({})).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// readBridgeFile — mtime cache, error paths
// ---------------------------------------------------------------------------
describe("readBridgeFile", () => {
	it("returns null and caches when the file is missing", async () => {
		fsMock.stat.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const result = await readBridgeFile("/tmp/missing.json");
		expect(result).toBeNull();
		expect(fsMock.readFile).not.toHaveBeenCalled();
	});

	it("returns null when the file is not valid JSON", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce("{ not json");

		const result = await readBridgeFile("/tmp/bad.json");
		expect(result).toBeNull();
	});

	it("returns the payload for a valid bridge file", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "owner/repo" }));

		const result = await readBridgeFile("/tmp/good.json");
		expect(result).toEqual({ repo: "owner/repo" });
	});

	it("short-circuits subsequent reads within the 1s dedupe window", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "owner/repo" }));

		await readBridgeFile("/tmp/good.json");
		await readBridgeFile("/tmp/good.json");
		await readBridgeFile("/tmp/good.json");

		expect(fsMock.stat).toHaveBeenCalledTimes(1);
		expect(fsMock.readFile).toHaveBeenCalledTimes(1);
	});

	it("re-reads when mtime changes (simulating a bridge-file rewrite)", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "owner/repo" }));
		await readBridgeFile("/tmp/good.json");

		_resetBridgeCache();

		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 200 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "other/repo" }));

		const second = await readBridgeFile("/tmp/good.json");
		expect(second).toEqual({ repo: "other/repo" });
		expect(fsMock.readFile).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// resolveRepoSelection
// ---------------------------------------------------------------------------
describe("resolveRepoSelection", () => {
	it("returns null for undefined / empty input", async () => {
		expect(await resolveRepoSelection(undefined)).toBeNull();
		expect(await resolveRepoSelection("")).toBeNull();
	});

	it("passes a fixed repo through untouched", async () => {
		const result = await resolveRepoSelection("owner/repo");
		expect(result).toEqual({ repo: "owner/repo", isSentinel: false });
		expect(fsMock.stat).not.toHaveBeenCalled();
	});

	it("resolves the sentinel via the bridge file when available", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "verygoodplugins/autohub" }));

		const result = await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath: "/tmp/bridge.json" });
		expect(result).toEqual({
			repo: "verygoodplugins/autohub",
			isSentinel: true,
			payload: { repo: "verygoodplugins/autohub" },
		});
	});

	it("reports 'bridge' missing when the file is absent", async () => {
		fsMock.stat.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

		const result = await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath: "/tmp/nope.json" });
		expect(result).toEqual({ repo: "", isSentinel: true, missing: "bridge" });
	});

	it("reports 'invalid' missing when the file exists but has no usable repo", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ sourceApp: "cursor" }));

		const result = await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath: "/tmp/empty.json" });
		expect(result).toMatchObject({ repo: "", isSentinel: true, missing: "invalid" });
	});

	it("falls back to remoteUrl when repo is not present", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ remoteUrl: "git@github.com:owner/repo.git" }));

		const result = await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath: "/tmp/remote-only.json" });
		expect(result).toMatchObject({ repo: "owner/repo", isSentinel: true });
	});

	it("respects a custom bridgePath override", async () => {
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "custom/path" }));

		await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath: "/custom/location.json" });
		expect(fsMock.stat).toHaveBeenCalledWith("/custom/location.json");
	});

	it("uses the default bridge path when no override is provided", async () => {
		fsMock.stat.mockRejectedValueOnce(new Error("ENOENT"));

		await resolveRepoSelection(ACTIVE_REPO_SENTINEL);
		expect(fsMock.stat).toHaveBeenCalledWith(getDefaultBridgePath());
	});
});

// ---------------------------------------------------------------------------
// activeRepoWatcher — mtime polling + notification
// ---------------------------------------------------------------------------
describe("activeRepoWatcher", () => {
	const PATH = "/tmp/bridge.json";

	beforeEach(() => {
		// Clean slate for the singleton watcher between tests
		for (const id of ["a", "b", "c"]) activeRepoWatcher.unsubscribe(id);
		activeRepoWatcher.setPathResolver(() => PATH);
	});

	it("is lazy — subscriberCount is 0 until someone subscribes", () => {
		expect(activeRepoWatcher.subscriberCount).toBe(0);
	});

	it("notifies all subscribers when the bridge-file mtime changes", async () => {
		const a = vi.fn();
		const b = vi.fn();

		// First stat sets the baseline
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		activeRepoWatcher.subscribe("a", a);
		activeRepoWatcher.subscribe("b", b);
		// Let the baseline-prime microtask run
		await Promise.resolve();
		await Promise.resolve();

		// Second stat: same mtime → no notification
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		await activeRepoWatcher._tick();
		expect(a).not.toHaveBeenCalled();
		expect(b).not.toHaveBeenCalled();

		// Third stat: changed mtime → both fire
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 200 });
		await activeRepoWatcher._tick();
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
	});

	it("invalidates the readBridgeFile cache so subscribers see fresh data", async () => {
		// Seed the bridge cache with repo A
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "a/a" }));
		expect(await readBridgeFile(PATH)).toEqual({ repo: "a/a" });

		// Baseline stat when we subscribe
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		activeRepoWatcher.subscribe("a", vi.fn());
		await Promise.resolve();
		await Promise.resolve();

		// Now simulate a write: mtime bumps to 200, content switches to repo B
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 200 });
		await activeRepoWatcher._tick();

		// Subscribers should now see the new repo on their next read
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 200 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify({ repo: "b/b" }));
		expect(await readBridgeFile(PATH)).toEqual({ repo: "b/b" });
	});

	it("unsubscribe stops notifications", async () => {
		const listener = vi.fn();
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		activeRepoWatcher.subscribe("a", listener);
		await Promise.resolve();
		await Promise.resolve();

		activeRepoWatcher.unsubscribe("a");

		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 999 });
		await activeRepoWatcher._tick();
		expect(listener).not.toHaveBeenCalled();
		expect(activeRepoWatcher.subscriberCount).toBe(0);
	});

	it("treats a bridge-path override switch as a change so subscribers re-read", async () => {
		const listener = vi.fn();
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 100 });
		activeRepoWatcher.subscribe("a", listener);
		await Promise.resolve();
		await Promise.resolve();

		activeRepoWatcher.setPathResolver(() => "/tmp/other.json");
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 50 });
		await activeRepoWatcher._tick();

		expect(listener).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// v1 / v2 bridge payload handling
// ---------------------------------------------------------------------------
describe("bridge schema v1 / v2 compatibility", () => {
	it("v1 payload validates and parses cleanly", async () => {
		const v1 = {
			version: 1,
			sourceApp: "Cursor",
			workspacePath: "/x",
			repo: "owner/repo",
			remoteUrl: "git@github.com:owner/repo.git",
			updatedAt: "2026-04-23T22:10:00.000Z",
		};
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 1 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify(v1));

		const payload = await readBridgeFile("/tmp/v1.json");
		expect(payload).not.toBeNull();
		expect(payload?.version).toBe(1);
		expect(hasGitState(payload)).toBe(false);
	});

	it("v2 payload validates and exposes git state", async () => {
		const v2 = {
			version: 2,
			sourceApp: "Cursor",
			workspacePath: "/x",
			repo: "owner/repo",
			remoteUrl: "git@github.com:owner/repo.git",
			updatedAt: "2026-04-23T22:10:00.000Z",
			branch: "feat/x",
			headSha: "a3f91c0",
			upstream: "origin/main",
			ahead: 3,
			behind: 1,
			staged: 2,
			unstaged: 5,
			untracked: 1,
			conflicts: 0,
			isDirty: true,
		};
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 1 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify(v2));

		const payload = await readBridgeFile("/tmp/v2.json");
		expect(payload).not.toBeNull();
		expect(hasGitState(payload)).toBe(true);
		expect(extractGitState(payload!)).toEqual({
			branch: "feat/x",
			headSha: "a3f91c0",
			upstream: "origin/main",
			ahead: 3,
			behind: 1,
			staged: 2,
			unstaged: 5,
			untracked: 1,
			conflicts: 0,
			isDirty: true,
		});
	});

	it("v2 clean state (no dirt, synced) still registers as hasGitState", async () => {
		const v2 = {
			version: 2,
			repo: "owner/repo",
			branch: "main",
			staged: 0,
			unstaged: 0,
			untracked: 0,
			conflicts: 0,
			isDirty: false,
		};
		fsMock.stat.mockResolvedValueOnce({ mtimeMs: 1 });
		fsMock.readFile.mockResolvedValueOnce(JSON.stringify(v2));

		const payload = await readBridgeFile("/tmp/clean.json");
		expect(hasGitState(payload)).toBe(true);
		expect(payload?.isDirty).toBe(false);
	});

	it("hasGitState returns false for null or empty payload", () => {
		expect(hasGitState(null)).toBe(false);
		expect(hasGitState(undefined)).toBe(false);
		expect(hasGitState({ repo: "owner/repo" })).toBe(false);
	});

	it("extractRepoFromBridge still works on a v2 payload", () => {
		const v2 = {
			version: 2,
			repo: "owner/repo",
			branch: "main",
			isDirty: false,
		};
		expect(extractRepoFromBridge(v2)).toBe("owner/repo");
	});
});
