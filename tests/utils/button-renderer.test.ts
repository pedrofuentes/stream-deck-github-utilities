/**
 * Tests for button-renderer utilities (src/utils/button-renderer.ts).
 *
 * Validates COLORS constants, getWorkflowStatusColor(), escapeXml(),
 * and all SVG rendering functions.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";
import {
	COLORS,
	getWorkflowStatusColor,
	getStatusIcon,
	escapeXml,
	renderKeyImage,
	renderIconKeyImage,
	renderStatImage,
	renderWorkflowImage,
	renderDeployingImage,
	renderLoadingImage,
	renderErrorImage,
	renderUnconfiguredImage,
} from "../../src/utils/button-renderer";

/** Decode SVG from a data URI */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

describe("button-renderer", () => {
	// ── COLORS ──────────────────────────────────

	describe("COLORS", () => {
		it("has GitHub dark theme background", () => {
			expect(COLORS.background).toBe("#0d1117");
		});

		it("has surface color", () => {
			expect(COLORS.surface).toBe("#161b22");
		});

		it("has text and muted text", () => {
			expect(COLORS.text).toBe("#e6edf3");
			expect(COLORS.textMuted).toBe("#8b949e");
		});

		it("has accent colors for all stat types", () => {
			expect(COLORS.accent.stars).toBe("#e3b341");
			expect(COLORS.accent.issues).toBe("#3fb950");
			expect(COLORS.accent.forks).toBe("#58a6ff");
			expect(COLORS.accent.watchers).toBe("#d2a8ff");
		});

		it("has workflow status colors", () => {
			expect(COLORS.workflow.success).toBe("#3fb950");
			expect(COLORS.workflow.failure).toBe("#f85149");
			expect(COLORS.workflow.in_progress).toBe("#d29922");
			expect(COLORS.workflow.cancelled).toBe("#8b949e");
			expect(COLORS.workflow.queued).toBe("#58a6ff");
			expect(COLORS.workflow.deploying).toBe("#a371f7");
		});
	});

	// ── getWorkflowStatusColor ──────────────────

	describe("getWorkflowStatusColor", () => {
		it("returns green for success", () => {
			expect(getWorkflowStatusColor("success")).toBe(COLORS.workflow.success);
		});

		it("returns red for failure", () => {
			expect(getWorkflowStatusColor("failure")).toBe(COLORS.workflow.failure);
		});

		it("returns yellow for in_progress", () => {
			expect(getWorkflowStatusColor("in_progress")).toBe(COLORS.workflow.in_progress);
		});

		it("returns blue for queued", () => {
			expect(getWorkflowStatusColor("queued")).toBe(COLORS.workflow.queued);
		});

		it("returns grey for cancelled", () => {
			expect(getWorkflowStatusColor("cancelled")).toBe(COLORS.workflow.cancelled);
		});

		it("returns red for timed_out", () => {
			expect(getWorkflowStatusColor("timed_out")).toBe(COLORS.workflow.timed_out);
		});

		it("returns purple for deploying", () => {
			expect(getWorkflowStatusColor("deploying")).toBe(COLORS.workflow.deploying);
		});

		it("returns muted color for unknown status", () => {
			expect(getWorkflowStatusColor("unknown_status")).toBe(COLORS.textMuted);
		});
	});

	// ── escapeXml ───────────────────────────────

	describe("escapeXml", () => {
		it("escapes ampersands", () => {
			expect(escapeXml("a&b")).toBe("a&amp;b");
		});

		it("escapes less-than", () => {
			expect(escapeXml("a<b")).toBe("a&lt;b");
		});

		it("escapes greater-than", () => {
			expect(escapeXml("a>b")).toBe("a&gt;b");
		});

		it("escapes double quotes", () => {
			expect(escapeXml('a"b')).toBe("a&quot;b");
		});

		it("escapes single quotes", () => {
			expect(escapeXml("a'b")).toBe("a&apos;b");
		});

		it("handles strings with no special characters", () => {
			expect(escapeXml("hello world")).toBe("hello world");
		});

		it("handles empty string", () => {
			expect(escapeXml("")).toBe("");
		});

		it("escapes multiple special characters", () => {
			expect(escapeXml('<script>"alert(\'xss\')&"</script>')).toBe(
				"&lt;script&gt;&quot;alert(&apos;xss&apos;)&amp;&quot;&lt;/script&gt;",
			);
		});
	});

	// ── renderKeyImage ──────────────────────────

	describe("renderKeyImage", () => {
		it("returns a data URI with encodeURIComponent encoding", () => {
			const result = renderKeyImage({ line2: "Test", statusColor: "#ff0000" });
			expect(result).toMatch(/^data:image\/svg\+xml,/);
		});

		it("generates valid SVG with correct dimensions", () => {
			const result = renderKeyImage({ line2: "OK", statusColor: "#00ff00" });
			const svg = decodeSvg(result);
			expect(svg).toContain('width="144"');
			expect(svg).toContain('height="144"');
			expect(svg).toContain("<svg");
			expect(svg).toContain("</svg>");
		});

		it("includes line2 text", () => {
			const result = renderKeyImage({ line2: "Success", statusColor: "#3fb950" });
			const svg = decodeSvg(result);
			expect(svg).toContain("Success");
		});

		it("includes line1 when provided", () => {
			const result = renderKeyImage({ line1: "my-repo", line2: "OK", statusColor: "#fff" });
			const svg = decodeSvg(result);
			expect(svg).toContain("my-repo");
		});

		it("includes line3 when provided", () => {
			const result = renderKeyImage({ line2: "OK", line3: "Stars", statusColor: "#fff" });
			const svg = decodeSvg(result);
			expect(svg).toContain("Stars");
		});

		it("uses the status color for the accent bar", () => {
			const result = renderKeyImage({ line2: "X", statusColor: "#e3b341" });
			const svg = decodeSvg(result);
			expect(svg).toContain('fill="#e3b341"');
		});

		it("escapes XML special characters in text", () => {
			const result = renderKeyImage({ line2: "A&B", statusColor: "#fff" });
			const svg = decodeSvg(result);
			expect(svg).toContain("A&amp;B");
		});

		it("truncates long line2 text", () => {
			const result = renderKeyImage({ line2: "VeryLongStatusLabel", statusColor: "#fff" });
			const svg = decodeSvg(result);
			expect(svg).toContain("..");
			expect(svg).not.toContain("VeryLongStatusLabel");
		});

		it("truncates long line1 text", () => {
			const result = renderKeyImage({ line1: "a-very-long-repo-name", line2: "X", statusColor: "#fff" });
			const svg = decodeSvg(result);
			expect(svg).toContain("..");
			expect(svg).not.toContain("a-very-long-repo-name");
		});
	});

	// ── renderStatImage ─────────────────────────

	describe("renderStatImage", () => {
		it("includes count and stat label", () => {
			const svg = decodeSvg(renderStatImage("1.5k", "stars"));
			expect(svg).toContain("1.5k");
			expect(svg).toContain("Stars");
		});

		it("includes repo name when provided", () => {
			const svg = decodeSvg(renderStatImage("42", "issues", "react"));
			expect(svg).toContain("react");
			expect(svg).toContain("42");
			expect(svg).toContain("Issues");
		});

		it("uses correct accent color for each stat type", () => {
			expect(decodeSvg(renderStatImage("1", "stars"))).toContain(COLORS.accent.stars);
			expect(decodeSvg(renderStatImage("1", "forks"))).toContain(COLORS.accent.forks);
			expect(decodeSvg(renderStatImage("1", "issues"))).toContain(COLORS.accent.issues);
			expect(decodeSvg(renderStatImage("1", "watchers"))).toContain(COLORS.accent.watchers);
		});
	});

	// ── renderWorkflowImage ─────────────────────

	describe("renderWorkflowImage", () => {
		it("renders a status icon instead of text", () => {
			const svg = decodeSvg(renderWorkflowImage("Success", "success"));
			// Should contain the checkmark polyline, not the text "Success" as line2
			expect(svg).toContain("polyline");
			expect(svg).toContain(COLORS.workflow.success);
		});

		it("shows status label as line3 when no deploy label", () => {
			const svg = decodeSvg(renderWorkflowImage("Success", "success"));
			expect(svg).toContain("Success");
		});

		it("includes repo name when provided", () => {
			const svg = decodeSvg(renderWorkflowImage("Failed", "failure", "my-repo"));
			expect(svg).toContain("my-repo");
			// Should have X icon for failure
			expect(svg).toContain(COLORS.workflow.failure);
		});

		it("includes deploy label instead of status label when provided", () => {
			const svg = decodeSvg(renderWorkflowImage("Success", "success", "repo", "prod: live"));
			expect(svg).toContain("prod: live");
		});

		it("uses correct icon for each status", () => {
			// success = polyline (checkmark)
			expect(decodeSvg(renderWorkflowImage("X", "success"))).toContain("polyline");
			// failure = line elements (X mark)
			const failSvg = decodeSvg(renderWorkflowImage("X", "failure"));
			expect(failSvg).toContain("line");
			expect(failSvg).toContain(COLORS.workflow.failure);
			// in_progress = path (circular arrow)
			expect(decodeSvg(renderWorkflowImage("X", "in_progress"))).toContain("path");
		});
	});

	// ── renderDeployingImage ────────────────────

	describe("renderDeployingImage", () => {
		it("shows deploying icon and environment name", () => {
			const svg = decodeSvg(renderDeployingImage("production", "in_progress"));
			expect(svg).toContain("production");
			expect(svg).toContain("polygon"); // deploying icon = triangle/rocket
			expect(svg).toContain(COLORS.workflow.deploying);
		});

		it("includes repo name when provided", () => {
			const svg = decodeSvg(renderDeployingImage("prod", "in_progress", "my-app"));
			expect(svg).toContain("my-app");
		});

		it("uses deploying icon regardless of state param", () => {
			const svg = decodeSvg(renderDeployingImage("staging", "queued"));
			expect(svg).toContain("staging");
			expect(svg).toContain(COLORS.workflow.deploying);
		});
	});

	// ── renderLoadingImage ──────────────────────

	describe("renderLoadingImage", () => {
		it("shows Loading text", () => {
			const svg = decodeSvg(renderLoadingImage());
			expect(svg).toContain("Loading");
		});

		it("returns a valid data URI", () => {
			expect(renderLoadingImage()).toMatch(/^data:image\/svg\+xml,/);
		});
	});

	// ── renderErrorImage ────────────────────────

	describe("renderErrorImage", () => {
		it("shows default Error text", () => {
			const svg = decodeSvg(renderErrorImage());
			expect(svg).toContain("Error");
		});

		it("shows custom error message", () => {
			const svg = decodeSvg(renderErrorImage("Not Found"));
			expect(svg).toContain("Not Found");
		});

		it("shows Press to retry", () => {
			const svg = decodeSvg(renderErrorImage());
			expect(svg).toContain("Press to retry");
		});

		it("uses error color for accent bar", () => {
			const svg = decodeSvg(renderErrorImage());
			expect(svg).toContain(COLORS.error);
		});
	});

	// ── renderUnconfiguredImage ─────────────────

	describe("renderUnconfiguredImage", () => {
		it("shows Setup text", () => {
			const svg = decodeSvg(renderUnconfiguredImage());
			expect(svg).toContain("Setup");
		});

		it("shows Open Settings text", () => {
			const svg = decodeSvg(renderUnconfiguredImage());
			expect(svg).toContain("Open Settings");
		});
	});

	// ── getStatusIcon ──────────────────────────

	describe("getStatusIcon", () => {
		it("returns checkmark for success", () => {
			const icon = getStatusIcon("success", "#3fb950");
			expect(icon).toContain("polyline");
			expect(icon).toContain("#3fb950");
		});

		it("returns X mark for failure", () => {
			const icon = getStatusIcon("failure", "#f85149");
			expect(icon).toContain("line");
			expect(icon).toContain("#f85149");
		});

		it("returns circle arrow for in_progress", () => {
			const icon = getStatusIcon("in_progress", "#d29922");
			expect(icon).toContain("path");
			expect(icon).toContain("polygon");
		});

		it("returns question mark for unknown status", () => {
			const icon = getStatusIcon("something_unknown", "#fff");
			expect(icon).toContain("?");
		});

		it("colorizes all occurrences", () => {
			const icon = getStatusIcon("cancelled", "#abcdef");
			expect(icon).not.toContain("%%COLOR%%");
			expect((icon.match(/#abcdef/g) ?? []).length).toBeGreaterThanOrEqual(2);
		});
	});

	// ── renderIconKeyImage ─────────────────────

	describe("renderIconKeyImage", () => {
		it("returns a valid data URI", () => {
			const result = renderIconKeyImage({ status: "success", statusColor: COLORS.workflow.success });
			expect(result).toMatch(/^data:image\/svg\+xml,/);
		});

		it("contains an embedded SVG icon", () => {
			const svg = decodeSvg(renderIconKeyImage({ status: "success", statusColor: COLORS.workflow.success }));
			expect(svg).toContain("transform=");
			expect(svg).toContain("polyline");
		});

		it("includes line1 and line3 text", () => {
			const svg = decodeSvg(renderIconKeyImage({
				line1: "repo",
				status: "failure",
				line3: "Failed",
				statusColor: COLORS.workflow.failure,
			}));
			expect(svg).toContain("repo");
			expect(svg).toContain("Failed");
		});
	});
});
