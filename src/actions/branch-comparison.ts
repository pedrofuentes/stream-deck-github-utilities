/**
 * Branch Comparison Action — displays ahead/behind counts between two branches.
 *
 * Shows: how many commits a branch is ahead/behind another branch.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to open the comparison page on GitHub
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
	DialDownEvent,
	DialUpEvent,
	TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { BaseGitHubAction } from "./base-github-action";
import type { GlobalSettings, BranchComparisonSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import { classifyErrorLabel } from "../utils/github-api";
import { renderBranchComparisonImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage, COLORS } from "../utils/button-renderer";
import { renderStatStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { MarqueeController } from "../utils/marquee-controller";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;

@action({ UUID: "com.pedrofuentes.github-utilities.branch-comparison" })
export class BranchComparisonAction extends BaseGitHubAction<BranchComparisonSettings> {
	private lastUrl = new Map<string, string>();
	private marqueeData = new Map<string, BranchMarqueeData>();

	override async onWillAppear(ev: WillAppearEvent<BranchComparisonSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !settings.baseBranch || !settings.headBranch || !globalSettings.githubToken) {
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
			if (!settings.repo || !settings.baseBranch || !settings.headBranch || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshComparison(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshComparison(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<BranchComparisonSettings>): void {
		super.onWillDisappear(ev);
		this.stopMarquee(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<BranchComparisonSettings>): Promise<void> {
		if (this.urlOpener.handlePress(ev.action.id)) {
			this.polling.resetBackoff(ev.action.id);
			await this.refreshComparison(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const resolved = await this.resolveEffectiveRepo(cached ?? settings);
		if (!resolved || resolved.missing) return;

		const cachedUrl = this.lastUrl.get(ev.action.id);
		let url: string | undefined;
		if (cachedUrl) {
			url = cachedUrl;
		} else {
			const parsed = parseRepoIdentifier(resolved.repo);
			const base = cached?.baseBranch ?? settings.baseBranch ?? "main";
			const head = cached?.headBranch ?? settings.headBranch ?? "develop";
			if (parsed) {
				url = `https://github.com/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
			}
		}

		if (url) {
			this.urlOpener.scheduleOpen(ev.action.id, url);
		}
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the compare page on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<BranchComparisonSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const resolved = await this.resolveEffectiveRepo(settings);
		if (!resolved || resolved.missing) return;

		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		} else {
			const parsed = parseRepoIdentifier(resolved.repo);
			const base = settings.baseBranch ?? "main";
			const head = settings.headBranch ?? "develop";
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
			}
		}
	}

	/**
	 * Called when the user releases the dial (Stream Deck+).
	 */
	override async onDialUp(_ev: DialUpEvent<BranchComparisonSettings>): Promise<void> {
		// No action needed on release
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Forces a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<BranchComparisonSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshComparison(ev.action.id, true);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BranchComparisonSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: BranchComparisonSettings = { ...cached, ...incoming };

		if (settings.repo && !settings.refreshInterval) {
			settings.refreshInterval = 300;
		}

		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !settings.baseBranch || !settings.headBranch || !globalSettings.githubToken) {
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
			if (!settings.repo || !settings.baseBranch || !settings.headBranch || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.coordinator.unsubscribe(ev.action.id);
				this.polling.stop(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshComparison(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshComparison(ev.action.id);
	}

	private async refreshComparison(actionId: string, force = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo || !settings.baseBranch || !settings.headBranch) return;

		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

		const isDial = actionContext.isDial();

		const resolved = await this.resolveEffectiveRepo(settings);
		if (!resolved) return;

		if (resolved.missing === "bridge") {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("No Active"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("No active repo") });
			return;
		}
		if (resolved.missing === "invalid") {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("Bad Bridge"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("Bridge invalid") });
			return;
		}

		const parsed = parseRepoIdentifier(resolved.repo);
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

			const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
			this.syncResolvedRepoSubscription(
				actionId,
				resolved.repo,
				["branchComparison"],
				intervalSec,
				{ baseBranch: settings.baseBranch, headBranch: settings.headBranch },
				() => this.refreshComparison(actionId),
			);

			const result = force
				? await this.coordinator.invalidateAndFetch(actionId, token)
				: await this.coordinator.fetchData(actionId, token);
			const comparison = result.branchComparison;
			if (!comparison) {
				throw new Error(result.errors?.branchComparison ?? "No comparison data available");
			}

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			// Format: "↑3 ↓1" for ahead/behind
			const displayParts: string[] = [];
			if (comparison.ahead_by > 0) displayParts.push(`↑${comparison.ahead_by}`);
			if (comparison.behind_by > 0) displayParts.push(`↓${comparison.behind_by}`);
			const displayText = displayParts.length > 0 ? displayParts.join(" ") : "Even";

			// Determine status color
			let statusColor = COLORS.accent.default_branch;
			if (comparison.status === "diverged") statusColor = COLORS.workflow.in_progress;
			else if (comparison.status === "ahead") statusColor = COLORS.accent.pull_requests;
			else if (comparison.status === "behind") statusColor = COLORS.workflow.failure;
			else if (comparison.status === "identical") statusColor = COLORS.accent.default_branch;

			const branchLabel = `${settings.headBranch}→${settings.baseBranch}`;

			const md = this.getOrCreateMarquee(actionId);
			md.line1.setText(parsed.repo);
			md.repoName = parsed.repo;
			md.displayText = displayText;
			md.branchLabel = branchLabel;
			md.statusColor = statusColor;

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			if (isDial) {
				await actionContext.setFeedback({
					canvas: renderStatStrip(displayText, "branches", undefined, parsed.repo),
				});
			}

			this.polling.reportSuccess(actionId);
			this.lastUrl.set(actionId, comparison.html_url);
			streamDeck.logger.debug(`Branch comparison updated: ${settings.repo} ${settings.headBranch}→${settings.baseBranch} ${displayText}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch branch comparison for ${settings.repo}: ${message}`);
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

	private getOrCreateMarquee(actionId: string): BranchMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				timer: null,
				repoName: "",
				displayText: "Even",
				branchLabel: "",
				statusColor: COLORS.accent.default_branch,
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

		await actionContext.setImage(renderBranchComparisonImage(md.displayText, md.branchLabel, displayName, md.statusColor));
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

/** Cached render data and marquee state per action instance. */
interface BranchMarqueeData {
	line1: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	displayText: string;
	branchLabel: string;
	statusColor: string;
}
