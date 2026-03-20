/**
 * Integration tests: Fragment strategy registry verification
 *
 * Verifies that the fragment strategy registry correctly maps all fragment
 * names to strategies, and that each strategy's extractFromGraphQL/assignToResult
 * pipeline works end-to-end with real data.
 */

import { describe, it, expect, vi } from "vitest";
import { fragmentRegistry } from "../../src/utils/fragment-strategies";
import { RepoDataCache } from "../../src/utils/repo-data-cache";
import type { CoordinatorResult, DataFragmentName, GraphQLRepoNode } from "../../src/types";
import { makeGraphQLRepoNode } from "./fixtures";

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

describe("Fragment strategy registry", () => {
	const ALL_FRAGMENTS: DataFragmentName[] = [
		"repoMetadata",
		"prCount",
		"issueCount",
		"latestRelease",
		"branches",
		"vulnerabilityAlerts",
		"discussions",
		"projectsV2",
		"workflowRuns",
		"commitActivity",
		"branchComparison",
		"reviewRequestedPRs",
	];

	it("has a strategy registered for every DataFragmentName", () => {
		for (const name of ALL_FRAGMENTS) {
			expect(fragmentRegistry.has(name)).toBe(true);
			expect(fragmentRegistry.get(name)!.name).toBe(name);
		}
	});

	it("GraphQL strategies have extractFromGraphQL defined", () => {
		const graphqlFragments: DataFragmentName[] = [
			"repoMetadata", "prCount", "issueCount", "latestRelease",
			"branches", "vulnerabilityAlerts", "discussions", "projectsV2",
		];

		for (const name of graphqlFragments) {
			const strategy = fragmentRegistry.get(name)!;
			expect(strategy.supportsGraphQL).toBe(true);
			expect(strategy.extractFromGraphQL).toBeDefined();
		}
	});

	it("REST-only strategies do not have extractFromGraphQL", () => {
		const restFragments: DataFragmentName[] = [
			"workflowRuns", "commitActivity", "branchComparison",
		];

		for (const name of restFragments) {
			const strategy = fragmentRegistry.get(name)!;
			expect(strategy.supportsGraphQL).toBe(false);
		}
	});

	describe("extractFromGraphQL → cache → assignToResult pipeline", () => {
		const node = makeGraphQLRepoNode();
		const cache = new RepoDataCache();
		const repo = "facebook/react";

		it("repoMetadata: extract → cache → assign", () => {
			const strategy = fragmentRegistry.get("repoMetadata")!;
			strategy.extractFromGraphQL!(cache, repo, node);

			const entry = cache.getStale(repo, "repoMetadata");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.repoMetadata).toBeDefined();
			expect(result.repoMetadata!.stargazers_count).toBe(42000);
			expect(result.repoMetadata!.full_name).toBe("facebook/react");
		});

		it("prCount: extract with state → cache → assign", () => {
			const strategy = fragmentRegistry.get("prCount")!;
			strategy.extractFromGraphQL!(cache, repo, node, { prState: "open" });

			const entry = cache.getStale(repo, "prCount");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.prCount).toBe(120);
		});

		it("issueCount: extract with state → cache → assign", () => {
			const strategy = fragmentRegistry.get("issueCount")!;
			strategy.extractFromGraphQL!(cache, repo, node, { issueState: "all" });

			const entry = cache.getStale(repo, "issueCount");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.issueCount).toBe(12850); // 850 + 12000
		});

		it("latestRelease: extract stable → cache → assign", () => {
			const strategy = fragmentRegistry.get("latestRelease")!;
			strategy.extractFromGraphQL!(cache, repo, node, { includePreReleases: false });

			const entry = cache.getStale(repo, "latestRelease");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.latestRelease).toBeDefined();
			expect(result.latestRelease!.tag_name).toBe("v18.3.1");
		});

		it("branches: extract → cache → assign", () => {
			const strategy = fragmentRegistry.get("branches")!;
			strategy.extractFromGraphQL!(cache, repo, node);

			const entry = cache.getStale(repo, "branches");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.branches).toHaveLength(3);
		});

		it("vulnerabilityAlerts: extract → cache → assign", () => {
			const strategy = fragmentRegistry.get("vulnerabilityAlerts")!;
			strategy.extractFromGraphQL!(cache, repo, node);

			const entry = cache.getStale(repo, "vulnerabilityAlerts");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.vulnerabilityAlerts).toBeDefined();
			expect(result.vulnerabilityAlerts!.total).toBe(3);
		});

		it("discussions: extract → cache → assign", () => {
			const strategy = fragmentRegistry.get("discussions")!;
			strategy.extractFromGraphQL!(cache, repo, node);

			const entry = cache.getStale(repo, "discussions");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.discussions).toBeDefined();
			expect(result.discussions!.totalCount).toBe(250);
			expect(result.discussions!.answeredCount).toBe(1);
		});

		it("projectsV2: extract → cache → assign", () => {
			const strategy = fragmentRegistry.get("projectsV2")!;
			strategy.extractFromGraphQL!(cache, repo, node);

			const entry = cache.getStale(repo, "projectsV2");
			expect(entry).not.toBeNull();

			const result: CoordinatorResult = {};
			strategy.assignToResult(result, entry!.data);
			expect(result.projectsV2).toBeDefined();
			expect(result.projectsV2!.projects).toHaveLength(1);
			expect(result.projectsV2!.projects[0].title).toBe("React 19 Roadmap");
		});
	});

	describe("assignToResult sets the correct field", () => {
		it.each([
			["repoMetadata", { stargazers_count: 1 }, "repoMetadata"],
			["prCount", 42, "prCount"],
			["issueCount", 99, "issueCount"],
			["latestRelease", { tag_name: "v1.0" }, "latestRelease"],
			["branches", [{ name: "main" }], "branches"],
			["vulnerabilityAlerts", { total: 5 }, "vulnerabilityAlerts"],
			["workflowRuns", { latestRun: {} }, "workflowRuns"],
			["commitActivity", [{ total: 10 }], "commitActivity"],
			["branchComparison", { ahead_by: 1 }, "branchComparison"],
			["discussions", { totalCount: 10 }, "discussions"],
			["projectsV2", { projects: [] }, "projectsV2"],
			["reviewRequestedPRs", { total_count: 3, items: [] }, "reviewRequestedPRs"],
		] as [DataFragmentName, unknown, keyof CoordinatorResult][])("strategy '%s' assigns to result.%s", (fragmentName, data, resultKey) => {
			const strategy = fragmentRegistry.get(fragmentName)!;
			const result: CoordinatorResult = {};
			strategy.assignToResult(result, data);
			expect(result[resultKey]).toBeDefined();
		});
	});
});
