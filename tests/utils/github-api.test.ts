/**
 * Tests for the GitHub API client (src/utils/github-api.ts).
 *
 * Uses vi.fn() to mock the global fetch function so no real HTTP calls are made.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	fetchRepoStats,
	fetchOpenPullRequestCount,
	fetchReviewRequestedPRs,
	fetchBranchNetwork,
	fetchPullRequestCount,
	fetchIssueCount,
	fetchCommitActivity,
	fetchBranchComparison,
	fetchLatestRelease,
	getStatValue,
	getStatLabel,
	getStatUrl,
	getStatDisplay,
	formatRepoSize,
	formatRunDuration,
	parseRateLimitHeaders,
	GitHubApiError,
	type RepoStats,
	type StatType,
	type BranchComparison,
	type ReleaseInfo,
} from "../../src/utils/github-api";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockHeaders(overrides: Record<string, string> = {}): Headers {
	const defaults: Record<string, string> = {
		"x-ratelimit-limit": "5000",
		"x-ratelimit-remaining": "4999",
		"x-ratelimit-reset": Math.floor(Date.now() / 1000 + 3600).toString(),
		"x-ratelimit-used": "1",
	};
	return new Headers({ ...defaults, ...overrides });
}

function mockRepoResponse(overrides: Partial<RepoStats> = {}): RepoStats {
	return {
		stargazers_count: 42000,
		open_issues_count: 150,
		forks_count: 8500,
		watchers_count: 42000,
		full_name: "facebook/react",
		description: "A JavaScript library for building user interfaces",
		visibility: "public",
		html_url: "https://github.com/facebook/react",
		language: "JavaScript",
		size: 248320,
		license: "MIT",
		default_branch: "main",
		...overrides,
	};
}

/** Raw API response body (license is an object, not a string) */
function mockRawApiResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		stargazers_count: 42000,
		open_issues_count: 150,
		forks_count: 8500,
		watchers_count: 42000,
		full_name: "facebook/react",
		description: "A JavaScript library for building user interfaces",
		visibility: "public",
		html_url: "https://github.com/facebook/react",
		language: "JavaScript",
		size: 248320,
		license: { spdx_id: "MIT", name: "MIT License" },
		default_branch: "main",
		...overrides,
	};
}

