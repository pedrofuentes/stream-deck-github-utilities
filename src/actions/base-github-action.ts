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
import { GraphQLQueryCoordinator } from "../utils/graphql-query-coordinator";
import { RepoDataCache } from "../utils/repo-data-cache";
import { handlePIDataRequest, type PIDataRequest } from "../utils/pi-data-provider";
import { classifyErrorLabel } from "../utils/github-api";
import { renderErrorImage } from "../utils/button-renderer";
import { renderStripError } from "../utils/touch-strip-renderer";
import {
	activeRepoWatcher,
	getDefaultBridgePath,
	resolveRepoSelection,
	type ResolvedRepo,
} from "../utils/active-repo-source";
import type { JsonValue } from "@elgato/utils";
import type {
	DataFragmentName,
	FragmentParams,
	GlobalSettings,
	RepoActionSettings,
} from "../types";

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
	private static _coordinator = new GraphQLQueryCoordinator(new RepoDataCache());
	/** Cached global-settings override for the bridge path — drives the watcher's pathResolver. */
	private static _cachedBridgePathOverride: string | undefined;

	/** Access the shared coordinator instance. */
	protected get coordinator(): GraphQLQueryCoordinator {
		return BaseGitHubAction._coordinator;
	}

	/** Centralized polling coordinator with error backoff */
	protected polling = new PollingCoordinator();

	/** Debounced URL opener for double-click detection */
	protected urlOpener = new DebouncedUrlOpener();

	/** Last known settings per action instance */
	protected actionSettings = new Map<string, TSettings>();

	/** Cached action contexts for O(1) lookup */
	protected actionContexts = new Map<string, Action<TSettings>>();

	/** Last resolved repo per action — used by syncResolvedRepoSubscription to detect repo changes. */
	protected lastResolvedRepo = new Map<string, string>();

	/**
	 * Common cleanup on action disappear.
	 * Subclasses should override, call super.onWillDisappear(ev),
	 * then clean up their own action-specific state.
	 */
	override onWillDisappear(ev: WillDisappearEvent<TSettings>): void {
		const actionId = ev.action.id;
		this.polling.stop(actionId);
		this.coordinator.unsubscribe(actionId);
		this.urlOpener.cleanup(actionId);
		activeRepoWatcher.unsubscribe(actionId);
		this.actionSettings.delete(actionId);
		this.actionContexts.delete(actionId);
		this.lastResolvedRepo.delete(actionId);
	}

	/**
	 * Resolve the effective repo for an action, honoring Dynamic Repo Mode.
	 *
	 * Returns `null` when the setting is blank — caller decides the semantics
	 * (e.g. pr-review-queue treats empty as "all repos", other actions render
	 * an unconfigured state). When the setting is the active-repo sentinel
	 * but the bridge file is missing/invalid, returns a result with a
	 * `missing` reason so callers can surface a specific error.
	 */
	protected async resolveEffectiveRepo(settings: TSettings): Promise<ResolvedRepo | null> {
		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		// Keep the watcher's path resolver in sync with the latest global-settings
		// override so path changes take effect on the next tick.
		if (globalSettings.activeRepoBridgePath !== BaseGitHubAction._cachedBridgePathOverride) {
			BaseGitHubAction._cachedBridgePathOverride = globalSettings.activeRepoBridgePath;
			const override = globalSettings.activeRepoBridgePath;
			activeRepoWatcher.setPathResolver(() =>
				override && override.trim().length > 0 ? override.trim() : getDefaultBridgePath(),
			);
		}
		return resolveRepoSelection(settings.repo, {
			bridgePath: globalSettings.activeRepoBridgePath,
		});
	}

	/**
	 * Subscribe (or keep subscribed) to the bridge-file watcher so the action
	 * re-runs its refresh immediately when the JSON file changes. When the
	 * setting is no longer the sentinel, we unsubscribe so non-dynamic actions
	 * don't re-render on every bridge change.
	 *
	 * Call from each action's refresh method right after `resolveEffectiveRepo`.
	 */
	protected watchActiveRepo(
		actionId: string,
		isSentinel: boolean,
		onChange: () => Promise<void>,
	): void {
		if (isSentinel) {
			activeRepoWatcher.subscribe(actionId, onChange);
		} else {
			activeRepoWatcher.unsubscribe(actionId);
		}
	}

	/**
	 * Subscribe an action to the coordinator, re-routing the subscription when
	 * the resolved repo has changed since the last call. Inside a single
	 * refresh tick this is a no-op for the common "repo didn't move" case —
	 * it simply reinstalls the subscription (picking up any fragment/params
	 * change) without touching the cache.
	 */
	protected syncResolvedRepoSubscription(
		actionId: string,
		resolvedRepo: string,
		fragments: DataFragmentName[],
		maxAgeSec: number,
		params?: FragmentParams,
		onSiblingRefresh?: () => Promise<void>,
	): void {
		const previous = this.lastResolvedRepo.get(actionId);
		if (previous !== undefined && previous !== resolvedRepo) {
			this.coordinator.unsubscribe(actionId);
		}
		this.coordinator.subscribe(
			{ actionId, repo: resolvedRepo, fragments, maxAgeSec, params },
			onSiblingRefresh,
		);
		this.lastResolvedRepo.set(actionId, resolvedRepo);
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
