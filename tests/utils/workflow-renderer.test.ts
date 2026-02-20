/**
 * Tests for workflow-related utilities from button-renderer.
 *
 * Tests additional edge cases for getWorkflowStatusColor, COLORS completeness,
 * and workflow-specific rendering functions.
 */

import { describe, it, expect } from "vitest";
import {
	getWorkflowStatusColor,
	COLORS,
	renderWorkflowImage,
	renderDeployingImage,
} from "../../src/utils/button-renderer";

/** Decode SVG from a data URI */
function decodeSvg(dataUri: string): string {
	return decodeURIComponent(dataUri.replace(/^data:image\/svg\+xml,/, ""));
}

describe("Workflow utilities", () => {
	describe("getWorkflowStatusColor – extended statuses", () => {
		it("returns blue for pending", () => {
			expect(getWorkflowStatusColor("pending")).toBe(COLORS.workflow.pending);
		});

		it("returns yellow for waiting", () => {
			expect(getWorkflowStatusColor("waiting")).toBe(COLORS.workflow.waiting);
		});

		it("returns grey for skipped", () => {
			expect(getWorkflowStatusColor("skipped")).toBe(COLORS.workflow.skipped);
		});

		it("returns yellow for action_required", () => {
			expect(getWorkflowStatusColor("action_required")).toBe(COLORS.workflow.action_required);
		});

		it("returns grey for neutral", () => {
			expect(getWorkflowStatusColor("neutral")).toBe(COLORS.workflow.neutral);
		});

		it("returns grey for stale", () => {
			expect(getWorkflowStatusColor("stale")).toBe(COLORS.workflow.stale);
		});

		it("returns blue for requested", () => {
			expect(getWorkflowStatusColor("requested")).toBe(COLORS.workflow.requested);
		});

		it("returns muted for empty string", () => {
			expect(getWorkflowStatusColor("")).toBe(COLORS.textMuted);
		});
	});

	describe("COLORS.workflow completeness", () => {
		it("has all expected workflow status keys", () => {
			const expectedKeys = [
				"success", "failure", "cancelled", "in_progress", "queued",
				"pending", "waiting", "skipped", "timed_out", "action_required",
				"neutral", "stale", "requested", "deploying",
			];

			for (const key of expectedKeys) {
				expect(COLORS.workflow).toHaveProperty(key);
				expect(typeof (COLORS.workflow as Record<string, string>)[key]).toBe("string");
			}
		});
	});

	describe("renderWorkflowImage – edge cases", () => {
		it("uses fallback color for unknown status", () => {
			const svg = decodeSvg(renderWorkflowImage("Unknown", "fake_status"));
			expect(svg).toContain(COLORS.textMuted);
			expect(svg).toContain("Unknown");
		});

		it("renders icon + text lines when repo and deploy info provided", () => {
			const svg = decodeSvg(renderWorkflowImage("Success", "success", "repo", "prod: live"));
			expect(svg).toContain("repo");
			expect(svg).toContain("prod: live");
			expect(svg).toContain("polyline"); // success checkmark icon
		});

		it("shows status label as line3 without deploy label", () => {
			const svg = decodeSvg(renderWorkflowImage("Failed", "failure"));
			expect(svg).toContain("Failed");
			expect(svg).toContain(COLORS.workflow.failure);
		});
	});

	describe("renderDeployingImage – edge cases", () => {
		it("uses deploying accent color", () => {
			const svg = decodeSvg(renderDeployingImage("prod", "in_progress"));
			expect(svg).toContain(COLORS.workflow.deploying);
		});

		it("shows deploying icon for any state", () => {
			const svg = decodeSvg(renderDeployingImage("staging", "pending"));
			expect(svg).toContain("polygon"); // deploying rocket icon
			expect(svg).toContain("staging");
		});

		it("shows repo name in line1", () => {
			const svg = decodeSvg(renderDeployingImage("prod", "in_progress", "my-app"));
			expect(svg).toContain("my-app");
			expect(svg).toContain("prod");
		});
	});
});