function mockFetchResponse(body: unknown, status = 200, headers?: Headers): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: headers ?? mockHeaders(),
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	} as unknown as Response;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("github-api", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	// ── fetchRepoStats ──────────────────────────

	describe("fetchRepoStats", () => {
		it("fetches repo stats successfully without token", async () => {
			const data = mockRawApiResponse();
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

			const result = await fetchRepoStats("facebook", "react");

			expect(result.stargazers_count).toBe(42000);
			expect(result.forks_count).toBe(8500);
			expect(result.full_name).toBe("facebook/react");
			expect(result.language).toBe("JavaScript");
			expect(result.license).toBe("MIT");
			expect(result.default_branch).toBe("main");
			expect(result.size).toBe(248320);

			// Verify correct URL was called
			const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
			expect(callArgs[0]).toBe("https://api.github.com/repos/facebook/react");

			// Verify no Authorization header when no token
			const headers = callArgs[1]?.headers as Record<string, string>;
			expect(headers["Authorization"]).toBeUndefined();
		});

		it("fetches repo stats with a PAT token", async () => {
			const data = mockRawApiResponse();
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

			await fetchRepoStats("facebook", "react", "ghp_abc123");

			const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
			const headers = callArgs[1]?.headers as Record<string, string>;
			expect(headers["Authorization"]).toBe("Bearer ghp_abc123");
			expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
			expect(headers["User-Agent"]).toContain("stream-deck-github-utilities");
		});

		it("URL-encodes owner and repo names with special characters", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse(mockRawApiResponse({ full_name: "my-org/my repo" })),
			);

			await fetchRepoStats("my-org", "my repo");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toBe("https://api.github.com/repos/my-org/my%20repo");
		});

		it("returns default values when API response fields are missing", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}));

			const result = await fetchRepoStats("owner", "repo");

			expect(result.stargazers_count).toBe(0);
			expect(result.open_issues_count).toBe(0);
			expect(result.forks_count).toBe(0);
			expect(result.watchers_count).toBe(0);
			expect(result.full_name).toBe("owner/repo");
			expect(result.description).toBeNull();
			expect(result.visibility).toBe("unknown");
			expect(result.html_url).toBe("https://github.com/owner/repo");
			expect(result.language).toBeNull();
			expect(result.size).toBe(0);
			expect(result.license).toBeNull();
			expect(result.default_branch).toBe("main");
		});

		// ── Error handling ──────────────────────────

		it("throws GitHubApiError on 401 Unauthorized", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Bad credentials" }, 401),
			);

			await expect(fetchRepoStats("owner", "repo", "bad_token")).rejects.toThrow(GitHubApiError);
			await expect(fetchRepoStats("owner", "repo", "bad_token")).rejects.toThrow(
				/Invalid or expired GitHub token/,
			);
		});

		it("throws GitHubApiError with rate limit message on 403 when limit exhausted", async () => {
			const headers = mockHeaders({
				"x-ratelimit-remaining": "0",
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "rate limit exceeded" }, 403, headers),
			);

			try {
				await fetchRepoStats("owner", "repo");
				expect.fail("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				const apiErr = err as GitHubApiError;
				expect(apiErr.status).toBe(403);
				expect(apiErr.message).toContain("rate limit exceeded");
				expect(apiErr.rateLimitInfo?.remaining).toBe(0);
			}
		});

		it("throws GitHubApiError on 403 access denied (not rate limit)", async () => {
			const headers = mockHeaders({ "x-ratelimit-remaining": "4999" });
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Forbidden" }, 403, headers),
			);

			await expect(fetchRepoStats("owner", "repo")).rejects.toThrow(/Access denied/);
		});

		it("throws GitHubApiError on 404 Not Found", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Not Found" }, 404),
			);

			await expect(fetchRepoStats("owner", "nonexistent")).rejects.toThrow(
				/not found or is private/,
			);
		});

		it("throws GitHubApiError with status on unexpected errors (500)", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Internal Server Error" }, 500),
			);

			try {
				await fetchRepoStats("owner", "repo");
				expect.fail("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				const apiErr = err as GitHubApiError;
				expect(apiErr.status).toBe(500);
				expect(apiErr.message).toContain("500");
			}
		});

		it("includes rate limit info in all error types", async () => {
			const headers = mockHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "3000",
				"x-ratelimit-used": "2000",
			});
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockFetchResponse({ message: "Not Found" }, 404, headers),
			);

			try {
				await fetchRepoStats("owner", "repo");
				expect.fail("Should have thrown");
			} catch (err) {
				const apiErr = err as GitHubApiError;
				expect(apiErr.rateLimitInfo?.limit).toBe(5000);
				expect(apiErr.rateLimitInfo?.remaining).toBe(3000);
				expect(apiErr.rateLimitInfo?.used).toBe(2000);
			}
		});

		it("handles fetch network errors gracefully", async () => {
			vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Network error"));

			await expect(fetchRepoStats("owner", "repo")).rejects.toThrow("Network error");
		});
	});

	// ── parseRateLimitHeaders ───────────────────

	describe("parseRateLimitHeaders", () => {
		it("parses complete rate limit headers", () => {
			const resetTimestamp = Math.floor(Date.now() / 1000 + 3600);
			const headers = new Headers({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "4500",
				"x-ratelimit-reset": resetTimestamp.toString(),
				"x-ratelimit-used": "500",
			});

			const info = parseRateLimitHeaders(headers);

			expect(info.limit).toBe(5000);
			expect(info.remaining).toBe(4500);
			expect(info.used).toBe(500);
			expect(info.reset).toBeInstanceOf(Date);
			expect(info.reset.getTime()).toBe(resetTimestamp * 1000);
		});

		it("returns zeros when headers are missing", () => {
			const headers = new Headers();

			const info = parseRateLimitHeaders(headers);

			expect(info.limit).toBe(0);
			expect(info.remaining).toBe(0);
			expect(info.used).toBe(0);
		});
	});

	// ── getStatValue ────────────────────────────

	describe("getStatValue", () => {
		const stats = mockRepoResponse();

		it("returns stargazers_count for 'stars'", () => {
			expect(getStatValue(stats, "stars")).toBe(42000);
		});

		it("returns open_issues_count for 'issues'", () => {
			expect(getStatValue(stats, "issues")).toBe(150);
		});

		it("returns forks_count for 'forks'", () => {
			expect(getStatValue(stats, "forks")).toBe(8500);
		});

		it("returns watchers_count for 'watchers'", () => {
			expect(getStatValue(stats, "watchers")).toBe(42000);
		});

		it("returns open_pull_request_count for 'pull_requests'", () => {
			const withPRs = mockRepoResponse({ open_pull_request_count: 7 });
			expect(getStatValue(withPRs, "pull_requests")).toBe(7);
		});

		it("returns 0 for pull_requests when count not set", () => {
			expect(getStatValue(stats, "pull_requests")).toBe(0);
		});

		it("returns size for 'size'", () => {
			expect(getStatValue(stats, "size")).toBe(248320);
		});

		it("returns 0 for text-based stat types", () => {
			expect(getStatValue(stats, "language")).toBe(0);
			expect(getStatValue(stats, "license")).toBe(0);
			expect(getStatValue(stats, "default_branch")).toBe(0);
			expect(getStatValue(stats, "visibility")).toBe(0);
		});
	});

	// ── getStatLabel ────────────────────────────

	describe("getStatLabel", () => {
		it.each([
			["stars", "Stars"],
			["issues", "Issues"],
			["forks", "Forks"],
			["watchers", "Watchers"],
			["pull_requests", "Pull Requests"],
			["language", "Language"],
			["size", "Size"],
			["license", "License"],
			["default_branch", "Branch"],
			["visibility", "Visibility"],
		] as [StatType, string][])("returns '%s' -> '%s'", (type, expected) => {
			expect(getStatLabel(type)).toBe(expected);
		});
	});

	// ── getStatUrl ────────────────────────────────────────

	describe("getStatUrl", () => {
		it.each([
			["stars", "https://github.com/owner/repo/stargazers"],
			["issues", "https://github.com/owner/repo/issues"],
			["forks", "https://github.com/owner/repo/forks"],
			["watchers", "https://github.com/owner/repo/watchers"],
			["pull_requests", "https://github.com/owner/repo/pulls"],
			["language", "https://github.com/owner/repo"],
			["size", "https://github.com/owner/repo"],
			["license", "https://github.com/owner/repo"],
			["visibility", "https://github.com/owner/repo/settings"],
		] as [StatType, string][])("returns correct URL for '%s'", (type, expected) => {
			expect(getStatUrl("owner", "repo", type)).toBe(expected);
		});
	});

	// ── getStatDisplay ────────────────────────────────────

	describe("getStatDisplay", () => {
		const mockFormat = (n: number): string => n.toString();
		const stats = mockRepoResponse();

		it("formats numeric stats with formatCount", () => {
			expect(getStatDisplay(stats, "stars", mockFormat)).toBe("42000");
			expect(getStatDisplay(stats, "issues", mockFormat)).toBe("150");
			expect(getStatDisplay(stats, "forks", mockFormat)).toBe("8500");
			expect(getStatDisplay(stats, "watchers", mockFormat)).toBe("42000");
		});

		it("returns language name", () => {
			expect(getStatDisplay(stats, "language", mockFormat)).toBe("JavaScript");
		});

		it("returns 'None' for null language", () => {
			const noLang = mockRepoResponse({ language: null });
			expect(getStatDisplay(noLang, "language", mockFormat)).toBe("None");
		});

		it("formats repo size", () => {
			expect(getStatDisplay(stats, "size", mockFormat)).toBe("242.5 MB");
		});

		it("returns license SPDX ID", () => {
			expect(getStatDisplay(stats, "license", mockFormat)).toBe("MIT");
		});

		it("returns 'None' for null license", () => {
			const noLicense = mockRepoResponse({ license: null });
			expect(getStatDisplay(noLicense, "license", mockFormat)).toBe("None");
		});

		it("returns default branch name", () => {
			expect(getStatDisplay(stats, "default_branch", mockFormat)).toBe("main");
		});

		it("returns visibility as Public or Private", () => {
			expect(getStatDisplay(stats, "visibility", mockFormat)).toBe("Public");
			const priv = mockRepoResponse({ visibility: "private" });
			expect(getStatDisplay(priv, "visibility", mockFormat)).toBe("Private");
		});

		it("formats pull request count", () => {
			const withPRs = mockRepoResponse({ open_pull_request_count: 12 });
			expect(getStatDisplay(withPRs, "pull_requests", mockFormat)).toBe("12");
		});
	});

	// ── formatRepoSize ─────────────────────────────────────

	describe("formatRepoSize", () => {
		it("formats sizes under 1024 KB as KB", () => {
			expect(formatRepoSize(512)).toBe("512 KB");
			expect(formatRepoSize(0)).toBe("0 KB");
		});

		it("formats sizes as MB", () => {
			expect(formatRepoSize(1024)).toBe("1.0 MB");
			expect(formatRepoSize(248320)).toBe("242.5 MB");
		});

		it("formats sizes as GB", () => {
			expect(formatRepoSize(1048576)).toBe("1.0 GB");
			expect(formatRepoSize(2621440)).toBe("2.5 GB");
		});
	});

	// ── fetchOpenPullRequestCount ───────────────────────

	describe("fetchOpenPullRequestCount", () => {
		it("returns total_count from Search API", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: mockHeaders(),
				json: () => Promise.resolve({ total_count: 23, incomplete_results: false, items: [] }),
			} as unknown as Response);

			const count = await fetchOpenPullRequestCount("owner", "repo", "ghp_test");
			expect(count).toBe(23);
		});

		it("returns 0 when no open PRs", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: mockHeaders(),
				json: () => Promise.resolve({ total_count: 0, incomplete_results: false, items: [] }),
			} as unknown as Response);

			const count = await fetchOpenPullRequestCount("owner", "repo");
			expect(count).toBe(0);
		});

		it("returns 0 on API error", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: false,
				status: 403,
				headers: mockHeaders(),
				json: () => Promise.resolve({ message: "forbidden" }),
			} as unknown as Response);

			const count = await fetchOpenPullRequestCount("owner", "repo");
			expect(count).toBe(0);
		});

		it("calls Search API with type:pr is:open", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: mockHeaders(),
				json: () => Promise.resolve({ total_count: 0, incomplete_results: false, items: [] }),
			} as unknown as Response);

			await fetchOpenPullRequestCount("owner", "repo", "ghp_test");

			const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
			expect(url).toContain("/search/issues");
			expect(decodeURIComponent(url)).toContain("type:pr");
			expect(decodeURIComponent(url)).toContain("is:open");
		});
	});

	// ── formatRunDuration ──────────────────────────────────────────────────

	describe("formatRunDuration", () => {
		it("returns seconds for short durations", () => {
			expect(formatRunDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:45Z")).toBe("45s");
		});

		it("returns minutes and seconds for medium durations", () => {
			expect(formatRunDuration("2026-01-01T00:00:00Z", "2026-01-01T00:03:42Z")).toBe("3m 42s");
		});

		it("returns hours and minutes for long durations", () => {
			expect(formatRunDuration("2026-01-01T00:00:00Z", "2026-01-01T01:05:00Z")).toBe("1h 5m");
		});

		it("returns empty string for empty inputs", () => {
			expect(formatRunDuration("", "2026-01-01T00:00:00Z")).toBe("");
			expect(formatRunDuration("2026-01-01T00:00:00Z", "")).toBe("");
			expect(formatRunDuration("", "")).toBe("");
		});

		it("returns empty string when end is before start", () => {
			expect(formatRunDuration("2026-01-01T01:00:00Z", "2026-01-01T00:00:00Z")).toBe("");
		});

		it("returns empty string for identical timestamps", () => {
			expect(formatRunDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe("");
		});

		it("handles multi-hour durations", () => {
			expect(formatRunDuration("2026-01-01T00:00:00Z", "2026-01-01T02:30:00Z")).toBe("2h 30m");
		});
	});
});

