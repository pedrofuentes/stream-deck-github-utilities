/**
 * Tests for the GitHub GraphQL API client (src/utils/github-graphql.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	fetchContributionCalendar,
	calendarToWeeklyData,
	executeGraphQLQuery,
	GraphQLQueryError,
	GITHUB_GRAPHQL_ENDPOINT,
	type ContributionCalendar,
} from "../../src/utils/github-graphql";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockGraphQLResponse(data: unknown, errors?: Array<{ message: string; type?: string }>) {
	return {
		ok: true,
		status: 200,
		headers: new Headers(),
		json: () => Promise.resolve({ data, errors }),
	} as unknown as Response;
}

function mockHttpError(status: number) {
	return {
		ok: false,
		status,
		headers: new Headers(),
		json: () => Promise.resolve({}),
	} as unknown as Response;
}

/** Mock response with rate-limit headers */
function mockResponseWithRateLimit(data: unknown, headers?: Record<string, string>) {
	const h = new Headers(headers);
	return {
		ok: true,
		status: 200,
		headers: h,
		json: () => Promise.resolve({ data }),
	} as unknown as Response;
}

/** Mock HTTP error with rate-limit headers */
function mockHttpErrorWithRateLimit(status: number, headers?: Record<string, string>) {
	const h = new Headers(headers);
	return {
		ok: false,
		status,
		headers: h,
		json: () => Promise.resolve({}),
	} as unknown as Response;
}

