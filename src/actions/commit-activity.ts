/**
 * Commit Activity Action — displays recent commit count for a GitHub repository.
 *
 * Shows: commit count for the last 24h, 7d, or 30d.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to open the commits page on GitHub
 *   - Optional branch filter
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
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type {
	DialRotateEvent,
	DialDownEvent,
	DialUpEvent,
	TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, CommitActivitySettings } from "../types";
import { classifyErrorLabel } from "../utils/github-api";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { renderCommitActivityImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { renderStatStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { BaseGitHubAction } from "./base-github-action";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;
const RANGE_LABELS: Record<string, string> = {
	"24h": "Commits (24h)",
	"7d": "Commits (7d)",
	"30d": "Commits (30d)",
};

/** Cached render data and marquee state per action instance. */
interface CommitMarqueeData {
	line1: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	displayCount: string;
	rangeLabel: string;
}

@action({ UUID: "com.pedrofuentes.github-utilities.commit-activity" })
export class CommitActivityAction extends BaseGitHubAction<CommitActivitySettings> {
	private marqueeData = new Map<string, CommitMarqueeData>();
	private recentSetSettings = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<CommitActivitySettings>): Promise<void> {
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
		this.coordinator.subscribe({
			actionId: ev.action.id,
			repo: settings.repo!,
			fragments: ["commitActivity"],
			maxAgeSec: intervalSec,
			params: { timeRange: settings.timeRange ?? "7d" },
		}, () => this.refreshActivity(ev.action.id));
		this.polling.start(ev.action.id, () => this.refreshActivity(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshActivity(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<CommitActivitySettings>): void {
		super.onWillDisappear(ev);
		this.stopMarquee(ev.action.id);
		this.marqueeData.delete(ev.action.id);
		this.recentSetSettings.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<CommitActivitySettings>): Promise<void> {
		if (this.urlOpener.handlePress(ev.action.id)) {
			this.polling.resetBackoff(ev.action.id);
			await this.refreshActivity(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			const url = `https://github.com/${parsed.owner}/${parsed.repo}/commits`;
			this.urlOpener.scheduleOpen(ev.action.id, url);
		}
	}

	/**
	 * Called when the user rotates the dial (Stream Deck+).
	 * Cycles timeRange between "24h", "7d", and "30d".
	 */
	override async onDialRotate(ev: DialRotateEvent<CommitActivitySettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const ranges: Array<"24h" | "7d" | "30d"> = ["24h", "7d", "30d"];
		const current = settings.timeRange ?? "7d";
		const currentIndex = ranges.indexOf(current);
		const direction = ev.payload.ticks > 0 ? 1 : -1;
		const nextIndex = (currentIndex + direction + ranges.length) % ranges.length;
		const nextRange = ranges[nextIndex];

		const newSettings: CommitActivitySettings = { ...settings, timeRange: nextRange };
		this.recentSetSettings.add(ev.action.id);
		await ev.action.setSettings(newSettings);
		this.actionSettings.set(ev.action.id, newSettings);

		this.polling.resetBackoff(ev.action.id);
		await this.refreshActivity(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the commits page on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<CommitActivitySettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const repo = settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/commits`);
		}
	}

	/**
	 * Called when the user releases the dial (Stream Deck+).
	 */
	override async onDialUp(_ev: DialUpEvent<CommitActivitySettings>): Promise<void> {
		// No action needed on release
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Forces a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<CommitActivitySettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshActivity(ev.action.id, true);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CommitActivitySettings>): Promise<void> {
		const incoming = ev.payload.settings;

		if (this.recentSetSettings.delete(ev.action.id)) {
			this.actionSettings.set(ev.action.id, incoming);
			return;
		}

		const cached = this.actionSettings.get(ev.action.id);
		const settings: CommitActivitySettings = { ...cached, ...incoming };

		if (settings.repo && !settings.timeRange) {
			settings.timeRange = "7d";
		}
		if (settings.repo && !settings.refreshInterval) {
			settings.refreshInterval = 300;
		}

		this.actionSettings.set(ev.action.id, settings);

		this.stopMarquee(ev.action.id);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.coordinator.unsubscribe(ev.action.id);
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
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.coordinator.unsubscribe(ev.action.id);
				this.polling.stop(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.coordinator.subscribe({
			actionId: ev.action.id,
			repo: settings.repo!,
			fragments: ["commitActivity"],
			maxAgeSec: intervalSec,
			params: { timeRange: settings.timeRange ?? "7d" },
		}, () => this.refreshActivity(ev.action.id));
		this.polling.restart(ev.action.id, () => this.refreshActivity(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshActivity(ev.action.id);
	}

	private async refreshActivity(actionId: string, force = false): Promise<void> {
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

			const timeRange = settings.timeRange ?? "7d";
			const result = force
				? await this.coordinator.invalidateAndFetch(actionId, token)
				: await this.coordinator.fetchData(actionId, token);
			const weeks = result.commitActivity;
			if (weeks === undefined) {
				throw new Error(result.errors?.commitActivity ?? "No commit activity data available");
			}

			let displayCount: string;
			let dailyTrend: number[] | undefined;

			if (weeks === null) {
				// Stats are being computed — show a transient state
				displayCount = "...";
			} else if (weeks.length === 0) {
				displayCount = formatCount(0);
			} else {
				// Compute count based on timeRange
				const nowMs = Date.now();
				let count: number;
				if (timeRange === "24h") {
					const latestWeek = weeks[weeks.length - 1];
					const weekStartMs = latestWeek.week * 1000;
					const dayOfWeek = Math.floor((nowMs - weekStartMs) / 86400000);
					count = (dayOfWeek >= 0 && dayOfWeek < 7) ? (latestWeek.days[dayOfWeek] ?? 0) : 0;
				} else if (timeRange === "7d") {
					count = weeks[weeks.length - 1].total;
				} else {
					const weeksToSum = Math.min(4, weeks.length);
					count = 0;
					for (let i = weeks.length - weeksToSum; i < weeks.length; i++) {
						count += weeks[i].total;
					}
				}
				displayCount = formatCount(count);

				// Extract daily data for sparkline
				if (timeRange === "24h") {
					dailyTrend = [...weeks[weeks.length - 1].days];
				} else if (timeRange === "7d") {
					dailyTrend = weeks.slice(-2).flatMap((w) => w.days);
				} else {
					dailyTrend = weeks.slice(-8).map((w) => w.total);
				}
			}

			const rangeLabel = RANGE_LABELS[timeRange] ?? "Commits";

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.repoName = parsed.repo;
			md.displayCount = displayCount;
			md.rangeLabel = rangeLabel;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			if (isDial) {
				await actionContext.setFeedback({
					canvas: renderStatStrip(displayCount, "commits", dailyTrend && dailyTrend.length >= 2 ? dailyTrend : undefined, parsed.repo, settings.timeRange ?? "7d"),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`Commit activity updated: ${settings.repo} ${timeRange}=${displayCount}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch commit activity for ${settings.repo}: ${message}`);
			this.stopMarquee(actionId);

			const errorLabel = classifyErrorLabel(error);

			this.polling.reportError(actionId);
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage(errorLabel));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}

	private getOrCreateMarquee(actionId: string): CommitMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				timer: null,
				repoName: "",
				displayCount: "0",
				rangeLabel: "Commits (7d)",
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

		await actionContext.setImage(renderCommitActivityImage(md.displayCount, md.rangeLabel, displayName));
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
