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
import { renderStatImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const LONG_PRESS_THRESHOLD_MS = 500; // hold ≥ 500ms = long press
const MARQUEE_INTERVAL_MS = 500; // marquee scroll speed
const LINE1_MAX_VISIBLE = 14; // max chars at 18px (hardware-tested)
const LINE2_MAX_VISIBLE = 16; // max chars at 18px for stat value

/** Cached render data and marquee state per action instance. */
interface MarqueeData {
	line1: MarqueeController;
	line2: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	displayValue: string;
	statType: StatType;
	repoName: string;
}

@action({ UUID: "com.pedrofuentes.github-utilities.repo-stats" })
export class RepoStatsAction extends SingletonAction<RepoStatsSettings> {
	/** Centralized polling coordinator with error backoff */
	private polling = new PollingCoordinator();

	/** Last known settings per action instance (for timer management) */
	private actionSettings = new Map<string, RepoStatsSettings>();

	/** Last resolved URL per action instance (opened on long press) */
	private lastUrl = new Map<string, string>();

	/** Timestamp when key was pressed down (for long/short press detection) */
	private keyDownTime = new Map<string, number>();

	/** Marquee scroll state per action instance */
	private marqueeData = new Map<string, MarqueeData>();

	/**
	 * IDs of actions that recently had setSettings called programmatically
	 * (from onKeyUp). Used to suppress the redundant loading/refresh that
	 * onDidReceiveSettings would otherwise trigger.
	 */
	private recentSetSettings = new Set<string>();

	/**
	 * Called when the action becomes visible on the Stream Deck.
	 * Sets up initial display and starts the polling timer.
	 */
	override async onWillAppear(ev: WillAppearEvent<RepoStatsSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		}

		// Start polling (creates state for generation counter)
		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshStats(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		// Initial fetch
		await this.refreshStats(ev.action.id);
	}

	/**
	 * Called when the action is no longer visible. Cleans up the timer.
	 */
	override onWillDisappear(ev: WillDisappearEvent<RepoStatsSettings>): void {
		this.polling.stop(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.keyDownTime.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
		this.recentSetSettings.delete(ev.action.id);
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
		// Prefer cached settings — the event payload may be missing fields if
		// sdpi-components sent a partial setSettings (overwriting repo to undefined).
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;

		if (!repo) {
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
				const parsed = parseRepoIdentifier(repo);
				if (parsed) {
					const statType: StatType = cached?.statType ?? settings.statType ?? "stars";
					await streamDeck.system.openUrl(getStatUrl(parsed.owner, parsed.repo, statType));
				}
			}
		} else {
			// Short press → cycle to next stat type
			// Use the local actionSettings cache as the source of truth for the
			// current stat type. The cache always reflects our own setSettings
			// calls, whereas ev.payload.settings may be stale when multiple
			// button instances exist or rapid presses occur.
			const cachedSettings = this.actionSettings.get(ev.action.id);
			const currentType: StatType = cachedSettings?.statType ?? settings.statType ?? "stars";
			const currentIndex = STAT_TYPES.indexOf(currentType);
			const nextIndex = (currentIndex + 1) % STAT_TYPES.length;
			const nextType = STAT_TYPES[nextIndex];

			// Update settings with new stat type
			const newSettings: RepoStatsSettings = { ...settings, ...cachedSettings, statType: nextType };
			// Mark this action as recently updated by us, so onDidReceiveSettings
			// can skip its redundant loading/refresh cycle.
			this.recentSetSettings.add(ev.action.id);
			await ev.action.setSettings(newSettings);
			this.actionSettings.set(ev.action.id, newSettings);

			// Refresh display immediately with new stat
			this.polling.resetBackoff(ev.action.id);
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
		const incoming = ev.payload.settings;

		// When onKeyUp calls setSettings, the SD app echoes didReceiveSettings
		// back. We already handled the refresh in onKeyUp, so skip the
		// redundant loading → re-fetch cycle to avoid flicker and races.
		if (this.recentSetSettings.delete(ev.action.id)) {
			// Still update the cache with whatever the SD persisted, then bail.
			this.actionSettings.set(ev.action.id, incoming);
			return;
		}

		// Merge incoming settings with cached settings to protect against
		// partial updates (e.g. sdpi-components sending statType without repo).
		const cached = this.actionSettings.get(ev.action.id);
		const settings: RepoStatsSettings = { ...cached, ...incoming };

		// Apply in-memory defaults (the PI send interceptor persists these,
		// so they should already be present; this is a safety fallback).
		if (settings.repo && !settings.statType) {
			settings.statType = "stars";
		}
		if (settings.repo && !settings.refreshInterval) {
			settings.refreshInterval = 300;
		}

		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.polling.stop(ev.action.id);
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		}

		// Restart timer with potentially new interval (creates fresh state for generation counter)
		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshStats(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		// Re-fetch with new settings
		await this.refreshStats(ev.action.id);
	}

	/**
	 * Fetches repo stats and updates the button display.
	 */
	private async refreshStats(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) {
			return;
		}

		// Generation counter — prevents stale async results from overwriting fresh data
		const gen = this.polling.incrementGeneration(actionId);

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

			if (!token) {
				await actionContext.setImage(renderUnconfiguredImage());
				await actionContext.setTitle("");
				return;
			}

			// Fetch data from GitHub
			const stats = await fetchRepoStats(parsed.owner, parsed.repo, token);

			// Determine which stat to show
			const statType: StatType = settings.statType ?? "stars";

			// If user selected pull_requests, fetch the PR count separately
			if (statType === "pull_requests") {
				stats.open_pull_request_count = await fetchOpenPullRequestCount(parsed.owner, parsed.repo, token);
			}

			const displayValue = getStatDisplay(stats, statType, formatCount);

			// Discard stale result if a newer refresh has started
			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			// Update marquee controllers and cache render data
			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.line2.setText(displayValue);
			md.displayValue = displayValue;
			md.statType = statType;
			md.repoName = parsed.repo;

			// Render with current marquee window position
			await this.renderWithMarquee(actionId);

			// Start/stop marquee timer based on whether any line needs animation
			this.updateMarqueeTimer(actionId);

			// Store URL for key press
			this.lastUrl.set(actionId, getStatUrl(parsed.owner, parsed.repo, statType));

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`Repo stats updated: ${settings.repo} ${statType}=${displayValue}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch repo stats for ${settings.repo}: ${message}`);

			// Stop marquee on error — nothing to scroll
			this.stopMarquee(actionId);

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

			this.polling.reportError(actionId);
			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	// ── Marquee helpers ────────────────────────────────────────────────────

	/**
	 * Gets or creates marquee state for an action instance.
	 */
	private getOrCreateMarquee(actionId: string): MarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				line2: new MarqueeController(LINE2_MAX_VISIBLE),
				timer: null,
				displayValue: "",
				statType: "stars",
				repoName: "",
			};
			this.marqueeData.set(actionId, md);
		}
		return md;
	}

	/**
	 * Renders the button using the current marquee window position.
	 * Uses cached render data so no API call is needed.
	 */
	private async renderWithMarquee(actionId: string): Promise<void> {
		const md = this.marqueeData.get(actionId);
		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!md || !actionContext?.isKey()) return;

		const displayName = md.line1.needsAnimation()
			? md.line1.getCurrentText()
			: md.repoName;
		const displayValue = md.line2.needsAnimation()
			? md.line2.getCurrentText()
			: md.displayValue;

		await actionContext.setImage(renderStatImage(displayValue, md.statType, displayName));
		await actionContext.setTitle("");
	}

	/**
	 * Starts or stops the marquee animation timer based on whether any line
	 * needs scrolling.
	 */
	private updateMarqueeTimer(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (!md) return;

		const needsAnimation = md.line1.needsAnimation() || md.line2.needsAnimation();

		if (needsAnimation && !md.timer) {
			md.timer = setInterval(() => {
				const changed1 = md.line1.tick();
				const changed2 = md.line2.tick();
				if (changed1 || changed2) {
					this.renderWithMarquee(actionId).catch(() => { /* marquee render error — ignore */ });
				}
			}, MARQUEE_INTERVAL_MS);
		} else if (!needsAnimation && md.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}

	/**
	 * Stops the marquee animation timer for an action instance.
	 */
	private stopMarquee(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (md?.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}
}
