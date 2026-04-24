/**
 * Integration tests: Cache invalidation → fresh fetch verification
 *
 * Verifies the cache invalidation pipeline: invalidateAndFetch clears cache,
 * forces a fresh fetch, and notifies sibling actions watching the same repo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLQueryCoordinator } from "../../src/utils/graphql-query-coordinator";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import type { DataSubscription } from "../../src/types";
import {
	TOKEN,
	REPO,
	makeGraphQLRepoResponse,
	mockResponse,
} from "./fixtures";

vi.mock("@elgato/streamdeck", () => ({
	default: {
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			setLevel: vi.fn(),
			trace: vi.fn(),
		},
	},
}));

function baseSub(overrides: Partial<DataSubscription> = {}): DataSubscription {
	return {
		actionId: "test-action-1",
		repo: REPO,
		fragments: ["repoMetadata"],
		maxAgeSec: 300,
		...overrides,
	};
}

describe("Cache invalidation flow", () => {
	let coordinator: GraphQLQueryCoordinator;
	let cache: RepoDataCache;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
		cache = new RepoDataCache();
		coordinator = new GraphQLQueryCoordinator(cache);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("invalidateAndFetch clears cache then fetches fresh data", async () => {
		// Initial fetch caches data
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse(makeGraphQLRepoResponse({ stargazerCount: 1000 })))
			.mockResolvedValueOnce(mockResponse(makeGraphQLRepoResponse({ stargazerCount: 2000 })));

		coordinator.subscribe(baseSub());
		const result1 = await coordinator.fetchData("test-action-1", TOKEN);
		expect(result1.repoMetadata!.stargazers_count).toBe(1000);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Regular fetchData should use cache
		const result2 = await coordinator.fetchData("test-action-1", TOKEN);
		expect(result2.repoMetadata!.stargazers_count).toBe(1000);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// invalidateAndFetch should force new fetch
		const result3 = await coordinator.invalidateAndFetch("test-action-1", TOKEN);
		expect(result3.repoMetadata!.stargazers_count).toBe(2000);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("invalidateAndFetch notifies sibling actions on same repo", async () => {
		const siblingCallback = vi.fn().mockResolvedValue(undefined);

		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		// Subscribe two actions to the same repo
		coordinator.subscribe(baseSub({ actionId: "action-1", fragments: ["repoMetadata"] }));
		coordinator.subscribe({
			...baseSub({ actionId: "action-2", fragments: ["prCount"] }),
		}, siblingCallback);

		// Initial fetch for action-1
		await coordinator.fetchData("action-1", TOKEN);

		// Force refresh from action-1 should notify action-2
		await coordinator.invalidateAndFetch("action-1", TOKEN);

		expect(siblingCallback).toHaveBeenCalled();
	});

	it("invalidateAndFetch does NOT notify the triggering action", async () => {
		const selfCallback = vi.fn().mockResolvedValue(undefined);
		const siblingCallback = vi.fn().mockResolvedValue(undefined);

		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(
			baseSub({ actionId: "action-1", fragments: ["repoMetadata"] }),
			selfCallback,
		);
		coordinator.subscribe(
			baseSub({ actionId: "action-2", fragments: ["prCount"] }),
			siblingCallback,
		);

		await coordinator.fetchData("action-1", TOKEN);
		await coordinator.invalidateAndFetch("action-1", TOKEN);

		// Self callback should NOT be called
		expect(selfCallback).not.toHaveBeenCalled();
		// Sibling callback SHOULD be called
		expect(siblingCallback).toHaveBeenCalled();
	});

	it("invalidateAndFetch does not notify actions on different repos", async () => {
		const otherRepoCallback = vi.fn().mockResolvedValue(undefined);

		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({ actionId: "action-1", repo: "facebook/react" }));
		coordinator.subscribe(
			baseSub({ actionId: "action-2", repo: "vercel/next.js" }),
			otherRepoCallback,
		);

		await coordinator.fetchData("action-1", TOKEN);
		await coordinator.invalidateAndFetch("action-1", TOKEN);

		expect(otherRepoCallback).not.toHaveBeenCalled();
	});

	it("unsubscribe keeps the cache warm during the retention window then evicts", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({ actionId: "action-1" }));
		await coordinator.fetchData("action-1", TOKEN);

		// Cache should have data
		expect(cache.has(REPO, "repoMetadata")).toBe(true);

		// Unsubscribe — cache stays warm inside the retention window
		coordinator.unsubscribe("action-1");
		expect(cache.has(REPO, "repoMetadata")).toBe(true);

		// Advance past retention window and trigger another cleanup pass
		vi.advanceTimersByTime(10 * 60 * 1000 + 1);
		coordinator.unsubscribe("nonexistent-action");
		expect(cache.has(REPO, "repoMetadata")).toBe(false);
	});

	it("cache survives unsubscribe if another action still watches the repo", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({ actionId: "action-1" }));
		coordinator.subscribe(baseSub({ actionId: "action-2" }));
		await coordinator.fetchData("action-1", TOKEN);

		expect(cache.has(REPO, "repoMetadata")).toBe(true);

		// Unsubscribe action-1, but action-2 still watches
		coordinator.unsubscribe("action-1");
		expect(cache.has(REPO, "repoMetadata")).toBe(true);

		// Unsubscribe action-2 — cache stays warm during retention
		coordinator.unsubscribe("action-2");
		expect(cache.has(REPO, "repoMetadata")).toBe(true);

		// Advance past retention window and trigger cleanup
		vi.advanceTimersByTime(10 * 60 * 1000 + 1);
		coordinator.unsubscribe("nonexistent-action");
		expect(cache.has(REPO, "repoMetadata")).toBe(false);
	});

	it("multiple invalidateAndFetch calls each trigger a new fetch", async () => {
		let callCount = 0;
		fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
			callCount++;
			return Promise.resolve(mockResponse(
				makeGraphQLRepoResponse({ stargazerCount: callCount * 1000 }),
			));
		});

		coordinator.subscribe(baseSub());
		await coordinator.fetchData("test-action-1", TOKEN);
		expect(callCount).toBe(1);

		const r2 = await coordinator.invalidateAndFetch("test-action-1", TOKEN);
		expect(callCount).toBe(2);
		expect(r2.repoMetadata!.stargazers_count).toBe(2000);

		const r3 = await coordinator.invalidateAndFetch("test-action-1", TOKEN);
		expect(callCount).toBe(3);
		expect(r3.repoMetadata!.stargazers_count).toBe(3000);
	});

	it("invalidateAndFetch for unknown action throws", async () => {
		await expect(
			coordinator.invalidateAndFetch("nonexistent", TOKEN),
		).rejects.toThrow("No subscription found");
	});

	it("fetchData for unknown action throws", async () => {
		await expect(
			coordinator.fetchData("nonexistent", TOKEN),
		).rejects.toThrow("No subscription found");
	});

	it("cache.invalidate marks fragments stale but preserves data for fallback", () => {
		// Set fresh data
		cache.set(REPO, "repoMetadata", { stargazers_count: 100 }, "graphql");
		expect(cache.get(REPO, "repoMetadata", 300)).not.toBeNull();

		// Invalidate
		cache.invalidate(REPO, ["repoMetadata"]);

		// get() returns null (stale)
		expect(cache.get(REPO, "repoMetadata", 300)).toBeNull();

		// getStale() still returns data
		const stale = cache.getStale(REPO, "repoMetadata");
		expect(stale).not.toBeNull();
		expect((stale!.data as Record<string, number>).stargazers_count).toBe(100);
	});
});
