/**
 * PR Counter Action — displays the pull request count for a GitHub repository.
 *
 * Shows: open, closed, or all PR count for a configured repository.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to open the PRs page on GitHub
 *   - SVG key images with accent-bar design
 *   - Marquee scrolling for long repo names
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	KeyDownEvent,
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

import type { GlobalSettings, PullRequestCounterSettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { coordinator } from "../utils/graphql-query-coordinator";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderPRCountImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import { renderStatStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;
const DOUBLE_CLICK_MS = 400;

const STATE_LABELS: Record<string, string> = {
	open: "Open PRs",
	closed: "Closed PRs",
	all: "All PRs",
};

/** Cached render data and marquee state per action instance. */
interface PRMarqueeData {
	line1: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	displayCount: string;
	stateLabel: string;
}

@action({ UUID: "com.pedrofuentes.github-utilities.pr-counter" })
export class PRCounterAction extends SingletonAction<PullRequestCounterSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, PullRequestCounterSettings>();
	private marqueeData = new Map<string, PRMarqueeData>();
	private recentSetSettings = new Set<string>();
	private trendCache = new Map<string, number[]>();
	private openUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<PullRequestCounterSettings>>();

	override async onWillAppear(ev: WillAppearEvent<PullRequestCounterSettings>): Promise<void> {
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

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

		if (settings.repo) {
			coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["prCount"],
				maxAgeSec: intervalSec,
				params: { prState: settings.stateFilter ?? "open" },
			}, () => this.refreshCount(ev.action.id));
		}

		this.polling.start(ev.action.id, () => this.refreshCount(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshCount(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<PullRequestCounterSettings>): void {
		this.polling.stop(ev.action.id);
		coordinator.unsubscribe(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
		this.recentSetSettings.delete(ev.action.id);
		this.trendCache.delete(ev.action.id);
		const urlTimer = this.openUrlTimers.get(ev.action.id);
		if (urlTimer) {
			clearTimeout(urlTimer);
			this.openUrlTimers.delete(ev.action.id);
		}
		this.actionContexts.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<PullRequestCounterSettings>): Promise<void> {
		// Double-click detection with debounced URL open
		const pendingTimer = this.openUrlTimers.get(ev.action.id);
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			this.openUrlTimers.delete(ev.action.id);
			this.polling.resetBackoff(ev.action.id);
			await this.refreshCount(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			const url = `https://github.com/${parsed.owner}/${parsed.repo}/pulls`;
			this.openUrlTimers.set(ev.action.id, setTimeout(() => {
				this.openUrlTimers.delete(ev.action.id);
				streamDeck.system.openUrl(url);
			}, DOUBLE_CLICK_MS));
		}
	}

	/**
	 * Called when the user rotates the dial (Stream Deck+).
	 * Cycles stateFilter between "open", "closed", and "all".
	 */
	override async onDialRotate(ev: DialRotateEvent<PullRequestCounterSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const states: Array<"open" | "closed" | "all"> = ["open", "closed", "all"];
		const current = settings.stateFilter ?? "open";
		const currentIndex = states.indexOf(current);
		const direction = ev.payload.ticks > 0 ? 1 : -1;
		const nextIndex = (currentIndex + direction + states.length) % states.length;
		const nextState = states[nextIndex];

		const newSettings: PullRequestCounterSettings = { ...settings, stateFilter: nextState };
		this.recentSetSettings.add(ev.action.id);
		await ev.action.setSettings(newSettings);
		this.actionSettings.set(ev.action.id, newSettings);

		this.polling.resetBackoff(ev.action.id);
		await this.refreshCount(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the PRs page on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<PullRequestCounterSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const repo = settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/pulls`);
		}
	}

	/**
	 * Called when the user releases the dial (Stream Deck+).
	 */
	override async onDialUp(_ev: DialUpEvent<PullRequestCounterSettings>): Promise<void> {
		// No action needed on release
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Forces a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<PullRequestCounterSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshCount(ev.action.id, true);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, PullRequestCounterSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`PRCounter onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PullRequestCounterSettings>): Promise<void> {
		const incoming = ev.payload.settings;

		if (this.recentSetSettings.delete(ev.action.id)) {
			this.actionSettings.set(ev.action.id, incoming);
			return;
		}

		const cached = this.actionSettings.get(ev.action.id);
		const settings: PullRequestCounterSettings = { ...cached, ...incoming };

		if (settings.repo && !settings.stateFilter) {
			settings.stateFilter = "open";
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
				coordinator.unsubscribe(ev.action.id);
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
				this.polling.stop(ev.action.id);
				coordinator.unsubscribe(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

		if (settings.repo) {
			coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["prCount"],
				maxAgeSec: intervalSec,
				params: { prState: settings.stateFilter ?? "open" },
			}, () => this.refreshCount(ev.action.id));
		}

		this.polling.restart(ev.action.id, () => this.refreshCount(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshCount(ev.action.id);
	}

	private async refreshCount(actionId: string, force = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return;

		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

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

			const stateFilter = settings.stateFilter ?? "open";
			const result = force
				? await coordinator.invalidateAndFetch(actionId, token)
				: await coordinator.fetchData(actionId, token);
			const count = result.prCount ?? 0;
			const displayCount = formatCount(count);
			const stateLabel = STATE_LABELS[stateFilter] ?? "PRs";

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.repoName = parsed.repo;
			md.displayCount = displayCount;
			md.stateLabel = stateLabel;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			if (isDial) {
				const numericCount = parseInt(displayCount.replace(/[^0-9]/g, "")) || 0;
				const trend = this.trendCache.get(actionId) ?? [];
				trend.push(numericCount);
				if (trend.length > 14) trend.shift();
				this.trendCache.set(actionId, trend);

				await actionContext.setFeedback({
					canvas: renderStatStrip(displayCount, "pull_requests", trend.length >= 2 ? trend : undefined, parsed.repo, settings.stateFilter ?? "open"),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`PR count updated: ${settings.repo} ${stateFilter}=${displayCount}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch PR count for ${settings.repo}: ${message}`);
			this.stopMarquee(actionId);

			let errorLabel = "Error";
			if (message.includes("rate limit")) errorLabel = "Rate Limited";
			else if (message.includes("not found")) errorLabel = "Not Found";
			else if (message.includes("token") || message.includes("401")) errorLabel = "Auth Error";
			else if (message.includes("Access denied")) errorLabel = "No Access";

			this.polling.reportError(actionId);
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage(errorLabel));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}

	private getOrCreateMarquee(actionId: string): PRMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				timer: null,
				repoName: "",
				displayCount: "0",
				stateLabel: "Open PRs",
			};
			this.marqueeData.set(actionId, md);
		}
		return md;
	}

	private async renderWithMarquee(actionId: string): Promise<void> {
		const md = this.marqueeData.get(actionId);
		const actionContext = this.actionContexts.get(actionId);
		if (!md || !actionContext?.isKey()) return;

		const displayName = md.line1.needsAnimation()
			? md.line1.getCurrentText()
			: md.repoName;

		await actionContext.setImage(renderPRCountImage(md.displayCount, md.stateLabel, displayName));
		await actionContext.setTitle("");
	}

	private updateMarqueeTimer(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (!md) return;

		const needsAnimation = md.line1.needsAnimation();

		if (needsAnimation && !md.timer) {
			md.timer = setInterval(() => {
				const changed = md.line1.tick();
				if (changed) {
					this.renderWithMarquee(actionId).catch(() => {});
				}
			}, MARQUEE_INTERVAL_MS);
		} else if (!needsAnimation && md.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}

	private stopMarquee(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (md?.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}
}
