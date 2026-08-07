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
	STAT_LABELS,
	getWorkflowStatusColor,
	getStatusIcon,
	escapeXml,
	renderKeyImage,
	renderIconKeyImage,
	renderStatImage,
	renderWorkflowImage,
	renderDeployingImage,
	renderLoadingImage,
	renderAnimatedSpinner,
	renderSpinnerFrame,
	renderErrorImage,
	renderUnconfiguredImage,
	SPINNER_FRAME_COUNT,
	SPINNER_INTERVAL_MS,
} from "../../src/utils/button-renderer";
import type { StatType } from "../../src/utils/github-api";

/** Decode SVG from a data URI */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

describe("button-renderer", () => {
	// ── STAT_LABELS ────────────────────────────────

	describe("STAT_LABELS", () => {
		const ALL_STAT_TYPES: StatType[] = [
			"stars", "issues", "forks", "watchers", "pull_requests",
			"language", "size", "license", "default_branch", "visibility",
		];

		it("has a label for every StatType", () => {
			for (const type of ALL_STAT_TYPES) {
				expect(STAT_LABELS[type]).toBeDefined();
				expect(STAT_LABELS[type].length).toBeGreaterThan(0);
			}
		});

		it("has no extra keys beyond StatType", () => {
			expect(Object.keys(STAT_LABELS).sort()).toEqual(ALL_STAT_TYPES.sort());
		});
	});

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

		it("has accent colors for Phase 2 action types", () => {
			expect(COLORS.accent.releases).toBe("#a371f7");
			expect(COLORS.accent.commits).toBe("#f78166");
			expect(COLORS.accent.branches).toBe("#58a6ff");
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

		// Several keys commonly watch one repository on different branches, so the
		// branch is what tells them apart and takes the prominent row; the status
		// moves to the smaller row below it.
		describe("branch label", () => {
			it("shows the branch above the deploy label", () => {
				const svg = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "dev: success", "develop"));

				expect(svg).toContain("develop");
				expect(svg).toContain("dev: success");
				expect(svg).toContain("Steps");
				// Branch on the 15 px row, deploy info on the 13 px row below it
				expect(svg).toMatch(/font-size="15"[^>]*>develop</);
				expect(svg).toMatch(/font-size="13"[^>]*>dev: success</);
			});

			it("falls back to the status label on the lower row without a deployment", () => {
				const svg = decodeSvg(renderWorkflowImage("Success", "success", "Steps", undefined, "develop"));

				expect(svg).toMatch(/font-size="15"[^>]*>develop</);
				expect(svg).toMatch(/font-size="13"[^>]*>Success</);
			});

			it("keeps the three-line layout when no branch is set", () => {
				const withBranch = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "dev: success", "develop"));
				const without = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "dev: success"));

				expect(without).not.toContain('font-size="13"');
				// The extra row shifts the other elements up
				expect(without).toContain('y="120"');
				expect(withBranch).not.toContain('y="120"');
			});

			it("treats an empty branch as no branch", () => {
				const empty = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "dev: success", ""));
				const omitted = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "dev: success"));

				expect(empty).toBe(omitted);
			});

			it("truncates a long branch name", () => {
				const svg = decodeSvg(renderWorkflowImage("Success", "success", "Steps", "prod: ok", "feature/a-very-long-branch-name"));

				expect(svg).not.toContain("feature/a-very-long-branch-name");
				expect(svg).toContain("feature/a-very-l..");
			});
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

		it("shows the branch above the environment when provided", () => {
			const svg = decodeSvg(renderDeployingImage("prod", "in_progress", "Steps", "main"));

			expect(svg).toMatch(/font-size="15"[^>]*>main</);
			expect(svg).toMatch(/font-size="13"[^>]*>prod</);
		});

		it("keeps the environment on the main row without a branch", () => {
			const svg = decodeSvg(renderDeployingImage("prod", "in_progress", "Steps"));

			expect(svg).toMatch(/font-size="15"[^>]*>prod</);
			expect(svg).not.toContain('font-size="13"');
		});
	});

	// ── renderLoadingImage ──────────────────────

	describe("renderLoadingImage", () => {
		it("returns a spinner SVG with Loading text", () => {
			const svg = decodeSvg(renderLoadingImage());
			expect(svg).toContain("Loading");
			expect(svg).toContain("circle"); // spinner track + arc
		});

		it("returns a valid data URI", () => {
			expect(renderLoadingImage()).toMatch(/^data:image\/svg\+xml,/);
		});

		it("is equivalent to renderAnimatedSpinner()", () => {
			expect(renderLoadingImage()).toBe(renderAnimatedSpinner());
		});
	});

	// ── renderSpinnerFrame ─────────────────────

	describe("renderSpinnerFrame", () => {
		it("returns a valid data URI", () => {
			expect(renderSpinnerFrame(0)).toMatch(/^data:image\/svg\+xml,/);
		});

		it("contains spinner SVG elements (track circle, arc circle, Loading text)", () => {
			const svg = decodeSvg(renderSpinnerFrame(0));
			expect(svg).toContain("circle");
			expect(svg).toContain("stroke-dasharray");
			expect(svg).toContain("Loading");
		});

		it("produces different SVGs for different frames", () => {
			const frame0 = renderSpinnerFrame(0);
			const frame1 = renderSpinnerFrame(1);
			const frame4 = renderSpinnerFrame(4);
			expect(frame0).not.toBe(frame1);
			expect(frame1).not.toBe(frame4);
		});

		it("uses the accent color when provided", () => {
			const svg = decodeSvg(renderSpinnerFrame(0, "#ff0000"));
			expect(svg).toContain("#ff0000");
		});

		it("uses default blue color when no accent provided", () => {
			const svg = decodeSvg(renderSpinnerFrame(0));
			expect(svg).toContain("#58a6ff");
		});

		it("wraps frame index modulo SPINNER_FRAME_COUNT", () => {
			const frame0 = renderSpinnerFrame(0);
			const frame8 = renderSpinnerFrame(SPINNER_FRAME_COUNT);
			expect(frame0).toBe(frame8);
		});

		it("contains rotation transform for animation", () => {
			const svg = decodeSvg(renderSpinnerFrame(3));
			expect(svg).toContain("rotate(");
		});

		it("has correct 144x144 dimensions", () => {
			const svg = decodeSvg(renderSpinnerFrame(0));
			expect(svg).toContain('width="144"');
			expect(svg).toContain('height="144"');
		});
	});

	// ── Spinner constants ──────────────────────

	describe("Spinner constants", () => {
		it("SPINNER_FRAME_COUNT is 8", () => {
			expect(SPINNER_FRAME_COUNT).toBe(8);
		});

		it("SPINNER_INTERVAL_MS is 150", () => {
			expect(SPINNER_INTERVAL_MS).toBe(150);
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

		describe("line4", () => {
			it("renders a fourth row and tightens the layout", () => {
				const svg = decodeSvg(renderIconKeyImage({
					line1: "repo",
					status: "success",
					line3: "develop",
					line4: "dev: success",
					statusColor: COLORS.workflow.success,
				}));

				expect(svg).toContain("develop");
				expect(svg).toContain("dev: success");
				// Rows move up to make room: line1 30, icon 42, line3 104, line4 126
				expect(svg).toContain('y="30"');
				expect(svg).toContain("translate(52,42)");
				expect(svg).toContain('y="104"');
				expect(svg).toContain('y="126"');
			});

			it("positions the rows without line1", () => {
				const svg = decodeSvg(renderIconKeyImage({
					status: "success",
					line3: "develop",
					line4: "dev: success",
					statusColor: COLORS.workflow.success,
				}));

				expect(svg).toContain("translate(52,32)");
				expect(svg).toContain('y="100"');
				expect(svg).toContain('y="122"');
			});

			it("is ignored without a line3, which would leave a hole", () => {
				const svg = decodeSvg(renderIconKeyImage({
					line1: "repo",
					status: "success",
					line4: "orphan",
					statusColor: COLORS.workflow.success,
				}));

				expect(svg).not.toContain("orphan");
				// Falls back to the line1-only geometry
				expect(svg).toContain("translate(52,56)");
			});

			it("leaves markup byte-identical when omitted", () => {
				const base = { line1: "repo", status: "success", line3: "Done", statusColor: COLORS.workflow.success };

				expect(renderIconKeyImage({ ...base, line4: undefined })).toBe(renderIconKeyImage(base));
			});

			it("escapes and truncates line4", () => {
				const svg = decodeSvg(renderIconKeyImage({
					status: "success",
					line3: "branch",
					line4: "A&B a-really-long-detail-line",
					statusColor: COLORS.workflow.success,
				}));

				expect(svg).toContain("A&amp;B");
				expect(svg).not.toContain("a-really-long-detail-line");
				expect(svg).toContain("..");
			});
		});
	});
});
