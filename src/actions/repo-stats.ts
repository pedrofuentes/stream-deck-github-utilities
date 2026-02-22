/**
 * Repo Stats Action — displays GitHub repository statistics on a Stream Deck button.
 *
 * Shows: stars, issues, forks, or watchers count for a configured repository.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to force refresh
 *   - SVG key images with accent-bar design (via setImage)
 *   - Visual error states with retry hint
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	KeyDownEvent,
	KeyUpEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, RepoStatsSettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { fetchRepoStats, fetchOpenPullRequestCount, getStatDisplay, getStatUrl, STAT_TYPES, type StatType } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderStatImage, renderLoadingImage, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const LONG_PRESS_THRESHOLD_MS = 500; // hold ≥ 500ms = long press

@action({ UUID: "com.pedrofuentes.github-utilities.repo-stats" })
export class RepoStatsAction extends SingletonAction<RepoStatsSettings> {
	/** Active polling timers keyed by action instance ID */
	private timers = new Map<string, ReturnType<typeof setInterval>>();

	/** Last known settings per action instance (for timer management) */
	private actionSettings = new Map<string, RepoStatsSettings>();

	/** Last resolved URL per action instance (opened on long press) */
	private lastUrl = new Map<string, string>();

	/** Timestamp when key was pressed down (for long/short press detection) */
	private keyDownTime = new Map<string, number>();

	/**
	 * Called when the action becomes visible on the Stream Deck.
	 * Sets up initial display and starts the polling timer.
	 */
	override async onWillAppear(ev: WillAppearEvent<RepoStatsSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			if (!settings.repo) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				return;
			}

			await ev.action.setImage(renderLoadingImage());
			await ev.action.setTitle("");
		}

		// Initial fetch
		await this.refreshStats(ev.action.id);

		// Start polling
		this.startTimer(ev.action.id, settings);
	}

	/**
	 * Called when the action is no longer visible. Cleans up the timer.
	 */
	override onWillDisappear(ev: WillDisappearEvent<RepoStatsSettings>): void {
		this.stopTimer(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.keyDownTime.delete(ev.action.id);
	}

	/**
	 * Called when the user presses the button down. Records timestamp for long/short press detection.
	 */
	override async onKeyDown(ev: KeyDownEvent<RepoStatsSettings>): Promise<void> {
		this.keyDownTime.set(ev.action.id, Date.now());
	}

	/**
	 * Called when the user releases the button.
	 * Short press (< 500ms): cycles to the next stat type.
	 * Long press (≥ 500ms): opens the stat's GitHub page in the browser.
	 */
	override async onKeyUp(ev: KeyUpEvent<RepoStatsSettings>): Promise<void> {
		const settings = ev.payload.settings;

		if (!settings.repo) {
			return;
		}

		const downTime = this.keyDownTime.get(ev.action.id) ?? Date.now();
		this.keyDownTime.delete(ev.action.id);
		const pressDuration = Date.now() - downTime;

		if (pressDuration >= LONG_PRESS_THRESHOLD_MS) {
			// Long press → open URL
			const url = this.lastUrl.get(ev.action.id);
			if (url) {
				await streamDeck.system.openUrl(url);
			} else {
				const parsed = parseRepoIdentifier(settings.repo);
				if (parsed) {
					const statType: StatType = settings.statType ?? "stars";
					await streamDeck.system.openUrl(getStatUrl(parsed.owner, parsed.repo, statType));
				}
			}
		} else {
			// Short press → cycle to next stat type
			const currentType: StatType = settings.statType ?? "stars";
			const currentIndex = STAT_TYPES.indexOf(currentType);
			const nextIndex = (currentIndex + 1) % STAT_TYPES.length;
			const nextType = STAT_TYPES[nextIndex];

			// Update settings with new stat type
			const newSettings: RepoStatsSettings = { ...settings, statType: nextType };
			await ev.action.setSettings(newSettings);
			this.actionSettings.set(ev.action.id, newSettings);

			// Refresh display immediately with new stat
			await this.refreshStats(ev.action.id);
		}
	}

	/**
	 * Handles messages from the Property Inspector (datasource requests).
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RepoStatsSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;

			if (!event || typeof event !== "string") {
				streamDeck.logger.debug(`RepoStats: received sendToPlugin without event: ${JSON.stringify(ev.payload)}`);
				return;
			}

			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`RepoStats onSendToPlugin error: ${message}`);
		}
	}

	/**
	 * Called when settings are changed from the Property Inspector.
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<RepoStatsSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			if (!settings.repo) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.stopTimer(ev.action.id);
				return;
			}

			await ev.action.setImage(renderLoadingImage());
			await ev.action.setTitle("");
		}

		// Re-fetch with new settings
		await this.refreshStats(ev.action.id);

		// Restart timer with potentially new interval
		this.stopTimer(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	/**
	 * Fetches repo stats and updates the button display.
	 */
	private async refreshStats(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) {
			return;
		}

		// Find the action context by ID
		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!actionContext || !actionContext.isKey()) {
			return;
		}

		const parsed = parseRepoIdentifier(settings.repo);
		if (!parsed) {
			await actionContext.setImage(renderErrorImage("Invalid"));
			await actionContext.setTitle("");
			return;
		}

		try {
			// Get the global token
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;

			// Fetch data from GitHub
			const stats = await fetchRepoStats(parsed.owner, parsed.repo, token);

			// Determine which stat to show
			const statType: StatType = settings.statType ?? "stars";

			// If user selected pull_requests, fetch the PR count separately
			if (statType === "pull_requests") {
				stats.open_pull_request_count = await fetchOpenPullRequestCount(parsed.owner, parsed.repo, token);
			}

			const displayValue = getStatDisplay(stats, statType, formatCount);

			await actionContext.setImage(renderStatImage(displayValue, statType, parsed.repo));
			await actionContext.setTitle("");

			// Store URL for key press
			this.lastUrl.set(actionId, getStatUrl(parsed.owner, parsed.repo, statType));

			streamDeck.logger.debug(`Repo stats updated: ${settings.repo} ${statType}=${displayValue}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch repo stats for ${settings.repo}: ${message}`);

			// Determine a short error label for the button
			let errorLabel = "Error";
			if (message.includes("rate limit")) {
				errorLabel = "Rate Limited";
			} else if (message.includes("not found")) {
				errorLabel = "Not Found";
			} else if (message.includes("token") || message.includes("401")) {
				errorLabel = "Auth Error";
			} else if (message.includes("Access denied")) {
				errorLabel = "No Access";
			}

			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	/**
	 * Starts the auto-refresh polling timer for an action instance.
	 */
	private startTimer(actionId: string, settings: RepoStatsSettings): void {
		if (!settings.repo) {
			return;
		}

		const intervalSec = Math.max(
			settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL,
			MIN_REFRESH_INTERVAL,
		);

		const timer = setInterval(() => {
			this.refreshStats(actionId).catch((err) => {
				streamDeck.logger.error(`Timer refresh failed for ${actionId}: ${err}`);
			});
		}, intervalSec * 1000);

		this.timers.set(actionId, timer);
		streamDeck.logger.debug(`Started timer for ${actionId} with ${intervalSec}s interval`);
	}

	/**
	 * Stops the polling timer for an action instance.
	 */
	private stopTimer(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(actionId);
			streamDeck.logger.debug(`Stopped timer for ${actionId}`);
		}
	}
}
