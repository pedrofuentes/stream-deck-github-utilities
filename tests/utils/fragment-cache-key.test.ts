/**
 * Tests for fragment cache keys (src/utils/fragment-cache-key.ts).
 *
 * Verifies that fragments whose result depends on the requesting action's
 * settings get their own cache entry, that parameter-independent fragments
 * keep the plain repository identifier, and that a key can always be mapped
 * back to its repository.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";
import {
	fragmentCacheKey,
	repoFromCacheKey,
	FRAGMENT_PARAM_DEFAULTS,
} from "../../src/utils/fragment-cache-key";
import type { DataFragmentName } from "../../src/types";

const REPO = "sonio-ag/Steps";

describe("fragmentCacheKey", () => {
	// ── Parameter-independent fragments ──────────────────────────────────

	describe("parameter-independent fragments", () => {
		const fragments: DataFragmentName[] = [
			"repoMetadata",
			"branches",
			"vulnerabilityAlerts",
			"discussions",
			"projectsV2",
			"reviewRequestedPRs",
			"commitActivity",
		];

		for (const fragment of fragments) {
			it(`keeps the plain repo identifier for ${fragment}`, () => {
				expect(fragmentCacheKey(REPO, fragment)).toBe(REPO);
			});

			it(`ignores params for ${fragment}`, () => {
				expect(fragmentCacheKey(REPO, fragment, { prState: "closed", timeRange: "30d" })).toBe(REPO);
			});
		}
	});

	// ── branchComparison ─────────────────────────────────────────────────

	describe("branchComparison", () => {
		it("separates different branch pairs", () => {
			const develop = fragmentCacheKey(REPO, "branchComparison", { baseBranch: "main", headBranch: "develop" });
			const test = fragmentCacheKey(REPO, "branchComparison", { baseBranch: "main", headBranch: "Test" });

			expect(develop).not.toBe(test);
		});

		it("separates a swapped base and head", () => {
			const forward = fragmentCacheKey(REPO, "branchComparison", { baseBranch: "main", headBranch: "develop" });
			const reverse = fragmentCacheKey(REPO, "branchComparison", { baseBranch: "develop", headBranch: "main" });

			expect(forward).not.toBe(reverse);
		});

		it("treats omitted branches as the documented defaults", () => {
			const omitted = fragmentCacheKey(REPO, "branchComparison");
			const explicit = fragmentCacheKey(REPO, "branchComparison", {
				baseBranch: FRAGMENT_PARAM_DEFAULTS.baseBranch,
				headBranch: FRAGMENT_PARAM_DEFAULTS.headBranch,
			});

			expect(omitted).toBe(explicit);
		});

		it("is stable for identical params", () => {
			const params = { baseBranch: "main", headBranch: "develop" };
			expect(fragmentCacheKey(REPO, "branchComparison", params))
				.toBe(fragmentCacheKey(REPO, "branchComparison", { ...params }));
		});
	});

	// ── workflowRuns ─────────────────────────────────────────────────────

	describe("workflowRuns", () => {
		it("separates different environments", () => {
			const prod = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml", environment: "production" });
			const test = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml", environment: "test" });

			expect(prod).not.toBe(test);
		});

		it("separates different workflow files", () => {
			const ci = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml" });
			const release = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "release.yml" });

			expect(ci).not.toBe(release);
		});

		it("separates different branches", () => {
			const main = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml", branch: "main" });
			const develop = fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml", branch: "develop" });

			expect(main).not.toBe(develop);
		});

		it("does not confuse a set branch with a set environment", () => {
			const branch = fragmentCacheKey(REPO, "workflowRuns", { branch: "prod" });
			const environment = fragmentCacheKey(REPO, "workflowRuns", { environment: "prod" });

			expect(branch).not.toBe(environment);
		});

		it("treats omitted values as empty", () => {
			expect(fragmentCacheKey(REPO, "workflowRuns")).toBe(fragmentCacheKey(REPO, "workflowRuns", {}));
		});
	});

	// ── Count and release fragments ──────────────────────────────────────

	describe("prCount / issueCount / latestRelease / networkCommits", () => {
		it("separates open from closed pull requests", () => {
			expect(fragmentCacheKey(REPO, "prCount", { prState: "open" }))
				.not.toBe(fragmentCacheKey(REPO, "prCount", { prState: "closed" }));
		});

		it("treats an omitted prState as the default", () => {
			expect(fragmentCacheKey(REPO, "prCount"))
				.toBe(fragmentCacheKey(REPO, "prCount", { prState: FRAGMENT_PARAM_DEFAULTS.prState }));
		});

		it("separates open from all issues", () => {
			expect(fragmentCacheKey(REPO, "issueCount", { issueState: "open" }))
				.not.toBe(fragmentCacheKey(REPO, "issueCount", { issueState: "all" }));
		});

		it("treats an omitted issueState as the default", () => {
			expect(fragmentCacheKey(REPO, "issueCount"))
				.toBe(fragmentCacheKey(REPO, "issueCount", { issueState: FRAGMENT_PARAM_DEFAULTS.issueState }));
		});

		it("separates stable releases from pre-releases", () => {
			expect(fragmentCacheKey(REPO, "latestRelease", { includePreReleases: true }))
				.not.toBe(fragmentCacheKey(REPO, "latestRelease", { includePreReleases: false }));
		});

		it("treats an omitted includePreReleases as stable-only", () => {
			expect(fragmentCacheKey(REPO, "latestRelease"))
				.toBe(fragmentCacheKey(REPO, "latestRelease", { includePreReleases: false }));
		});

		it("separates different commit counts", () => {
			expect(fragmentCacheKey(REPO, "networkCommits", { maxCommits: 50 }))
				.not.toBe(fragmentCacheKey(REPO, "networkCommits", { maxCommits: 200 }));
		});

		it("treats an omitted maxCommits as the default", () => {
			expect(fragmentCacheKey(REPO, "networkCommits"))
				.toBe(fragmentCacheKey(REPO, "networkCommits", { maxCommits: FRAGMENT_PARAM_DEFAULTS.maxCommits }));
		});
	});

	// ── Repository scoping ───────────────────────────────────────────────

	describe("repository scoping", () => {
		it("separates the same params on different repos", () => {
			const params = { baseBranch: "main", headBranch: "develop" };
			expect(fragmentCacheKey("a/one", "branchComparison", params))
				.not.toBe(fragmentCacheKey("b/two", "branchComparison", params));
		});

		it("handles an empty repo identifier", () => {
			expect(repoFromCacheKey(fragmentCacheKey("", "prCount"))).toBe("");
		});
	});
});

describe("repoFromCacheKey", () => {
	it("returns the key unchanged when it carries no discriminator", () => {
		expect(repoFromCacheKey(REPO)).toBe(REPO);
	});

	it("strips the discriminator", () => {
		expect(repoFromCacheKey(fragmentCacheKey(REPO, "prCount", { prState: "closed" }))).toBe(REPO);
	});

	it("keeps only the repo when the discriminator itself contains a separator", () => {
		const key = fragmentCacheKey(REPO, "branchComparison", { baseBranch: "main", headBranch: "fix/#42" });
		expect(repoFromCacheKey(key)).toBe(REPO);
	});

	it("round-trips every parameterised fragment", () => {
		const keys = [
			fragmentCacheKey(REPO, "prCount", { prState: "all" }),
			fragmentCacheKey(REPO, "issueCount", { issueState: "closed" }),
			fragmentCacheKey(REPO, "latestRelease", { includePreReleases: true }),
			fragmentCacheKey(REPO, "workflowRuns", { workflowFile: "ci.yml", environment: "prod" }),
			fragmentCacheKey(REPO, "branchComparison", { baseBranch: "main", headBranch: "develop" }),
			fragmentCacheKey(REPO, "networkCommits", { maxCommits: 25 }),
		];

		for (const key of keys) {
			expect(repoFromCacheKey(key)).toBe(REPO);
		}
	});
});
