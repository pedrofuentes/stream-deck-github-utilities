/**
 * Integration tests: Multi-subscriber coordinator behavior
 *
 * Verifies that the coordinator correctly batches requests from multiple
 * actions watching the same repo, handles subscriptions/unsubscriptions,
 * and shares cache across subscribers.
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

describe("Multi-subscriber coordinator behavior", () => {
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

	it("two actions watching same repo share a single GraphQL batch", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub({
			actionId: "action-1",
			fragments: ["repoMetadata"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "action-2",
			fragments: ["prCount"],
			params: { prState: "open" },
		}));

		// First fetch includes both fragments in the batch
		const result1 = await coordinator.fetchData("action-1", TOKEN);
		expect(result1.repoMetadata).toBeDefined();

		// Second fetch uses cached data (no new fetch)
		const result2 = await coordinator.fetchData("action-2", TOKEN);
		expect(result2.prCount).toBeDefined();
		expect(result2.prCount).toBe(120);

		// Only 1 fetch call — both served from the same batch
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("actions on different repos make separate fetches", async () => {
		const reactResponse = makeGraphQLRepoResponse({ stargazerCount: 42000 });
		const nextResponse = makeGraphQLRepoResponse({
			stargazerCount: 120000,
			nameWithOwner: "vercel/next.js",
		});

		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockResponse(reactResponse))
			.mockResolvedValueOnce(mockResponse(nextResponse));

		coordinator.subscribe(baseSub({
			actionId: "action-react",
			repo: "facebook/react",
			fragments: ["repoMetadata"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "action-next",
			repo: "vercel/next.js",
			fragments: ["repoMetadata"],
		}));

		const r1 = await coordinator.fetchData("action-react", TOKEN);
		expect(r1.repoMetadata!.stargazers_count).toBe(42000);

		const r2 = await coordinator.fetchData("action-next", TOKEN);
		expect(r2.repoMetadata!.stargazers_count).toBe(120000);

		// Two separate fetches (different repos)
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("subscription count tracks active subscriptions", () => {
		expect(coordinator.subscriptionCount).toBe(0);

		coordinator.subscribe(baseSub({ actionId: "a1" }));
		expect(coordinator.subscriptionCount).toBe(1);

		coordinator.subscribe(baseSub({ actionId: "a2" }));
		expect(coordinator.subscriptionCount).toBe(2);

		coordinator.unsubscribe("a1");
		expect(coordinator.subscriptionCount).toBe(1);

		coordinator.unsubscribe("a2");
		expect(coordinator.subscriptionCount).toBe(0);
	});

	it("isSubscribed returns correct status", () => {
		expect(coordinator.isSubscribed("a1")).toBe(false);

		coordinator.subscribe(baseSub({ actionId: "a1" }));
		expect(coordinator.isSubscribed("a1")).toBe(true);

		coordinator.unsubscribe("a1");
		expect(coordinator.isSubscribed("a1")).toBe(false);
	});

	it("getActiveRepos returns all repos with subscribers", () => {
		coordinator.subscribe(baseSub({ actionId: "a1", repo: "facebook/react" }));
		coordinator.subscribe(baseSub({ actionId: "a2", repo: "vercel/next.js" }));
		coordinator.subscribe(baseSub({ actionId: "a3", repo: "facebook/react" }));

		const repos = coordinator.getActiveRepos();
		expect(repos.size).toBe(2);
		expect(repos.has("facebook/react")).toBe(true);
		expect(repos.has("vercel/next.js")).toBe(true);
	});

	it("getAllFragmentsForRepo returns union of all subscriber fragments", () => {
		coordinator.subscribe(baseSub({
			actionId: "a1",
			repo: "facebook/react",
			fragments: ["repoMetadata", "prCount"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "a2",
			repo: "facebook/react",
			fragments: ["issueCount", "latestRelease"],
		}));
		coordinator.subscribe(baseSub({
			actionId: "a3",
			repo: "facebook/react",
			fragments: ["repoMetadata"], // Duplicate — should be deduped
		}));

		const fragments = coordinator.getAllFragmentsForRepo("facebook/react");
		expect(fragments).toContain("repoMetadata");
		expect(fragments).toContain("prCount");
		expect(fragments).toContain("issueCount");
		expect(fragments).toContain("latestRelease");
		// No duplicates
		const unique = new Set(fragments);
		expect(unique.size).toBe(fragments.length);
	});

	it("re-subscribing same action updates fragments", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		// Initial subscription: stars only
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata"],
		}));

		const r1 = await coordinator.fetchData("a1", TOKEN);
		expect(r1.repoMetadata).toBeDefined();
		expect(r1.prCount).toBeUndefined();

		// Advance time to expire cache
		vi.advanceTimersByTime(301_000);

		// Re-subscribe with additional fragments
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata", "prCount"],
			params: { prState: "open" },
		}));

		const r2 = await coordinator.fetchData("a1", TOKEN);
		expect(r2.repoMetadata).toBeDefined();
		expect(r2.prCount).toBe(120);
	});

	it("result only contains requested fragments, not all cached data", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		// Action 1 requests many fragments
		coordinator.subscribe(baseSub({
			actionId: "a1",
			fragments: ["repoMetadata", "prCount", "issueCount", "branches"],
			params: { prState: "open", issueState: "open" },
		}));
		await coordinator.fetchData("a1", TOKEN);

		// Action 2 only requests repoMetadata
		coordinator.subscribe(baseSub({
			actionId: "a2",
			fragments: ["repoMetadata"],
		}));
		const result = await coordinator.fetchData("a2", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		// These were NOT requested by action-2
		expect(result.prCount).toBeUndefined();
		expect(result.issueCount).toBeUndefined();
		expect(result.branches).toBeUndefined();
	});

	it("cache entries track data source (graphql vs rest)", async () => {
		fetchSpy = vi.spyOn(globalThis, "fetch")
			.mockResolvedValue(mockResponse(makeGraphQLRepoResponse()));

		coordinator.subscribe(baseSub());
		await coordinator.fetchData("test-action-1", TOKEN);

		const entry = cache.getStale(REPO, "repoMetadata");
		expect(entry).not.toBeNull();
		expect(entry!.source).toBe("graphql");
	});
});