// ──────────────────────────────────────────────
// fetchReviewRequestedPRs
// ──────────────────────────────────────────────

describe("fetchReviewRequestedPRs", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns total_count and items from search results", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve({
				total_count: 2,
				incomplete_results: false,
				items: [
					{
						number: 42,
						title: "Fix bug",
						user: { login: "alice" },
						html_url: "https://github.com/owner/repo/pull/42",
						created_at: "2024-01-15T10:00:00Z",
					},
					{
						number: 99,
						title: "Add feature",
						user: { login: "bob" },
						html_url: "https://github.com/owner/repo/pull/99",
						created_at: "2024-01-16T12:00:00Z",
					},
				],
			}),
		} as unknown as Response);

		const result = await fetchReviewRequestedPRs("ghp_test");
		expect(result.total_count).toBe(2);
		expect(result.items).toHaveLength(2);
		expect(result.items[0].number).toBe(42);
		expect(result.items[0].title).toBe("Fix bug");
		expect(result.items[0].user_login).toBe("alice");
		expect(result.items[1].number).toBe(99);
	});

	it("includes repo filter in search query when provided", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve({ total_count: 0, items: [] }),
		} as unknown as Response);

		await fetchReviewRequestedPRs("ghp_test", "owner/repo");

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const url = call[0] as string;
		expect(url).toContain(encodeURIComponent("repo:owner/repo"));
	});

	it("does not include repo filter when not provided", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve({ total_count: 0, items: [] }),
		} as unknown as Response);

		await fetchReviewRequestedPRs("ghp_test");

		const call = vi.mocked(globalThis.fetch).mock.calls[0];
		const url = call[0] as string;
		expect(url).not.toContain("repo%3A");
	});

	it("throws GitHubApiError on 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 401,
			headers: mockHeaders({ "x-ratelimit-remaining": "0" }),
			json: () => Promise.resolve({ message: "Bad credentials" }),
			text: () => Promise.resolve("Bad credentials"),
		} as unknown as Response);

		await expect(fetchReviewRequestedPRs("bad_token")).rejects.toThrow(GitHubApiError);
		await expect(fetchReviewRequestedPRs("bad_token")).rejects.toThrow("Invalid or expired");
	});

	it("throws GitHubApiError on 403 rate limit", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 403,
			headers: mockHeaders({ "x-ratelimit-remaining": "0" }),
			json: () => Promise.resolve({ message: "rate limit exceeded" }),
			text: () => Promise.resolve("rate limit exceeded"),
		} as unknown as Response);

		await expect(fetchReviewRequestedPRs("ghp_test")).rejects.toThrow(GitHubApiError);
		await expect(fetchReviewRequestedPRs("ghp_test")).rejects.toThrow("rate limit");
	});

	it("returns zero count gracefully", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve({ total_count: 0, items: [] }),
		} as unknown as Response);

		const result = await fetchReviewRequestedPRs("ghp_test");
		expect(result.total_count).toBe(0);
		expect(result.items).toHaveLength(0);
	});

	it("handles missing user.login gracefully", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve({
				total_count: 1,
				items: [{
					number: 1,
					title: "Test PR",
					user: null,
					html_url: "https://github.com/owner/repo/pull/1",
					created_at: "2024-01-01T00:00:00Z",
				}],
			}),
		} as unknown as Response);

		const result = await fetchReviewRequestedPRs("ghp_test");
		expect(result.items[0].user_login).toBe("");
	});
});

