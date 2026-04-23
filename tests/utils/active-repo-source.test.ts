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
	parseRemoteUrl,
	readBridgeFile,
	resolveRepoSelection,
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
