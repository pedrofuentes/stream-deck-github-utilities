/**
 * Release Monitor Action — displays the latest release version for a GitHub repository.
 *
 * Shows: version tag, release name, and relative time since publication.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to open the release page on GitHub
 *   - Optional pre-release inclusion
 *   - SVG key images with accent-bar design
 *   - Marquee scrolling for long text
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

import type { GlobalSettings, ReleaseMonitorSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import { fetchLatestRelease, formatRelativeTime } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderReleaseImage, renderSpinnerFrame, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { SpinnerAnimator, startLoadingSpinner, stopLoadingSpinner } from "../utils/spinner-animator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;
const LINE2_MAX_VISIBLE = 16;

/** Cached render data and marquee state per action instance. */
interface ReleaseMarqueeData {
	line1: MarqueeController;
	line2: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	tagName: string;
	detail: string;
}

@action({ UUID: "com.pedrofuentes.github-utilities.release-monitor" })
export class ReleaseMonitorAction extends SingletonAction<ReleaseMonitorSettings> {
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private actionSettings = new Map<string, ReleaseMonitorSettings>();
	private lastUrl = new Map<string, string>();
	private marqueeData = new Map<string, ReleaseMarqueeData>();
	private spinners = new Map<string, SpinnerAnimator>();

	override async onWillAppear(ev: WillAppearEvent<ReleaseMonitorSettings>): Promise<void> {
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

		await this.refreshRelease(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<ReleaseMonitorSettings>): void {
		this.stopTimer(ev.action.id);
		this.stopMarquee(ev.action.id);
		stopLoadingSpinner(this.spinners, ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<ReleaseMonitorSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		} else {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/releases`);
			}
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ReleaseMonitorSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`ReleaseMonitor onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReleaseMonitorSettings>): Promise<void> {
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: ReleaseMonitorSettings = { ...cached, ...incoming };

		if (settings.repo && settings.refreshInterval === undefined) {
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

		await this.refreshRelease(ev.action.id);
		this.stopTimer(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	private async refreshRelease(actionId: string): Promise<void> {
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

			const includePreReleases = settings.includePreReleases === true;
			const release = await fetchLatestRelease(parsed.owner, parsed.repo, token, includePreReleases);

			if (!release) {
				await actionContext.setImage(renderReleaseImage("None", "No Releases", parsed.repo));
				await actionContext.setTitle("");
				this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/releases`);
				return;
			}

			const tag = release.tag_name || "unknown";
			let detail = formatRelativeTime(release.published_at);
			if (release.prerelease) {
				detail = detail ? `Pre · ${detail}` : "Pre-release";
			}

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.line2.setText(tag);
			md.repoName = parsed.repo;
			md.tagName = tag;
			md.detail = detail;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			this.lastUrl.set(actionId, release.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/releases`);
			streamDeck.logger.debug(`Release updated: ${settings.repo} tag=${tag}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch release for ${settings.repo}: ${message}`);
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

	private startTimer(actionId: string, settings: ReleaseMonitorSettings): void {
		if (!settings.repo) return;

		const intervalSec = Math.max(
			settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL,
			MIN_REFRESH_INTERVAL,
		);

		const timer = setInterval(() => {
			this.refreshRelease(actionId).catch((err) => {
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

	private getOrCreateMarquee(actionId: string): ReleaseMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				line2: new MarqueeController(LINE2_MAX_VISIBLE),
				timer: null,
				repoName: "",
				tagName: "",
				detail: "",
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
		const displayTag = md.line2.needsAnimation()
			? md.line2.getCurrentText()
			: md.tagName;

		await actionContext.setImage(renderReleaseImage(displayTag, md.detail, displayName));
		await actionContext.setTitle("");
	}

	private updateMarqueeTimer(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (!md) return;

		const needsAnimation = md.line1.needsAnimation() || md.line2.needsAnimation();

		if (needsAnimation && !md.timer) {
			md.timer = setInterval(() => {
				const changed1 = md.line1.tick();
				const changed2 = md.line2.tick();
				if (changed1 || changed2) {
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