// ── fetchBranchNetwork ────────────────────────────────────────────────────

describe("fetchBranchNetwork", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("should return branch info from API response", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve([
				{ name: "main", commit: { sha: "abc123" } },
				{ name: "develop", commit: { sha: "def456" } },
				{ name: "feature/auth", commit: { sha: "ghi789" } },
			]),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		const result = await fetchBranchNetwork("owner", "repo", "ghp_test");

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ name: "main", commitSha: "abc123" });
		expect(result[1]).toEqual({ name: "develop", commitSha: "def456" });
		expect(result[2]).toEqual({ name: "feature/auth", commitSha: "ghi789" });
	});

	it("should send correct API URL with per_page=10", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve([]),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		await fetchBranchNetwork("owner", "repo", "ghp_test");

		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.stringContaining("/repos/owner/repo/branches?per_page=10"),
			expect.any(Object),
		);
	});

	it("should throw GitHubApiError for 404", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 404,
			headers: mockHeaders(),
			json: () => Promise.resolve({ message: "Not Found" }),
			text: () => Promise.resolve("Not Found"),
		} as unknown as Response);

		await expect(fetchBranchNetwork("owner", "repo", "ghp_test"))
			.rejects.toThrow(GitHubApiError);
	});

	it("should throw GitHubApiError for 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: false,
			status: 401,
			headers: mockHeaders(),
			json: () => Promise.resolve({ message: "Bad credentials" }),
			text: () => Promise.resolve("Bad credentials"),
		} as unknown as Response);

		await expect(fetchBranchNetwork("owner", "repo", "ghp_test"))
			.rejects.toThrow("Invalid or expired GitHub token");
	});

	it("should return empty array for repos with no branches", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve([]),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		const result = await fetchBranchNetwork("owner", "repo", "ghp_test");
		expect(result).toEqual([]);
	});

	it("should include authorization header", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 200,
			headers: mockHeaders(),
			json: () => Promise.resolve([]),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		await fetchBranchNetwork("owner", "repo", "ghp_mytoken");

		expect(globalThis.fetch).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer ghp_mytoken",
				}),
			}),
		);
	});
});

