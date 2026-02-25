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
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, CommitActivitySettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { fetchCommitActivity } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderCommitActivityImage, renderSpinnerFrame, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { SpinnerAnimator, startLoadingSpinner, stopLoadingSpinner } from "../utils/spinner-animator";
import type { JsonValue } from "@elgato/utils";

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
export class CommitActivityAction extends SingletonAction<CommitActivitySettings> {
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private actionSettings = new Map<string, CommitActivitySettings>();
	private marqueeData = new Map<string, CommitMarqueeData>();
	private spinners = new Map<string, SpinnerAnimator>();

	override async onWillAppear(ev: WillAppearEvent<CommitActivitySettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				return;
			}

			startLoadingSpinner(this.spinners, ev.action.id, (frame) => {
				ev.action.setImage(renderSpinnerFrame(frame)).catch(() => {});
			});
			await ev.action.setTitle("");
		}

		await this.refreshActivity(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<CommitActivitySettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
		stopLoadingSpinner(this.spinners, ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<CommitActivitySettings>): Promise<void> {
		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/commits`);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, CommitActivitySettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`CommitActivity onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<CommitActivitySettings>): Promise<void> {
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: CommitActivitySettings = { ...cached, ...incoming };

		if (settings.repo && !settings.timeRange) {
			settings.timeRange = "7d";
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
				this.stopTimer(ev.action.id);
				return;
			}

			startLoadingSpinner(this.spinners, ev.action.id, (frame) => {
				ev.action.setImage(renderSpinnerFrame(frame)).catch(() => {});
			});
			await ev.action.setTitle("");
		}

		await this.refreshActivity(ev.action.id);
		this.stopTimer(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	private async refreshActivity(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return;

		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!actionContext || !actionContext.isKey()) return;

		stopLoadingSpinner(this.spinners, actionId);

		const parsed = parseRepoIdentifier(settings.repo);
		if (!parsed) {
			await actionContext.setImage(renderErrorImage("Invalid"));
			await actionContext.setTitle("");
			return;
		}

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token) {
				await actionContext.setImage(renderUnconfiguredImage());
				await actionContext.setTitle("");
				return;
			}

			const timeRange = settings.timeRange ?? "7d";
			const count = await fetchCommitActivity(parsed.owner, parsed.repo, token, timeRange);

			let displayCount: string;
			if (count === -1) {
				// Stats are being computed — show a transient state
				displayCount = "...";
			} else {
				displayCount = formatCount(count);
			}

			const rangeLabel = RANGE_LABELS[timeRange] ?? "Commits";

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.repoName = parsed.repo;
			md.displayCount = displayCount;
			md.rangeLabel = rangeLabel;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			streamDeck.logger.debug(`Commit activity updated: ${settings.repo} ${timeRange}=${displayCount}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch commit activity for ${settings.repo}: ${message}`);
			this.stopMarquee(actionId);

			let errorLabel = "Error";
			if (message.includes("rate limit")) errorLabel = "Rate Limited";
			else if (message.includes("not found")) errorLabel = "Not Found";
			else if (message.includes("token") || message.includes("401")) errorLabel = "Auth Error";
			else if (message.includes("Access denied")) errorLabel = "No Access";

			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	private startTimer(actionId: string, settings: CommitActivitySettings): void {
		if (!settings.repo) return;

		const intervalSec = Math.max(
			settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL,
			MIN_REFRESH_INTERVAL,
		);

		const timer = setInterval(() => {
			this.refreshActivity(actionId).catch((err) => {
				streamDeck.logger.error(`Timer refresh failed for ${actionId}: ${err}`);
			});
		}, intervalSec * 1000);

		this.timers.set(actionId, timer);
	}

	private stopTimer(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(actionId);
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
		const actionContext = [...this.actions].find((a) => a.id === actionId);
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
