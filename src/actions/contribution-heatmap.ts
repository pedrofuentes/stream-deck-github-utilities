/**
 * Contribution Heatmap Action — displays a GitHub contribution grid
 * on the Stream Deck+ touch strip.
 *
 * Encoder-only action designed for the Stream Deck+ touch strip.
 * Shows weekly commit activity as a color-intensity heatmap grid.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
	type DialRotateEvent,
	type DialDownEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings, ContributionHeatmapSettings } from "../types";
import { BaseGitHubAction } from "./base-github-action";
import { parseRepoIdentifier } from "../utils/github";
import { classifyErrorLabel, fetchCommitActivityWeeks } from "../utils/github-api";
import { fetchContributionCalendar, calendarToWeeklyData } from "../utils/github-graphql";
import { RenderDebouncer } from "../utils/render-debouncer";
import { renderHeatmapStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;

/**
 * Reorder days from GitHub API format [Sun, Mon, ..., Sat]
 * to heatmap display format [Mon, Tue, ..., Sun].
 */
function reorderDays(apiDays: number[]): number[] {
	return [...apiDays.slice(1), apiDays[0]];
}

@action({ UUID: "com.pedrofuentes.github-utilities.contribution-heatmap" })
export class ContributionHeatmapAction extends BaseGitHubAction<ContributionHeatmapSettings> {
	private retryTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
	private renderDebouncer = new RenderDebouncer();
	private lastUrl = new Map<string, string>();
	/** Cached weekly data per action for rendering */
	private weeklyCache = new Map<string, number[][]>();
	/** Cached total commits per action */
	private totalCommitsCache = new Map<string, number>();
	/** Dial column position per action (0-3) */
	private dialColumn = new Map<string, number>();
	/** Shared horizontal scroll offset per scroll key (synced across siblings) */
	private static sharedScrollH = new Map<string, number>();

	/** Get the scroll map key — repo for per-repo mode, "__user__" for user mode */
	private getScrollKey(settings?: ContributionHeatmapSettings): string | undefined {
		if (settings?.dataSource === "user") return "__user__";
		return settings?.repo;
	}

	/**
	 * Compute base offset by finding this instance's relative position among
	 * siblings with the same scroll key, sorted by column.
	 */
	private getBaseOffset(actionId: string): number {
		const settings = this.actionSettings.get(actionId);
		const scrollKey = this.getScrollKey(settings);
		if (!scrollKey) return 0;

		const myColumn = this.dialColumn.get(actionId) ?? 0;
		const siblingColumns: number[] = [];
		for (const a of this.actionContexts.values()) {
			const s = this.actionSettings.get(a.id);
			if (this.getScrollKey(s) === scrollKey && a.isDial()) {
				siblingColumns.push(this.dialColumn.get(a.id) ?? 0);
			}
		}
		siblingColumns.sort((a, b) => a - b);
		const relativeIndex = siblingColumns.indexOf(myColumn);
		return (relativeIndex >= 0 ? relativeIndex : 0) * 200;
	}

	/** Compute total horizontal offset: base position + shared scroll */
	private getTotalOffset(actionId: string): number {
		const settings = this.actionSettings.get(actionId);
		const scrollKey = this.getScrollKey(settings);
		const scroll = scrollKey ? (ContributionHeatmapAction.sharedScrollH.get(scrollKey) ?? 0) : 0;
		return this.getBaseOffset(actionId) + scroll;
	}

