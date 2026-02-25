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
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, PullRequestCounterSettings } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { fetchPullRequestCount } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderPRCountImage, renderSpinnerFrame, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { SpinnerAnimator, startLoadingSpinner, stopLoadingSpinner } from "../utils/spinner-animator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;

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
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private actionSettings = new Map<string, PullRequestCounterSettings>();
	private marqueeData = new Map<string, PRMarqueeData>();
	private spinners = new Map<string, SpinnerAnimator>();

	override async onWillAppear(ev: WillAppearEvent<PullRequestCounterSettings>): Promise<void> {
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

		await this.refreshCount(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<PullRequestCounterSettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
		stopLoadingSpinner(this.spinners, ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<PullRequestCounterSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const parsed = parseRepoIdentifier(repo);
		if (parsed) {
			await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/pulls`);
		}
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
				this.stopTimer(ev.action.id);
				return;
			}

			startLoadingSpinner(this.spinners, ev.action.id, (frame) => {
				ev.action.setImage(renderSpinnerFrame(frame)).catch(() => {});
			});
			await ev.action.setTitle("");
		}

		await this.refreshCount(ev.action.id);
		this.stopTimer(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	private async refreshCount(actionId: string): Promise<void> {
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

			const stateFilter = settings.stateFilter ?? "open";
			const count = await fetchPullRequestCount(parsed.owner, parsed.repo, token, stateFilter);
			const displayCount = formatCount(count);
			const stateLabel = STATE_LABELS[stateFilter] ?? "PRs";

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.repoName = parsed.repo;
			md.displayCount = displayCount;
			md.stateLabel = stateLabel;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

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

			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	private startTimer(actionId: string, settings: PullRequestCounterSettings): void {
		if (!settings.repo) return;

		const intervalSec = Math.max(
			settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL,
			MIN_REFRESH_INTERVAL,
		);

		const timer = setInterval(() => {
			this.refreshCount(actionId).catch((err) => {
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
		const actionContext = [...this.actions].find((a) => a.id === actionId);
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
