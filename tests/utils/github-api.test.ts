/**
 * Tests for the GitHub API client (src/utils/github-api.ts).
 *
 * Uses vi.fn() to mock the global fetch function so no real HTTP calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	fetchRepoStats,
	getStatValue,
	getStatLabel,
	parseRateLimitHeaders,
	GitHubApiError,
	type RepoStats,
	type StatType,
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
			const data = mockRepoResponse();
			vi.mocked(globalThis.fetch).mockResolvedValue(mockFetchResponse(data));

			const result = await fetchRepoStats("facebook", "react");

			expect(result.stargazers_count).toBe(42000);
			expect(result.forks_count).toBe(8500);
			expect(result.full_name).toBe("facebook/react");

			// Verify correct URL was called
			const callArgs = vi.mocked(globalThis.fetch).mock.calls[0];
			expect(callArgs[0]).toBe("https://api.github.com/repos/facebook/react");

			// Verify no Authorization header when no token
			const headers = callArgs[1]?.headers as Record<string, string>;
			expect(headers["Authorization"]).toBeUndefined();
		});

		it("fetches repo stats with a PAT token", async () => {
			const data = mockRepoResponse();
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
				mockFetchResponse(mockRepoResponse({ full_name: "my-org/my repo" })),
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
	});

	// ── getStatLabel ────────────────────────────

	describe("getStatLabel", () => {
		it.each([
			["stars", "Stars"],
			["issues", "Issues"],
			["forks", "Forks"],
			["watchers", "Watchers"],
		] as [StatType, string][])("returns '%s' -> '%s'", (type, expected) => {
			expect(getStatLabel(type)).toBe(expected);
		});
	});
});
