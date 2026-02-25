/**
 * Workflow Status Action — displays the last GitHub Actions workflow run status
 * and current deployment status on a Stream Deck button.
 *
 * Shows:
 *   - Latest workflow run status (success, failure, in_progress, etc.)
 *   - If currently deploying, shows deployment progress
 *   - Workflow name and branch info
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 60 seconds)
 *   - Press to force refresh
 *   - SVG key images with accent-bar design (via setImage)
 *   - Optional filtering by workflow file, branch, and environment
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

import type { GlobalSettings, WorkflowStatusSettings } from "../types";
import { parseRepoIdentifier } from "../utils/github";
import {
	fetchWorkflowInfo,
	getWorkflowDisplayStatus,
	getWorkflowStatusLabel,
	type DeploymentState,
} from "../utils/github-api";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import {
	renderWorkflowImage,
	renderDeployingImage,
	renderAnimatedSpinner,
	renderErrorImage,
	renderUnconfiguredImage,
} from "../utils/button-renderer";
import { MarqueeController } from "../utils/marquee-controller";
import { PollingCoordinator } from "../utils/polling-coordinator";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 60; // 1 minute (workflows change faster than stats)
const MIN_REFRESH_INTERVAL = 15; // 15 seconds minimum
const MARQUEE_INTERVAL_MS = 500; // marquee scroll speed
const LINE1_MAX_VISIBLE = 14; // max chars at 18px
const LINE3_MAX_VISIBLE = 18; // max chars at 15px

/** Render variant cache for marquee re-rendering without API calls. */
type WfRenderVariant =
	| { type: "deploying"; deployState: string }
	| { type: "workflow"; statusLabel: string; displayStatus: string; deployLabel?: string }
	| { type: "noRuns" };

/** Cached render data and marquee state per action instance. */
interface WfMarqueeData {
	line1: MarqueeController;
	line3: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	repoName: string;
	line3Text: string;
	variant: WfRenderVariant;
}

@action({ UUID: "com.pedrofuentes.github-utilities.workflow-status" })
export class WorkflowStatusAction extends SingletonAction<WorkflowStatusSettings> {
	/** Centralized polling coordinator with error backoff */
	private polling = new PollingCoordinator();

	/** Last known settings per action instance */
	private actionSettings = new Map<string, WorkflowStatusSettings>();

	/** Last known URL per action instance (for opening on key press) */
	private lastUrl = new Map<string, string>();

	/** Marquee scroll state per action instance */
	private marqueeData = new Map<string, WfMarqueeData>();

