/**
 * Tests for the MarqueeController (src/utils/marquee-controller.ts).
 *
 * Verifies the circular scrolling behavior, pause ticks, separator insertion,
 * and edge cases for the marquee text animation system.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { describe, it, expect } from "vitest";
import {
	MarqueeController,
	MARQUEE_PAUSE_TICKS,
	MARQUEE_SEPARATOR,
} from "../../src/utils/marquee-controller";

describe("MarqueeController", () => {
	// ── Constructor & defaults ──────────────────────────

	describe("constructor", () => {
		it("defaults maxVisible to 10", () => {
			const mc = new MarqueeController();
			mc.setText("short");
			expect(mc.getCurrentText()).toBe("short");
			expect(mc.needsAnimation()).toBe(false);
		});

		it("accepts a custom maxVisible", () => {
			const mc = new MarqueeController(5);
			mc.setText("longtext");
			expect(mc.needsAnimation()).toBe(true);
			expect(mc.getCurrentText()).toHaveLength(5);
		});
	});

	// ── setText ─────────────────────────────────────────

	describe("setText", () => {
		it("stores the text", () => {
			const mc = new MarqueeController(10);
			mc.setText("hello");
			expect(mc.getFullText()).toBe("hello");
		});

		it("resets scroll position when text changes", () => {
			const mc = new MarqueeController(5);
			mc.setText("longtext123");

			// Advance past the pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
			mc.tick(); // offset 1
			expect(mc.getCurrentText()).toBe("ongte");

			// Change text — should reset to start
			mc.setText("anothertext");
			expect(mc.getCurrentText()).toBe("anoth");
		});

		it("does not reset when same text is set", () => {
			const mc = new MarqueeController(5);
			mc.setText("longtext123");

			// Advance past pause + 1
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
			mc.tick();
			const textAfterScroll = mc.getCurrentText();

			// Set same text — should NOT reset
			mc.setText("longtext123");
			expect(mc.getCurrentText()).toBe(textAfterScroll);
		});
	});

	// ── needsAnimation ──────────────────────────────────

	describe("needsAnimation", () => {
		it("returns false for empty text", () => {
			const mc = new MarqueeController(10);
			mc.setText("");
			expect(mc.needsAnimation()).toBe(false);
		});

		it("returns false when text fits exactly", () => {
			const mc = new MarqueeController(5);
			mc.setText("exact");
			expect(mc.needsAnimation()).toBe(false);
		});

		it("returns false when text is shorter than maxVisible", () => {
			const mc = new MarqueeController(10);
			mc.setText("short");
			expect(mc.needsAnimation()).toBe(false);
		});

		it("returns true when text exceeds maxVisible", () => {
			const mc = new MarqueeController(5);
			mc.setText("toolong");
			expect(mc.needsAnimation()).toBe(true);
		});

		it("returns true when text exceeds by one character", () => {
			const mc = new MarqueeController(5);
			mc.setText("sixchr");
			expect(mc.needsAnimation()).toBe(true);
		});
	});

	// ── getCurrentText ──────────────────────────────────

	describe("getCurrentText", () => {
		it("returns full text when it fits", () => {
			const mc = new MarqueeController(10);
			mc.setText("hello");
			expect(mc.getCurrentText()).toBe("hello");
		});

		it("returns first maxVisible chars at offset 0", () => {
			const mc = new MarqueeController(5);
			mc.setText("abcdefghij");
			expect(mc.getCurrentText()).toBe("abcde");
		});

		it("returns windowed text after scrolling", () => {
			const mc = new MarqueeController(5);
			mc.setText("abcdefghij");

			// Skip past pause ticks
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

			// First scroll step
			mc.tick();
			expect(mc.getCurrentText()).toBe("bcdef");
		});

		it("includes separator when scrolled far enough", () => {
			const mc = new MarqueeController(5);
			mc.setText("abcde");
			// Text is exactly 5, same as maxVisible — no animation
			expect(mc.needsAnimation()).toBe(false);

			// Now with slightly longer text
			const mc2 = new MarqueeController(5);
			mc2.setText("abcdef"); // 6 chars, needs scrolling

			// Skip pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc2.tick();

			// Scroll to where separator appears: "abcdef" + "  •  "
			// offset 1: "bcdef "
			mc2.tick();
			expect(mc2.getCurrentText()).toBe("bcdef");

			// offset 2: "cdef  " — text ends, separator starts
			// full loop: "abcdef  •  " = 11 chars
			// offset 2: chars at indices 2,3,4,5,6 → "cdef " → "cdef "
		});

		it("wraps around to create seamless loop", () => {
			const mc = new MarqueeController(3);
			mc.setText("ABCD"); // 4 chars + "  •  " = 9 char loop

			// Skip pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

			// Collect all frames through a full loop
			const frames: string[] = [mc.getCurrentText()]; // "ABC" at offset 0
			const loopLen = "ABCD".length + MARQUEE_SEPARATOR.length;

			for (let i = 1; i < loopLen; i++) {
				mc.tick();
				frames.push(mc.getCurrentText());
			}

			// First frame should show start of text
			expect(frames[0]).toBe("ABC");
			// Some frame should contain the bullet separator
			expect(frames.some((f) => f.includes("\u2022"))).toBe(true);
			// Last frame + 1 tick should wrap back to start (but will be paused)
			mc.tick(); // This wraps offset to 0, sets pause
			expect(mc.getCurrentText()).toBe("ABC");
		});
	});

	// ── tick ────────────────────────────────────────────

	describe("tick", () => {
		it("returns false when text fits (no animation needed)", () => {
			const mc = new MarqueeController(10);
			mc.setText("short");
			expect(mc.tick()).toBe(false);
		});

		it("returns false during initial pause", () => {
			const mc = new MarqueeController(5);
			mc.setText("toolongtext");

			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) {
				expect(mc.tick()).toBe(false);
			}
		});

		it("returns true after pause completes (scrolling begins)", () => {
			const mc = new MarqueeController(5);
			mc.setText("toolongtext");

			// Exhaust pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

			// First scroll tick
			expect(mc.tick()).toBe(true);
		});

		it("pauses again when offset wraps to 0", () => {
			const mc = new MarqueeController(3);
			mc.setText("ABCD"); // loop length = 4 + 5 = 9

			// Exhaust initial pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();

			// Scroll through full loop (9 ticks)
			const loopLen = "ABCD".length + MARQUEE_SEPARATOR.length;
			for (let i = 0; i < loopLen; i++) mc.tick();

			// Now offset should be back at 0, pause renewed
			// Next ticks should return false (pausing)
			expect(mc.tick()).toBe(false);
		});

		it("pause ticks equal MARQUEE_PAUSE_TICKS constant", () => {
			const mc = new MarqueeController(5);
			mc.setText("toolongtext");

			let pauseCount = 0;
			while (!mc.tick()) {
				pauseCount++;
				if (pauseCount > 100) break; // safety
			}

			expect(pauseCount).toBe(MARQUEE_PAUSE_TICKS);
		});
	});

	// ── reset ───────────────────────────────────────────

	describe("reset", () => {
		it("resets to start position with pause", () => {
			const mc = new MarqueeController(5);
			mc.setText("longtext123");

			// Advance past pause + several ticks
			for (let i = 0; i < MARQUEE_PAUSE_TICKS + 3; i++) mc.tick();

			mc.reset();

			// Should be back at start
			expect(mc.getCurrentText()).toBe("longt");

			// Should be paused again
			expect(mc.tick()).toBe(false);
		});
	});

	// ── getFullText ─────────────────────────────────────

	describe("getFullText", () => {
		it("returns the full unsliced text", () => {
			const mc = new MarqueeController(5);
			mc.setText("abcdefghij");
			expect(mc.getFullText()).toBe("abcdefghij");
		});

		it("returns empty string when no text set", () => {
			const mc = new MarqueeController(10);
			expect(mc.getFullText()).toBe("");
		});
	});

	// ── Integration: full scroll cycle ──────────────────

	describe("full scroll cycle", () => {
		it("completes a full loop and returns to start", () => {
			const mc = new MarqueeController(5);
			const text = "HelloWorld";
			mc.setText(text);

			const loopLen = text.length + MARQUEE_SEPARATOR.length;

			// Skip initial pause
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) {
				expect(mc.tick()).toBe(false);
			}

			// Scroll through entire loop
			for (let i = 0; i < loopLen; i++) {
				expect(mc.tick()).toBe(true);
			}

			// Back at start — should be paused
			expect(mc.getCurrentText()).toBe("Hello");
			expect(mc.tick()).toBe(false);
		});

		it("works with maxVisible=14 (line1 repo name)", () => {
			const mc = new MarqueeController(14);
			mc.setText("pedrofuentes/stream-deck-github-utilities");

			expect(mc.needsAnimation()).toBe(true);
			expect(mc.getCurrentText()).toBe("pedrofuentes/s");
			expect(mc.getCurrentText()).toHaveLength(14);

			// Scroll a few ticks
			for (let i = 0; i < MARQUEE_PAUSE_TICKS; i++) mc.tick();
			mc.tick();
			expect(mc.getCurrentText()).toBe("edrofuentes/st");
		});

		it("works with maxVisible=16 (line2 stat value)", () => {
			const mc = new MarqueeController(16);
			mc.setText("feature/long-branch-name-here");

			expect(mc.needsAnimation()).toBe(true);
			expect(mc.getCurrentText()).toHaveLength(16);
			expect(mc.getCurrentText()).toBe("feature/long-bra");
		});

		it("works with maxVisible=18 (line3 metadata)", () => {
			const mc = new MarqueeController(18);
			mc.setText("staging-environment-long-name");

			expect(mc.needsAnimation()).toBe(true);
			expect(mc.getCurrentText()).toHaveLength(18);
			expect(mc.getCurrentText()).toBe("staging-environmen");
		});

		it("does not animate when text equals maxVisible", () => {
			const mc = new MarqueeController(14);
			mc.setText("exactly14chars");
			expect(mc.needsAnimation()).toBe(false);
			expect(mc.getCurrentText()).toBe("exactly14chars");
		});
	});

	// ── MARQUEE_SEPARATOR constant ──────────────────────

	describe("MARQUEE_SEPARATOR", () => {
		it("is 5 characters: 2 spaces + bullet + 2 spaces", () => {
			expect(MARQUEE_SEPARATOR).toBe("  \u2022  ");
			expect(MARQUEE_SEPARATOR).toHaveLength(5);
		});
	});

	// ── MARQUEE_PAUSE_TICKS constant ────────────────────

	describe("MARQUEE_PAUSE_TICKS", () => {
		it("is 3", () => {
			expect(MARQUEE_PAUSE_TICKS).toBe(3);
		});
	});
});