/** Sample contribution calendar with 2 weeks of data */
function sampleCalendar(): ContributionCalendar {
	return {
		totalContributions: 42,
		weeks: [
			{
				contributionDays: [
					{ date: "2024-01-07", contributionCount: 0 }, // Sun
					{ date: "2024-01-08", contributionCount: 3 }, // Mon
					{ date: "2024-01-09", contributionCount: 5 }, // Tue
					{ date: "2024-01-10", contributionCount: 2 }, // Wed
					{ date: "2024-01-11", contributionCount: 7 }, // Thu
					{ date: "2024-01-12", contributionCount: 1 }, // Fri
					{ date: "2024-01-13", contributionCount: 4 }, // Sat
				],
			},
			{
				contributionDays: [
					{ date: "2024-01-14", contributionCount: 2 }, // Sun
					{ date: "2024-01-15", contributionCount: 0 }, // Mon
					{ date: "2024-01-16", contributionCount: 6 }, // Tue
					{ date: "2024-01-17", contributionCount: 1 }, // Wed
					{ date: "2024-01-18", contributionCount: 3 }, // Thu
					{ date: "2024-01-19", contributionCount: 8 }, // Fri
					{ date: "2024-01-20", contributionCount: 0 }, // Sat
				],
			},
		],
	};
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe("github-graphql", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	describe("fetchContributionCalendar", () => {
		it("fetches viewer calendar when no username is provided", async () => {
			const calendar = sampleCalendar();
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({ viewer: { contributionsCollection: { contributionCalendar: calendar } } }),
			);

			const result = await fetchContributionCalendar("ghp_test123");

			expect(result.totalContributions).toBe(42);
			expect(result.weeks).toHaveLength(2);

			// Verify the request used the viewer query
			const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
			expect(url).toBe("https://api.github.com/graphql");
			const body = JSON.parse((options as RequestInit).body as string);
			expect(body.query).toContain("viewer");
			expect(body.query).not.toContain("user(login:");
		});

		it("fetches user calendar when username is provided", async () => {
			const calendar = sampleCalendar();
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({ user: { contributionsCollection: { contributionCalendar: calendar } } }),
			);

			const result = await fetchContributionCalendar("ghp_test123", "octocat");

			expect(result.totalContributions).toBe(42);

			// Verify the request used the user(login:) query
			const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
			const body = JSON.parse((options as RequestInit).body as string);
			expect(body.query).toContain('user(login: "octocat")');
		});

		it("sends correct authorization header", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({ viewer: { contributionsCollection: { contributionCalendar: sampleCalendar() } } }),
			);

			await fetchContributionCalendar("ghp_mytoken");

			const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
			expect((options as RequestInit).headers).toEqual(
				expect.objectContaining({ Authorization: "Bearer ghp_mytoken" }),
			);
		});

		it("throws on HTTP error", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockHttpError(401));

			await expect(fetchContributionCalendar("bad_token")).rejects.toThrow("GraphQL request failed: 401");
		});

		it("throws GraphQLQueryError (not generic Error) on HTTP failure", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockHttpError(401));

			await expect(fetchContributionCalendar("bad_token"))
				.rejects.toBeInstanceOf(GraphQLQueryError);
		});

		it("throws on HTTP 500 error", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockHttpError(500));

			await expect(fetchContributionCalendar("ghp_test")).rejects.toThrow("GraphQL request failed: 500");
		});

		it("throws on GraphQL errors", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse(null, [{ message: "Could not resolve to a User" }]),
			);

			await expect(fetchContributionCalendar("ghp_test", "nonexistent"))
				.rejects.toThrow("GraphQL error: Could not resolve to a User");
		});

		it("preserves GraphQLQueryError type and structured info on GraphQL errors", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse(null, [{ message: "Could not resolve to a User" }]),
			);

			const err = await fetchContributionCalendar("ghp_test", "nonexistent").catch((e) => e);
			expect(err).toBeInstanceOf(GraphQLQueryError);
			expect(err.graphqlErrors).toBeDefined();
			expect(err.graphqlErrors).toHaveLength(1);
		});

		it("throws on missing contribution data", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({ viewer: null }),
			);

			await expect(fetchContributionCalendar("ghp_test"))
				.rejects.toThrow("No contribution data returned");
		});

		it("throws when data is completely empty", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({}),
			);

			await expect(fetchContributionCalendar("ghp_test"))
				.rejects.toThrow("No contribution data returned");
		});

		it("handles calendar with zero contributions", async () => {
			const emptyCalendar: ContributionCalendar = {
				totalContributions: 0,
				weeks: [
					{
						contributionDays: [
							{ date: "2024-01-07", contributionCount: 0 },
							{ date: "2024-01-08", contributionCount: 0 },
							{ date: "2024-01-09", contributionCount: 0 },
							{ date: "2024-01-10", contributionCount: 0 },
							{ date: "2024-01-11", contributionCount: 0 },
							{ date: "2024-01-12", contributionCount: 0 },
							{ date: "2024-01-13", contributionCount: 0 },
						],
					},
				],
			};

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({ viewer: { contributionsCollection: { contributionCalendar: emptyCalendar } } }),
			);

			const result = await fetchContributionCalendar("ghp_test");
			expect(result.totalContributions).toBe(0);
			expect(result.weeks).toHaveLength(1);
		});

		it("prefers user data over viewer when both present", async () => {
			const userCalendar = { ...sampleCalendar(), totalContributions: 99 };
			const viewerCalendar = { ...sampleCalendar(), totalContributions: 11 };

			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse({
					user: { contributionsCollection: { contributionCalendar: userCalendar } },
					viewer: { contributionsCollection: { contributionCalendar: viewerCalendar } },
				}),
			);

			const result = await fetchContributionCalendar("ghp_test", "octocat");
			expect(result.totalContributions).toBe(99);
		});
	});

	describe("calendarToWeeklyData", () => {
		it("converts calendar to number[][] format", () => {
			const calendar = sampleCalendar();
			const result = calendarToWeeklyData(calendar);

			expect(result).toHaveLength(2);
			expect(result[0]).toHaveLength(7);
			expect(result[1]).toHaveLength(7);
		});

		it("reorders days from Sun-Sat to Mon-Sun", () => {
			const calendar: ContributionCalendar = {
				totalContributions: 10,
				weeks: [
					{
						contributionDays: [
							{ date: "2024-01-07", contributionCount: 0 }, // Sun → goes to end
							{ date: "2024-01-08", contributionCount: 1 }, // Mon → index 0
							{ date: "2024-01-09", contributionCount: 2 }, // Tue → index 1
							{ date: "2024-01-10", contributionCount: 3 }, // Wed → index 2
							{ date: "2024-01-11", contributionCount: 4 }, // Thu → index 3
							{ date: "2024-01-12", contributionCount: 5 }, // Fri → index 4
							{ date: "2024-01-13", contributionCount: 6 }, // Sat → index 5
						],
					},
				],
			};

			const result = calendarToWeeklyData(calendar);
			// Mon-Sun: [1, 2, 3, 4, 5, 6, 0]
			expect(result[0]).toEqual([1, 2, 3, 4, 5, 6, 0]);
		});

		it("handles empty calendar", () => {
			const calendar: ContributionCalendar = {
				totalContributions: 0,
				weeks: [],
			};

			const result = calendarToWeeklyData(calendar);
			expect(result).toEqual([]);
		});

		it("handles a partial week (fewer than 7 days)", () => {
			const calendar: ContributionCalendar = {
				totalContributions: 6,
				weeks: [
					{
						contributionDays: [
							{ date: "2024-01-07", contributionCount: 1 }, // Sun
							{ date: "2024-01-08", contributionCount: 2 }, // Mon
							{ date: "2024-01-09", contributionCount: 3 }, // Tue
						],
					},
				],
			};

			const result = calendarToWeeklyData(calendar);
			// After reorder: [Mon=2, Tue=3, Sun=1]
			expect(result[0]).toEqual([2, 3, 1]);
		});

		it("preserves contribution counts accurately", () => {
			const calendar = sampleCalendar();
			const result = calendarToWeeklyData(calendar);

			// Week 1 input: [Sun=0, Mon=3, Tue=5, Wed=2, Thu=7, Fri=1, Sat=4]
			// Expected Mon-Sun: [3, 5, 2, 7, 1, 4, 0]
			expect(result[0]).toEqual([3, 5, 2, 7, 1, 4, 0]);

			// Week 2 input: [Sun=2, Mon=0, Tue=6, Wed=1, Thu=3, Fri=8, Sat=0]
			// Expected Mon-Sun: [0, 6, 1, 3, 8, 0, 2]
			expect(result[1]).toEqual([0, 6, 1, 3, 8, 0, 2]);
		});

		it("handles many weeks (52-week calendar)", () => {
			const weeks = Array.from({ length: 52 }, (_, i) => ({
				contributionDays: Array.from({ length: 7 }, (_, d) => ({
					date: `2024-${String(Math.floor((i * 7 + d) / 30) + 1).padStart(2, "0")}-${String(((i * 7 + d) % 30) + 1).padStart(2, "0")}`,
					contributionCount: (i + d) % 10,
				})),
			}));

			const calendar: ContributionCalendar = {
				totalContributions: weeks.reduce(
					(sum, w) => sum + w.contributionDays.reduce((s, d) => s + d.contributionCount, 0),
					0,
				),
				weeks,
			};

			const result = calendarToWeeklyData(calendar);
			expect(result).toHaveLength(52);
			result.forEach((week) => expect(week).toHaveLength(7));
		});
	});

	describe("GraphQLQueryError", () => {
		it("has correct name and properties", () => {
			const errors = [{ message: "Bad query", type: "SOME_ERROR" }];
			const rateLimit = { limit: 5000, remaining: 4999, resetAt: new Date(), cost: 1, nodeCount: 0 };
			const err = new GraphQLQueryError("test error", 422, errors, rateLimit);

			expect(err.name).toBe("GraphQLQueryError");
			expect(err.message).toBe("test error");
			expect(err.status).toBe(422);
			expect(err.graphqlErrors).toBe(errors);
			expect(err.rateLimit).toBe(rateLimit);
			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(GraphQLQueryError);
		});

		it("works without optional properties", () => {
			const err = new GraphQLQueryError("minimal", 500);

			expect(err.name).toBe("GraphQLQueryError");
			expect(err.status).toBe(500);
			expect(err.graphqlErrors).toBeUndefined();
			expect(err.rateLimit).toBeUndefined();
		});
	});

	describe("executeGraphQLQuery", () => {
		it("returns data on successful response", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockResponseWithRateLimit({ repository: { stargazerCount: 100 } }),
			);

			const result = await executeGraphQLQuery<{ repository: { stargazerCount: number } }>(
				"ghp_token",
				"query { repository(owner: \"a\", name: \"b\") { stargazerCount } }",
			);

			expect(result.data.repository.stargazerCount).toBe(100);
		});

		it("sends query and variables correctly", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockResponseWithRateLimit({ viewer: { login: "octocat" } }),
			);

			await executeGraphQLQuery(
				"ghp_token",
				"query($login: String!) { user(login: $login) { id } }",
				{ login: "octocat" },
			);

			const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
			expect(url).toBe(GITHUB_GRAPHQL_ENDPOINT);
			const body = JSON.parse((options as RequestInit).body as string);
			expect(body.query).toContain("$login");
			expect(body.variables).toEqual({ login: "octocat" });
		});

		it("omits variables key when not provided", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockResponseWithRateLimit({ viewer: { login: "test" } }),
			);

			await executeGraphQLQuery("ghp_token", "query { viewer { login } }");

			const [, options] = vi.mocked(globalThis.fetch).mock.calls[0];
			const body = JSON.parse((options as RequestInit).body as string);
			expect(body).not.toHaveProperty("variables");
		});

		it("throws GraphQLQueryError on HTTP error", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(mockHttpErrorWithRateLimit(401));

			await expect(executeGraphQLQuery("bad_token", "query { viewer { login } }"))
				.rejects.toThrow(GraphQLQueryError);

			try {
				await executeGraphQLQuery("bad_token", "query { viewer { login } }");
			} catch (err) {
				expect(err).toBeInstanceOf(GraphQLQueryError);
				expect((err as GraphQLQueryError).status).toBe(401);
				expect((err as GraphQLQueryError).message).toContain("401");
			}
		});

		it("throws GraphQLQueryError with errors array on GraphQL errors", async () => {
			const graphqlErrors = [{ message: "Field 'x' not found", type: "FIELD_ERROR", path: ["query", "x"] }];
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse(null, graphqlErrors),
			);

			try {
				await executeGraphQLQuery("ghp_token", "query { x }");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GraphQLQueryError);
				const gqlErr = err as GraphQLQueryError;
				expect(gqlErr.message).toContain("Field 'x' not found");
				expect(gqlErr.graphqlErrors).toHaveLength(1);
				expect(gqlErr.graphqlErrors![0].type).toBe("FIELD_ERROR");
				expect(gqlErr.status).toBe(200);
			}
		});

		it("detects rate-limited GraphQL errors and sets status 429", async () => {
			const rateLimitErrors = [{ message: "API rate limit exceeded", type: "RATE_LIMITED" }];
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockGraphQLResponse(null, rateLimitErrors),
			);

			try {
				await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
				expect.unreachable("should have thrown");
			} catch (err) {
				const gqlErr = err as GraphQLQueryError;
				expect(gqlErr.status).toBe(429);
				expect(gqlErr.message).toContain("rate limited");
			}
		});

		it("parses rate limit headers into GraphQLRateLimit", async () => {
			const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockResponseWithRateLimit(
					{ viewer: { login: "test" } },
					{
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4950",
						"x-ratelimit-reset": String(resetTimestamp),
						"x-ratelimit-used": "50",
					},
				),
			);

			const result = await executeGraphQLQuery("ghp_token", "query { viewer { login } }");

			expect(result.rateLimit).toBeDefined();
			expect(result.rateLimit!.limit).toBe(5000);
			expect(result.rateLimit!.remaining).toBe(4950);
			expect(result.rateLimit!.cost).toBe(50);
			expect(result.rateLimit!.resetAt).toBeInstanceOf(Date);
			expect(result.rateLimit!.resetAt.getTime()).toBe(resetTimestamp * 1000);
		});

		it("returns undefined rateLimit when headers are missing", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockResponseWithRateLimit({ viewer: { login: "test" } }),
			);

			const result = await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
			expect(result.rateLimit).toBeUndefined();
		});

		it("throws on missing data field", async () => {
			vi.mocked(globalThis.fetch).mockResolvedValue({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: () => Promise.resolve({}),
			} as unknown as Response);

			await expect(executeGraphQLQuery("ghp_token", "query { viewer { login } }"))
				.rejects.toThrow("No data returned");

			try {
				await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
			} catch (err) {
				expect(err).toBeInstanceOf(GraphQLQueryError);
				expect((err as GraphQLQueryError).status).toBe(200);
			}
		});

		it("includes rate limit in error on HTTP failure with headers", async () => {
			const resetTimestamp = Math.floor(Date.now() / 1000) + 60;
			vi.mocked(globalThis.fetch).mockResolvedValue(
				mockHttpErrorWithRateLimit(403, {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": String(resetTimestamp),
					"x-ratelimit-used": "5000",
				}),
			);

			try {
				await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
				expect.unreachable("should have thrown");
			} catch (err) {
				const gqlErr = err as GraphQLQueryError;
				expect(gqlErr.status).toBe(403);
				expect(gqlErr.rateLimit).toBeDefined();
				expect(gqlErr.rateLimit!.remaining).toBe(0);
			}
		});

		it("converts network failure to GraphQLQueryError with status 0", async () => {
			vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError("fetch failed"));

			try {
				await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GraphQLQueryError);
				const gqlErr = err as GraphQLQueryError;
				expect(gqlErr.status).toBe(0);
				expect(gqlErr.message).toContain("Network error");
				expect(gqlErr.message).toContain("fetch failed");
			}
		});

		it("converts timeout (AbortError) to GraphQLQueryError with 'timed out' message", async () => {
			const abortError = new DOMException("The operation was aborted", "AbortError");
			vi.mocked(globalThis.fetch).mockRejectedValue(abortError);

			try {
				await executeGraphQLQuery("ghp_token", "query { viewer { login } }");
				expect.unreachable("should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(GraphQLQueryError);
				const gqlErr = err as GraphQLQueryError;
				expect(gqlErr.status).toBe(0);
				expect(gqlErr.message).toContain("timed out");
				expect(gqlErr.message).toContain("30s");
			}
		});
	});
});
