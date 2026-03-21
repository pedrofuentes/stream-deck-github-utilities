/**
 * Abstract base class for all GitHub utility actions.
 *
 * Provides shared infrastructure that every action needs:
 *   - PollingCoordinator for rate-limited refresh with error backoff
 *   - DebouncedUrlOpener for double-click detection on key press
 *   - Per-instance settings and context Maps
 *   - Common onWillDisappear cleanup (coordinator, polling, URL opener, Maps)
 *   - Common onSendToPlugin PI data request handler
 *   - renderError() helper for centralized error display
 *   - validateSettings() helper for repo + token validation
 *
 * Subclasses must still implement onWillAppear and action-specific logic.
 * They should call super.onWillDisappear(ev) and then clean up their own state.
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	SingletonAction,
	type Action,
	type WillDisappearEvent,
	type SendToPluginEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { PollingCoordinator } from "../utils/polling-coordinator";
import { DebouncedUrlOpener } from "../utils/debounced-url-opener";
import { coordinator } from "../utils/graphql-query-coordinator";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { classifyErrorLabel } from "../utils/github-api";
import { renderErrorImage } from "../utils/button-renderer";
import { renderStripError } from "../utils/touch-strip-renderer";
import type { JsonValue } from "@elgato/utils";
import type { RepoActionSettings } from "../types";

/**
 * Minimal settings shape that all GitHub action settings share.
 * Alias for RepoActionSettings — the canonical base defined in types.ts.
 */
export type BaseActionSettings = RepoActionSettings;

/**
 * Abstract base class for GitHub utility actions.
 *
 * Provides common infrastructure: polling, URL debouncing, settings management,
 * error handling, and PI data request delegation.
 *
 * @typeParam TSettings - The action's settings interface (must extend BaseActionSettings)
 */
export abstract class BaseGitHubAction<TSettings extends BaseActionSettings> extends SingletonAction<TSettings> {
	/** Centralized polling coordinator with error backoff */
	protected polling = new PollingCoordinator();

	/** Debounced URL opener for double-click detection */
	protected urlOpener = new DebouncedUrlOpener();

	/** Last known settings per action instance */
	protected actionSettings = new Map<string, TSettings>();

	/** Cached action contexts for O(1) lookup */
	protected actionContexts = new Map<string, Action<TSettings>>();

	/**
	 * Common cleanup on action disappear.
	 * Subclasses should override, call super.onWillDisappear(ev),
	 * then clean up their own action-specific state.
	 */
	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		const actionId = ev.action.id;
		this.polling.stop(actionId);
		coordinator.unsubscribe(actionId);
		this.urlOpener.cleanup(actionId);
		this.actionSettings.delete(actionId);
		this.actionContexts.delete(actionId);
	}

	/**
	 * Common PI data request handler.
	 * Delegates datasource requests from the Property Inspector to handlePIDataRequest.
	 */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, TSettings>): Promise<void> {
		try {
			const data = ev.payload as PIDataRequest;
			const event = data?.event;
			if (!event || typeof event !== "string") return;
			await handlePIDataRequest(event, () => ev.action.getSettings());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`onSendToPlugin error: ${message}`);
		}
	}

	/**
	 * Classify an error and render an error image on the button/strip.
	 * Returns the error label for logging.
	 */
	protected async renderError(actionId: string, error: unknown): Promise<string> {
		const errorLabel = classifyErrorLabel(error);
		const actionContext = this.actionContexts.get(actionId);
		if (actionContext) {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage(errorLabel));
				await actionContext.setTitle("");
			}
			if (actionContext.isDial()) {
				await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
			}
		}
		return errorLabel;
	}
}