// ──────────────────────────────────────────────
// fetchPullRequestCount
// ──────────────────────────────────────────────

describe("fetchPullRequestCount", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns total_count from search results", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 17 }));

		const result = await fetchPullRequestCount("owner", "repo", "ghp_test");
		expect(result).toBe(17);
	});

	it("includes is:open in query for open state", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 5 }));

		await fetchPullRequestCount("owner", "repo", "ghp_test", "open");

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		expect(decodeURIComponent(url)).toContain("is:open");
	});

	it("includes is:closed in query for closed state", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 3 }));

		await fetchPullRequestCount("owner", "repo", "ghp_test", "closed");

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		expect(decodeURIComponent(url)).toContain("is:closed");
	});

	it("has no state qualifier for all state", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 10 }));

		await fetchPullRequestCount("owner", "repo", "ghp_test", "all");

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		const decoded = decodeURIComponent(url);
		expect(decoded).not.toContain("is:open");
		expect(decoded).not.toContain("is:closed");
		expect(decoded).toContain("type:pr");
	});

	it("throws GitHubApiError on 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Bad credentials" },
			401,
		));

		await expect(fetchPullRequestCount("owner", "repo", "bad_token")).rejects.toThrow(GitHubApiError);
		await expect(fetchPullRequestCount("owner", "repo", "bad_token")).rejects.toThrow(/Invalid or expired/);
	});

	it("throws GitHubApiError on 404", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Not Found" },
			404,
		));

		await expect(fetchPullRequestCount("owner", "repo", "ghp_test")).rejects.toThrow(GitHubApiError);
		await expect(fetchPullRequestCount("owner", "repo", "ghp_test")).rejects.toThrow(/not found/);
	});
});

