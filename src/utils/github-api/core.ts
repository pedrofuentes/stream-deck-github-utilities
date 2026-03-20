/**
 * GitHub API infrastructure: HTTP helpers, error handling, and shared types.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/** Rate limit information from response headers */
export interface RateLimitInfo {
	limit: number;
	remaining: number;
	reset: Date;
	used: number;
}

/** Structured error from the GitHub API */
export class GitHubApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly rateLimitInfo?: RateLimitInfo,
		/** Seconds to wait before retrying (from Retry-After header or rate limit reset). */
		public readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "GitHubApiError";
	}
}

export const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";

/**
 * Extracts rate limit information from GitHub API response headers.
 */
export function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
	return {
		limit: parseInt(headers.get("x-ratelimit-limit") ?? "0", 10),
		remaining: parseInt(headers.get("x-ratelimit-remaining") ?? "0", 10),
		reset: new Date(parseInt(headers.get("x-ratelimit-reset") ?? "0", 10) * 1000),
		used: parseInt(headers.get("x-ratelimit-used") ?? "0", 10),
	};
}

/**
 * Builds the standard headers for GitHub API requests.
 */
export function buildHeaders(token?: string): Record<string, string> {
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": GITHUB_API_VERSION,
		"User-Agent": "stream-deck-github-utilities/1.0",
	};

	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	return headers;
}

/**
 * Fetch with timeout and network error handling.
 * Wraps fetch() with a 30-second AbortSignal timeout and converts
 * network errors into GitHubApiError with context.
 */
export async function fetchWithTimeout(url: string, options: RequestInit = {}, context?: string): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 30000);
	try {
		const response = await fetch(url, { ...options, signal: controller.signal });
		return response;
	} catch (err) {
		if (err instanceof Error && err.name === "AbortError") {
			throw new GitHubApiError(
				`Request timed out after 30s${context ? ` (${context})` : ""}`,
				0,
			);
		}
		throw new GitHubApiError(
			`Network error: ${err instanceof Error ? err.message : "unknown"}${context ? ` (${context})` : ""}`,
			0,
		);
	} finally {
		clearTimeout(timeoutId);
	}
}

/**
 * Parses the Retry-After header value into seconds.
 * Supports both delay-seconds (integer) and HTTP-date formats.
 *
 * @param headers - Response headers
 * @returns Seconds to wait, or undefined if header is missing/invalid
 */
export function parseRetryAfter(headers: Headers): number | undefined {
	const raw = headers.get("retry-after");
	if (!raw) return undefined;

	// Try as integer seconds first
	const seconds = parseInt(raw, 10);
	if (!isNaN(seconds) && seconds >= 0) return seconds;

	// Try as HTTP-date
	const date = new Date(raw);
	if (!isNaN(date.getTime())) {
		const delta = Math.ceil((date.getTime() - Date.now()) / 1000);
		return Math.max(delta, 0);
	}

	return undefined;
}

/**
 * Centralized error handler for GitHub API responses.
 * @throws {GitHubApiError} always
 */
export function handleApiError(status: number, rateLimitInfo: RateLimitInfo, owner: string, repo: string, retryAfterSeconds?: number): never {
	if (status === 401) {
		throw new GitHubApiError("Invalid or expired GitHub token", status, rateLimitInfo);
	}

	if (status === 429) {
		const waitSec = retryAfterSeconds ?? Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 60);
		throw new GitHubApiError(
			`GitHub API rate limit exceeded (429). Retry after ${waitSec}s`,
			status,
			rateLimitInfo,
			waitSec,
		);
	}

	if (status === 403 && rateLimitInfo.remaining === 0) {
		const resetTime = rateLimitInfo.reset.toLocaleTimeString();
		const waitSec = Math.max(Math.ceil((rateLimitInfo.reset.getTime() - Date.now()) / 1000), 0);
		throw new GitHubApiError(
			`GitHub API rate limit exceeded. Resets at ${resetTime}`,
			status,
			rateLimitInfo,
			waitSec > 0 ? waitSec : undefined,
		);
	}

	if (status === 403) {
		throw new GitHubApiError("Access denied. Check token permissions.", status, rateLimitInfo);
	}

	if (status === 404) {
		throw new GitHubApiError(
			`Repository "${owner}/${repo}" not found or is private`,
			status,
			rateLimitInfo,
		);
	}

	throw new GitHubApiError(`GitHub API error (${status})`, status, rateLimitInfo);
}
