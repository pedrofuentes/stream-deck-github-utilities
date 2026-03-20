/**
 * PR Review Queue Action — displays the count of pull requests awaiting the user's review.
 *
 * Shows: number of open PRs with review-requested:@me across all repos or a specific repo.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Count color shifts from blue (1) → amber (3) → red (5+) for urgency
 *   - Press to open the review-requested page on GitHub
 *   - Encoder support: dial rotate/touch tap to refresh, dial press to open reviews
 *   - SVG key images with accent-bar design
 *   - Marquee scrolling for long repo names
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	type Action,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type SendToPluginEvent,
	type DialRotateEvent,
	type DialDownEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, PRReviewQueueSettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { coordinator } from "../utils/graphql-query-coordinator";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderPRCountImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { renderPRQueueStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;

/** Cached render data and marquee state per action instance. */
interface PRQueueMarqueeData {
	line1: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	displayCount: string;
	count: number;
}

@action({ UUID: "com.pedrofuentes.github-utilities.pr-review-queue" })
export class PRReviewQueueAction extends SingletonAction<PRReviewQueueSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, PRReviewQueueSettings>();
	private marqueeData = new Map<string, PRQueueMarqueeData>();
	private lastKeyUpTime = new Map<string, number>();
	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<PRReviewQueueSettings>>();

	override async onWillAppear(ev: WillAppearEvent<PRReviewQueueSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		if (!globalSettings.githubToken) {
			if (ev.action.isKey()) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
			} else if (ev.action.isDial()) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
			}
			return;
		}

		if (ev.action.isKey()) {
			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		} else if (ev.action.isDial()) {
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		const maxAgeSec = intervalSec;
		coordinator.subscribe({ actionId: ev.action.id, repo: settings.repo ?? "", fragments: ["reviewRequestedPRs"], maxAgeSec }, () => this.refreshQueue(ev.action.id));

		this.polling.start(ev.action.id, () => this.refreshQueue(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshQueue(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<PRReviewQueueSettings>): void {
		this.polling.stop(ev.action.id);
		coordinator.unsubscribe(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
		this.lastKeyUpTime.delete(ev.action.id);
		this.actionContexts.delete(ev.action.id);
	}

	/**
	 * Called when the user presses the button. Opens the review-requested page on GitHub.
	 */
	override async onKeyDown(ev: KeyDownEvent<PRReviewQueueSettings>): Promise<void> {
		// Double-click detection → force refresh
		const now = Date.now();
		const lastUp = this.lastKeyUpTime.get(ev.action.id) ?? 0;
		this.lastKeyUpTime.set(ev.action.id, now);
		if (now - lastUp < 400) {
			this.lastKeyUpTime.delete(ev.action.id);
			this.polling.resetBackoff(ev.action.id);
			await this.refreshQueue(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;

		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me`);
				return;
			}
		}
		await streamDeck.system.openUrl("https://github.com/pulls/review-requested");
	}

	/**
	 * Called when the user rotates the dial (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onDialRotate(ev: DialRotateEvent<PRReviewQueueSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshQueue(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the review-requested page on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<PRReviewQueueSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo;

		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/pulls?q=is%3Apr+is%3Aopen+review-requested%3A%40me`);
				return;
			}
		}
		await streamDeck.system.openUrl("https://github.com/pulls/review-requested");
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<PRReviewQueueSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshQueue(ev.action.id, true);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, PRReviewQueueSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`PRReviewQueue onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<PRReviewQueueSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: PRReviewQueueSettings = { ...cached, ...incoming };

		if (!settings.refreshInterval) {
			settings.refreshInterval = DEFAULT_REFRESH_INTERVAL;
		}

		this.actionSettings.set(ev.action.id, settings);

		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		if (!globalSettings.githubToken) {
			if (ev.action.isKey()) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
			} else if (ev.action.isDial()) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
			}
			this.polling.stop(ev.action.id);
			coordinator.unsubscribe(ev.action.id);
			return;
		}

		if (ev.action.isKey()) {
			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		} else if (ev.action.isDial()) {
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		const maxAgeSec = intervalSec;
		coordinator.subscribe({ actionId: ev.action.id, repo: settings.repo ?? "", fragments: ["reviewRequestedPRs"], maxAgeSec }, () => this.refreshQueue(ev.action.id));

		this.polling.restart(ev.action.id, () => this.refreshQueue(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshQueue(ev.action.id);
	}

	private async refreshQueue(actionId: string, forceRefresh = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderUnconfiguredImage());
					await actionContext.setTitle("");
				} else if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				}
				return;
			}

			const repo = settings?.repo || undefined;
			const coordinatorResult = forceRefresh
				? await coordinator.invalidateAndFetch(actionId, token)
				: await coordinator.fetchData(actionId, token);
			const prData = coordinatorResult.reviewRequestedPRs;
			if (!prData) {
				const errorMsg = coordinatorResult.errors?.reviewRequestedPRs ?? "No data available";
				throw new Error(errorMsg);
			}
			const count = prData.total_count;
			const displayCount = formatCount(count);

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			// Determine repo display name for marquee
			let repoDisplayName = "";
			if (repo) {
				const parsed = parseRepoIdentifier(repo);
				repoDisplayName = parsed?.repo ?? repo;
			}

			if (actionContext.isKey()) {
				const md = this.getOrCreateMarquee(actionId);
				md.line1.setText(repoDisplayName || "All Repos");
				md.repoName = repoDisplayName || "All Repos";
				md.displayCount = displayCount;
				md.count = count;

				await this.renderWithMarquee(actionId);
				this.updateMarqueeTimer(actionId);
			} else if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderPRQueueStrip(count, repoDisplayName || undefined),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`PR review queue updated: ${repo ?? "all"}=${displayCount}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch PR review queue: ${message}`);
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
			} else if (actionContext.isDial()) {
				await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
			}
		}
	}

	private getOrCreateMarquee(actionId: string): PRQueueMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				timer: null,
				repoName: "All Repos",
				displayCount: "0",
				count: 0,
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

		await actionContext.setImage(renderPRCountImage(md.displayCount, "Reviews", displayName));
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