// ──────────────────────────────────────────────
// fetchIssueCount
// ──────────────────────────────────────────────

describe("fetchIssueCount", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("open state: subtracts PR count from open_issues_count", async () => {
		vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
			const urlStr = url as string;
			if (urlStr.includes("/search/issues")) {
				return mockFetchResponse({ total_count: 5 });
			}
			// repo stats
			return mockFetchResponse(mockRawApiResponse({ open_issues_count: 20 }));
		});

		const result = await fetchIssueCount("owner", "repo", "ghp_test", "open");
		expect(result).toBe(15);
	});

	it("open state: never goes negative", async () => {
		vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
			const urlStr = url as string;
			if (urlStr.includes("/search/issues")) {
				return mockFetchResponse({ total_count: 30 });
			}
			return mockFetchResponse(mockRawApiResponse({ open_issues_count: 10 }));
		});

		const result = await fetchIssueCount("owner", "repo", "ghp_test", "open");
		expect(result).toBe(0);
	});

	it("closed state: uses search API and returns total_count", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 42 }));

		const result = await fetchIssueCount("owner", "repo", "ghp_test", "closed");
		expect(result).toBe(42);

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		const decoded = decodeURIComponent(url);
		expect(decoded).toContain("type:issue");
		expect(decoded).toContain("is:closed");
	});

	it("all state: uses search API with no state qualifier", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({ total_count: 100 }));

		const result = await fetchIssueCount("owner", "repo", "ghp_test", "all");
		expect(result).toBe(100);

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		const decoded = decodeURIComponent(url);
		expect(decoded).toContain("type:issue");
		expect(decoded).not.toContain("is:open");
		expect(decoded).not.toContain("is:closed");
	});

	it("throws GitHubApiError on 401 for search API", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Bad credentials" },
			401,
		));

		await expect(fetchIssueCount("owner", "repo", "bad_token", "closed")).rejects.toThrow(GitHubApiError);
		await expect(fetchIssueCount("owner", "repo", "bad_token", "closed")).rejects.toThrow(/Invalid or expired/);
	});
});

// ──────────────────────────────────────────────
// fetchCommitActivity
// ──────────────────────────────────────────────

