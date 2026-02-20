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
	renderLoadingImage,
	renderErrorImage,
	renderUnconfiguredImage,
} from "../utils/button-renderer";
import type { JsonValue } from "@elgato/utils";

const DEFAULT_REFRESH_INTERVAL = 60; // 1 minute (workflows change faster than stats)
const MIN_REFRESH_INTERVAL = 15; // 15 seconds minimum

@action({ UUID: "com.pedrofuentes.github-utilities.workflow-status" })
export class WorkflowStatusAction extends SingletonAction<WorkflowStatusSettings> {
	/** Active polling timers keyed by action instance ID */
	private timers = new Map<string, ReturnType<typeof setInterval>>();

	/** Last known settings per action instance */
	private actionSettings = new Map<string, WorkflowStatusSettings>();

	/** Last known URL per action instance (for opening on key press) */
	private lastUrl = new Map<string, string>();

	/**
	 * Called when the action becomes visible on the Stream Deck.
	 */
	override async onWillAppear(ev: WillAppearEvent<WorkflowStatusSettings>): Promise<void> {
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			if (!settings.repo) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				return;
			}

			await ev.action.setImage(renderLoadingImage());
			await ev.action.setTitle("");
		}

		await this.refreshStatus(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	/**
	 * Called when the action is no longer visible. Cleans up the timer.
	 */
	override onWillDisappear(ev: WillDisappearEvent<WorkflowStatusSettings>): void {
		this.stopTimer(ev.action.id);
		this.actionSettings.delete(ev.action.id);
		this.lastUrl.delete(ev.action.id);
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
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			if (!settings.repo) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.stopTimer(ev.action.id);
				return;
			}

			await ev.action.setImage(renderLoadingImage());
			await ev.action.setTitle("");
		}

		await this.refreshStatus(ev.action.id);

		this.stopTimer(ev.action.id);
		this.startTimer(ev.action.id, settings);
	}

	/**
	 * Fetches workflow/deployment status and updates the button display.
	 */
	private async refreshStatus(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) {
			return;
		}

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

			const info = await fetchWorkflowInfo(parsed.owner, parsed.repo, token, {
				branch: settings.branch,
				workflowFile: settings.workflowFile,
				environment: settings.environment,
			});

			// Determine which state to display
			const activeDeployStates: DeploymentState[] = ["in_progress", "queued", "pending"];
			const isDeploying = info.deployment && activeDeployStates.includes(info.deployment.state);

			if (isDeploying && info.deployment) {
				// Show deploying state prominently
				const envName = info.deployment.environment || "deploy";
				await actionContext.setImage(renderDeployingImage(envName, info.deployment.state, parsed.repo));

				// Store the deployment log URL, or fall back to latest run URL
				this.lastUrl.set(
					actionId,
					info.deployment.log_url || info.latestRun?.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/actions`,
				);
			} else if (info.latestRun) {
				// Show the latest workflow run status
				const displayStatus = getWorkflowDisplayStatus(info.latestRun);
				const statusLabel = getWorkflowStatusLabel(displayStatus);

				// Add deploy info as secondary line if available
				let deployLabel: string | undefined;
				if (info.deployment) {
					const envName = info.deployment.environment || "deploy";
					deployLabel = `${envName}: ${info.deployment.state}`;
				}

				await actionContext.setImage(renderWorkflowImage(statusLabel, displayStatus, parsed.repo, deployLabel));

				// Store the workflow run URL
				this.lastUrl.set(actionId, info.latestRun.html_url || `https://github.com/${parsed.owner}/${parsed.repo}/actions`);
			} else {
				// No workflow runs found
				await actionContext.setImage(renderWorkflowImage("No Runs", "neutral", parsed.repo));

				// Fall back to the repo's Actions tab
				this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/actions`);
			}

			await actionContext.setTitle("");

			streamDeck.logger.debug(
				`Workflow status updated: ${settings.repo} run=${info.latestRun?.status ?? "none"} deploy=${info.deployment?.state ?? "none"}`,
			);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch workflow status for ${settings.repo}: ${message}`);

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

			await actionContext.setImage(renderErrorImage(errorLabel));
			await actionContext.setTitle("");
		}
	}

	/**
	 * Starts the auto-refresh polling timer for an action instance.
	 */
	private startTimer(actionId: string, settings: WorkflowStatusSettings): void {
		if (!settings.repo) {
			return;
		}

		const intervalSec = Math.max(
			settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL,
			MIN_REFRESH_INTERVAL,
		);

		const timer = setInterval(() => {
			this.refreshStatus(actionId).catch((err) => {
				streamDeck.logger.error(`Timer refresh failed for ${actionId}: ${err}`);
			});
		}, intervalSec * 1000);

		this.timers.set(actionId, timer);
		streamDeck.logger.debug(`Started workflow timer for ${actionId} with ${intervalSec}s interval`);
	}

	/**
	 * Stops the polling timer for an action instance.
	 */
	private stopTimer(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(actionId);
			streamDeck.logger.debug(`Stopped workflow timer for ${actionId}`);
		}
	}
}
