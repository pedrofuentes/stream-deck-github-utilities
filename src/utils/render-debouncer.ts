/**
 * Manages debounced render callbacks per action ID.
 * Cancels any pending render when a new one is scheduled,
 * ensuring only the latest render fires.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

export class RenderDebouncer {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	/**
	 * Schedule a render callback after a delay.
	 * Cancels any previously pending render for this action.
	 */
	schedule(actionId: string, callback: () => void, delayMs: number): void {
		this.cleanup(actionId);
		this.timers.set(actionId, setTimeout(() => {
			this.timers.delete(actionId);
			callback();
		}, delayMs));
	}

	/**
	 * Cancel any pending render for this action.
	 * Call in onWillDisappear.
	 */
	cleanup(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(actionId);
		}
	}
}
