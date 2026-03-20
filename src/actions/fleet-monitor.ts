/**
 * Fleet Monitor Action — compact per-repo dashboard for the touch strip.
 *
 * Shows: repo name + workflow status badge + PR count + activity sparkline.
 * Designed to be placed 4-across on a Stream Deck+ for fleet monitoring.
 * Features:
 *   - Fetches workflow status, PR count, and commit activity in parallel
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Touch strip shows compact dashboard with sparkline trend
 *   - Key shows repo name + workflow status
 *   - Press to open the repository on GitHub
 *   - Encoder support: dial rotate/touch tap to refresh, dial press to open repo
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

import type { GlobalSettings, FleetMonitorSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import {
	getWorkflowDisplayStatus,
	getWorkflowStatusLabel,
} from "../utils/github-api";
import { coordinator } from "../utils/graphql-query-coordinator";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderKeyImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage, getWorkflowStatusColor } from "../utils/button-renderer";
import { renderFleetStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 15; // 15 seconds minimum
const DOUBLE_CLICK_MS = 400;

@action({ UUID: "com.pedrofuentes.github-utilities.fleet-monitor" })
export class FleetMonitorAction extends SingletonAction<FleetMonitorSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, FleetMonitorSettings>();
	private openUrlTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<FleetMonitorSettings>>();

	override async onWillAppear(ev: WillAppearEvent<FleetMonitorSettings>): Promise<void> {
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

		if (settings.repo) {
			coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["prCount", "workflowRuns", "commitActivity"],
				maxAgeSec: intervalSec,
			}, () => this.refreshFleet(ev.action.id));
		}

		this.polling.start(ev.action.id, () => this.refreshFleet(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshFleet(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<FleetMonitorSettings>): void {
		this.polling.stop(ev.action.id);
		coordinator.unsubscribe(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		const urlTimer = this.openUrlTimers.get(ev.action.id);
		if (urlTimer) {
			clearTimeout(urlTimer);
			this.openUrlTimers.delete(ev.action.id);
		}
		this.actionContexts.delete(ev.action.id);
	}

	/**
	 * Called when the user presses the button. Opens the repository on GitHub.
	 */
	override async onKeyDown(ev: KeyDownEvent<FleetMonitorSettings>): Promise<void> {
		// Double-click detection with debounced URL open
		const pendingTimer = this.openUrlTimers.get(ev.action.id);
		if (pendingTimer) {
			clearTimeout(pendingTimer);
			this.openUrlTimers.delete(ev.action.id);
			this.polling.resetBackoff(ev.action.id);
			await this.refreshFleet(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;

		let url = "https://github.com";
		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				url = `https://github.com/${parsed.owner}/${parsed.repo}`;
			}
		}

		this.openUrlTimers.set(ev.action.id, setTimeout(() => {
			this.openUrlTimers.delete(ev.action.id);
			streamDeck.system.openUrl(url);
		}, DOUBLE_CLICK_MS));
	}

	/**
	 * Called when the user rotates the dial (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onDialRotate(ev: DialRotateEvent<FleetMonitorSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshFleet(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the repository on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<FleetMonitorSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo;

		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}`);
				return;
			}
		}
		await streamDeck.system.openUrl("https://github.com");
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<FleetMonitorSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshFleet(ev.action.id, true);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, FleetMonitorSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`FleetMonitor onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FleetMonitorSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: FleetMonitorSettings = { ...cached, ...incoming };

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

		if (settings.repo) {
			coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["prCount", "workflowRuns", "commitActivity"],
				maxAgeSec: intervalSec,
			}, () => this.refreshFleet(ev.action.id));
		} else {
			coordinator.unsubscribe(ev.action.id);
		}

		this.polling.restart(ev.action.id, () => this.refreshFleet(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshFleet(ev.action.id);
	}

	private async refreshFleet(actionId: string, force = false): Promise<void> {
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

			const repo = settings?.repo;
			if (!repo) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderUnconfiguredImage());
					await actionContext.setTitle("");
				} else if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				}
				return;
			}

			const parsed = parseRepoIdentifier(repo);
			if (!parsed) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderErrorImage("Invalid Repo"));
					await actionContext.setTitle("");
				} else if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripError("Invalid Repo") });
				}
				return;
			}

			// Fetch all data points via the coordinator (batched GraphQL + REST)
			const result = force
				? await coordinator.invalidateAndFetch(actionId, token)
				: await coordinator.fetchData(actionId, token);
			const workflowInfo = result.workflowRuns;
			const prCount = result.prCount ?? 0;
			const commitWeeks = result.commitActivity ?? [];

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			// Determine workflow display status
			let displayStatus = "neutral";
			let statusLabel = "No Runs";
			let statusColor = getWorkflowStatusColor("neutral");

			if (workflowInfo?.latestRun) {
				displayStatus = getWorkflowDisplayStatus(workflowInfo.latestRun);
				statusLabel = getWorkflowStatusLabel(displayStatus);
				statusColor = getWorkflowStatusColor(displayStatus);
			}

			// Extract weekly trend data for sparkline (last 8 weeks)
			const trend: number[] = [];
			if (commitWeeks.length > 0) {
				const recentWeeks = commitWeeks.slice(-8);
				for (const week of recentWeeks) {
					trend.push(week.total);
				}
			}

			const repoDisplayName = parsed.repo;

			if (actionContext.isKey()) {
				await actionContext.setImage(renderKeyImage({
					line1: repoDisplayName,
					line2: statusLabel,
					line3: `${prCount} PRs`,
					statusColor,
				}));
				await actionContext.setTitle("");
			} else if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderFleetStrip(repoDisplayName, statusLabel, statusColor, prCount, trend),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`Fleet monitor updated: ${repo} status=${statusLabel} prs=${prCount}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to refresh fleet monitor: ${message}`);

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

}
