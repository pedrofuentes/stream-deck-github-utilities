# Stream Deck GitHub Utilities — Active Repo Bridge

A tiny VS Code / Cursor extension that writes your currently-focused workspace's GitHub repo **plus its live working-tree state** (branch, ahead/behind upstream, staged / unstaged / untracked counts, merge conflicts) to a small JSON file. The [Stream Deck GitHub Utilities](https://github.com/pedrofuentes/stream-deck-github-utilities) plugin reads that file so any button with the **★ Current Active Repo** setting follows your editor focus in real time, and the dedicated **Active Repo** action renders branch / dirty state on the Stream Deck LCD without any GitHub API calls.

## Install

### From source

```bash
cd bridge-extension
npm install
npm run build
npm run package        # produces dist/stream-deck-github-bridge-x.y.z.vsix
```

Then in Cursor or VS Code: **Extensions → "…" menu → Install from VSIX…** and pick the file in `dist/`.

### Dev loop

Open this folder in VS Code / Cursor and press **F5** to launch an Extension Development Host. Changes in `src/extension.ts` rebuild on save if you have `npm run watch` running.

## What it does

Triggers on:

- Startup of a focused editor window
- Workspace folder add / remove / switch
- Window focus changes (the last-focused window wins — switching windows updates the bridge)
- **Active text editor changes** — flipping between tabs in the same window
- **Git state changes** — every save, stage, commit, or branch switch in the active repo
- The **Stream Deck Bridge: Refresh Active Repo** command (manual override)

The extension caches the last successful git-state snapshot per workspace and falls back to it when Cursor's git API drops the repo briefly during transitions — so the Stream Deck LCD stays stable instead of flickering to "git state unavailable".

Git state is read via the built-in `vscode.git` extension (declared as an `extensionDependencies`), so no extra `git` subprocess is spawned on every tick — just a subscription to `Repository.state.onDidChange`.

For the primary workspace folder, it runs `git remote get-url origin` once to resolve the GitHub remote, then writes the JSON payload atomically on every relevant event:

```json
{
  "version": 2,
  "sourceApp": "Cursor",
  "workspacePath": "/Users/you/Projects/owner/repo",
  "repo": "owner/repo",
  "remoteUrl": "git@github.com:owner/repo.git",
  "updatedAt": "2026-04-23T22:10:00.000Z",
  "branch": "feat/x",
  "headSha": "a3f91c0",
  "upstream": "origin/main",
  "ahead": 3,
  "behind": 1,
  "staged": 2,
  "unstaged": 5,
  "untracked": 1,
  "conflicts": 0,
  "isDirty": true
}
```

Writes that would only change `updatedAt` (no meaningful state change) are suppressed, so the Stream Deck's 1 s mtime watcher doesn't fire for noops.

## Where it writes

Default path (matches the Stream Deck plugin's default):

- **macOS** `~/Library/Application Support/stream-deck-github-utilities/active-repo.json`
- **Windows** `%APPDATA%\stream-deck-github-utilities\active-repo.json`
- **Linux / other** `$XDG_CONFIG_HOME/stream-deck-github-utilities/active-repo.json` (fallback `~/.config/…`)

Override via `streamDeckGitHubBridge.bridgePath` in settings — only needed if you also override the path on the Stream Deck plugin side.

## Settings

| Key | Default | Purpose |
|-----|---------|---------|
| `streamDeckGitHubBridge.bridgePath` | `""` (use OS default) | Absolute path to write the bridge file |
| `streamDeckGitHubBridge.debounceMs` | `300` | How long (ms) to wait after a workspace/focus change before writing |

## Behavior notes

- **Non-git workspace:** no write. The bridge file keeps pointing at the last known repo — the Stream Deck keeps showing that repo's data until you open another git project.
- **Non-GitHub remote:** no write. Same as above.
- **Multiple windows:** whichever window you focus last owns the bridge file. Useful when you juggle two projects across two windows.
- **Multi-root workspaces:** the first folder wins. Rearrange your workspace folders if you need a different primary.
- **Git lookup timeout:** 3 seconds. A slow git or networked path won't hang the extension.

## Troubleshooting

Open **Output → "Stream Deck GitHub Bridge"** to see every trigger and skipped-write reason. Useful for diagnosing "button says No Active Repo but I have a repo open" issues.

## License

MIT — see the parent repo.
