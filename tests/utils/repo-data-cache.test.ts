/**
 * Tests for per-repository data cache with field-level staleness tracking
 * (src/utils/repo-data-cache.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import { fragmentCacheKey } from "../../src/utils/fragment-cache-key";
import type { DataFragmentName } from "../../src/types";

describe("RepoDataCache", () => {
	let cache: RepoDataCache;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
		cache = new RepoDataCache();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ── get() ────────────────────────────────────────────────────────────

	describe("get()", () => {
		it("should return data when fresh", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			const result = cache.get<number>("owner/repo", "prCount", 300);
			expect(result).not.toBeNull();
			expect(result!.data).toBe(42);
			expect(result!.source).toBe("graphql");
		});

		it("should return null when data is stale", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			vi.advanceTimersByTime(301_000); // 301 seconds

			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
		});

		it("should return null when not cached", () => {
			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
		});

		it("should return data at exact maxAge boundary", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			vi.advanceTimersByTime(300_000); // exactly 300 seconds

			// Age is exactly 300s, maxAge is 300s → 300 > 300 is false → fresh
			expect(cache.get("owner/repo", "prCount", 300)).not.toBeNull();
		});

		it("should return null one millisecond past maxAge", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			vi.advanceTimersByTime(300_001);

			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
		});

		it("should return null when maxAgeSec is 0 and any time has passed", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			vi.advanceTimersByTime(1);

			expect(cache.get("owner/repo", "prCount", 0)).toBeNull();
		});

		it("should return data when maxAgeSec is 0 and no time has passed", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			// No time advance — age is 0s, 0 > 0 is false → fresh
			expect(cache.get("owner/repo", "prCount", 0)).not.toBeNull();
		});

		it("should return null when maxAgeSec is negative", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			// Age is 0s, -1 is the max → 0 > -1 is true → stale
			expect(cache.get("owner/repo", "prCount", -1)).toBeNull();
		});

		it("should return null when repo exists but fragment does not", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			expect(cache.get("owner/repo", "issueCount", 300)).toBeNull();
		});
	});

	// ── set() ────────────────────────────────────────────────────────────

	describe("set()", () => {
		it("should store data correctly", () => {
			cache.set("owner/repo", "repoMetadata", { stars: 100 }, "graphql");

			const result = cache.get<{ stars: number }>("owner/repo", "repoMetadata", 300);
			expect(result).not.toBeNull();
			expect(result!.data).toEqual({ stars: 100 });
			expect(result!.source).toBe("graphql");
			expect(result!.fetchedAt).toBe(Date.now());
		});

		it("should overwrite existing data", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "prCount", 20, "rest");

			const result = cache.get<number>("owner/repo", "prCount", 300);
			expect(result).not.toBeNull();
			expect(result!.data).toBe(20);
			expect(result!.source).toBe("rest");
		});

		it("should update the timestamp on overwrite", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			const firstTimestamp = Date.now();

			vi.advanceTimersByTime(5000);
			cache.set("owner/repo", "prCount", 20, "graphql");

			const result = cache.get<number>("owner/repo", "prCount", 300);
			expect(result!.fetchedAt).toBe(firstTimestamp + 5000);
		});

		it("should store data for the same fragment in different repos independently", () => {
			cache.set("alice/repo", "prCount", 10, "graphql");
			cache.set("bob/repo", "prCount", 99, "rest");

			expect(cache.get<number>("alice/repo", "prCount", 300)!.data).toBe(10);
			expect(cache.get<number>("bob/repo", "prCount", 300)!.data).toBe(99);
		});

		it("should handle an empty string as repo key", () => {
			cache.set("", "prCount", 5, "graphql");

			const result = cache.get<number>("", "prCount", 300);
			expect(result).not.toBeNull();
			expect(result!.data).toBe(5);
		});
	});

	// ── invalidate() ─────────────────────────────────────────────────────

	describe("invalidate()", () => {
		it("should mark specific fragments as stale", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "issueCount", 5, "graphql");

			cache.invalidate("owner/repo", ["prCount"]);

			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
			expect(cache.get("owner/repo", "issueCount", 300)).not.toBeNull();
		});

		it("should invalidate all fragments when none specified", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "issueCount", 5, "graphql");
			cache.set("owner/repo", "repoMetadata", {}, "graphql");

			cache.invalidate("owner/repo");

			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
			expect(cache.get("owner/repo", "issueCount", 300)).toBeNull();
			expect(cache.get("owner/repo", "repoMetadata", 300)).toBeNull();
		});

		it("should preserve data for fallback after invalidation", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			cache.invalidate("owner/repo", ["prCount"]);

			// Stale via get()
			expect(cache.get("owner/repo", "prCount", 300)).toBeNull();
			// But data is still available via getStale()
			expect(cache.getStale<number>("owner/repo", "prCount")!.data).toBe(42);
		});

		it("should set fetchedAt to 0", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			cache.invalidate("owner/repo", ["prCount"]);

			const entry = cache.getStale("owner/repo", "prCount");
			expect(entry!.fetchedAt).toBe(0);
		});

		it("should be a no-op for a repo not in the cache", () => {
			cache.invalidate("nonexistent/repo", ["prCount"]);
			expect(cache.size).toBe(0);
		});

		it("should be a no-op for fragments not in the cache", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");

			cache.invalidate("owner/repo", ["issueCount"]);

			expect(cache.get("owner/repo", "prCount", 300)).not.toBeNull();
		});
	});

	// ── getStaleFragments() ──────────────────────────────────────────────

	describe("getStaleFragments()", () => {
		it("should return empty array when all fragments are fresh", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "issueCount", 5, "graphql");

			const stale = cache.getStaleFragments("owner/repo", ["prCount", "issueCount"], 300);
			expect(stale).toEqual([]);
		});

		it("should return all fragments when none are cached", () => {
			const fragments: DataFragmentName[] = ["prCount", "issueCount", "repoMetadata"];
			const stale = cache.getStaleFragments("owner/repo", fragments, 300);
			expect(stale).toEqual(fragments);
		});

		it("should return only stale fragments in a mixed scenario", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "issueCount", 5, "graphql");

			vi.advanceTimersByTime(200_000); // 200s

			// Refresh only prCount
			cache.set("owner/repo", "prCount", 12, "graphql");

			const stale = cache.getStaleFragments(
				"owner/repo",
				["prCount", "issueCount", "repoMetadata"],
				150 // 150s max age — issueCount is 200s old, repoMetadata never cached
			);

			expect(stale).toContain("issueCount");
			expect(stale).toContain("repoMetadata");
			expect(stale).not.toContain("prCount");
		});

		it("should treat invalidated fragments as stale", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");

			cache.invalidate("owner/repo", ["prCount"]);

			const stale = cache.getStaleFragments("owner/repo", ["prCount"], 300);
			expect(stale).toEqual(["prCount"]);
		});
	});

	// ── cleanup() ────────────────────────────────────────────────────────

	describe("cleanup()", () => {
		it("should remove inactive repos", () => {
			cache.set("active/repo", "prCount", 10, "graphql");
			cache.set("inactive/repo", "prCount", 5, "graphql");

			cache.cleanup(new Set(["active/repo"]));

			expect(cache.has("active/repo", "prCount")).toBe(true);
			expect(cache.has("inactive/repo", "prCount")).toBe(false);
			expect(cache.size).toBe(1);
		});

		it("should preserve all active repos", () => {
			cache.set("repo-a/x", "prCount", 1, "graphql");
			cache.set("repo-b/y", "issueCount", 2, "rest");

			cache.cleanup(new Set(["repo-a/x", "repo-b/y"]));

			expect(cache.size).toBe(2);
		});

		it("should remove everything when active set is empty", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");

			cache.cleanup(new Set());

			expect(cache.size).toBe(0);
		});

		it("should be a no-op when cache is empty", () => {
			cache.cleanup(new Set(["some/repo"]));
			expect(cache.size).toBe(0);
		});

		it("should keep every parameter variant of an active repo", () => {
			const open = fragmentCacheKey("active/repo", "prCount", { prState: "open" });
			const closed = fragmentCacheKey("active/repo", "prCount", { prState: "closed" });
			cache.set(open, "prCount", 10, "graphql");
			cache.set(closed, "prCount", 99, "graphql");

			cache.cleanup(new Set(["active/repo"]));

			expect(cache.has(open, "prCount")).toBe(true);
			expect(cache.has(closed, "prCount")).toBe(true);
			expect(cache.size).toBe(2);
		});

		it("should remove every parameter variant of an inactive repo", () => {
			const active = fragmentCacheKey("active/repo", "prCount", { prState: "open" });
			const inactiveOpen = fragmentCacheKey("inactive/repo", "prCount", { prState: "open" });
			const inactiveClosed = fragmentCacheKey("inactive/repo", "prCount", { prState: "closed" });
			cache.set(active, "prCount", 1, "graphql");
			cache.set(inactiveOpen, "prCount", 2, "graphql");
			cache.set(inactiveClosed, "prCount", 3, "graphql");

			cache.cleanup(new Set(["active/repo"]));

			expect(cache.size).toBe(1);
			expect(cache.has(active, "prCount")).toBe(true);
		});

		it("should not be fooled by a discriminator containing the separator", () => {
			const key = fragmentCacheKey("active/repo", "branchComparison", {
				baseBranch: "main",
				headBranch: "fix/#42",
			});
			cache.set(key, "branchComparison", { ahead_by: 1 }, "rest");

			cache.cleanup(new Set(["active/repo"]));

			expect(cache.has(key, "branchComparison")).toBe(true);
		});
	});

	// ── has() ────────────────────────────────────────────────────────────

	describe("has()", () => {
		it("should return true for cached fragment", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			expect(cache.has("owner/repo", "prCount")).toBe(true);
		});

		it("should return true for stale (invalidated) fragment", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			cache.invalidate("owner/repo", ["prCount"]);
			expect(cache.has("owner/repo", "prCount")).toBe(true);
		});

		it("should return false for uncached fragment", () => {
			expect(cache.has("owner/repo", "prCount")).toBe(false);
		});

		it("should return false for uncached repo", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			expect(cache.has("other/repo", "prCount")).toBe(false);
		});

		it("should return false for wrong fragment on existing repo", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			expect(cache.has("owner/repo", "issueCount")).toBe(false);
		});
	});

	// ── getStale() ───────────────────────────────────────────────────────

	describe("getStale()", () => {
		it("should return data regardless of staleness", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");

			vi.advanceTimersByTime(999_999_000); // way past any reasonable maxAge

			const result = cache.getStale<number>("owner/repo", "prCount");
			expect(result).not.toBeNull();
			expect(result!.data).toBe(42);
		});

		it("should return data after invalidation", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			cache.invalidate("owner/repo", ["prCount"]);

			const result = cache.getStale<number>("owner/repo", "prCount");
			expect(result!.data).toBe(42);
			expect(result!.fetchedAt).toBe(0);
		});

		it("should return null when never cached", () => {
			expect(cache.getStale("owner/repo", "prCount")).toBeNull();
		});

		it("should return null for wrong fragment on existing repo", () => {
			cache.set("owner/repo", "prCount", 42, "graphql");
			expect(cache.getStale("owner/repo", "issueCount")).toBeNull();
		});
	});

	// ── size ─────────────────────────────────────────────────────────────

	describe("size", () => {
		it("should return 0 for empty cache", () => {
			expect(cache.size).toBe(0);
		});

		it("should count repos, not fragments", () => {
			cache.set("owner/repo", "prCount", 10, "graphql");
			cache.set("owner/repo", "issueCount", 5, "graphql");
			expect(cache.size).toBe(1);
		});

		it("should count each unique repo", () => {
			cache.set("repo-a/x", "prCount", 1, "graphql");
			cache.set("repo-b/y", "prCount", 2, "graphql");
			cache.set("repo-c/z", "prCount", 3, "graphql");
			expect(cache.size).toBe(3);
		});
	});

	// ── clear() ──────────────────────────────────────────────────────────

	describe("clear()", () => {
		it("should remove everything", () => {
			cache.set("repo-a/x", "prCount", 1, "graphql");
			cache.set("repo-b/y", "issueCount", 2, "rest");

			cache.clear();

			expect(cache.size).toBe(0);
			expect(cache.has("repo-a/x", "prCount")).toBe(false);
			expect(cache.has("repo-b/y", "issueCount")).toBe(false);
		});

		it("should be safe to call on empty cache", () => {
			cache.clear();
			expect(cache.size).toBe(0);
		});
	});

	// ── Edge cases ───────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should isolate same fragment across different repos", () => {
			cache.set("alice/repo", "prCount", 100, "graphql");
			cache.set("bob/repo", "prCount", 200, "rest");

			cache.invalidate("alice/repo", ["prCount"]);

			expect(cache.get("alice/repo", "prCount", 300)).toBeNull();
			expect(cache.get<number>("bob/repo", "prCount", 300)!.data).toBe(200);
		});

		it("should handle empty string repo key consistently", () => {
			cache.set("", "prCount", 5, "graphql");

			expect(cache.has("", "prCount")).toBe(true);
			expect(cache.get<number>("", "prCount", 300)!.data).toBe(5);
			expect(cache.size).toBe(1);

			cache.cleanup(new Set([""]));
			expect(cache.size).toBe(1);

			cache.cleanup(new Set());
			expect(cache.size).toBe(0);
		});
	});
});
