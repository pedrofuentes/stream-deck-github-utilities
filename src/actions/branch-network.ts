/**
 * Branch Network Action — displays a real git network graph
 * on the Stream Deck+ touch strip.
 *
 * Encoder-only action designed for the Stream Deck+ touch strip.
 * Uses the `git-network-graph` library for accurate graph topology:
 * real commit history with branch lanes, merge points, and fork connections.
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
import {
	createGitGraphFromData,
	printUnicode,
	Characters,
	BranchSettings,
	BranchSettingsDef,
	MergePatterns,
} from "git-network-graph";
import type { Settings as GraphSettings, GitGraph, RawGraphInput } from "git-network-graph";

import type { GlobalSettings, BranchNetworkSettings } from "../types";
import { BaseGitHubAction } from "./base-github-action";
import { parseRepoIdentifier } from "../utils/github";
import { classifyErrorLabel } from "../utils/github-api";
import type { BranchInfo } from "../utils/github-api";
import { RenderDebouncer } from "../utils/render-debouncer";
import {
	renderNetworkGraphStrip,
	renderStripLoading,
	renderStripError,
	renderStripUnconfigured,
	resolveGraphColor,
	parseGraphGrid,
} from "../utils/touch-strip-renderer";
import type { NetworkGraphRenderData } from "../utils/touch-strip-renderer";

const DEFAULT_REFRESH_INTERVAL = 300;
const MIN_REFRESH_INTERVAL = 30;

/**
 * Build `git-network-graph` settings from the action's model preference.
 *
 * @param model - Branching model name
 * @returns Configured settings for the graph library
 */
function buildGraphSettings(model: "gitflow" | "simple" | "none" = "gitflow"): GraphSettings {
	const modelMap: Record<string, BranchSettingsDef> = {
		gitflow: BranchSettingsDef.gitFlow(),
		simple: BranchSettingsDef.simple(),
		none: BranchSettingsDef.none(),
	};
	return {
		// Always false — the renderer handles horizontal direction via CW/CCW
		// coordinate mapping, matching the library's printSvgHorizontal approach.
		reverseCommitOrder: false,
		debug: false,
		compact: true,
		colored: false,
		includeRemote: false,
		format: { type: "OneLine" },
		wrapping: null,
		characters: Characters.round(),
		branchOrder: { type: "ShortestFirst", forward: true },
		branches: BranchSettings.from(modelMap[model] ?? BranchSettingsDef.gitFlow()),
		mergePatterns: MergePatterns.default(),
	};
}

/**
 * Resolve a GitGraph into pre-computed render data for the SVG renderer.
 * Converts library-internal indices into concrete positions and colors.
 *
 * @param graph - The computed git graph from createGitGraphFromData
 * @returns Render data ready for {@link renderNetworkGraphStrip}
 */
/**
 * Resolve a GitGraph into pre-computed render data using `printUnicode`.
 * Generates the character grid and color mapping for the SVG renderer.
 */
