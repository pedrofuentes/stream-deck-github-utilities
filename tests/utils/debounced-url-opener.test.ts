/**
 * Tests for the DebouncedUrlOpener utility (src/utils/debounced-url-opener.ts).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockOpenUrl } = vi.hoisted(() => ({
	mockOpenUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@elgato/streamdeck", () => ({
	default: {
		system: {
			openUrl: mockOpenUrl,
		},
	},
}));

import { DebouncedUrlOpener } from "../../src/utils/debounced-url-opener";

describe("DebouncedUrlOpener", () => {
	let opener: DebouncedUrlOpener;

	beforeEach(() => {
		vi.useFakeTimers();
		opener = new DebouncedUrlOpener();
		mockOpenUrl.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("handlePress", () => {
		it("returns false on first press (no pending timer)", () => {
			expect(opener.handlePress("action-1")).toBe(false);
		});

		it("returns true on second press within window (double-click)", () => {
			opener.scheduleOpen("action-1", "https://github.com");
			expect(opener.handlePress("action-1")).toBe(true);
		});

		it("returns false after timer expires (third press treated as first)", () => {
			opener.scheduleOpen("action-1", "https://github.com");
			vi.advanceTimersByTime(400);
			expect(opener.handlePress("action-1")).toBe(false);
		});

		it("handles independent action IDs separately", () => {
			opener.scheduleOpen("action-1", "https://github.com/a");
			expect(opener.handlePress("action-2")).toBe(false);
			expect(opener.handlePress("action-1")).toBe(true);
		});
	});

	describe("scheduleOpen", () => {
		it("opens URL after 400ms delay", () => {
			opener.scheduleOpen("action-1", "https://github.com/repo");
			expect(mockOpenUrl).not.toHaveBeenCalled();
			vi.advanceTimersByTime(400);
			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/repo");
		});

		it("does not open URL before 400ms", () => {
			opener.scheduleOpen("action-1", "https://github.com/repo");
			vi.advanceTimersByTime(399);
			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("cancels previous timer when scheduling new one for same action", () => {
			opener.scheduleOpen("action-1", "https://github.com/first");
			opener.scheduleOpen("action-1", "https://github.com/second");
			vi.advanceTimersByTime(400);
			expect(mockOpenUrl).toHaveBeenCalledTimes(1);
			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/second");
		});
	});

	describe("schedule", () => {
		it("calls callback after 400ms delay", () => {
			const callback = vi.fn();
			opener.schedule("action-1", callback);
			expect(callback).not.toHaveBeenCalled();
			vi.advanceTimersByTime(400);
			expect(callback).toHaveBeenCalledOnce();
		});

		it("is detected by handlePress as pending timer", () => {
			opener.schedule("action-1", vi.fn());
			expect(opener.handlePress("action-1")).toBe(true);
		});
	});

	describe("cleanup", () => {
		it("prevents URL from opening", () => {
			opener.scheduleOpen("action-1", "https://github.com/repo");
			opener.cleanup("action-1");
			vi.advanceTimersByTime(400);
			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("prevents scheduled callback from running", () => {
			const callback = vi.fn();
			opener.schedule("action-1", callback);
			opener.cleanup("action-1");
			vi.advanceTimersByTime(400);
			expect(callback).not.toHaveBeenCalled();
		});

		it("is safe to call with no pending timer", () => {
			expect(() => opener.cleanup("nonexistent")).not.toThrow();
		});

		it("resets state so next press is treated as first", () => {
			opener.scheduleOpen("action-1", "https://github.com/repo");
			opener.cleanup("action-1");
			expect(opener.handlePress("action-1")).toBe(false);
		});
	});

	describe("double-click cancels URL open", () => {
		it("second press cancels the scheduled URL open", () => {
			opener.scheduleOpen("action-1", "https://github.com/repo");
			const isDoubleClick = opener.handlePress("action-1");
			expect(isDoubleClick).toBe(true);
			vi.advanceTimersByTime(400);
			expect(mockOpenUrl).not.toHaveBeenCalled();
		});

		it("allows new URL after double-click clears state", () => {
			opener.scheduleOpen("action-1", "https://github.com/first");
			opener.handlePress("action-1"); // double-click clears
			opener.scheduleOpen("action-1", "https://github.com/second");
			vi.advanceTimersByTime(400);
			expect(mockOpenUrl).toHaveBeenCalledWith("https://github.com/second");
		});
	});
});