describe("fetchCommitActivity", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns -1 on 202 (computing)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 202,
			headers: mockHeaders(),
			json: () => Promise.resolve(null),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		const result = await fetchCommitActivity("owner", "repo", "ghp_test");
		expect(result).toBe(-1);
	});

	it("returns 0 on 204 (empty repo)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue({
			ok: true,
			status: 204,
			headers: mockHeaders(),
			json: () => Promise.resolve(null),
			text: () => Promise.resolve(""),
		} as unknown as Response);

		const result = await fetchCommitActivity("owner", "repo", "ghp_test");
		expect(result).toBe(0);
	});

	it("7d returns latest week total", async () => {
		const weeks = Array.from({ length: 52 }, (_, i) => ({
			total: i === 51 ? 42 : 5,
			days: i === 51 ? [6, 6, 6, 6, 6, 6, 6] : [1, 0, 1, 1, 0, 1, 1],
			week: Math.floor(Date.now() / 1000) - (51 - i) * 604800,
		}));

		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(weeks));

		const result = await fetchCommitActivity("owner", "repo", "ghp_test", "7d");
		expect(result).toBe(42);
	});

	it("30d sums last 4 weeks", async () => {
		const weeks = Array.from({ length: 52 }, (_, i) => ({
			total: 10,
			days: [1, 1, 2, 2, 1, 2, 1],
			week: Math.floor(Date.now() / 1000) - (51 - i) * 604800,
		}));

		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(weeks));

		const result = await fetchCommitActivity("owner", "repo", "ghp_test", "30d");
		expect(result).toBe(40);
	});

	it("24h returns today's commit count from latest week", async () => {
		// Build weeks so the latest week starts at the beginning of the current week
		const now = new Date();
		const dayOfWeek = now.getUTCDay(); // Sunday = 0
		const weekStartMs = now.getTime() - dayOfWeek * 86400000;
		const weekStartSec = Math.floor(weekStartMs / 1000);

		const dailyCounts = [10, 20, 30, 40, 50, 60, 70];
		const weeks = Array.from({ length: 52 }, (_, i) => ({
			total: i === 51 ? 280 : 5,
			days: i === 51 ? dailyCounts : [1, 0, 1, 1, 0, 1, 1],
			week: i === 51 ? weekStartSec : weekStartSec - (51 - i) * 604800,
		}));

		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(weeks));

		const result = await fetchCommitActivity("owner", "repo", "ghp_test", "24h");
		expect(result).toBe(dailyCounts[dayOfWeek]);
	});

	it("returns 0 on empty array", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

		const result = await fetchCommitActivity("owner", "repo", "ghp_test");
		expect(result).toBe(0);
	});

	it("throws GitHubApiError on 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Bad credentials" },
			401,
		));

		await expect(fetchCommitActivity("owner", "repo", "bad_token")).rejects.toThrow(GitHubApiError);
		await expect(fetchCommitActivity("owner", "repo", "bad_token")).rejects.toThrow(/Invalid or expired/);
	});
});

// ──────────────────────────────────────────────
// fetchBranchComparison
// ──────────────────────────────────────────────

describe("fetchBranchComparison", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns comparison data on success", async () => {
		const data = {
			ahead_by: 3,
			behind_by: 1,
			total_commits: 4,
			html_url: "https://github.com/owner/repo/compare/main...develop",
			status: "ahead",
		};
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

		const result = await fetchBranchComparison("owner", "repo", "main", "develop", "ghp_test");
		expect(result).toEqual({
			ahead_by: 3,
			behind_by: 1,
			total_commits: 4,
			html_url: "https://github.com/owner/repo/compare/main...develop",
			status: "ahead",
		});
	});

	it("URL contains base...head pattern", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({
			ahead_by: 0,
			behind_by: 0,
			total_commits: 0,
			html_url: "",
			status: "identical",
		}));

		await fetchBranchComparison("owner", "repo", "main", "develop", "ghp_test");

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		expect(url).toContain("main...develop");
	});

	it("missing fields default to 0 or identical", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}));

		const result = await fetchBranchComparison("owner", "repo", "main", "develop", "ghp_test");
		expect(result.ahead_by).toBe(0);
		expect(result.behind_by).toBe(0);
		expect(result.total_commits).toBe(0);
		expect(result.status).toBe("identical");
	});

	it("throws GitHubApiError on 404", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Not Found" },
			404,
		));

		await expect(fetchBranchComparison("owner", "repo", "main", "nonexistent", "ghp_test")).rejects.toThrow(GitHubApiError);
		await expect(fetchBranchComparison("owner", "repo", "main", "nonexistent", "ghp_test")).rejects.toThrow(/not found/);
	});

	it("throws GitHubApiError on 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Bad credentials" },
			401,
		));

		await expect(fetchBranchComparison("owner", "repo", "main", "develop", "bad_token")).rejects.toThrow(GitHubApiError);
		await expect(fetchBranchComparison("owner", "repo", "main", "develop", "bad_token")).rejects.toThrow(/Invalid or expired/);
	});
});

// ──────────────────────────────────────────────
// fetchLatestRelease
// ──────────────────────────────────────────────