	/**
	 * Called when the action becomes visible on the Stream Deck.
	 */
	override async onWillAppear(ev: WillAppearEvent<WorkflowStatusSettings>): Promise<void> {
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

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.start(ev.action.id, () => this.refreshStatus(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshStatus(ev.action.id);
	}

	/**
	 * Called when the action is no longer visible. Cleans up the timer.
	 */
	override onWillDisappear(ev: WillDisappearEvent<WorkflowStatusSettings>): void {
		this.polling.stop(ev.action.id);
		this.stopMarquee(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
		this.marqueeData.delete(ev.action.id);
	}

	/**
	 * Called when the user presses the button. Opens the workflow run URL in the browser.
	 */
	override async onKeyDown(ev: KeyDownEvent<WorkflowStatusSettings>): Promise<void> {
		const settings = ev.payload.settings;

		if (!settings.repo) {
			return;
		}

		// Open the last known URL for this action (workflow run or repo actions page)
		const url = this.lastUrl.get(ev.action.id);
		if (url) {
			await streamDeck.system.openUrl(url);
		} else {
			// Fallback: open the repo's Actions tab
			const parsed = parseRepoIdentifier(settings.repo);
			if (parsed) {
				const fallbackUrl = settings.workflowFile
					? `https://github.com/${parsed.owner}/${parsed.repo}/actions/workflows/${settings.workflowFile}`
					: `https://github.com/${parsed.owner}/${parsed.repo}/actions`;
				await streamDeck.system.openUrl(fallbackUrl);
			}
		}
	}

	/**
	 * Handles messages from the Property Inspector (datasource requests).
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, WorkflowStatusSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;

			if (!event || typeof event !== "string") {
				streamDeck.logger.debug(`WorkflowStatus: received sendToPlugin without event: ${JSON.stringify(ev.payload)}`);
				return;
			}

			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`WorkflowStatus onSendToPlugin error: ${message}`);
		}
	}

	/**
	 * Called when settings are changed from the Property Inspector.
	 */
	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<WorkflowStatusSettings>): Promise<void> {
		const incoming = ev.payload.settings;

		// Merge incoming settings with cached settings to protect against
		// partial updates (e.g. sdpi-components sending fields without repo).
		const cached = this.actionSettings.get(ev.action.id);
		const settings: WorkflowStatusSettings = { ...cached, ...incoming };
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.polling.stop(ev.action.id);
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner());
			await ev.action.setTitle("");
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
		this.polling.restart(ev.action.id, () => this.refreshStatus(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshStatus(ev.action.id);
	}

	/**
	 * Fetches workflow/deployment status and updates the button display.
	 */
	private async refreshStatus(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) {
			return;
		}

		// Generation counter — prevents stale async results from overwriting fresh data
		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!actionContext || !actionContext.isKey()) {
			return;
		}

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

			const info = await fetchWorkflowInfo(parsed.owner, parsed.repo, token, {
				branch: settings.branch,
				workflowFile: settings.workflowFile,
				environment: settings.environment,
			});

			// Discard stale result if a newer refresh has started
			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			// Determine which state to display
			const activeDeployStates: DeploymentState[] = ["in_progress", "queued", "pending"];
			const isDeploying = info.deployment && activeDeployStates.includes(info.deployment.state);

			// Update marquee state with render variant and text
			const md = this.getOrCreateMarquee(actionId);
			md.repoName = parsed.repo;
			md.line1.setText(parsed.repo);

			if (isDeploying && info.deployment) {
				const envName = info.deployment.environment || "deploy";
				md.line3Text = envName;
				md.line3.setText(envName);
				md.variant = { type: "deploying", deployState: info.deployment.state };

				this.lastUrl.set(
					actionId,
					info.deployment.log_url || info.latestRun?.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/actions`,
				);
			} else if (info.latestRun) {
				const displayStatus = getWorkflowDisplayStatus(info.latestRun);
				const statusLabel = getWorkflowStatusLabel(displayStatus);

				let deployLabel: string | undefined;
				if (info.deployment) {
					const envName = info.deployment.environment || "deploy";
					deployLabel = `${envName}: ${info.deployment.state}`;
				}

				const line3Text = deployLabel ?? statusLabel;
				md.line3Text = line3Text;
				md.line3.setText(line3Text);
				md.variant = { type: "workflow", statusLabel, displayStatus, deployLabel };

				this.lastUrl.set(actionId, info.latestRun.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/actions`);
			} else {
				md.line3Text = "No Runs";
				md.line3.setText("No Runs");
				md.variant = { type: "noRuns" };

				this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/actions`);
			}

			// Render with current marquee window position
			await this.renderWithMarquee(actionId);

			// Start/stop marquee timer based on animation needs
			this.updateMarqueeTimer(actionId);

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(
				`Workflow status updated: ${settings.repo} run=${info.latestRun?.status ?? "none"} deploy=${info.deployment?.state ?? "none"}`,
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch workflow status for ${settings.repo}: ${message}`);

			// Stop marquee on error — nothing to scroll
			this.stopMarquee(actionId);

			let errorLabel = "Error";
			if (message.includes("rate limit")) {
				errorLabel = "Rate Limited";
			} else if (message.includes("not found")) {
				errorLabel = "Not Found";
			} else if (message.includes("token") || message.includes("401")) {
				errorLabel = "Auth Error";
			} else if (message.includes("Access denied")) {
				errorLabel = "No Access";
			}

			this.polling.reportError(actionId);
			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	// ── Marquee helpers ────────────────────────────────────────────────────

	/**
	 * Gets or creates marquee state for an action instance.
	 */
	private getOrCreateMarquee(actionId: string): WfMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				line3: new MarqueeController(LINE3_MAX_VISIBLE),
				timer: null,
				repoName: "",
				line3Text: "",
				variant: { type: "noRuns" },
			};
			this.marqueeData.set(actionId, md);
		}
		return md;
	}

	/**
	 * Renders the button using the current marquee window position.
	 * Uses cached render variant so no API call is needed.
	 */
	private async renderWithMarquee(actionId: string): Promise<void> {
		const md = this.marqueeData.get(actionId);
		const actionContext = [...this.actions].find((a) => a.id === actionId);
		if (!md || !actionContext?.isKey()) return;

		const displayName = md.line1.needsAnimation()
			? md.line1.getCurrentText()
			: md.repoName;
		const displayLine3 = md.line3.needsAnimation()
			? md.line3.getCurrentText()
			: md.line3Text;

		let image: string;
		switch (md.variant.type) {
			case "deploying":
				image = renderDeployingImage(displayLine3, md.variant.deployState, displayName);
				break;
			case "workflow":
				image = renderWorkflowImage(
					md.variant.statusLabel,
					md.variant.displayStatus,
					displayName,
					md.variant.deployLabel ? displayLine3 : undefined,
				);
				break;
			case "noRuns":
				image = renderWorkflowImage("No Runs", "neutral", displayName);
				break;
		}

		await actionContext.setImage(image);
		await actionContext.setTitle("");
	}

	/**
	 * Starts or stops the marquee animation timer based on whether any line
	 * needs scrolling.
	 */
	private updateMarqueeTimer(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (!md) return;

		const needsAnimation = md.line1.needsAnimation() || md.line3.needsAnimation();

		if (needsAnimation && !md.timer) {
			md.timer = setInterval(() => {
				const changed1 = md.line1.tick();
				const changed3 = md.line3.tick();
				if (changed1 || changed3) {
					this.renderWithMarquee(actionId).catch(() => { /* marquee render error — ignore */ });
				}
			}, MARQUEE_INTERVAL_MS);
		} else if (!needsAnimation && md.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}

	/**
	 * Stops the marquee animation timer for an action instance.
	 */
	private stopMarquee(actionId: string): void {
		const md = this.marqueeData.get(actionId);
		if (md?.timer) {
			clearInterval(md.timer);
			md.timer = null;
		}
	}
}
