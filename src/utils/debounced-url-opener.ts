/**
 * Debounced URL opener for Stream Deck key presses.
 *
 * Manages timer-based double-click detection: first press schedules an action
 * after 400ms; a second press within that window cancels it and signals a
 * double-click (force refresh).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import streamDeck from "@elgato/streamdeck";

/** Threshold for double-click detection (ms). */
const DOUBLE_CLICK_MS = 400;

/**
 * Manages debounced URL opens for Stream Deck key presses.
 * On first press, schedules a URL open after 400ms.
 * If a second press arrives within that window, cancels the URL open
 * and returns `true` to signal a double-click (force refresh).
 */
export class DebouncedUrlOpener {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	/**
	 * Handle a key press. If a pending timer exists (second click),
	 * cancels it and returns `true` (double-click detected).
	 * Otherwise returns `false` (first click — caller should compute URL
	 * and call {@link scheduleOpen}).
	 */
	handlePress(actionId: string): boolean {
		const pending = this.timers.get(actionId);
		if (pending) {
			clearTimeout(pending);
			this.timers.delete(actionId);
			return true; // double-click
		}
		return false; // first click
	}

	/**
	 * Schedule a URL to open after the double-click window.
	 * Call this after computing the URL on the first click.
	 */
	scheduleOpen(actionId: string, url: string): void {
		this.schedule(actionId, () => {
			streamDeck.system.openUrl(url);
		});
	}

	/**
	 * Schedule an arbitrary callback after the double-click window.
	 * Use this for actions that aren't simple URL opens (e.g. stat cycling).
	 */
	schedule(actionId: string, callback: () => void): void {
		const existing = this.timers.get(actionId);
		if (existing) {
			clearTimeout(existing);
		}
		this.timers.set(actionId, setTimeout(() => {
			this.timers.delete(actionId);
			callback();
		}, DOUBLE_CLICK_MS));
	}

	/**
	 * Cancel any pending timer for this action.
	 * Call this in onWillDisappear.
	 */
	cleanup(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(actionId);
		}
	}
}
