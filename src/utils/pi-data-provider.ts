/**
 * Property Inspector Data Provider — handles datasource requests from the PI.
 *
 * Both RepoStatsAction and WorkflowStatusAction use this shared handler to
 * respond to sdpi-components datasource requests, providing dynamic dropdown
 * data (repos, workflows, branches, environments) fetched from the GitHub API.
 *
 * Communication flow:
 *   1. PI opens a <sdpi-select datasource="getRepos"> dropdown
 *   2. sdpi-components sends `sendToPlugin` with `{ event: "getRepos" }`
 *   3. Plugin's `onSendToPlugin` delegates to this handler
 *   4. Handler fetches data from GitHub API via github-api.ts
 *   5. Handler sends response via `streamDeck.ui.sendToPropertyInspector()`
 *   6. sdpi-components receives items and populates the dropdown
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import type { JsonValue } from "@elgato/utils";

import streamDeck from "@elgato/streamdeck";

import type { GlobalSettings } from "../types";
import { parseRepoIdentifier } from "./github";
import {
	validateTokenStatus,
	fetchUserRepos,
	fetchRepoWorkflows,
	fetchRepoBranches,
	fetchRepoEnvironments,
	type DataSourceItem,
} from "./github-api";
import { ACTIVE_REPO_SENTINEL, resolveRepoSelection } from "./active-repo-source";

/** Payload shape from sdpi-components datasource requests */
export interface PIDataRequest {
	event: string;
	isRefresh?: boolean;
	[key: string]: JsonValue;
}

/** Response shape expected by sdpi-components datasource */
export interface PIDataResponse {
	event: string;
	items: DataSourceItem[];
}

/**
 * Build the leading "Current Active Repo" entry shown in every repo picker.
 * When the bridge file resolves cleanly the label includes the live repo so
 * users can confirm the integration at a glance.
 */
async function buildActiveRepoPickerItem(bridgePath: string | undefined): Promise<DataSourceItem> {
	const resolved = await resolveRepoSelection(ACTIVE_REPO_SENTINEL, { bridgePath });
	if (resolved && !resolved.missing && resolved.repo) {
		return {
			label: `★ Current Active Repo (${resolved.repo})`,
			value: ACTIVE_REPO_SENTINEL,
		};
	}
	return {
		label: "★ Cursor/VS Code: Current Active Repo",
		value: ACTIVE_REPO_SENTINEL,
	};
}

/**
 * Known datasource event names supported by the PI.
 */
export const PI_EVENTS = {
	VALIDATE_TOKEN: "validateToken",
	GET_REPOS: "getRepos",
	GET_WORKFLOWS: "getWorkflows",
	GET_BRANCHES: "getBranches",
	GET_ENVIRONMENTS: "getEnvironments",
} as const;

/**
 * Handles a datasource request from the Property Inspector.
 *
 * Reads global settings for the token, action settings for context (repo),
 * fetches the appropriate data from GitHub, and sends it back to the PI.
 *
 * @param event - The datasource event name (e.g. "getRepos", "getWorkflows")
 * @param getActionSettings - Async function to get current action settings
 */
export async function handlePIDataRequest(
	event: string,
	getActionSettings: () => Promise<{ repo?: string }>,
): Promise<void> {
	streamDeck.logger.debug(`PI datasource request: ${event}`);

	try {
		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		const token = globalSettings.githubToken;

		let items: DataSourceItem[];

		switch (event) {
			case PI_EVENTS.VALIDATE_TOKEN: {
				items = await validateTokenStatus(token);
				break;
			}

			case PI_EVENTS.GET_REPOS: {
				const repos = await fetchUserRepos(token);
				const activeEntry = await buildActiveRepoPickerItem(globalSettings.activeRepoBridgePath);
				items = [activeEntry, ...repos];
				break;
			}

			case PI_EVENTS.GET_WORKFLOWS:
			case PI_EVENTS.GET_BRANCHES:
			case PI_EVENTS.GET_ENVIRONMENTS: {
				const settings = await getActionSettings();
				const resolved = settings.repo
					? await resolveRepoSelection(settings.repo, { bridgePath: globalSettings.activeRepoBridgePath })
					: null;

				if (resolved?.missing === "bridge") {
					items = [{ label: "⚠ Active-repo bridge file not found — see README", value: "", disabled: true }];
					break;
				}
				if (resolved?.missing === "invalid") {
					items = [{ label: "⚠ Active-repo bridge file is invalid — see README", value: "", disabled: true }];
					break;
				}

				const parsed = resolved ? parseRepoIdentifier(resolved.repo) : null;

				if (!parsed) {
					items = [{ label: "⚠ Select a repository first", value: "", disabled: true }];
					break;
				}

				if (event === PI_EVENTS.GET_WORKFLOWS) {
					items = await fetchRepoWorkflows(parsed.owner, parsed.repo, token);
				} else if (event === PI_EVENTS.GET_BRANCHES) {
					items = await fetchRepoBranches(parsed.owner, parsed.repo, token);
				} else {
					items = await fetchRepoEnvironments(parsed.owner, parsed.repo, token);
				}
				break;
			}

			default: {
				streamDeck.logger.warn(`Unknown PI datasource event: ${event}`);
				// Still respond so the dropdown doesn't hang forever
				items = [{ label: "⚠ Unknown request", value: "", disabled: true }];
				break;
			}
		}

		streamDeck.logger.debug(`PI datasource response: ${event} → ${items.length} items`);
		await streamDeck.ui.sendToPropertyInspector({ event, items });
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Unknown error";
		streamDeck.logger.error(`PI data request failed for "${event}": ${message}`);

		// Always respond so the dropdown doesn't hang
		try {
			await streamDeck.ui.sendToPropertyInspector({
				event,
				items: [{ label: "⚠ Error loading data", value: "", disabled: true }],
			});
		} catch {
			streamDeck.logger.error(`Failed to send error response to PI for "${event}"`);
		}
	}
}
