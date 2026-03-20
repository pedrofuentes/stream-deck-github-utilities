/**
 * Integration tests: HTTP error → GitHubErrorCode → error label → SVG
 *
 * Verifies the complete error classification pipeline from HTTP status codes
 * through error codes, user-facing labels, and rendered error SVG images.
 */

import { describe, it, expect, vi } from "vitest";
import {
	GitHubApiError,
	GitHubErrorCode,
	classifyErrorLabel,
} from "../../src/utils/github-api";
import { renderErrorImage } from "../../src/utils/button-renderer";
import { decodeSvg } from "./fixtures";

// Mock @elgato/streamdeck (button-renderer may import it indirectly)
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

describe("Error flow: HTTP status → error code → label → image", () => {
	it.each([
		[401, GitHubErrorCode.AUTH_ERROR, "Auth Error"],
		[403, GitHubErrorCode.ACCESS_DENIED, "No Access"],
		[403, GitHubErrorCode.RATE_LIMITED, "Rate Limited"],
		[404, GitHubErrorCode.NOT_FOUND, "Not Found"],
		[429, GitHubErrorCode.RATE_LIMITED, "Rate Limited"],
		[500, GitHubErrorCode.SERVER_ERROR, "Server Error"],
		[502, GitHubErrorCode.SERVER_ERROR, "Server Error"],
		[0, GitHubErrorCode.NETWORK_ERROR, "Network Error"],
		[0, GitHubErrorCode.TIMEOUT, "Timeout"],
	])("HTTP %d with code %s → label '%s' → valid SVG", (status, code, expectedLabel) => {
		// Step 1: Create a structured GitHubApiError
		const error = new GitHubApiError(`Test error ${status}`, status, undefined, undefined, code);

		// Step 2: Classify to user-facing label
		const label = classifyErrorLabel(error);
		expect(label).toBe(expectedLabel);

		// Step 3: Render error image with that label
		const svg = renderErrorImage(label);
		expect(svg).toMatch(/^data:image\/svg\+xml,/);

		// Step 4: Verify SVG contains the label text (may be truncated by renderer)
		const decoded = decodeSvg(svg);
		// The renderer may truncate long labels with "..", so check prefix
		const truncatedLabel = expectedLabel.length > 12
			? expectedLabel.substring(0, 10)
			: expectedLabel;
		expect(decoded).toContain(truncatedLabel);
		expect(decoded).toContain("Press to retry");
		expect(decoded).toContain("144"); // Canvas size
	});

	it("classifies generic Error (non-GitHubApiError) via message matching", () => {
		const errors: [Error, string][] = [
			[new Error("rate limit exceeded"), "Rate Limited"],
			[new Error("Repository not found (404)"), "Not Found"],
			[new Error("bad credentials 401"), "Auth Error"],
			[new Error("access denied 403"), "No Access"],
			[new Error("Something unexpected"), "Error"],
		];

		for (const [error, expected] of errors) {
			expect(classifyErrorLabel(error)).toBe(expected);
		}
	});

	it("classifies string errors via message matching", () => {
		expect(classifyErrorLabel("rate limit")).toBe("Rate Limited");
		expect(classifyErrorLabel("token invalid")).toBe("Auth Error");
		expect(classifyErrorLabel("unknown error")).toBe("Error");
	});

	it("renders default 'Error' when no message provided", () => {
		const svg = renderErrorImage();
		const decoded = decodeSvg(svg);
		expect(decoded).toContain("Error");
		expect(decoded).toContain("Press to retry");
	});

	it("renders custom error message in SVG", () => {
		const svg = renderErrorImage("Rate Limited");
		const decoded = decodeSvg(svg);
		expect(decoded).toContain("Rate Limited");
	});

	it("all GitHubErrorCode values have valid labels", () => {
		const allCodes = Object.values(GitHubErrorCode);
		for (const code of allCodes) {
			const error = new GitHubApiError("test", 0, undefined, undefined, code);
			const label = classifyErrorLabel(error);
			// Should never return generic "Error" for known codes
			expect(label).not.toBe("Error");
			expect(label.length).toBeGreaterThan(0);
		}
	});

	it("error SVG uses the error color", () => {
		const svg = renderErrorImage("Not Found");
		const decoded = decodeSvg(svg);
		// Error color is #f85149
		expect(decoded).toContain("#f85149");
	});
});
