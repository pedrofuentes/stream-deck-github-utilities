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
	type Action,
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import type {
	DialRotateEvent,
	DialDownEvent,
	DialUpEvent,
	TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, RepoStatsSettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { getStatDisplay, getStatUrl, STAT_TYPES, type StatType } from "../utils/github-api";
import { coordinator } from "../utils/graphql-query-coordinator";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderStatImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { renderStatStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const LONG_PRESS_THRESHOLD_MS = 500; // hold ≥ 500ms = long press
const MARQUEE_INTERVAL_MS = 500; // marquee scroll speed
const LINE1_MAX_VISIBLE = 14; // max chars at 18px (hardware-tested)
const LINE2_MAX_VISIBLE = 16; // max chars at 18px for stat value
const DOUBLE_CLICK_MS = 400;

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

	/** Timestamp of last key-up per action (for double-click detection) */
	private openUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Marquee scroll state per action instance */
	private marqueeData = new Map<string, MarqueeData>();

	/**
	 * IDs of actions that recently had setSettings called programmatically
	 * (from onKeyUp). Used to suppress the redundant loading/refresh that
	 * onDidReceiveSettings would otherwise trigger.
	 */
	private recentSetSettings = new Set<string>();

	/** Sparkline trend cache per action instance (last N stat values) */
	private trendCache = new Map<string, number[]>();

	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<RepoStatsSettings>>();

	/**
	 * Called when the action becomes visible on the Stream Deck.
	 * Sets up initial display and starts the polling timer.
	 */
	override async onWillAppear(ev: WillAppearEvent<RepoStatsSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
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

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		// Subscribe to coordinator for data fetching
		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		coordinator.subscribe({
			actionId: ev.action.id,
			repo: settings.repo!,
			fragments: ["repoMetadata", "prCount"],
			maxAgeSec: intervalSec,
		}, () => this.refreshStats(ev.action.id));

		// Start polling (creates state for generation counter)
		this.polling.start(ev.action.id, () => this.refreshStats(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		// Initial fetch
		await this.refreshStats(ev.action.id);
	}

	/**
	 * Called when the action is no longer visible. Cleans up the timer.
	 */
	override onWillDisappear(ev: WillDisappearEvent<RepoStatsSettings>): void {
		coordinator.unsubscribe(ev.action.id);
		this.polling.stop(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.keyDownTime.delete(ev.action.id);
		const urlTimer = this.openUrlTimers.get(ev.action.id);
		if (urlTimer) {
			clearTimeout(urlTimer);
			this.openUrlTimers.delete(ev.action.id);
		}
		this.marqueeData.delete(ev.action.id);
		this.recentSetSettings.delete(ev.action.id);
		this.trendCache.delete(ev.action.id);
		this.actionContexts.delete(ev.action.id);
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
		// Double-click detection with debounced action
		const pendingTimer = this.openUrlTimers.get(ev.action.id);
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			this.openUrlTimers.delete(ev.action.id);
			this.polling.resetBackoff(ev.action.id);
			await this.refreshStats(ev.action.id, true);
			return;
		}

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
			// Long press → schedule URL open with debounce
			const url = this.lastUrl.get(ev.action.id);
			if (url) {
				this.openUrlTimers.set(ev.action.id, setTimeout(() => {
					this.openUrlTimers.delete(ev.action.id);
					streamDeck.system.openUrl(url);
				}, DOUBLE_CLICK_MS));
			} else {
				const parsed = parseRepoIdentifier(repo);
				if (parsed) {
					const statType: StatType = cached?.statType ?? settings.statType ?? "stars";
					const computedUrl = getStatUrl(parsed.owner, parsed.repo, statType);
					this.openUrlTimers.set(ev.action.id, setTimeout(() => {
						this.openUrlTimers.delete(ev.action.id);
						streamDeck.system.openUrl(computedUrl);
					}, DOUBLE_CLICK_MS));
				}
			}
		} else {
			// Short press → schedule stat cycle with debounce
			this.openUrlTimers.set(ev.action.id, setTimeout(async () => {
				this.openUrlTimers.delete(ev.action.id);
				// Cycle to next stat type
				const cachedSettings = this.actionSettings.get(ev.action.id);
				const currentType: StatType = cachedSettings?.statType ?? settings.statType ?? "stars";
				const currentIndex = STAT_TYPES.indexOf(currentType);
				const nextIndex = (currentIndex + 1) % STAT_TYPES.length;
				const nextType = STAT_TYPES[nextIndex];

				const newSettings: RepoStatsSettings = { ...settings, ...cachedSettings, statType: nextType };
				this.recentSetSettings.add(ev.action.id);
				await ev.action.setSettings(newSettings);
				this.actionSettings.set(ev.action.id, newSettings);

				this.polling.resetBackoff(ev.action.id);
				await this.refreshStats(ev.action.id);
			}, DOUBLE_CLICK_MS));
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
	 * Called when the user rotates the dial (Stream Deck+).
	 * Cycles to the next/previous stat type.
	 */
	override async onDialRotate(ev: DialRotateEvent<RepoStatsSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const currentType: StatType = settings.statType ?? "stars";
		const currentIndex = STAT_TYPES.indexOf(currentType);
		const direction = ev.payload.ticks > 0 ? 1 : -1;
		const nextIndex = (currentIndex + direction + STAT_TYPES.length) % STAT_TYPES.length;
		const nextType = STAT_TYPES[nextIndex];

		const newSettings: RepoStatsSettings = { ...settings, statType: nextType };
		this.recentSetSettings.add(ev.action.id);
		await ev.action.setSettings(newSettings);
		this.actionSettings.set(ev.action.id, newSettings);

		this.polling.resetBackoff(ev.action.id);
		await this.refreshStats(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Records timestamp for long/short press detection.
	 */
	override async onDialDown(ev: DialDownEvent<RepoStatsSettings>): Promise<void> {
		this.keyDownTime.set(ev.action.id, Date.now());
	}

	/**
	 * Called when the user releases the dial (Stream Deck+).
	 * Opens the stat's GitHub page.
	 */
	override async onDialUp(ev: DialUpEvent<RepoStatsSettings>): Promise<void> {
		this.keyDownTime.delete(ev.action.id);
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const repo = settings.repo;

		if (!repo) return;

		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		} else {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				const statType: StatType = settings.statType ?? "stars";
				await streamDeck.system.openUrl(getStatUrl(parsed.owner, parsed.repo, statType));
			}
		}
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Forces a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<RepoStatsSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshStats(ev.action.id, true);
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
				coordinator.unsubscribe(ev.action.id);
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.polling.stop(ev.action.id);
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		}

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				coordinator.unsubscribe(ev.action.id);
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.polling.stop(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		// Re-subscribe with updated settings
		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		coordinator.unsubscribe(ev.action.id);
		coordinator.subscribe({
			actionId: ev.action.id,
			repo: settings.repo!,
			fragments: ["repoMetadata", "prCount"],
			maxAgeSec: intervalSec,
		}, () => this.refreshStats(ev.action.id));

		// Restart timer with potentially new interval(creates fresh state for generation counter)
		this.polling.restart(ev.action.id, () => this.refreshStats(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		// Re-fetch with new settings
		await this.refreshStats(ev.action.id);
	}

	/**
	 * Fetches repo stats and updates the button display.
	 */
	private async refreshStats(actionId: string, forceRefresh = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) {
			return;
		}

		// Generation counter — prevents stale async results from overwriting fresh data
		const gen = this.polling.incrementGeneration(actionId);

		// Find the action context by ID
		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) {
			return;
		}

		const isDial = actionContext.isDial();

		const parsed = parseRepoIdentifier(settings.repo);
		if (!parsed) {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("Invalid"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("Invalid repo") });
			return;
		}

		try {
			// Get the global token
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;

			if (!token) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderUnconfiguredImage());
					await actionContext.setTitle("");
				}
				if (isDial) await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}

			// Fetch data via coordinator (GraphQL with REST fallback)
			const result = forceRefresh
				? await coordinator.invalidateAndFetch(actionId, token)
				: await coordinator.fetchData(actionId, token);
			const stats = result.repoMetadata;
			if (!stats) {
				const errorMsg = result.errors?.repoMetadata ?? "Failed to fetch data";
				throw new Error(errorMsg);
			}

			// Determine which stat to show
			const statType: StatType = settings.statType ?? "stars";

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

			// Update touch strip for encoder
			if (isDial) {
				const numericValue = parseFloat(displayValue.replace(/[^0-9.]/g, "")) || 0;
				const trend = this.trendCache.get(actionId) ?? [];
				trend.push(numericValue);
				if (trend.length > 14) trend.shift();
				this.trendCache.set(actionId, trend);

				await actionContext.setFeedback({
					canvas: renderStatStrip(displayValue, statType, trend.length >= 2 ? trend : undefined, parsed.repo),
				});
			}

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
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage(errorLabel));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
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
		const actionContext = this.actionContexts.get(actionId);
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
