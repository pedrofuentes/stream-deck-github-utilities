# Stream Deck GitHub Utilities — Active Repo Bridge

A tiny VS Code / Cursor extension that writes your currently-focused workspace's GitHub repo to a small JSON file. The [Stream Deck GitHub Utilities](https://github.com/pedrofuentes/stream-deck-github-utilities) plugin reads that file to make any button with the **★ Current Active Repo** setting follow your editor focus — no reconfiguration when you switch projects.

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
- The **Stream Deck Bridge: Refresh Active Repo** command (manual override)

For the primary workspace folder, it runs `git remote get-url origin`, parses the result as a GitHub URL (SSH or HTTPS), and writes a JSON payload atomically:

```json
{
  "version": 1,
  "sourceApp": "Cursor",
  "workspacePath": "/Users/you/Projects/owner/repo",
  "repo": "owner/repo",
  "remoteUrl": "git@github.com:owner/repo.git",
  "updatedAt": "2026-04-23T22:10:00.000Z"
}
```

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
