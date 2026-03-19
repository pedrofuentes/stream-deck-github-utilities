/**
 * Security Health Action — displays Dependabot alert grade with arc gauge.
 *
 * Shows: a letter grade (A–F) based on open Dependabot alerts for a repository.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Grade color shifts from green (A/B) → amber (C) → red (D/F)
 *   - Arc gauge on touch strip with severity breakdown dots
 *   - Press to open the repository's security page on GitHub
 *   - Encoder support: dial rotate/touch tap to refresh, dial press to open security
 *   - SVG key images with accent-bar design
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

import type { GlobalSettings, SecurityHealthSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import { coordinator } from "../utils/graphql-query-coordinator";
import type { SecurityAlertSummary } from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { renderKeyImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { renderSecurityArcStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum

/**
 * Computes a letter grade and numeric score from alert severity counts.
 *
 * Grade: A (0 alerts), B (1-3 low/medium only), C (4+ or any high), D (any critical), F (3+ critical)
 * Score: 100 minus weighted penalties (critical=25, high=10, medium=3, low=1), capped at 0.
 */
export function computeGrade(alerts: SecurityAlertSummary): { grade: string; score: number } {
	const score = Math.max(0, 100 - (alerts.critical * 25 + alerts.high * 10 + alerts.medium * 3 + alerts.low * 1));

	let grade: string;
	if (alerts.total === 0) {
		grade = "A";
	} else if (alerts.critical >= 3) {
		grade = "F";
	} else if (alerts.critical > 0) {
		grade = "D";
	} else if (alerts.high > 0 || alerts.total >= 4) {
		grade = "C";
	} else {
		grade = "B";
	}

	return { grade, score };
}

@action({ UUID: "com.pedrofuentes.github-utilities.security-health" })
export class SecurityHealthAction extends SingletonAction<SecurityHealthSettings> {
	private polling = new PollingCoordinator();
	private actionSettings = new Map<string, SecurityHealthSettings>();
	private lastKeyUpTime = new Map<string, number>();
	/** Cached action contexts for O(1) lookup */
	private actionContexts = new Map<string, Action<SecurityHealthSettings>>();

	override async onWillAppear(ev: WillAppearEvent<SecurityHealthSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		if (!globalSettings.githubToken || !settings.repo) {
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
		coordinator.subscribe({ actionId: ev.action.id, repo: settings.repo!, fragments: ["vulnerabilityAlerts"], maxAgeSec });

		this.polling.start(ev.action.id, () => this.refreshHealth(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshHealth(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<SecurityHealthSettings>): void {
		this.polling.stop(ev.action.id);
		coordinator.unsubscribe(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastKeyUpTime.delete(ev.action.id);
		this.actionContexts.delete(ev.action.id);
	}

	/**
	 * Called when the user presses the button. Opens the security page on GitHub.
	 */
	override async onKeyDown(ev: KeyDownEvent<SecurityHealthSettings>): Promise<void> {
		// Double-click detection → force refresh
		const now = Date.now();
		const lastUp = this.lastKeyUpTime.get(ev.action.id) ?? 0;
		this.lastKeyUpTime.set(ev.action.id, now);
		if (now - lastUp < 400) {
			this.lastKeyUpTime.delete(ev.action.id);
			this.polling.resetBackoff(ev.action.id);
			await this.refreshHealth(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo ?? settings.repo;

		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/security`);
				return;
			}
		}
		await streamDeck.system.openUrl("https://github.com");
	}

	/**
	 * Called when the user rotates the dial (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onDialRotate(ev: DialRotateEvent<SecurityHealthSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshHealth(ev.action.id, true);
	}

	/**
	 * Called when the user presses the dial (Stream Deck+).
	 * Opens the security page on GitHub.
	 */
	override async onDialDown(ev: DialDownEvent<SecurityHealthSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const repo = cached?.repo;

		if (repo) {
			const parsed = parseRepoIdentifier(repo);
			if (parsed) {
				await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/security`);
				return;
			}
		}
		await streamDeck.system.openUrl("https://github.com");
	}

	/**
	 * Called when the user taps the touch strip (Stream Deck+).
	 * Triggers a data refresh.
	 */
	override async onTouchTap(ev: TouchTapEvent<SecurityHealthSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshHealth(ev.action.id, true);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SecurityHealthSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`SecurityHealth onSendToPlugin error: ${message}`);
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<SecurityHealthSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const settings: SecurityHealthSettings = { ...cached, ...incoming };

		if (!settings.refreshInterval) {
			settings.refreshInterval = DEFAULT_REFRESH_INTERVAL;
		}

		this.actionSettings.set(ev.action.id, settings);

		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		if (!globalSettings.githubToken || !settings.repo) {
			if (ev.action.isKey()) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
			} else if (ev.action.isDial()) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
			}
			coordinator.unsubscribe(ev.action.id);
			this.polling.stop(ev.action.id);
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
		coordinator.subscribe({ actionId: ev.action.id, repo: settings.repo!, fragments: ["vulnerabilityAlerts"], maxAgeSec });

		this.polling.restart(ev.action.id, () => this.refreshHealth(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshHealth(ev.action.id);
	}

	private async refreshHealth(actionId: string, forceRefresh = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token || !settings?.repo) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderUnconfiguredImage());
					await actionContext.setTitle("");
				} else if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				}
				return;
			}

			const parsed = parseRepoIdentifier(settings.repo);
			if (!parsed) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderErrorImage("Bad Repo"));
					await actionContext.setTitle("");
				} else if (actionContext.isDial()) {
					await actionContext.setFeedback({ canvas: renderStripError("Bad Repo") });
				}
				return;
			}

			const result = forceRefresh
				? await coordinator.invalidateAndFetch(actionId, token)
				: await coordinator.fetchData(actionId, token);
			const alerts = result.vulnerabilityAlerts;
			if (!alerts) {
				const errorMsg = result.errors?.vulnerabilityAlerts ?? "No data available";
				throw new Error(errorMsg);
			}

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			const { grade, score } = computeGrade(alerts);
			const repoShort = parsed.repo;

			// Determine accent color based on grade
			let statusColor: string;
			if (grade === "A" || grade === "B") statusColor = "#3fb950";
			else if (grade === "C") statusColor = "#d29922";
			else statusColor = "#f85149";

			if (actionContext.isKey()) {
				await actionContext.setImage(renderKeyImage({
					line1: repoShort,
					line2: grade,
					line3: alerts.total === 0 ? "No Alerts" : `${alerts.total} alert${alerts.total === 1 ? "" : "s"}`,
					statusColor,
				}));
				await actionContext.setTitle("");
			}

			if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderSecurityArcStrip(grade, score, alerts),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`Security health updated: ${settings.repo} grade=${grade} score=${score}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch security health: ${message}`);

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
