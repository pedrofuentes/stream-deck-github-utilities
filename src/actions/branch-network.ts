/**
 * Branch Network Action — displays a metro-map style git branch diagram
 * on the Stream Deck+ touch strip.
 *
 * Encoder-only action designed for the Stream Deck+ touch strip.
 * Shows branches as colored lines with commit dots and merge points.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type Action,
	type SendToPluginEvent,
	type DialRotateEvent,
	type DialDownEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, BranchNetworkSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import { fetchBranchNetwork } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderBranchNetworkStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;

@action({ UUID: "com.pedrofuentes.github-utilities.branch-network" })
export class BranchNetworkAction extends SingletonAction<BranchNetworkSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, BranchNetworkSettings>();
	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<BranchNetworkSettings>>();
	private renderTimeout: ReturnType<typeof setTimeout> | null = null;
	private lastUrl = new Map<string, string>();
	private branchCache = new Map<string, string[]>();
	/** Dial column position per action (0-3) */
	private dialColumn = new Map<string, number>();

	/** Shared horizontal scroll per repo (synced across siblings) */
	private static sharedScrollH = new Map<string, number>();
	/** Shared vertical scroll per repo (synced across siblings) */
	private static sharedScrollV = new Map<string, number>();

	/**
	 * Compute base offset from relative position among siblings with same repo.
	 */
	private getBaseOffset(actionId: string): number {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return 0;
		const myColumn = this.dialColumn.get(actionId) ?? 0;
		const siblingColumns: number[] = [];
		for (const a of this.actionContexts.values()) {
			const s = this.actionSettings.get(a.id);
			if (s?.repo === settings.repo && a.isDial()) {
				siblingColumns.push(this.dialColumn.get(a.id) ?? 0);
			}
		}
		siblingColumns.sort((a, b) => a - b);
		const idx = siblingColumns.indexOf(myColumn);
		return (idx >= 0 ? idx : 0) * 200;
	}

	override async onWillAppear(ev: WillAppearEvent<BranchNetworkSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isDial()) {
			this.dialColumn.set(ev.action.id, "coordinates" in ev.payload ? ev.payload.coordinates.column : 0);
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshNetwork(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		await this.refreshNetwork(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<BranchNetworkSettings>): void {
		this.polling.stop(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.actionContexts.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.branchCache.delete(ev.action.id);
		this.dialColumn.delete(ev.action.id);
		if (this.renderTimeout) { clearTimeout(this.renderTimeout); this.renderTimeout = null; }
	}

	override async onDialRotate(ev: DialRotateEvent<BranchNetworkSettings>): Promise<void> {
		const settings = this.actionSettings.get(ev.action.id);
		const repo = settings?.repo;
		if (!repo) return;

		if (ev.payload.pressed) {
			const vOff = BranchNetworkAction.sharedScrollV.get(repo) ?? 0;
			BranchNetworkAction.sharedScrollV.set(repo, Math.max(-50, Math.min(100, vOff + ev.payload.ticks * 5)));
		} else {
			const hOff = BranchNetworkAction.sharedScrollH.get(repo) ?? 0;
			BranchNetworkAction.sharedScrollH.set(repo, Math.max(0, hOff + ev.payload.ticks * 10));
		}

		if (this.renderTimeout) clearTimeout(this.renderTimeout);
		this.renderTimeout = setTimeout(() => {
			this.renderAllSiblings(repo).catch(() => {});
		}, 16);
	}

	override async onDialDown(_ev: DialDownEvent<BranchNetworkSettings>): Promise<void> {
		// No action — press+rotate used for vertical scrolling
	}

	override async onTouchTap(ev: TouchTapEvent<BranchNetworkSettings>): Promise<void> {
		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		}
	}

	/** Re-render all sibling instances for the same repo */
	private async renderAllSiblings(repo: string): Promise<void> {
		const hScroll = BranchNetworkAction.sharedScrollH.get(repo) ?? 0;
		const vScroll = BranchNetworkAction.sharedScrollV.get(repo) ?? 0;

		for (const ctx of this.actionContexts.values()) {
			const s = this.actionSettings.get(ctx.id);
			if (s?.repo !== repo || !ctx.isDial()) continue;

			const branches = this.branchCache.get(ctx.id) ?? [];
			if (branches.length === 0) continue;

			const hOff = this.getBaseOffset(ctx.id) + hScroll;
			await ctx.setFeedback({
				canvas: renderBranchNetworkStrip(branches, hOff, vScroll),
			});
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, BranchNetworkSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`BranchNetwork onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BranchNetworkSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: BranchNetworkSettings = { ...cached, ...incoming };
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.polling.stop(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshNetwork(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		await this.refreshNetwork(ev.action.id);
	}

	private async refreshNetwork(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return;

		const gen = this.polling.incrementGeneration(actionId);
		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

		const parsed = parseRepoIdentifier(settings.repo);
		if (!parsed) {
			if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError("Invalid repo") });
			return;
		}

		// Check if another instance already has branch data for this repo
		for (const otherAction of this.actionContexts.values()) {
			if (otherAction.id === actionId) continue;
			const otherSettings = this.actionSettings.get(otherAction.id);
			if (otherSettings?.repo === settings.repo) {
				const cached = this.branchCache.get(otherAction.id);
				if (cached && cached.length > 0) {
					this.branchCache.set(actionId, cached);
					const hScroll = BranchNetworkAction.sharedScrollH.get(settings.repo!) ?? 0;
					const vScroll = BranchNetworkAction.sharedScrollV.get(settings.repo!) ?? 0;
					const hOff = this.getBaseOffset(actionId) + hScroll;
					if (actionContext.isDial()) {
						await actionContext.setFeedback({
							canvas: renderBranchNetworkStrip(cached, hOff, vScroll),
						});
					}
					this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/network`);
					this.polling.reportSuccess(actionId);
					return;
				}
			}
		}

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token) {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}

			const branchInfos = await fetchBranchNetwork(parsed.owner, parsed.repo, token);
			if (!this.polling.isCurrentGeneration(actionId, gen)) return;
			const branchNames = branchInfos.map((b) => b.name);

			this.branchCache.set(actionId, branchNames);

			const hScroll = BranchNetworkAction.sharedScrollH.get(settings.repo!) ?? 0;
			const vScroll = BranchNetworkAction.sharedScrollV.get(settings.repo!) ?? 0;
			const hOff = this.getBaseOffset(actionId) + hScroll;
			if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderBranchNetworkStrip(branchNames, hOff, vScroll),
				});
			}

			this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/network`);
			this.polling.reportSuccess(actionId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch branch network for ${settings.repo}: ${message}`);

			let errorLabel = "Error";
			if (message.includes("rate limit")) errorLabel = "Rate Limited";
			else if (message.includes("not found")) errorLabel = "Not Found";
			else if (message.includes("token") || message.includes("401")) errorLabel = "Auth Error";

			this.polling.reportError(actionId);
			if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}
}
