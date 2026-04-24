/**
 * Active Repo Action — surfaces the current editor's repo, branch, and
 * working-tree git state on the Stream Deck.
 *
 * Reads the bridge file written by the Cursor/VSCode companion extension
 * and re-renders on any bridge-file change (save/stage/commit/focus switch).
 * No GitHub API calls are made; all data is local.
 *
 * Controllers:
 *   - Keypad (144×144) — compact summary: repo, branch, status line.
 *   - Encoder (200×100) — rotatable between two view modes:
 *       · branch-sync  (default) — repo + branch + ahead/behind/upstream.
 *       · working-tree — repo + branch + staged/unstaged/untracked columns.
 *
 * Triggers:
 *   - Key / dial press: open the current workspace in the editor that wrote
 *     the bridge (Cursor or VS Code).
 *   - Dial rotate: cycle view mode.
 *   - Touch tap: force refresh (resets bridge cache and re-renders).
 *
 * @author Pedro Fuentes <git@pedrofuent.es>
 * @copyright Pedro Pablo Fuentes Schuster
 * @license MIT
 */

import {
	action,
	KeyUpEvent,
	WillAppearEvent,
	WillDisappearEvent,
	DidReceiveSettingsEvent,
} from "@elgato/streamdeck";
import type {
	DialRotateEvent,
	DialUpEvent,
	TouchTapEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";

import { BaseGitHubAction } from "./base-github-action";
import type { ActiveRepoSettings, GlobalSettings } from "../types";
import {
	_resetBridgeCache,
	ACTIVE_REPO_SENTINEL,
	extractGitState,
	getDefaultBridgePath,
	hasGitState,
	readBridgeFile,
	resolveRepoSelection,
	type ActiveRepoBridgePayload,
	type ActiveRepoGitState,
} from "../utils/active-repo-source";
import {
	renderActiveRepoDialModeA,
	renderActiveRepoDialModeB,
	renderActiveRepoDialNoGit,
	renderActiveRepoDialUnconfigured,
	renderActiveRepoKey,
	renderActiveRepoKeyNoGit,
	renderActiveRepoKeyUnconfigured,
} from "../utils/active-repo-renderer";
import { buildEditorOpenUrl } from "../utils/editor-open";

const DEFAULT_VIEW_MODE: NonNullable<ActiveRepoSettings["viewMode"]> = "branch-sync";

type ViewMode = NonNullable<ActiveRepoSettings["viewMode"]>;

/** Snapshot cached per action — last bridge read + resolved repo. */
interface RenderSnapshot {
	repo: string;
	payload: ActiveRepoBridgePayload | null;
	git: ActiveRepoGitState | null;
}

@action({ UUID: "com.pedrofuentes.github-utilities.active-repo" })
export class ActiveRepoAction extends BaseGitHubAction<ActiveRepoSettings> {
	/** Last render snapshot so rotates can re-render without refetching. */
	private snapshots = new Map<string, RenderSnapshot>();

	/** Per-instance view mode (driven by settings, mutated by dial rotate). */
	private viewModes = new Map<string, ViewMode>();

	// ── Lifecycle ─────────────────────────────────────────────────────────

	override async onWillAppear(ev: WillAppearEvent<ActiveRepoSettings>): Promise<void> {
		const actionId = ev.action.id;
		streamDeck.logger.debug(
			`[active-repo] ${actionId} onWillAppear controller=${ev.action.isKey() ? "key" : ev.action.isDial() ? "dial" : "?"} settings=${JSON.stringify(ev.payload.settings)}`,
		);
		this.actionContexts.set(actionId, ev.action);

		const settings = ev.payload.settings;

		// First-appear defaults — the button should "just work" after being
		// dragged onto a profile without the PI being opened. Seed user-facing
		// toggles so the PI selects match the render on every subsequent load.
		let needsSeed = false;
		if (!settings.repo) {
			settings.repo = ACTIVE_REPO_SENTINEL;
			needsSeed = true;
		}
		if (!settings.ownerDisplay) {
			settings.ownerDisplay = "full";
			needsSeed = true;
		}
		if (!settings.viewMode) {
			settings.viewMode = DEFAULT_VIEW_MODE;
			needsSeed = true;
		}
		if (needsSeed) {
			await ev.action.setSettings(settings);
		}

		this.actionSettings.set(actionId, settings);
		this.viewModes.set(actionId, settings.viewMode ?? DEFAULT_VIEW_MODE);

		if (ev.action.isDial()) {
			await ev.action.setFeedbackLayout("layouts/github-full-canvas.json");
		}

		// Subscribe to the bridge-file watcher via the base class helper so
		// we pick up any future changes. We pass `true` unconditionally: even
		// when the user pins this action to a fixed repo, a bridge file for
		// *the same* repo will still feed us live git state.
		this.watchActiveRepo(actionId, true, async () => {
			await this.refresh(actionId);
		});

		await this.refresh(actionId);
	}

	override onWillDisappear(ev: WillDisappearEvent<ActiveRepoSettings>): void {
		const actionId = ev.action.id;
		super.onWillDisappear(ev);
		this.snapshots.delete(actionId);
		this.viewModes.delete(actionId);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ActiveRepoSettings>): Promise<void> {
		const actionId = ev.action.id;
		const cached = this.actionSettings.get(actionId);
		const settings: ActiveRepoSettings = { ...cached, ...ev.payload.settings };
		this.actionSettings.set(actionId, settings);

		streamDeck.logger.debug(
			`[active-repo] ${actionId} didReceiveSettings incoming=${JSON.stringify(ev.payload.settings)} merged=${JSON.stringify(settings)}`,
		);

		// PI changed the default view mode — respect the new default.
		const nextMode = settings.viewMode ?? DEFAULT_VIEW_MODE;
		this.viewModes.set(actionId, nextMode);

		await this.refresh(actionId);
	}

	// ── Press — open workspace in editor ──────────────────────────────────

	override async onKeyUp(ev: KeyUpEvent<ActiveRepoSettings>): Promise<void> {
		await this.openInEditor(ev.action.id);
	}

	override async onDialUp(ev: DialUpEvent<ActiveRepoSettings>): Promise<void> {
		await this.openInEditor(ev.action.id);
	}

	// ── Dial rotate — cycle view mode ─────────────────────────────────────

	override async onDialRotate(ev: DialRotateEvent<ActiveRepoSettings>): Promise<void> {
		const actionId = ev.action.id;
		const current = this.viewModes.get(actionId) ?? DEFAULT_VIEW_MODE;
		const next: ViewMode = current === "branch-sync" ? "working-tree" : "branch-sync";
		this.viewModes.set(actionId, next);

		// Persist so the chosen mode survives across reappears, not just the session.
		const settings = this.actionSettings.get(actionId) ?? {};
		const nextSettings = { ...settings, viewMode: next } as ActiveRepoSettings;
		this.actionSettings.set(actionId, nextSettings);
		await ev.action.setSettings(nextSettings);

		await this.renderFromSnapshot(actionId);
	}

	override async onTouchTap(ev: TouchTapEvent<ActiveRepoSettings>): Promise<void> {
		_resetBridgeCache();
		await this.refresh(ev.action.id);
	}

	// ── Core refresh ──────────────────────────────────────────────────────

	private async refresh(actionId: string): Promise<void> {
		const settings = this.actionSettings.get(actionId);
		const ctx = this.actionContexts.get(actionId);
		if (!settings || !ctx) return;

		const globalSettings = await streamDeck.settings.getGlobalSettings<GlobalSettings>();
		const resolved = await resolveRepoSelection(settings.repo, {
			bridgePath: globalSettings.activeRepoBridgePath,
		});

		// No repo at all — unconfigured state.
		if (!resolved) {
			this.snapshots.set(actionId, { repo: "", payload: null, git: null });
			await this.renderUnconfigured(actionId);
			return;
		}

		// Sentinel but no bridge file — setup required.
		if (resolved.missing === "bridge") {
			this.snapshots.set(actionId, { repo: "", payload: null, git: null });
			await this.renderUnconfigured(actionId);
			return;
		}

		// Sentinel but malformed bridge — show a specific error state.
		if (resolved.missing === "invalid") {
			this.snapshots.set(actionId, { repo: "", payload: resolved.payload ?? null, git: null });
			await this.renderInvalidBridge(actionId);
			return;
		}

		// For non-sentinel configurations we still want the payload if it happens
		// to describe the same repo — that lets users pin the action to "owner/foo"
		// and still see live git state when they're editing foo.
		let payload: ActiveRepoBridgePayload | null = resolved.payload ?? null;
		if (!payload && !resolved.isSentinel) {
			const bridgePath = globalSettings.activeRepoBridgePath && globalSettings.activeRepoBridgePath.trim().length > 0
				? globalSettings.activeRepoBridgePath.trim()
				: getDefaultBridgePath();
			payload = await readBridgeFile(bridgePath);
		}

		const git = payload && hasGitState(payload) && payload.repo === resolved.repo
			? extractGitState(payload)
			: null;

		this.snapshots.set(actionId, { repo: resolved.repo, payload, git });
		await this.renderFromSnapshot(actionId);
	}

	private async renderFromSnapshot(actionId: string): Promise<void> {
		const ctx = this.actionContexts.get(actionId);
		const snap = this.snapshots.get(actionId);
		const settings = this.actionSettings.get(actionId);
		if (!ctx || !snap || !settings) return;

		// Renderer expects a boolean. Default = show owner.
		const showOwner = settings.ownerDisplay === "short" ? false : true;

		streamDeck.logger.debug(
			`[active-repo] ${actionId} render: repo=${snap.repo} branch=${snap.git?.branch ?? "-"} ownerDisplay=${settings.ownerDisplay ?? "?"} showOwner=${showOwner} git=${snap.git ? "yes" : "no"}`,
		);

		if (!snap.repo) {
			await this.renderUnconfigured(actionId);
			return;
		}

		// Bridge present but no git state (v1 bridge or repo mismatch) — show
		// repo only with an upgrade hint.
		if (!snap.git) {
			if (ctx.isKey()) {
				await ctx.setImage(renderActiveRepoKeyNoGit(snap.repo, showOwner));
				await ctx.setTitle("");
			} else if (ctx.isDial()) {
				await ctx.setFeedback({ canvas: renderActiveRepoDialNoGit(snap.repo, showOwner) });
			}
			return;
		}

		if (ctx.isKey()) {
			await ctx.setImage(renderActiveRepoKey({ repo: snap.repo, git: snap.git, showOwner }));
			await ctx.setTitle("");
			return;
		}

		if (ctx.isDial()) {
			const mode = this.viewModes.get(actionId) ?? DEFAULT_VIEW_MODE;
			const canvas = mode === "working-tree"
				? renderActiveRepoDialModeB({ repo: snap.repo, git: snap.git, showOwner })
				: renderActiveRepoDialModeA({ repo: snap.repo, git: snap.git, showOwner });
			await ctx.setFeedback({ canvas });
		}
	}

	private async renderUnconfigured(actionId: string): Promise<void> {
		const ctx = this.actionContexts.get(actionId);
		if (!ctx) return;
		if (ctx.isKey()) {
			await ctx.setImage(renderActiveRepoKeyUnconfigured());
			await ctx.setTitle("");
		} else if (ctx.isDial()) {
			await ctx.setFeedback({ canvas: renderActiveRepoDialUnconfigured() });
		}
	}

	private async renderInvalidBridge(actionId: string): Promise<void> {
		const ctx = this.actionContexts.get(actionId);
		if (!ctx) return;
		if (ctx.isKey()) {
			await ctx.setImage(renderActiveRepoKeyUnconfigured("Bad bridge"));
			await ctx.setTitle("");
		} else if (ctx.isDial()) {
			await ctx.setFeedback({ canvas: renderActiveRepoDialUnconfigured("Bridge file invalid") });
		}
	}

	// ── Press → open editor ──────────────────────────────────────────────

	private async openInEditor(actionId: string): Promise<void> {
		const snap = this.snapshots.get(actionId);
		if (!snap) return;

		const url = buildEditorOpenUrl({
			workspacePath: snap.payload?.workspacePath,
			sourceApp: snap.payload?.sourceApp,
		});

		if (!url) {
			streamDeck.logger.info("[active-repo] no workspace path — nothing to open");
			return;
		}

		streamDeck.system.openUrl(url);
	}
}
