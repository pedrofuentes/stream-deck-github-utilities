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
	type ContributionCalendar,
} from "../../src/utils/github-graphql";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mockGraphQLResponse(data: unknown, errors?: Array<{ message: string }>) {
	return {
		ok: true,
		status: 200,
		json: () => Promise.resolve({ data, errors }),
	} as unknown as Response;
}

function mockHttpError(status: number) {
	return {
		ok: false,
		status,
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
});
