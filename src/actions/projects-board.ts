/**
 * Projects Board Action — displays GitHub Projects V2 data for a repository.
 *
 * Shows: project count and first project name on the button.
 * Features:
 *   - Auto-refreshes on a configurable interval (default: 5 minutes)
 *   - Press to open the projects page on GitHub
 *   - Double-click to force refresh
 *   - SVG key images with accent-bar design
 *   - Marquee scrolling for long project names
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	KeyDownEvent,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type {
	DialRotateEvent,
	DialDownEvent,
	DialUpEvent,
	TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { BaseGitHubAction } from "./base-github-action";
import type { GlobalSettings, ProjectsBoardSettings, ProjectsV2Data } from "../types";
import { parseRepoIdentifier, formatCount } from "../utils/github";
import { classifyErrorLabel } from "../utils/github-api";
import { renderProjectsBoardImage, renderAnimatedSpinner, renderErrorImage, renderUnconfiguredImage } from "../utils/button-renderer";
import { renderStatStrip, renderStripLoading, renderStripError, renderStripUnconfigured } from "../utils/touch-strip-renderer";
import { MarqueeController } from "../utils/marquee-controller";

const DEFAULT_REFRESH_INTERVAL = 300; // 5 minutes
const MIN_REFRESH_INTERVAL = 30; // 30 seconds minimum
const MARQUEE_INTERVAL_MS = 500;
const LINE1_MAX_VISIBLE = 14;

/** Cached render data and marquee state per action instance. */
interface ProjectsMarqueeData {
	line1: MarqueeController;
	timer: ReturnType<typeof setInterval> | null;
	projects: ProjectsV2Data["projects"];
}

@action({ UUID: "com.pedrofuentes.github-utilities.projects-board" })
export class ProjectsBoardAction extends BaseGitHubAction<ProjectsBoardSettings> {
	private marqueeData = new Map<string, ProjectsMarqueeData>();
	private recentSetSettings = new Set<string>();

