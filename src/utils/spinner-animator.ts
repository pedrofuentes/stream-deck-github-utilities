/**
 * Manages frame-based spinner animation for Stream Deck loading states.
 *
 * Since Stream Deck renders SVG images statically (no CSS animations or SMIL),
 * loading spinners must be implemented as frame-by-frame image updates.
 *
 * This class manages the animation lifecycle: starting, ticking through frames,
 * and stopping. The caller provides a callback that receives the current frame
 * number and is responsible for rendering/setting the image.
 *
 * Usage pattern (in an action):
 * ```ts
 * const spinner = new SpinnerAnimator();
 * spinner.start((frame) => {
 *   action.setImage(renderSpinnerFrame(frame));
 * });
 * // ... later, when data arrives:
 * spinner.stop();
 * ```
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import { SPINNER_FRAME_COUNT, SPINNER_INTERVAL_MS } from "./button-renderer";

/**
 * Frame-based spinner animation controller.
 *
 * Similar to {@link MarqueeController}, this class manages cyclical
 * animation state. The action that uses it owns the timer lifecycle
 * and image rendering — this controller manages frame progression.
 */
export class SpinnerAnimator {
	private frame = 0;
	private timer: ReturnType<typeof setInterval> | null = null;

	/**
	 * Starts the spinner animation. Calls `onFrame` immediately with frame 0,
	 * then advances through frames at the given interval.
	 *
	 * If already running, stops the current animation first.
	 *
	 * @param onFrame Callback invoked on each frame with the frame index (0–7)
	 * @param intervalMs Time between frames in milliseconds (default: 150)
	 */
	start(onFrame: (frame: number) => void, intervalMs = SPINNER_INTERVAL_MS): void {
		this.stop();
		this.frame = 0;
		onFrame(this.frame);
		this.timer = setInterval(() => {
			this.frame = (this.frame + 1) % SPINNER_FRAME_COUNT;
			onFrame(this.frame);
		}, intervalMs);
	}

	/**
	 * Stops the spinner animation. Safe to call even if not running.
	 */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	/**
	 * Returns whether the spinner animation is currently running.
	 */
	isRunning(): boolean {
		return this.timer !== null;
	}
}

// ── Convenience helpers for Map-based action management ────────────────────

/**
 * Starts an animated loading spinner for a specific action instance.
 * Stops any existing spinner for the same action first.
 *
 * @param spinners Map of action ID → SpinnerAnimator (owned by the action class)
 * @param actionId The action instance ID
 * @param onFrame Callback receiving frame index (0–7) — typically renders and sets the image
 */
export function startLoadingSpinner(
	spinners: Map<string, SpinnerAnimator>,
	actionId: string,
	onFrame: (frame: number) => void,
): void {
	spinners.get(actionId)?.stop();
	const spinner = new SpinnerAnimator();
	spinners.set(actionId, spinner);
	spinner.start(onFrame);
}

/**
 * Stops and removes a loading spinner for a specific action instance.
 * Safe to call even if no spinner exists for the given ID.
 *
 * @param spinners Map of action ID → SpinnerAnimator (owned by the action class)
 * @param actionId The action instance ID
 */
export function stopLoadingSpinner(
	spinners: Map<string, SpinnerAnimator>,
	actionId: string,
): void {
	spinners.get(actionId)?.stop();
	spinners.delete(actionId);
}
