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
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, BranchComparisonSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import { fetchBranchComparison } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderBranchComparisonImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage, COLORS } from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;

@action({ UUID: "com.pedrofuentes.github-utilities.branch-comparison" })
export class BranchComparisonAction extends SingletonAction<BranchComparisonSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, BranchComparisonSettings>();
	private lastUrl = new Map<string, string>();
	private marqueeData = new Map<string, BranchMarqueeData>();

	override async onWillAppear(ev: WillAppearEvent<BranchComparisonSettings>): Promise<void> {
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

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshComparison(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshComparison(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<BranchComparisonSettings>): void {
		this.polling.stop(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<BranchComparisonSettings>): Promise<void> {
		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;
		if (!repo) return;

		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		} else {
			const parsed = parseRepoIdentifier(repo);
			const base = cached?.baseBranch ?? settings.baseBranch ?? "main";
			const head = cached?.headBranch ?? settings.headBranch ?? "develop";
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/compare/${base}...${head}`);
			}
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, BranchComparisonSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`BranchComparison onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BranchComparisonSettings>): Promise<void> {
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
				this.polling.stop(ev.action.id);
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshComparison(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshComparison(ev.action.id);
	}

	private async refreshComparison(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo || !settings.baseBranch || !settings.headBranch) return;

		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!actionContext || !actionContext.isKey()) return;

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

			const comparison = await fetchBranchComparison(
				parsed.owner, parsed.repo, settings.baseBranch, settings.headBranch, token,
			);

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

			this.polling.reportSuccess(actionId);
			this.lastUrl.set(actionId, comparison.html_url);
			streamDeck.logger.debug(`Branch comparison updated: ${settings.repo} ${settings.headBranch}→${settings.baseBranch} ${displayText}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch branch comparison for ${settings.repo}: ${message}`);
			this.stopMarquee(actionId);

			let errorLabel = "Error";
			if (message.includes("rate limit")) errorLabel = "Rate Limited";
			else if (message.includes("not found")) errorLabel = "Not Found";
			else if (message.includes("token") || message.includes("401")) errorLabel = "Auth Error";
			else if (message.includes("Access denied")) errorLabel = "No Access";

			this.polling.reportError(actionId);
			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
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
		const actionContext = [...this.actions].find((a) => a.id === actionId);
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