function resolveRenderData(graph: GitGraph, graphSettings: GraphSettings): NetworkGraphRenderData {
	// Get graph lines from printUnicode (colored: false for clean characters)
	const cleanSettings: GraphSettings = { ...graphSettings, colored: false };
	const [graphLines] = printUnicode(graph, cleanSettings);

	// Strip any residual ANSI escape codes (safety measure)
	// eslint-disable-next-line no-control-regex -- intentional ANSI escape (ESC, \x1b) stripping
	const cleanLines = graphLines.map((line: string) => line.replace(/\x1b\[[0-9;]*m/g, ""));

	// Build column → color mapping from branch data
	const columnColors = new Map<number, string>();
	for (const branch of graph.allBranches) {
		if (branch.visual.column != null && !columnColors.has(branch.visual.column)) {
			columnColors.set(branch.visual.column, resolveGraphColor(branch.visual.svgColor ?? "gray"));
		}
	}

	// Parse into grid cells with colors
	const grid = parseGraphGrid(cleanLines, columnColors);
	const gridCols = cleanLines.reduce((max: number, line: string) => Math.max(max, [...line].length), 0);

	// Resolve branch labels
	const branches = graph.allBranches
		.filter((b) => b.visual.column != null)
		.map((b) => {
			// Find the first row where this branch's dot appears
			const col = b.visual.column!;
			const charCol = col * 2; // each branch lane = 2 chars wide
			let firstRow = 0;
			for (let row = 0; row < grid.length; row++) {
				const cell = grid[row][charCol];
				if (cell && (cell.char === "●" || cell.char === "○")) {
					firstRow = row;
					break;
				}
			}
			return {
				name: b.name,
				column: charCol,
				color: resolveGraphColor(b.visual.svgColor ?? "gray"),
				firstRow,
			};
		});

	return { grid, gridCols, branches };
}

@action({ UUID: "com.pedrofuentes.github-utilities.branch-network" })
export class BranchNetworkAction extends BaseGitHubAction<BranchNetworkSettings> {
	private renderDebouncer = new RenderDebouncer();
	private lastUrl = new Map<string, string>();
	/** Cached render data per action (avoids recomputing graph on every scroll) */
	private graphCache = new Map<string, NetworkGraphRenderData>();
	/** Dial column position per action (0-3) */
	private dialColumn = new Map<string, number>();

	/** Shared horizontal scroll per sibling group (synced across same repo+orientation) */
	private static sharedScrollH = new Map<string, number>();
	/** Shared vertical scroll per sibling group (synced across same repo+orientation) */
	private static sharedScrollV = new Map<string, number>();

	/** Composite key for linking siblings: only same repo + same orientation are linked */
	private siblingKey(repo: string, orientation: string): string {
		return `${repo}|${orientation}`;
	}

	/**
	 * Compute base offset from relative position among siblings with same repo and orientation.
	 */
	private getBaseOffset(actionId: string): number {
		const settings = this.actionSettings.get(actionId);
		if (!settings?.repo) return 0;
		const orientation = settings.orientation ?? "horizontal";
		const myColumn = this.dialColumn.get(actionId) ?? 0;
		const siblingColumns: number[] = [];
		for (const a of this.actionContexts.values()) {
			const s = this.actionSettings.get(a.id);
			if (s?.repo === settings.repo && (s.orientation ?? "horizontal") === orientation && a.isDial()) {
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

		if (settings.repo) {
			this.coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["branches", "networkCommits"],
				maxAgeSec: intervalSec,
				params: { maxCommits: Number(settings.maxCommits) || 100 },
			}, () => this.refreshNetwork(ev.action.id));
		}

		this.polling.start(ev.action.id, () => this.refreshNetwork(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		await this.refreshNetwork(ev.action.id);
		if (settings.repo) {
			const orientation = settings.orientation ?? "horizontal";
			this.renderAllSiblings(settings.repo, orientation).catch(() => {});
		}
	}

	override onWillDisappear(ev: WillDisappearEvent<BranchNetworkSettings>): void {
		const settings = this.actionSettings.get(ev.action.id);
		const repo = settings?.repo;
		const orientation = settings?.orientation ?? "horizontal";
		super.onWillDisappear(ev);
		this.lastUrl.delete(ev.action.id);
		this.graphCache.delete(ev.action.id);
		this.dialColumn.delete(ev.action.id);
		this.renderDebouncer.cleanup(ev.action.id);
		if (repo) this.renderAllSiblings(repo, orientation).catch(() => {});
	}

	override async onDialRotate(ev: DialRotateEvent<BranchNetworkSettings>): Promise<void> {
		const settings = this.actionSettings.get(ev.action.id);
		const repo = settings?.repo;
		if (!repo) return;
		const orientation = settings.orientation ?? "horizontal";
		const key = this.siblingKey(repo, orientation);

		if (ev.payload.pressed) {
			const vOff = BranchNetworkAction.sharedScrollV.get(key) ?? 0;
			BranchNetworkAction.sharedScrollV.set(key, Math.max(-50, Math.min(100, vOff + ev.payload.ticks * 5)));
		} else {
			const hOff = BranchNetworkAction.sharedScrollH.get(key) ?? 0;
			BranchNetworkAction.sharedScrollH.set(key, Math.max(0, hOff + ev.payload.ticks * 10));
		}

		this.renderDebouncer.schedule(ev.action.id, () => {
			this.renderAllSiblings(repo, orientation).catch(() => {});
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

	/** Re-render all sibling instances for the same repo and orientation using cached graph data */
	private async renderAllSiblings(repo: string, orientation: string): Promise<void> {
		const key = this.siblingKey(repo, orientation);
		const hScroll = BranchNetworkAction.sharedScrollH.get(key) ?? 0;
		const vScroll = BranchNetworkAction.sharedScrollV.get(key) ?? 0;

		for (const ctx of this.actionContexts.values()) {
			const s = this.actionSettings.get(ctx.id);
			if (s?.repo !== repo || (s.orientation ?? "horizontal") !== orientation || !ctx.isDial()) continue;

			const renderData = this.graphCache.get(ctx.id);
			if (!renderData) continue;

			const hOff = this.getBaseOffset(ctx.id) + hScroll;
			await ctx.setFeedback({
				canvas: renderNetworkGraphStrip(renderData, orientation as "horizontal" | "horizontal-reverse", hOff, vScroll),
			});
		}
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BranchNetworkSettings>): Promise<void> {
		this.actionContexts.set(ev.action.id, ev.action);
		const incoming = ev.payload.settings;
		const cached = this.actionSettings.get(ev.action.id);
		const oldRepo = cached?.repo;
		const oldMaxCommits = Number(cached?.maxCommits) || 100;
		const oldOrientation = cached?.orientation ?? "horizontal";
		const oldBranchModel = cached?.branchModel ?? "gitflow";
		const settings: BranchNetworkSettings = { ...cached, ...incoming };
		this.actionSettings.set(ev.action.id, settings);
		const newMaxCommits = Number(settings.maxCommits) || 100;
		const newOrientation = settings.orientation ?? "horizontal";
		const newBranchModel = settings.branchModel ?? "gitflow";

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (!settings.repo || !globalSettings.githubToken) {
				await ev.action.setFeedback({ canvas: renderStripUnconfigured() });
				this.polling.stop(ev.action.id);
				this.coordinator.unsubscribe(ev.action.id);
				if (oldRepo) this.renderAllSiblings(oldRepo, oldOrientation).catch(() => {});
				return;
			}
			await ev.action.setFeedback({ canvas: renderStripLoading() });
		}

		const intervalSec = settings.refreshInterval ?? DEFAULT_REFRESH_INTERVAL;

		// Invalidate cached graph when graph-shaping settings change
		const graphSettingsChanged = oldMaxCommits !== newMaxCommits
			|| oldOrientation !== newOrientation
			|| oldBranchModel !== newBranchModel;
		if (settings.repo && graphSettingsChanged) {
			this.graphCache.delete(ev.action.id);
		}

		if (settings.repo) {
			this.coordinator.subscribe({
				actionId: ev.action.id,
				repo: settings.repo,
				fragments: ["branches", "networkCommits"],
				maxAgeSec: intervalSec,
				params: { maxCommits: newMaxCommits },
			}, () => this.refreshNetwork(ev.action.id));
		}

		this.polling.restart(ev.action.id, () => this.refreshNetwork(ev.action.id), intervalSec, MIN_REFRESH_INTERVAL);
		// Force refetch when maxCommits changes (cached data has wrong commit count)
		if (settings.repo && oldMaxCommits !== newMaxCommits) {
			this.graphCache.delete(ev.action.id);
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			if (globalSettings.githubToken) {
				await this.coordinator.invalidateAndFetch(ev.action.id, globalSettings.githubToken);
			}
		}
		await this.refreshNetwork(ev.action.id);
		if (oldRepo && (oldRepo !== settings.repo || oldOrientation !== newOrientation)) {
			this.renderAllSiblings(oldRepo, oldOrientation).catch(() => {});
		}
		if (settings.repo) this.renderAllSiblings(settings.repo, newOrientation).catch(() => {});
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

		try {
			const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
			const token = globalSettings.githubToken;
			if (!token) {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripUnconfigured() });
				return;
			}

			const result = await this.coordinator.fetchData(actionId, token);
			if (!this.polling.isCurrentGeneration(actionId, gen)) return;

			if (result.errors?.networkCommits && result.networkCommits === undefined) {
				throw new Error(result.errors.networkCommits);
			}

			const branches: BranchInfo[] = result.branches ?? [];
			const networkData = result.networkCommits;
			const commits = networkData?.commits ?? [];
			const tags = networkData?.tags ?? [];

			if (commits.length === 0) {
				if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError("No Commits") });
				this.polling.reportSuccess(actionId);
				return;
			}

			// Build git-network-graph input from API data
			const defaultBranch = branches.find((b) => b.name === "main" || b.name === "master") ?? branches[0];
			const graphInput: RawGraphInput = {
				head: {
					oid: defaultBranch?.commitSha ?? commits[0].oid,
					name: defaultBranch?.name ?? "main",
					isBranch: true,
				},
				commits,
				branches: branches.map((b) => ({ name: b.name, oid: b.commitSha })),
				tags,
			};

			const graphSettings = buildGraphSettings(settings.branchModel ?? "gitflow");
			const graph = createGitGraphFromData(graphInput, graphSettings);
			const renderData = resolveRenderData(graph, graphSettings);

			this.graphCache.set(actionId, renderData);

			const orientation = settings.orientation ?? "horizontal";
			const key = this.siblingKey(settings.repo!, orientation);
			const hScroll = BranchNetworkAction.sharedScrollH.get(key) ?? 0;
			const vScroll = BranchNetworkAction.sharedScrollV.get(key) ?? 0;
			const hOff = this.getBaseOffset(actionId) + hScroll;

			if (actionContext.isDial()) {
				await actionContext.setFeedback({
					canvas: renderNetworkGraphStrip(renderData, orientation, hOff, vScroll),
				});
			}

			this.lastUrl.set(actionId, `https://github.com/${parsed.owner}/${parsed.repo}/network`);
			this.polling.reportSuccess(actionId);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error";
			streamDeck.logger.error(`Failed to fetch network graph for ${settings.repo}: ${message}`);

			const errorLabel = classifyErrorLabel(error);

			this.polling.reportError(actionId);
			if (actionContext.isDial()) await actionContext.setFeedback({ canvas: renderStripError(errorLabel) });
		}
	}
}
