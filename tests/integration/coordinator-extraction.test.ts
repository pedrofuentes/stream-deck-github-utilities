/**
 * Integration tests: GraphQL response → Coordinator → CoordinatorResult
 *
 * Verifies the full extraction pipeline from raw GraphQL responses through
 * the real coordinator, real strategies, real extractors, and real cache —
 * mocking only globalThis.fetch (the HTTP boundary).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GraphQLQueryCoordinator } from "../../src/utils/graphql-query-coordinator";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import type { DataSubscription } from "../../src/types";
import {
	TOKEN,
	REPO,
	makeGraphQLRepoNode,
	makeGraphQLRepoResponse,
	mockResponse,
} from "./fixtures";

// Mock @elgato/streamdeck logger (required by coordinator)
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

describe("Coordinator: GraphQL response → CoordinatorResult", () => {
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

	it("extracts repo metadata from GraphQL batch response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		expect(result.repoMetadata!.stargazers_count).toBe(42000);
		expect(result.repoMetadata!.forks_count).toBe(5200);
		expect(result.repoMetadata!.watchers_count).toBe(1800);
		expect(result.repoMetadata!.language).toBe("JavaScript");
		expect(result.repoMetadata!.license).toBe("MIT");
		expect(result.repoMetadata!.default_branch).toBe("main");
		expect(result.repoMetadata!.visibility).toBe("public");
		expect(result.repoMetadata!.full_name).toBe("facebook/react");
		expect(result.repoMetadata!.description).toBe("The library for web and native user interfaces.");
	});

	it("extracts open PR count from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["prCount"],
			params: { prState: "open" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.prCount).toBe(120);
	});

	it("extracts closed PR count (includes merged)", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["prCount"],
			params: { prState: "closed" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		// closed (4500) + merged (3200)
		expect(result.prCount).toBe(7700);
	});

	it("extracts all PR count", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["prCount"],
			params: { prState: "all" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		// open (120) + closed (4500) + merged (3200)
		expect(result.prCount).toBe(7820);
	});

	it("extracts open issue count from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["issueCount"],
			params: { issueState: "open" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.issueCount).toBe(850);
	});

	it("extracts closed issue count", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["issueCount"],
			params: { issueState: "closed" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.issueCount).toBe(12000);
	});

	it("extracts all issue count", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["issueCount"],
			params: { issueState: "all" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		// open (850) + closed (12000)
		expect(result.issueCount).toBe(12850);
	});

	it("extracts latest stable release (excludes pre-releases)", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["latestRelease"],
			params: { includePreReleases: false },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.latestRelease).toBeDefined();
		expect(result.latestRelease!.tag_name).toBe("v18.3.1");
		expect(result.latestRelease!.name).toBe("React 18.3.1");
		expect(result.latestRelease!.prerelease).toBe(false);
	});

	it("extracts latest release including pre-releases", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["latestRelease"],
			params: { includePreReleases: true },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.latestRelease).toBeDefined();
		expect(result.latestRelease!.tag_name).toBe("v19.0.0-rc.1");
		expect(result.latestRelease!.prerelease).toBe(true);
	});

	it("extracts branches from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["branches"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.branches).toBeDefined();
		expect(result.branches).toHaveLength(3);
		expect(result.branches![0].name).toBe("main");
		expect(result.branches![0].commitSha).toBe("abc123def456");
		expect(result.branches![1].name).toBe("canary");
		expect(result.branches![2].name).toBe("experimental");
	});

	it("extracts security alerts from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["vulnerabilityAlerts"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.vulnerabilityAlerts).toBeDefined();
		expect(result.vulnerabilityAlerts!.critical).toBe(1);
		expect(result.vulnerabilityAlerts!.high).toBe(1);
		expect(result.vulnerabilityAlerts!.low).toBe(1);
		expect(result.vulnerabilityAlerts!.total).toBe(3);
	});

	it("extracts discussions from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["discussions"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.discussions).toBeDefined();
		expect(result.discussions!.totalCount).toBe(250);
		expect(result.discussions!.answeredCount).toBe(1);
		expect(result.discussions!.items).toHaveLength(2);
	});

	it("extracts Projects V2 from GraphQL response", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["projectsV2"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.projectsV2).toBeDefined();
		expect(result.projectsV2!.projects).toHaveLength(1);
		expect(result.projectsV2!.projects[0].title).toBe("React 19 Roadmap");
		expect(result.projectsV2!.projects[0].totalItems).toBe(42);
	});

	it("extracts multiple fragments from a single GraphQL batch", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["repoMetadata", "prCount", "issueCount", "latestRelease", "branches"],
			params: { prState: "open", issueState: "open" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata).toBeDefined();
		expect(result.prCount).toBe(120);
		expect(result.issueCount).toBe(850);
		expect(result.latestRelease).toBeDefined();
		expect(result.branches).toHaveLength(3);
		// Only one fetch call — all fragments batched
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("returns null release when repo has no releases", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({
			latestRelease: null,
			releases: { nodes: [] },
		});
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["latestRelease"],
			params: { includePreReleases: false },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.latestRelease).toBeNull();
	});

	it("returns empty branches when repo has no refs", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({ refs: undefined });
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["branches"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.branches).toEqual([]);
	});

	it("handles missing PR counts gracefully (defaults to 0)", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({
			openPRs: undefined,
			closedPRs: undefined,
			mergedPRs: undefined,
		});
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["prCount"],
			params: { prState: "all" },
		}));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.prCount).toBe(0);
	});

	it("extracts private repo visibility correctly", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({ isPrivate: true });
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata!.visibility).toBe("private");
	});

	it("handles null primaryLanguage", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({ primaryLanguage: null });
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata!.language).toBeNull();
	});

	it("handles null licenseInfo", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({ licenseInfo: null });
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.repoMetadata!.license).toBeNull();
	});

	it("uses cached data on second fetch within maxAgeSec", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["repoMetadata"] }));

		// First fetch: hits API
		await coordinator.fetchData("test-action-1", TOKEN);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Second fetch within cache window: uses cache
		await coordinator.fetchData("test-action-1", TOKEN);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("re-fetches data after cache expires", async () => {
		const graphqlResponse = makeGraphQLRepoResponse();
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({
			fragments: ["repoMetadata"],
			maxAgeSec: 60,
		}));

		// First fetch
		await coordinator.fetchData("test-action-1", TOKEN);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// Advance time past maxAgeSec
		vi.advanceTimersByTime(61_000);

		// Second fetch: cache expired, re-fetches
		await coordinator.fetchData("test-action-1", TOKEN);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("handles unknown vulnerability severity as low", async () => {
		const graphqlResponse = makeGraphQLRepoResponse({
			vulnerabilityAlerts: {
				totalCount: 2,
				nodes: [
					{ securityVulnerability: { severity: "UNKNOWN_LEVEL" } },
					{ securityVulnerability: { severity: "medium" } },
				],
			},
		});
		fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockResponse(graphqlResponse),
		);

		coordinator.subscribe(baseSub({ fragments: ["vulnerabilityAlerts"] }));
		const result = await coordinator.fetchData("test-action-1", TOKEN);

		expect(result.vulnerabilityAlerts!.low).toBe(1); // unknown → low
		expect(result.vulnerabilityAlerts!.medium).toBe(1);
		expect(result.vulnerabilityAlerts!.total).toBe(2);
	});
});