	override async onWillAppear(ev: WillAppearEvent<ContributionHeatmapSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isDial()) {
			this.dialColumn.set(ev.action.id, "coordinates" in ev.payload ? ev.payload.coordinates.column : 0);
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const needsRepo = settings.dataSource !== "user";
			if ((needsRepo && !settings.repo) || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshHeatmap(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		await this.refreshHeatmap(ev.action.id);
		// Re-render existing siblings so they recalculate offsets with the new instance
		const scrollKey = this.getScrollKey(settings);
		if (scrollKey) this.renderAllForScrollKey(scrollKey).catch(() => {});
	}

	override onWillDisappear(ev: WillDisappearEvent<ContributionHeatmapSettings>): void {
		const scrollKey = this.getScrollKey(this.actionSettings.get(ev.action.id));
		const retryTimeout = this.retryTimeouts.get(ev.action.id);
		if (retryTimeout) {
			clearTimeout(retryTimeout);
			this.retryTimeouts.delete(ev.action.id);
		}
		// Note: must happen BEFORE super.onWillDisappear which deletes actionSettings/actionContexts
		super.onWillDisappear(ev);
		this.lastUrl.delete(ev.action.id);
		this.weeklyCache.delete(ev.action.id);
		this.totalCommitsCache.delete(ev.action.id);
		this.dialColumn.delete(ev.action.id);
		this.renderDebouncer.cleanup(ev.action.id);
		// Re-render remaining siblings so they recalculate their offsets
		if (scrollKey) this.renderAllForScrollKey(scrollKey).catch(() => {});
	}

	override async onDialRotate(ev: DialRotateEvent<ContributionHeatmapSettings>): Promise<void> {
		const settings = this.actionSettings.get(ev.action.id);
		const scrollKey = this.getScrollKey(settings);
		if (!scrollKey) return;

		const hOffset = ContributionHeatmapAction.sharedScrollH.get(scrollKey) ?? 0;
		const newH = Math.max(0, hOffset + ev.payload.ticks * 10);
		ContributionHeatmapAction.sharedScrollH.set(scrollKey, newH);

		this.renderDebouncer.schedule(ev.action.id, () => {
			this.renderAllForScrollKey(scrollKey).catch(() => {});
		}, 16);
	}

	override async onDialDown(ev: DialDownEvent<ContributionHeatmapSettings>): Promise<void> {
		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		}
	}

	override async onTouchTap(ev: TouchTapEvent<ContributionHeatmapSettings>): Promise<void> {
		const settings = this.actionSettings.get(ev.action.id);
		const scrollKey = this.getScrollKey(settings);
		if (scrollKey) {
			ContributionHeatmapAction.sharedScrollH.set(scrollKey, 0);
		}
		this.polling.resetBackoff(ev.action.id);
		await this.refreshHeatmap(ev.action.id);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ContributionHeatmapSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const oldScrollKey = this.getScrollKey(cached);
		const settings: ContributionHeatmapSettings = { ...cached, ...incoming };
		this.actionSettings.set(ev.action.id, settings);
		const newScrollKey = this.getScrollKey(settings);

		streamDeck.logger.debug(`Heatmap settings: action=${ev.action.id} dataSource=${settings.dataSource} repo=${settings.repo} oldKey=${oldScrollKey} newKey=${newScrollKey}`);

		// Clear stale cached data when data source or repo changes
		if (oldScrollKey !== newScrollKey) {
			this.weeklyCache.delete(ev.action.id);
			this.totalCommitsCache.delete(ev.action.id);
		}

		if (ev.action.isDial()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const needsRepo = settings.dataSource !== "user";
			if ((needsRepo && !settings.repo) || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.polling.stop(ev.action.id);
				// Re-render old siblings — this instance left the group
				if (oldScrollKey) this.renderAllForScrollKey(oldScrollKey).catch(() => {});
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshHeatmap(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		await this.refreshHeatmap(ev.action.id);
		// Re-render siblings for both old and new scroll keys
		if (oldScrollKey && oldScrollKey !== newScrollKey) this.renderAllForScrollKey(oldScrollKey).catch(() => {});
		if (newScrollKey) this.renderAllForScrollKey(newScrollKey).catch(() => {});
	}

	/** Re-render all instances that share the same scroll key */
	private async renderAllForScrollKey(scrollKey: string): Promise<void> {
		for (const actionContext of this.actionContexts.values()) {
			const settings = this.actionSettings.get(actionContext.id);
			if (this.getScrollKey(settings) !== scrollKey || !actionContext.isDial()) continue;

			const weeklyData = this.weeklyCache.get(actionContext.id) ?? [];
			if (weeklyData.length === 0) continue;

			const totalCommits = this.totalCommitsCache.get(actionContext.id) ?? 0;
			const baseOff = this.getBaseOffset(actionContext.id);
			const hOff = baseOff + (ContributionHeatmapAction.sharedScrollH.get(scrollKey) ?? 0);

			await actionContext.setFeedback({
				canvas: renderHeatmapStrip(weeklyData, hOff, totalCommits, baseOff === 0),
			});
		}
	}

	private async refreshHeatmap(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		const dataSource = settings?.dataSource ?? "repo";

		// In repo mode, repo is required; in user mode it's optional
		if (dataSource === "repo" && !settings?.repo) {
			streamDeck.logger.debug(`Heatmap refresh skipped: action=${actionId} dataSource=${dataSource} repo=${settings?.repo} (no repo)`);
			return;
		}

		const gen = this.polling.incrementGeneration(actionId);
		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) {
			streamDeck.logger.debug(`Heatmap refresh skipped: action=${actionId} (no context)`);
			return;
		}

		streamDeck.logger.debug(`Heatmap refresh starting: action=${actionId} dataSource=${dataSource} repo=${settings?.repo} gen=${gen}`);

		// Resolve dynamic repo mode — only applies to dataSource === "repo".
		// dataSource === "user" hits the global profile GraphQL, no repo involved.
		let parsed: { owner: string; repo: string } | null = null;
		if (dataSource === "repo") {
			const resolved = await this.resolveEffectiveRepo(settings!);
			if (!resolved) return;
			this.watchActiveRepo(actionId, resolved.isSentinel, () => this.refreshHeatmap(actionId));

			if (resolved.missing === "bridge") {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError("No active repo") });
				return;
			}
			if (resolved.missing === "invalid") {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError("Bridge invalid") });
				return;
			}

			parsed = parseRepoIdentifier(resolved.repo);
			if (!parsed) {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError("Invalid repo") });
				return;
			}

			// When the resolved repo changes under a stable setting (e.g. sentinel
			// following the editor from A to B), invalidate any cached weekly data
			// so we don't render stale numbers for the wrong repo.
			const previousResolved = this.lastResolvedRepo.get(actionId);
			if (previousResolved !== undefined && previousResolved !== resolved.repo) {
				this.weeklyCache.delete(actionId);
				this.totalCommitsCache.delete(actionId);
			}
			this.lastResolvedRepo.set(actionId, resolved.repo);
		} else {
			// dataSource === "user" — drop any bridge-watch subscription left over
			// from a prior repo-mode configuration.
			this.watchActiveRepo(actionId, false, () => this.refreshHeatmap(actionId));
		}

		// Check if another instance already has data for the same scroll key
		const scrollKey = this.getScrollKey(settings);
		for (const otherAction of this.actionContexts.values()) {
			if (otherAction.id === actionId) continue;
			const otherSettings = this.actionSettings.get(otherAction.id);
			if (this.getScrollKey(otherSettings) === scrollKey) {
				const cached = this.weeklyCache.get(otherAction.id);
				if (cached && cached.length > 0) {
					streamDeck.logger.debug(`Heatmap refresh: reusing sibling cache from ${otherAction.id} scrollKey=${scrollKey}`);
					const totalCommits = this.totalCommitsCache.get(otherAction.id) ?? 0;
					this.weeklyCache.set(actionId, cached);
					this.totalCommitsCache.set(actionId, totalCommits);
					const offset = this.getTotalOffset(actionId);
					if (actionContext.isDial()) {
						await actionContext.setFeedback({
							canvas: renderHeatmapStrip(cached, offset, totalCommits, this.getBaseOffset(actionId) === 0),
						});
					}
					const url = dataSource === "user"
						? "https://github.com"
						: `https://github.com/${parsed!.owner}/${parsed!.repo}/graphs/contributors`;
					this.lastUrl.set(actionId, url);
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

			if (dataSource === "user") {
				// GraphQL: profile-level contribution calendar
				const calendar = await fetchContributionCalendar(token);
				if (!this.polling.isCurrentGeneration(actionId, gen)) return;

				const weeklyData = calendarToWeeklyData(calendar);
				const totalCommits = calendar.totalContributions;

				this.weeklyCache.set(actionId, weeklyData);
				this.totalCommitsCache.set(actionId, totalCommits);

				const hOff = this.getTotalOffset(actionId);

				if (actionContext.isDial()) {
					await actionContext.setFeedback({
						canvas: renderHeatmapStrip(weeklyData, hOff, totalCommits, this.getBaseOffset(actionId) === 0),
					});
				}

				this.lastUrl.set(actionId, "https://github.com");
				this.polling.reportSuccess(actionId);
				return;
			}

			// REST: per-repo commit activity
			const weeks = await fetchCommitActivityWeeks(parsed!.owner, parsed!.repo, token);
			if (!this.polling.isCurrentGeneration(actionId, gen)) {
				streamDeck.logger.debug(`Heatmap refresh: stale generation action=${actionId} gen=${gen} (current=${this.polling.getGeneration(actionId)})`);
				return;
			}

			if (weeks === null) {
				streamDeck.logger.debug(`Heatmap refresh: API returned 202 (computing) for ${settings?.repo}, retrying in 5s`);
				if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripLoading("Computing…") });
				}
				// GitHub Stats API returns 202 on first request — retry quickly
				const timeoutId = setTimeout(() => {
					this.retryTimeouts.delete(actionId);
					this.refreshHeatmap(actionId).catch(() => {});
				}, 5000);
				this.retryTimeouts.set(actionId, timeoutId);
				return;
			}

			const weeklyData = weeks.map((w) => reorderDays(w.days));
			const totalCommits = weeks.reduce((sum, w) => sum + w.total, 0);

			this.weeklyCache.set(actionId, weeklyData);
			this.totalCommitsCache.set(actionId, totalCommits);

			const hOff = this.getTotalOffset(actionId);

			if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderHeatmapStrip(weeklyData, hOff, totalCommits, this.getBaseOffset(actionId) === 0),
				});
			}

			this.lastUrl.set(actionId, `https://github.com/${parsed!.owner}/${parsed!.repo}/graphs/contributors`);
			this.polling.reportSuccess(actionId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			const label = dataSource === "user" ? "contribution calendar" : settings?.repo;
			streamDeck.logger.error(`Failed to fetch ${label}: ${message}`);

			const errorLabel = classifyErrorLabel(error);

			this.polling.reportError(actionId);
			if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}
}