describe("fetchLatestRelease", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns release info on success", async () => {
		const data = {
			tag_name: "v1.2.0",
			name: "Version 1.2.0",
			html_url: "https://github.com/owner/repo/releases/tag/v1.2.0",
			published_at: "2024-01-15T10:00:00Z",
			prerelease: false,
			draft: false,
		};
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

		const result = await fetchLatestRelease("owner", "repo", "ghp_test");
		expect(result).toEqual({
			tag_name: "v1.2.0",
			name: "Version 1.2.0",
			html_url: "https://github.com/owner/repo/releases/tag/v1.2.0",
			published_at: "2024-01-15T10:00:00Z",
			prerelease: false,
			draft: false,
		});
	});

	it("returns null on 404 (no releases)", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Not Found" },
			404,
		));

		const result = await fetchLatestRelease("owner", "repo", "ghp_test");
		expect(result).toBeNull();
	});

	it("includePreReleases=true uses /releases?per_page=1", async () => {
		const data = [{
			tag_name: "v2.0.0-beta.1",
			name: "Beta Release",
			html_url: "https://github.com/owner/repo/releases/tag/v2.0.0-beta.1",
			published_at: "2024-02-01T10:00:00Z",
			prerelease: true,
			draft: false,
		}];
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

		const result = await fetchLatestRelease("owner", "repo", "ghp_test", true);

		const url = vi.mocked(globalThis.fetch).mock.calls[0][0] as string;
		expect(url).toContain("/releases?per_page=1");
		expect(url).not.toContain("/releases/latest");
		expect(result).toEqual({
			tag_name: "v2.0.0-beta.1",
			name: "Beta Release",
			html_url: "https://github.com/owner/repo/releases/tag/v2.0.0-beta.1",
			published_at: "2024-02-01T10:00:00Z",
			prerelease: true,
			draft: false,
		});
	});

	it("includePreReleases=true returns null on empty array", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse([]));

		const result = await fetchLatestRelease("owner", "repo", "ghp_test", true);
		expect(result).toBeNull();
	});

	it("throws GitHubApiError on 401", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(
			{ message: "Bad credentials" },
			401,
		));

		await expect(fetchLatestRelease("owner", "repo", "bad_token")).rejects.toThrow(GitHubApiError);
		await expect(fetchLatestRelease("owner", "repo", "bad_token")).rejects.toThrow(/Invalid or expired/);
	});

	it("missing fields default to empty string or false", async () => {
		vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse({}));

		const result = await fetchLatestRelease("owner", "repo", "ghp_test");
		expect(result).not.toBeNull();
		expect(result!.tag_name).toBe("");
		expect(result!.name).toBe("");
		expect(result!.html_url).toBe("");
		expect(result!.published_at).toBe("");
		expect(result!.prerelease).toBe(false);
		expect(result!.draft).toBe(false);
	});

	// ── fetchWithTimeout (network resilience) ──────

	describe("fetchWithTimeout network resilience", () => {
		it("converts network failure (TypeError) to GitHubApiError with status 0", async () => {
			vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));

			try {
				await fetchRepoStats("owner", "repo", "ghp_test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				const apiErr = err as InstanceType<typeof GitHubApiError>;
				expect(apiErr.status).toBe(0);
				expect(apiErr.message).toContain("Network error");
				expect(apiErr.message).toContain("fetch failed");
				expect(apiErr.message).toContain("fetchRepoStats");
			}
		});

		it("converts AbortError (timeout) to GitHubApiError with 'timed out' message", async () => {
			const abortError = new DOMException("The operation was aborted", "AbortError");
			vi.mocked(globalThis.fetch).mockRejectedValue(abortError);

			try {
				await fetchRepoStats("owner", "repo", "ghp_test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				const apiErr = err as InstanceType<typeof GitHubApiError>;
				expect(apiErr.status).toBe(0);
				expect(apiErr.message).toContain("timed out");
				expect(apiErr.message).toContain("30s");
				expect(apiErr.message).toContain("fetchRepoStats");
			}
		});

		it("converts non-Error throw to GitHubApiError with 'unknown' message", async () => {
			vi.mocked(globalThis.fetch).mockRejectedValue("string error");

			try {
				await fetchRepoStats("owner", "repo", "ghp_test");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GitHubApiError);
				const apiErr = err as InstanceType<typeof GitHubApiError>;
				expect(apiErr.status).toBe(0);
				expect(apiErr.message).toContain("Network error");
				expect(apiErr.message).toContain("unknown");
			}
		});
	});
});
