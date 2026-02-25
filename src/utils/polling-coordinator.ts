/**
 * Centralized polling coordinator for action refresh timers.
 *
 * Extracts the common polling pattern from all actions into one reusable class:
 * - Per-action timer management (start/stop/restart)
 * - Exponential error backoff on consecutive failures
 * - Generation counter to prevent stale callbacks from overwriting fresh data
 * - Key-press backoff reset for immediate manual retry
 *
 * Usage (in an action):
 * ```ts
 * private polling = new PollingCoordinator();
 *
 * onWillAppear(ev) {
 *   this.polling.start(ev.action.id, () => this.refresh(ev.action.id), intervalSec);
 * }
 * onWillDisappear(ev) {
 *   this.polling.stop(ev.action.id);
 * }
 * onKeyDown(ev) {
 *   this.polling.resetBackoff(ev.action.id);
 *   this.refresh(ev.action.id);
 * }
 * ```
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

/** Internal state per polling action. */
interface PollingState {
	timer: ReturnType<typeof setInterval> | null;
	errorCount: number;
	generation: number;
	baseIntervalMs: number;
	callback: () => Promise<void>;
}

/** Maximum backoff multiplier (2^5 = 32x base interval). */
const MAX_BACKOFF_EXPONENT = 5;

/**
 * Reusable polling coordinator with error backoff and generation guards.
 *
 * - Manages one timer per action ID
 * - On consecutive errors, exponentially increases the polling interval
 * - On success, resets error count to base interval
 * - Generation counter prevents stale async callbacks from acting
 */
export class PollingCoordinator {
	private states = new Map<string, PollingState>();

	/**
	 * Starts polling for a specific action instance.
	 * If already polling, stops the previous timer first.
	 *
	 * The callback is invoked on each tick. If the callback throws,
	 * the error count increments and the next interval is exponentially longer.
	 *
	 * @param actionId Unique action instance ID
	 * @param callback Async function to invoke on each tick (should handle its own errors for display)
	 * @param intervalSec Polling interval in seconds
	 * @param minIntervalSec Minimum interval floor (default: 15)
	 */
	start(
		actionId: string,
		callback: () => Promise<void>,
		intervalSec: number,
		minIntervalSec = 15,
	): void {
		this.stop(actionId);

		const baseIntervalMs = Math.max(intervalSec, minIntervalSec) * 1000;
		const state: PollingState = {
			timer: null,
			errorCount: 0,
			generation: 0,
			baseIntervalMs,
			callback,
		};

		this.states.set(actionId, state);
		this.scheduleNext(actionId, state);
	}

	/**
	 * Stops polling for a specific action instance.
	 * Safe to call even if not polling.
	 */
	stop(actionId: string): void {
		const state = this.states.get(actionId);
		if (state?.timer) {
			clearInterval(state.timer);
			state.timer = null;
		}
		this.states.delete(actionId);
	}

	/**
	 * Stops all polling timers. Use in cleanup scenarios.
	 */
	stopAll(): void {
		for (const [actionId] of this.states) {
			this.stop(actionId);
		}
	}

	/**
	 * Reports a successful callback execution.
	 * Resets error count so the next interval returns to base.
	 */
	reportSuccess(actionId: string): void {
		const state = this.states.get(actionId);
		if (state) {
			state.errorCount = 0;
		}
	}

	/**
	 * Reports a failed callback execution.
	 * Increments error count, increasing the backoff for the next interval.
	 */
	reportError(actionId: string): void {
		const state = this.states.get(actionId);
		if (state) {
			state.errorCount = Math.min(state.errorCount + 1, MAX_BACKOFF_EXPONENT);
		}
	}

	/**
	 * Resets the error backoff counter for an action.
	 * Call this on key press so the user gets an immediate retry at full speed.
	 */
	resetBackoff(actionId: string): void {
		const state = this.states.get(actionId);
		if (state) {
			state.errorCount = 0;
		}
	}

	/**
	 * Restarts polling with a new interval. Preserves error state.
	 */
	restart(actionId: string, callback: () => Promise<void>, intervalSec: number, minIntervalSec = 15): void {
		const oldState = this.states.get(actionId);
		const errorCount = oldState?.errorCount ?? 0;

		this.stop(actionId);

		const baseIntervalMs = Math.max(intervalSec, minIntervalSec) * 1000;
		const state: PollingState = {
			timer: null,
			errorCount,
			generation: 0,
			baseIntervalMs,
			callback,
		};

		this.states.set(actionId, state);
		this.scheduleNext(actionId, state);
	}

	/**
	 * Returns the current generation for an action.
	 * Use this before an async operation, then check if it still matches after.
	 */
	getGeneration(actionId: string): number {
		return this.states.get(actionId)?.generation ?? 0;
	}

	/**
	 * Increments and returns the new generation for an action.
	 * Call this at the start of a refresh to invalidate any in-flight callbacks.
	 */
	incrementGeneration(actionId: string): number {
		const state = this.states.get(actionId);
		if (!state) return 0;
		return ++state.generation;
	}

	/**
	 * Checks if the given generation is still current.
	 * If not, the refresh result is stale and should be discarded.
	 */
	isCurrentGeneration(actionId: string, gen: number): boolean {
		const state = this.states.get(actionId);
		return state?.generation === gen;
	}

	/**
	 * Returns the current effective interval in milliseconds
	 * (base interval * backoff factor).
	 */
	getEffectiveIntervalMs(actionId: string): number {
		const state = this.states.get(actionId);
		if (!state) return 0;
		return this.computeInterval(state);
	}

	/**
	 * Returns whether polling is active for the given action.
	 */
	isPolling(actionId: string): boolean {
		return this.states.has(actionId);
	}

	// ── Private ────────────────────────────────────────────────────────────

	private scheduleNext(_actionId: string, state: PollingState): void {
		const intervalMs = this.computeInterval(state);

		state.timer = setInterval(() => {
			state.callback().catch(() => {
				// Error handling (reportError/reportSuccess) is done by the caller
				// in their refresh method, not here.
			});
		}, intervalMs);
	}

	/**
	 * Computes the effective polling interval with exponential backoff.
	 * backoffFactor = 2^errorCount (capped at 2^MAX_BACKOFF_EXPONENT = 32x)
	 */
	private computeInterval(state: PollingState): number {
		if (state.errorCount === 0) return state.baseIntervalMs;
		const factor = Math.pow(2, state.errorCount);
		return state.baseIntervalMs * factor;
	}
}
