/**
 * Tests for SpinnerAnimator utility (src/utils/spinner-animator.ts).
 *
 * Validates animation lifecycle: start, stop, frame progression,
 * and convenience helpers for Map-based action management.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	SpinnerAnimator,
	startLoadingSpinner,
	stopLoadingSpinner,
} from "../../src/utils/spinner-animator";
import { SPINNER_FRAME_COUNT } from "../../src/utils/button-renderer";

describe("SpinnerAnimator", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ── Constructor & initial state ────────────────

	describe("initial state", () => {
		it("is not running when created", () => {
			const spinner = new SpinnerAnimator();
			expect(spinner.isRunning()).toBe(false);
		});
	});

	// ── start() ────────────────────────────────────

	describe("start", () => {
		it("calls onFrame immediately with frame 0", () => {
			const spinner = new SpinnerAnimator();
			const onFrame = vi.fn();
			spinner.start(onFrame);

			expect(onFrame).toHaveBeenCalledTimes(1);
			expect(onFrame).toHaveBeenCalledWith(0);
		});

		it("sets isRunning to true", () => {
			const spinner = new SpinnerAnimator();
			spinner.start(vi.fn());
			expect(spinner.isRunning()).toBe(true);

			spinner.stop();
		});

		it("advances frames on each interval tick", () => {
			const spinner = new SpinnerAnimator();
			const onFrame = vi.fn();
			spinner.start(onFrame, 100);

			vi.advanceTimersByTime(100);
			expect(onFrame).toHaveBeenCalledWith(1);

			vi.advanceTimersByTime(100);
			expect(onFrame).toHaveBeenCalledWith(2);

			vi.advanceTimersByTime(100);
			expect(onFrame).toHaveBeenCalledWith(3);

			spinner.stop();
		});

		it("wraps frame index at SPINNER_FRAME_COUNT", () => {
			const spinner = new SpinnerAnimator();
			const onFrame = vi.fn();
			spinner.start(onFrame, 100);

			// Advance through all frames plus one more
			vi.advanceTimersByTime(SPINNER_FRAME_COUNT * 100);
			expect(onFrame).toHaveBeenLastCalledWith(0); // wrapped back to 0

			spinner.stop();
		});

		it("cycles through all 8 frames", () => {
			const spinner = new SpinnerAnimator();
			const frames: number[] = [];
			spinner.start((frame) => frames.push(frame), 100);

			// Advance through 1 full cycle
			vi.advanceTimersByTime((SPINNER_FRAME_COUNT - 1) * 100);

			expect(frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

			spinner.stop();
		});

		it("stops existing animation before starting new one", () => {
			const spinner = new SpinnerAnimator();
			const onFrame1 = vi.fn();
			const onFrame2 = vi.fn();

			spinner.start(onFrame1, 100);
			vi.advanceTimersByTime(200); // frames 1, 2
			expect(onFrame1).toHaveBeenCalledTimes(3); // 0 + 1 + 2

			spinner.start(onFrame2, 100);
			vi.advanceTimersByTime(100);

			// onFrame1 should not have been called again
			expect(onFrame1).toHaveBeenCalledTimes(3);
			// onFrame2 should have been called: 0 (immediate) + 1 (tick)
			expect(onFrame2).toHaveBeenCalledTimes(2);

			spinner.stop();
		});

		it("uses default interval when not specified", () => {
			const spinner = new SpinnerAnimator();
			const onFrame = vi.fn();
			spinner.start(onFrame);

			// Default is SPINNER_INTERVAL_MS = 150
			vi.advanceTimersByTime(150);
			expect(onFrame).toHaveBeenCalledTimes(2); // 0 + 1

			spinner.stop();
		});
	});

	// ── stop() ─────────────────────────────────────

	describe("stop", () => {
		it("sets isRunning to false", () => {
			const spinner = new SpinnerAnimator();
			spinner.start(vi.fn());
			spinner.stop();
			expect(spinner.isRunning()).toBe(false);
		});

		it("stops frame advancement", () => {
			const spinner = new SpinnerAnimator();
			const onFrame = vi.fn();
			spinner.start(onFrame, 100);

			vi.advanceTimersByTime(200); // frames 0, 1, 2
			spinner.stop();

			const callCount = onFrame.mock.calls.length;
			vi.advanceTimersByTime(1000); // should not fire
			expect(onFrame).toHaveBeenCalledTimes(callCount);
		});

		it("is safe to call when not running", () => {
			const spinner = new SpinnerAnimator();
			expect(() => spinner.stop()).not.toThrow();
		});

		it("is safe to call multiple times", () => {
			const spinner = new SpinnerAnimator();
			spinner.start(vi.fn());
			spinner.stop();
			expect(() => spinner.stop()).not.toThrow();
			expect(spinner.isRunning()).toBe(false);
		});
	});

	// ── startLoadingSpinner helper ──────────────────

	describe("startLoadingSpinner", () => {
		it("creates a new spinner and stores it in the map", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			const onFrame = vi.fn();
			startLoadingSpinner(spinners, "action-1", onFrame);

			expect(spinners.has("action-1")).toBe(true);
			expect(spinners.get("action-1")!.isRunning()).toBe(true);
			expect(onFrame).toHaveBeenCalledWith(0);

			spinners.get("action-1")!.stop();
		});

		it("stops existing spinner before starting new one", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			const onFrame1 = vi.fn();
			startLoadingSpinner(spinners, "action-1", onFrame1);

			const firstSpinner = spinners.get("action-1")!;

			const onFrame2 = vi.fn();
			startLoadingSpinner(spinners, "action-1", onFrame2);

			expect(firstSpinner.isRunning()).toBe(false);
			expect(spinners.get("action-1")!.isRunning()).toBe(true);

			spinners.get("action-1")!.stop();
		});

		it("can manage multiple action IDs independently", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			startLoadingSpinner(spinners, "action-1", vi.fn());
			startLoadingSpinner(spinners, "action-2", vi.fn());

			expect(spinners.size).toBe(2);
			expect(spinners.get("action-1")!.isRunning()).toBe(true);
			expect(spinners.get("action-2")!.isRunning()).toBe(true);

			spinners.get("action-1")!.stop();
			spinners.get("action-2")!.stop();
		});
	});

	// ── stopLoadingSpinner helper ───────────────────

	describe("stopLoadingSpinner", () => {
		it("stops the spinner and removes it from the map", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			startLoadingSpinner(spinners, "action-1", vi.fn());

			stopLoadingSpinner(spinners, "action-1");

			expect(spinners.has("action-1")).toBe(false);
		});

		it("is safe to call for non-existent action ID", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			expect(() => stopLoadingSpinner(spinners, "not-here")).not.toThrow();
		});

		it("does not affect other spinners", () => {
			const spinners = new Map<string, SpinnerAnimator>();
			startLoadingSpinner(spinners, "action-1", vi.fn());
			startLoadingSpinner(spinners, "action-2", vi.fn());

			stopLoadingSpinner(spinners, "action-1");

			expect(spinners.has("action-1")).toBe(false);
			expect(spinners.get("action-2")!.isRunning()).toBe(true);

			spinners.get("action-2")!.stop();
		});
	});
});