	override async onWillAppear(ev: WillAppearEvent<ProjectsBoardSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const settings = ev.payload.settings;
		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner("#3FB950"));
			await ev.action.setTitle("");
		}

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

		this.polling.start(ev.action.id, () => this.refreshData(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshData(ev.action.id);
	}

	override onWillDisappear(ev: WillDisappearEvent<ProjectsBoardSettings>): void {
		super.onWillDisappear(ev);
		this.stopMarquee(ev.action.id);
		this.marqueeData.delete(ev.action.id);
		this.recentSetSettings.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<ProjectsBoardSettings>): Promise<void> {
		if (this.urlOpener.handlePress(ev.action.id)) {
			this.polling.resetBackoff(ev.action.id);
			await this.refreshData(ev.action.id, true);
			return;
		}

		const settings = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const resolved = await this.resolveEffectiveRepo(cached ?? settings);
		if (!resolved || resolved.missing) return;

		const parsed = parseRepoIdentifier(resolved.repo);
		if (parsed) {
			const url = `https://github.com/${parsed.owner}/${parsed.repo}/projects`;
			this.urlOpener.scheduleOpen(ev.action.id, url);
		}
	}

	/** Opens the projects page on dial press (Stream Deck+). */
	override async onDialDown(ev: DialDownEvent<ProjectsBoardSettings>): Promise<void> {
		const cached = this.actionSettings.get(ev.action.id);
		const settings = cached ?? ev.payload.settings;
		const resolved = await this.resolveEffectiveRepo(settings);
		if (!resolved || resolved.missing) return;

		const parsed = parseRepoIdentifier(resolved.repo);
		if (parsed) {
			await streamDeck.system.openUrl(`https://github.com/${parsed.owner}/${parsed.repo}/projects`);
		}
	}

	override async onDialUp(_ev: DialUpEvent<ProjectsBoardSettings>): Promise<void> {
		// No action needed on release
	}

	/** Forces a data refresh on dial rotate (Stream Deck+). */
	override async onDialRotate(ev: DialRotateEvent<ProjectsBoardSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshData(ev.action.id, true);
	}

	/** Forces a data refresh on touch strip tap (Stream Deck+). */
	override async onTouchTap(ev: TouchTapEvent<ProjectsBoardSettings>): Promise<void> {
		this.polling.resetBackoff(ev.action.id);
		await this.refreshData(ev.action.id, true);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ProjectsBoardSettings>): Promise<void> {
		const incoming = ev.payload.settings;

		if (this.recentSetSettings.delete(ev.action.id)) {
			this.actionSettings.set(ev.action.id, incoming);
			return;
		}

		const cached = this.actionSettings.get(ev.action.id);
		const settings: ProjectsBoardSettings = { ...cached, ...incoming };

		if (settings.repo && !settings.refreshInterval) {
			settings.refreshInterval = 300;
		}

		this.actionSettings.set(ev.action.id, settings);

		if (ev.action.isKey()) {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setImage(renderUnconfiguredImage());
				await ev.action.setTitle("");
				this.polling.stop(ev.action.id);
				this.coordinator.unsubscribe(ev.action.id);
				return;
			}

			await ev.action.setImage(renderAnimatedSpinner("#3FB950"));
			await ev.action.setTitle("");
		}

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.polling.stop(ev.action.id);
				this.coordinator.unsubscribe(ev.action.id);
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

		this.polling.restart(ev.action.id, () => this.refreshData(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);

		await this.refreshData(ev.action.id);
	}

	private async refreshData(actionId: string, force = false): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return;

		const gen = this.polling.incrementGeneration(actionId);

		const actionContext = this.actionContexts.get(actionId);
		if (!actionContext) return;

		const isDial = actionContext.isDial();

		const resolved = await this.resolveEffectiveRepo(settings);
		if (!resolved) return;
		this.watchActiveRepo(actionId, resolved.isSentinel, () => this.refreshData(actionId));

		if (resolved.missing === "bridge") {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("No Active"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("No active repo") });
			return;
		}
		if (resolved.missing === "invalid") {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("Bad Bridge"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("Bridge invalid") });
			return;
		}

		const parsed = parseRepoIdentifier(resolved.repo);
		if (!parsed) {
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage("Invalid"));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError("Invalid repo") });
			return;
		}

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token) {
				if (actionContext.isKey()) {
					await actionContext.setImage(renderUnconfiguredImage());
					await actionContext.setTitle("");
				}
				if (isDial) await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}

			const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;
			this.syncResolvedRepoSubscription(
				actionId,
				resolved.repo,
				["projectsV2"],
				intervalSec,
				undefined,
				() => this.refreshData(actionId),
			);

			const result = force
				? await this.coordinator.invalidateAndFetch(actionId, token)
				: await this.coordinator.fetchData(actionId, token);
			const projectsData = result.projectsV2;

			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			const projects = projectsData?.projects ?? [];

			const md = this.getOrCreateMarquee(actionId);
			md.projects = projects;

			// Set marquee text for the line that might scroll
			if (projects.length === 1) {
				md.line1.setText(`${projects[0].totalItems} items`);
			} else if (projects.length > 1) {
				md.line1.setText(projects[0].title);
			} else {
				md.line1.setText("");
			}

			await this.renderWithMarquee(actionId);
			this.updateMarqueeTimer(actionId);

			if (isDial) {
				const displayCount = formatCount(projects.length);
				await actionContext.setFeedback({
					canvas: renderStatStrip(displayCount, "projects", undefined, parsed.repo, "projects"),
				});
			}

			this.polling.reportSuccess(actionId);
			streamDeck.logger.debug(`Projects updated: ${settings.repo} count=${projects.length}`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch projects for ${settings.repo}: ${message}`);
			this.stopMarquee(actionId);

			const errorLabel = classifyErrorLabel(error);

			this.polling.reportError(actionId);
			if (actionContext.isKey()) {
				await actionContext.setImage(renderErrorImage(errorLabel));
				await actionContext.setTitle("");
			}
			if (isDial) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}

	private getOrCreateMarquee(actionId: string): ProjectsMarqueeData {
		let md = this.marqueeData.get(actionId);
		if (!md) {
			md = {
				line1: new MarqueeController(LINE1_MAX_VISIBLE),
				timer: null,
				projects: [],
			};
			this.marqueeData.set(actionId, md);
		}
		return md;
	}

	private async renderWithMarquee(actionId: string): Promise<void> {
		const md = this.marqueeData.get(actionId);
		const actionContext = this.actionContexts.get(actionId);
		if (!md || !actionContext?.isKey()) return;

		await actionContext.setImage(renderProjectsBoardImage(md.projects));
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
