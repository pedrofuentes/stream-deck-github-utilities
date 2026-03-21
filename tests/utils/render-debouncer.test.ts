/**
 * Tests for RenderDebouncer utility.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RenderDebouncer } from "../../src/utils/render-debouncer";

describe("RenderDebouncer", () => {
	let debouncer: RenderDebouncer;

	beforeEach(() => {
		vi.useFakeTimers();
		debouncer = new RenderDebouncer();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires callback after the specified delay", () => {
		const callback = vi.fn();
		debouncer.schedule("action-1", callback, 100);

		expect(callback).not.toHaveBeenCalled();
		vi.advanceTimersByTime(99);
		expect(callback).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(callback).toHaveBeenCalledOnce();
	});

	it("replaces a previous pending render for the same action", () => {
		const firstCallback = vi.fn();
		const secondCallback = vi.fn();

		debouncer.schedule("action-1", firstCallback, 100);
		vi.advanceTimersByTime(50);

		debouncer.schedule("action-1", secondCallback, 100);
		vi.advanceTimersByTime(100);

		expect(firstCallback).not.toHaveBeenCalled();
		expect(secondCallback).toHaveBeenCalledOnce();
	});

	it("cleanup prevents callback from firing", () => {
		const callback = vi.fn();
		debouncer.schedule("action-1", callback, 100);

		vi.advanceTimersByTime(50);
		debouncer.cleanup("action-1");
		vi.advanceTimersByTime(100);

		expect(callback).not.toHaveBeenCalled();
	});

	it("cleanup is safe to call with no pending timer", () => {
		expect(() => debouncer.cleanup("nonexistent")).not.toThrow();
	});

	it("independent action IDs do not interfere with each other", () => {
		const callback1 = vi.fn();
		const callback2 = vi.fn();

		debouncer.schedule("action-1", callback1, 100);
		debouncer.schedule("action-2", callback2, 200);

		vi.advanceTimersByTime(100);
		expect(callback1).toHaveBeenCalledOnce();
		expect(callback2).not.toHaveBeenCalled();

		vi.advanceTimersByTime(100);
		expect(callback2).toHaveBeenCalledOnce();
	});

	it("cleanup for one action does not affect another", () => {
		const callback1 = vi.fn();
		const callback2 = vi.fn();

		debouncer.schedule("action-1", callback1, 100);
		debouncer.schedule("action-2", callback2, 100);

		debouncer.cleanup("action-1");
		vi.advanceTimersByTime(100);

		expect(callback1).not.toHaveBeenCalled();
		expect(callback2).toHaveBeenCalledOnce();
	});

	it("removes timer entry from internal map after callback fires", () => {
		const callback = vi.fn();
		debouncer.schedule("action-1", callback, 50);

		vi.advanceTimersByTime(50);
		expect(callback).toHaveBeenCalledOnce();

		// Scheduling again should work without issues (no stale entry)
		const callback2 = vi.fn();
		debouncer.schedule("action-1", callback2, 50);
		vi.advanceTimersByTime(50);
		expect(callback2).toHaveBeenCalledOnce();
	});

	it("handles zero delay", () => {
		const callback = vi.fn();
		debouncer.schedule("action-1", callback, 0);

		vi.advanceTimersByTime(0);
		expect(callback).toHaveBeenCalledOnce();
	});
});
