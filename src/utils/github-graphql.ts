/**
 * GitHub GraphQL API client.
 *
 * Provides a generic query executor for GitHub's GraphQL API plus
 * specialised helpers like the contribution calendar fetcher.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { GraphQLError, GraphQLRateLimit } from "../types";

/** GitHub GraphQL API endpoint */
export const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";

// ─── Generic Query Types ─────────────────────────────────────────────

/** Result wrapper returned by {@link executeGraphQLQuery} */
export interface GraphQLQueryResult<T> {
	data: T;
	rateLimit?: GraphQLRateLimit;
}

/** Structured error thrown by {@link executeGraphQLQuery} */
export class GraphQLQueryError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly graphqlErrors?: GraphQLError[],
		public readonly rateLimit?: GraphQLRateLimit,
	) {
		super(message);
		this.name = "GraphQLQueryError";
	}
}

// ─── Generic Query Executor ──────────────────────────────────────────

/**
 * Parses rate-limit info from GitHub response headers.
 * Returns `undefined` when the headers are absent or unparseable.
 */
function parseRateLimitHeaders(headers: Headers): GraphQLRateLimit | undefined {
	const limit = headers.get("x-ratelimit-limit");
	const remaining = headers.get("x-ratelimit-remaining");
	const reset = headers.get("x-ratelimit-reset");
	const used = headers.get("x-ratelimit-used");

	if (!limit || !remaining || !reset) return undefined;

	return {
		limit: Number(limit),
		remaining: Number(remaining),
		resetAt: new Date(Number(reset) * 1000),
		cost: used ? Number(used) : 0,
		nodeCount: 0,
	};
}

/**
 * Executes an arbitrary GraphQL query against GitHub's API.
 *
 * @param token - GitHub PAT (Bearer auth)
 * @param query - The GraphQL query string
 * @param variables - Optional variables for the query
 * @returns The parsed response data
 * @throws {GraphQLQueryError} on HTTP errors, GraphQL errors, or rate limiting
 */
export async function executeGraphQLQuery<T>(
	token: string,
	query: string,
	variables?: Record<string, unknown>,
): Promise<GraphQLQueryResult<T>> {
	const body: Record<string, unknown> = { query };
	if (variables) {
		body.variables = variables;
	}

	let response: Response;
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30000);
		try {
			response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeoutId);
		}
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new GraphQLQueryError("GraphQL request timed out after 30s", 0);
		}
		throw new GraphQLQueryError(
			`Network error: ${err instanceof Error ? err.message : "unknown"}`,
			0,
		);
	}

	const rateLimit = parseRateLimitHeaders(response.headers);

	if (!response.ok) {
		throw new GraphQLQueryError(
			`GraphQL request failed: ${response.status}`,
			response.status,
			undefined,
			rateLimit,
		);
	}

	const json = await response.json() as {
		data?: T;
		errors?: GraphQLError[];
	};

	if (json.errors && json.errors.length > 0) {
		const isRateLimited = json.errors.some((e) => e.type === "RATE_LIMITED");
		throw new GraphQLQueryError(
			isRateLimited
				? `GraphQL rate limited: ${json.errors[0].message}`
				: `GraphQL error: ${json.errors[0].message}`,
			isRateLimited ? 429 : 200,
			json.errors,
			rateLimit,
		);
	}

	if (!json.data) {
		throw new GraphQLQueryError("No data returned", 200, undefined, rateLimit);
	}

	return { data: json.data, rateLimit };
}

// ─── Contribution Calendar ───────────────────────────────────────────

/** A single day's contribution data */
export interface ContributionDay {
	date: string;
	contributionCount: number;
}

/** A week of contribution data */
export interface ContributionWeek {
	contributionDays: ContributionDay[];
}

/** The full contribution calendar response */
export interface ContributionCalendar {
	totalContributions: number;
	weeks: ContributionWeek[];
}

/** Shape of the GraphQL response for contribution calendar queries */
interface ContributionCalendarResponse {
	user?: { contributionsCollection: { contributionCalendar: ContributionCalendar } };
	viewer?: { contributionsCollection: { contributionCalendar: ContributionCalendar } };
}

/**
 * Fetches the authenticated user's contribution calendar via GraphQL.
 * Returns the profile-style contribution data (all repos, all types).
 *
 * @param token - GitHub PAT (must have user scope for private contributions)
 * @param username - GitHub username (optional — if omitted, fetches for the token owner via `viewer`)
 * @returns The contribution calendar with weekly/daily breakdown
 */
export async function fetchContributionCalendar(
	token: string,
	username?: string,
): Promise<ContributionCalendar> {
	const query = username
		? `query { user(login: "${username}") { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`
		: `query { viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }`;

	const result = await executeGraphQLQuery<ContributionCalendarResponse>(token, query);

	const calendar = result.data.user?.contributionsCollection?.contributionCalendar
		?? result.data.viewer?.contributionsCollection?.contributionCalendar;

	if (!calendar) {
		throw new Error("No contribution data returned");
	}

	return calendar;
}

/**
 * Converts GraphQL contribution calendar to the number[][] format
 * used by renderHeatmapStrip (each inner array = 7 days Mon-Sun).
 */
export function calendarToWeeklyData(calendar: ContributionCalendar): number[][] {
	return calendar.weeks.map((week) => {
		// GraphQL returns Sun-Sat order, reorder to Mon-Sun
		const days = week.contributionDays.map((d) => d.contributionCount);
		return [...days.slice(1), days[0]];
	});
}
