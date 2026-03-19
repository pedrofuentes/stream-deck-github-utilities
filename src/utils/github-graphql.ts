/**
 * GitHub GraphQL API client for contribution calendar data.
 *
 * Uses the GitHub GraphQL API to fetch the user's contribution calendar,
 * which includes all contribution types (commits, PRs, issues, reviews)
 * across all repositories — the same data shown on the GitHub profile page.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

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

	const response = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({ query }),
	});

	if (!response.ok) {
		throw new Error(`GraphQL request failed: ${response.status}`);
	}

	const json = await response.json() as {
		data?: {
			user?: { contributionsCollection: { contributionCalendar: ContributionCalendar } };
			viewer?: { contributionsCollection: { contributionCalendar: ContributionCalendar } };
		};
		errors?: Array<{ message: string }>;
	};

	if (json.errors && json.errors.length > 0) {
		throw new Error(`GraphQL error: ${json.errors[0].message}`);
	}

	const calendar = json.data?.user?.contributionsCollection?.contributionCalendar
		?? json.data?.viewer?.contributionsCollection?.contributionCalendar;

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
