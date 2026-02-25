/**
 * Tests for PollingCoordinator utility.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PollingCoordinator } from "../../src/utils/polling-coordinator";

describe("PollingCoordinator", () => {
	let coordinator: PollingCoordinator;

	beforeEach(() => {
		vi.useFakeTimers();
		coordinator = new PollingCoordinator();
	});

	afterEach(() => {
		coordinator.stopAll();
		vi.useRealTimers();
	});

	// ── start() ──────────────────────────────────────────────────────

	describe("start()", () => {
		it("should schedule the callback at the given interval", () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			coordinator.start("action-1", callback, 60);

			expect(callback).not.toHaveBeenCalled();

			vi.advanceTimersByTime(60_000);
			expect(callback).toHaveBeenCalledTimes(1);

			vi.advanceTimersByTime(60_000);
			expect(callback).toHaveBeenCalledTimes(2);
		});

		it("should enforce minimum interval", () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			coordinator.start("action-1", callback, 5, 15); // 5s requested, 15s minimum

			// Should not fire at 5s
			vi.advanceTimersByTime(5_000);
			expect(callback).not.toHaveBeenCalled();

			// Should fire at 15s
			vi.advanceTimersByTime(10_000);
			expect(callback).toHaveBeenCalledTimes(1);
		});

		it("should stop the previous timer when called for the same action", () => {
			const callback1 = vi.fn().mockResolvedValue(undefined);
			const callback2 = vi.fn().mockResolvedValue(undefined);

			coordinator.start("action-1", callback1, 60);
			coordinator.start("action-1", callback2, 30);

			// Advance past first callback's expected interval
			vi.advanceTimersByTime(60_000);

			// Only callback2 should have been called (at 30s and 60s)
			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).toHaveBeenCalledTimes(2);
		});

		it("should handle different action IDs independently", () => {
			const callback1 = vi.fn().mockResolvedValue(undefined);
			const callback2 = vi.fn().mockResolvedValue(undefined);

			coordinator.start("action-1", callback1, 60);
			coordinator.start("action-2", callback2, 30);

			vi.advanceTimersByTime(60_000);

			expect(callback1).toHaveBeenCalledTimes(1);
			expect(callback2).toHaveBeenCalledTimes(2);
		});

		it("should use default minimum of 15 seconds", () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			coordinator.start("action-1", callback, 10); // 10s, below default 15s min

			vi.advanceTimersByTime(10_000);
			expect(callback).not.toHaveBeenCalled();

			vi.advanceTimersByTime(5_000);
			expect(callback).toHaveBeenCalledTimes(1);
		});
	});

	// ── stop() ──────────────────────────────────────────────────────

	describe("stop()", () => {
		it("should stop an active timer", () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			coordinator.start("action-1", callback, 60);

			coordinator.stop("action-1");

			vi.advanceTimersByTime(120_000);
			expect(callback).not.toHaveBeenCalled();
		});

		it("should be safe to call when not polling", () => {
			expect(() => coordinator.stop("nonexistent")).not.toThrow();
		});

		it("should allow re-starting after stop", () => {
			const callback = vi.fn().mockResolvedValue(undefined);
			coordinator.start("action-1", callback, 60);
			coordinator.stop("action-1");

			coordinator.start("action-1", callback, 30);
			vi.advanceTimersByTime(30_000);

			expect(callback).toHaveBeenCalledTimes(1);
		});
	});

	// ── stopAll() ──────────────────────────────────────────────────

	describe("stopAll()", () => {
		it("should stop all active timers", () => {
			const callback1 = vi.fn().mockResolvedValue(undefined);
			const callback2 = vi.fn().mockResolvedValue(undefined);

			coordinator.start("action-1", callback1, 60);
			coordinator.start("action-2", callback2, 60);

			coordinator.stopAll();

			vi.advanceTimersByTime(120_000);
			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).not.toHaveBeenCalled();
		});

		it("should handle empty coordinator", () => {
			expect(() => coordinator.stopAll()).not.toThrow();
		});
	});

	// ── Error backoff ──────────────────────────────────────────────

	describe("error backoff", () => {
		it("should start with base interval (no backoff)", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(60_000);
		});

		it("should double interval on each reported error", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			coordinator.reportError("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(120_000); // 2x

			coordinator.reportError("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(240_000); // 4x

			coordinator.reportError("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(480_000); // 8x
		});

		it("should cap backoff at 32x base interval", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			// Report 10 errors (more than the cap of 5)
			for (let i = 0; i < 10; i++) {
				coordinator.reportError("action-1");
			}

			// 2^5 = 32x is the cap
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(60_000 * 32);
		});

		it("should reset backoff on success", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			coordinator.reportError("action-1");
			coordinator.reportError("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(240_000);

			coordinator.reportSuccess("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(60_000);
		});

		it("should be safe to call reportError/reportSuccess on nonexistent action", () => {
			expect(() => coordinator.reportError("nonexistent")).not.toThrow();
			expect(() => coordinator.reportSuccess("nonexistent")).not.toThrow();
		});
	});

	// ── resetBackoff() ──────────────────────────────────────────────

	describe("resetBackoff()", () => {
		it("should reset error count to 0", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			coordinator.reportError("action-1");
			coordinator.reportError("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(240_000);

			coordinator.resetBackoff("action-1");
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(60_000);
		});

		it("should be safe to call on nonexistent action", () => {
			expect(() => coordinator.resetBackoff("nonexistent")).not.toThrow();
		});
	});

	// ── restart() ──────────────────────────────────────────────────

	describe("restart()", () => {
		it("should start polling with a new interval and callback", () => {
			const callback1 = vi.fn().mockResolvedValue(undefined);
			const callback2 = vi.fn().mockResolvedValue(undefined);

			coordinator.start("action-1", callback1, 60);
			coordinator.restart("action-1", callback2, 30);

			vi.advanceTimersByTime(60_000);
			expect(callback1).not.toHaveBeenCalled();
			expect(callback2).toHaveBeenCalledTimes(2); // 30s and 60s
		});

		it("should preserve error count across restarts", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			coordinator.reportError("action-1");
			coordinator.reportError("action-1");

			coordinator.restart("action-1", vi.fn().mockResolvedValue(undefined), 60);
			// Error count should be preserved: 2 errors → 4x backoff
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(240_000);
		});
	});

	// ── Generation counter ──────────────────────────────────────────

	describe("generation counter", () => {
		it("should start at generation 0", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			expect(coordinator.getGeneration("action-1")).toBe(0);
		});

		it("should increment generation and return new value", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			const gen1 = coordinator.incrementGeneration("action-1");
			expect(gen1).toBe(1);

			const gen2 = coordinator.incrementGeneration("action-1");
			expect(gen2).toBe(2);
		});

		it("should correctly identify current generation", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);

			const gen = coordinator.incrementGeneration("action-1");
			expect(coordinator.isCurrentGeneration("action-1", gen)).toBe(true);

			// Increment again — old generation is now stale
			coordinator.incrementGeneration("action-1");
			expect(coordinator.isCurrentGeneration("action-1", gen)).toBe(false);
		});

		it("should return 0 for nonexistent action", () => {
			expect(coordinator.getGeneration("nonexistent")).toBe(0);
			expect(coordinator.incrementGeneration("nonexistent")).toBe(0);
		});

		it("should return false for isCurrentGeneration on nonexistent action", () => {
			expect(coordinator.isCurrentGeneration("nonexistent", 0)).toBe(false);
		});
	});

	// ── isPolling() ──────────────────────────────────────────────

	describe("isPolling()", () => {
		it("should return true when polling is active", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			expect(coordinator.isPolling("action-1")).toBe(true);
		});

		it("should return false when polling is stopped", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			coordinator.stop("action-1");
			expect(coordinator.isPolling("action-1")).toBe(false);
		});

		it("should return false for non-started actions", () => {
			expect(coordinator.isPolling("nonexistent")).toBe(false);
		});
	});

	// ── getEffectiveIntervalMs() ──────────────────────────────────

	describe("getEffectiveIntervalMs()", () => {
		it("should return 0 for nonexistent action", () => {
			expect(coordinator.getEffectiveIntervalMs("nonexistent")).toBe(0);
		});

		it("should return base interval when no errors", () => {
			coordinator.start("action-1", vi.fn().mockResolvedValue(undefined), 60);
			expect(coordinator.getEffectiveIntervalMs("action-1")).toBe(60_000);
		});
	});

	// ── Callback error handling ──────────────────────────────────

	describe("callback error handling", () => {
		it("should not crash when callback throws", () => {
			const callback = vi.fn().mockRejectedValue(new Error("API error"));
			coordinator.start("action-1", callback, 60);

			// Should not throw, the error is caught internally
			expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
			expect(callback).toHaveBeenCalledTimes(1);

			// Should continue scheduling
			vi.advanceTimersByTime(60_000);
			expect(callback).toHaveBeenCalledTimes(2);
		});
	});
});
