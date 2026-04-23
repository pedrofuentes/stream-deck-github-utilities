# Stream Deck GitHub Utilities

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that provides utilities to display information from GitHub directly on your Stream Deck device.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.3.0-blue.svg)](https://github.com/pedrofuentes/stream-deck-github-utilities/releases)
[![Tests](https://img.shields.io/badge/tests-1562%20passed-brightgreen.svg)](https://github.com/pedrofuentes/stream-deck-github-utilities)

## Overview

Stream Deck GitHub Utilities brings GitHub data to your fingertips. Monitor repositories, track pull requests, view issues, and more — all from your Stream Deck. Full **Stream Deck+** support with rich touch strip visualizations, dial controls, and encoder interactions across all 14 actions.

> **Note:**This project is under active development. See the [Roadmap](#roadmap) section for planned features.

## Features

### Repo Stats

Display real-time GitHub repository statistics directly on a Stream Deck button.

- **Stars** — stargazers count with gold accent
- **Open Issues** — open issues count with green accent (note: includes PRs due to a GitHub API limitation; use the dedicated Issue Counter action for an accurate count)
- **Forks** — fork count with blue accent
- **Watchers** — watcher count with purple accent
- **Pull Requests** — open PR count with green accent
- **Language** — primary language with salmon accent
- **Size** — repository size (auto-formatted KB/MB/GB) with gray accent
- **License** — license type with amber accent
- **Default Branch** — default branch name with blue accent
- **Visibility** — public/private status with gray accent

Each button features:
- Minimalistic SVG design with GitHub's dark theme
- Animated loading spinner during data fetches
- Auto-refresh on a configurable interval (1 min to 1 hour)
- **Short press** cycles through stat types; **long press** (≥500ms) opens the repository on GitHub
- Marquee scrolling for text that exceeds button width
- Clear error states with retry hints
- Setup prompt when token or repository is not configured

### Workflow Status

Monitor GitHub Actions workflow runs and deployment status in real time.

- **Latest workflow run** — shows status (success, failed, running, queued, cancelled, etc.) with color-coded indicators
- **Deployment tracking** — when a deployment is active (in_progress, queued, pending), shows a dedicated deploying view with animated indicator
- **Deploy label** — for completed deployments, shows environment + state as secondary info on the workflow button
- **Filtering** — optionally filter by workflow file, branch, and deployment environment

Each button features:
- Status-specific colors (green=success, red=failure, yellow=running, blue=queued, purple=deploying)
- Status-specific icons (checkmark, X, spinner, clock, rocket, etc.)
- Auto-refresh on a configurable interval (15 seconds to 10 minutes, default 60s)
- Press-to-refresh for instant updates
- Workflow name and repo name displayed on button

### Pull Request Counter

Display the pull request count for a repository, filtered by state.

- **State filter** — open, closed, or all PRs
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the repository's pull requests page on GitHub
- Marquee scrolling for long repository names

### Issue Counter

Display the issue count for a repository (excluding PRs), filtered by state.

- **State filter** — open, closed, or all issues
- Accurately separates issues from PRs (GitHub's API combines them)
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the repository's issues page on GitHub

### Release Monitor

Track and display the latest release for a repository.

- **Version tag** — shows the latest release tag (e.g., "v2.3.1")
- **Pre-release support** — toggle to include pre-releases, with visual "Pre" indicator
- **Relative time** — shows how long ago the release was published
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the release page on GitHub

### Commit Activity

Show the number of commits in a recent time window.

- **Time range** — last 24 hours, 7 days, or 30 days
- Handles GitHub's 202 "computing" state gracefully
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the repository's commits page on GitHub

### Branch Comparison

Show how many commits one branch is ahead/behind another.

- **Ahead/behind display** — "↑3 ↓2" format, or "Even" when identical
- **Color-coded status** — diverged (yellow), ahead (green), behind (red), identical (teal)
- **Branch label** — shows "head→base" for clarity
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the branch comparison page on GitHub

### Branch Network *(Stream Deck+ only)*

Display a real git network graph on the Stream Deck+ touch strip, powered by [`git-network-graph`](https://github.com/pedrofuentes/git-network-graph).

- Shows actual commit topology with branch lanes, merge points, and fork connections
- Configurable orientation: oldest→newest or newest→oldest (horizontal-reverse)
- Configurable commit depth (100, 200, or 300 commits) and branch model (Git Flow, Simple, or None)
- Scroll with the dial, hold-and-rotate for cross-axis pan
- Span 2 or 4 adjacent encoder quarters for panoramic views
- Touch to open the GitHub network graph

### Contribution Heatmap *(Stream Deck+ only)*

Display a GitHub contribution heatmap on the Stream Deck+ touch strip.

- **Profile mode** — contributions across all repos via GraphQL API
- **Repo mode** — commit activity for a single repository
- Scroll through weeks with the dial
- Auto-refresh on a configurable interval

### PR Review Queue

Display the count of pull requests awaiting your review.

- **Urgency gradient** — blue (1 PR) → amber (3) → red (5+)
- Works across all repos or filtered to a single repository
- Press to open your review-requested PRs on GitHub
- Marquee scrolling for long repository names

### Fleet Monitor

Compact repo health dashboard — monitor multiple repos at a glance.

- **Multi-metric display** — workflow status + open PR count + commit sparkline
- Place 4 across on Stream Deck+ for fleet monitoring
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the repository on GitHub

### Security Health

Display Dependabot security alert summary with letter grade.

- **A–F grade** based on critical/high/medium/low alert counts
- **Arc gauge** on Stream Deck+ touch strip with severity breakdown
- Color-coded: green (A/B), amber (C), red (D/F)
- Press to open the repository's security page

### 💬 Discussions Monitor

Display GitHub Discussions count and answered status for a repository.

- **Total discussion count** at a glance
- **Answered vs unanswered count** — see how many discussions have accepted answers
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the discussions page on GitHub
- Double-click to force refresh
- Requires `Discussions: Read` permission on fine-grained token

### 📊 Projects V2 Board

Monitor GitHub Projects V2 for a repository.

- **Project count** and first project name on the button
- **Item count** per project
- Auto-refresh on a configurable interval (default 5 minutes)
- Press to open the projects page on GitHub
- Double-click to force refresh
- Requires `Projects: Read` permission on fine-grained token

### Stream Deck+ Encoder Support

All 14 actions support the Stream Deck+ encoder with rich touch strip visualizations:

| Interaction | Action |
|-------------|--------|
| **Rotate** | Cycle stats, scroll weeks, browse runs, change range |
| **Push (press dial)** | Open relevant GitHub page |
| **Touch tap** | Refresh data immediately |
| **Long touch** | Context-dependent: dispatch workflow, open repo |

Touch strip visualizations include:
- **Sparklines** — trend data for repo stats and fleet monitoring
- **Arc gauges** — security health scoring
- **Contribution heatmaps** — 52-week grids
- **Real git network graphs** — commit topology visualization powered by git-network-graph
- **Atmospheric status** — workflow status ambient glow

### Smart Property Inspector

The Property Inspector features a dynamic, auto-populated UX:

- **Token entry** — paste your PAT once; repositories load automatically
- **Searchable dropdowns** — type to filter repositories, workflows, branches, and environments
- **Repository dropdown** — populated from your GitHub account (sorted by most recently pushed)
- **Cascading filters** — selecting a repo automatically loads its workflows, branches, and environments
- **Visual feedback** — status indicators show token validation and loading states
- Private repos are indicated with a lock icon

### Dynamic Repo Mode

Every repo picker in this plugin shows a **★ Current Active Repo (Cursor/VS Code)** option at the top of the dropdown. Pick it once and the button follows whatever repo your editor currently has focused — no reconfiguration when you switch projects.

**How it works.** A companion extension in Cursor / VS Code writes a small JSON bridge file whenever the active workspace changes. The plugin reads that file on every refresh and retargets the button automatically. Repo data is cached for 10 minutes across project switches, so flipping A → B → A within the window serves from cache instead of hitting the GitHub API again.

**Bridge file path**

- macOS: `~/Library/Application Support/stream-deck-github-utilities/active-repo.json`
- Windows: `%APPDATA%\stream-deck-github-utilities\active-repo.json`
- Linux / other: `$XDG_CONFIG_HOME/stream-deck-github-utilities/active-repo.json` (falls back to `~/.config/...`)

**Schema**

```json
{
  "repo": "owner/repo",
  "remoteUrl": "git@github.com:owner/repo.git",
  "workspacePath": "/Users/you/Projects/owner/repo",
  "sourceApp": "cursor",
  "updatedAt": "2026-04-23T22:10:00.000Z"
}
```

- `repo` (preferred) or `remoteUrl` (fallback) is required. Other fields are metadata the plugin ignores but a companion may populate for its own use.
- `remoteUrl` accepts both SSH (`git@github.com:owner/repo.git`) and HTTPS (`https://github.com/owner/repo.git`) forms.
- The plugin watches file mtime — just rewrite the file atomically and buttons retarget within one refresh interval (or instantly on touch-tap / key refresh).

**Special cases**

- **PR Review Queue** — empty repo still means "all repos, unscoped". The sentinel scopes to the current active repo only. A missing bridge file shows an error state rather than silently falling back to cross-repo (so you never leak activity across projects).
- **Contribution Heatmap** — only applies when the data source is **Repo**. The **User** profile mode stays global and ignores the bridge file.

**Companion extension (Cursor / VS Code).** This repo ships the companion at [`bridge-extension/`](bridge-extension/). It writes the bridge file automatically on startup, workspace-folder changes, and window focus changes. Build with `npm run build && npm run package` inside `bridge-extension/`, then install the resulting `.vsix` via **Extensions → Install from VSIX…** in Cursor or VS Code. A single install covers both editors since Cursor is a VS Code fork.

If you'd rather integrate a different tool, anything that writes the JSON schema above to the default path will work — the plugin reads the file and parses it; it doesn't care how it got there.

### Authentication

Uses a GitHub Personal Access Token (PAT) stored as a global plugin setting (shared across all actions).

1. Create a [fine-grained token](https://github.com/settings/tokens?type=beta) with the following permissions:
   - **Metadata** — read (required for Repo Stats, Commit Activity)
   - **Actions** — read (required for Workflow Status)
   - **Deployments** — read (required for deployment tracking)
   - **Pull requests** — read (required for PR Counter)
   - **Issues** — read (required for Issue Counter)
   - **Contents** — read (required for Release Monitor, Branch Comparison)
   - **Dependabot alerts** — read (required for Security Health)
   - **Discussions** — read (required for Discussions Monitor)
   - **Projects** — read (required for Projects V2 Board)
2. Enter it oncein the Property Inspector — it's shared across all buttons
3. Authenticated requests get 5,000 API calls per hour

## Requirements

- [Stream Deck](https://www.elgato.com/s/downloads?product=Stream%20Deck) version 6.9 or higher
- [Node.js](https://nodejs.org/) version 20 or higher
- A Stream Deck device (or [Stream Deck Mobile](https://www.elgato.com/stream-deck-mobile))
- A GitHub personal access token (for API access)

## Installation

### From Release Package

1. Download the latest `.streamDeckPlugin` file from the [Releases](https://github.com/pedrofuentes/stream-deck-github-utilities/releases) page.
2. Double-click the downloaded file to install automatically into Stream Deck.

### From Source

```bash
# Clone the repository
git clone https://github.com/pedrofuentes/stream-deck-github-utilities.git
cd stream-deck-github-utilities

# Install dependencies
npm install

# Build the plugin
npm run build

# Link the plugin to Stream Deck for development
streamdeck link release/com.pedrofuentes.github-utilities.sdPlugin
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro): `npm install -g @elgato/cli`
- [Stream Deck](https://www.elgato.com/s/downloads?product=Stream%20Deck) >= 6.9

### Getting Started

```bash
# Install dependencies
npm install

# Start development mode (watches for changes and auto-restarts)
npm run watch
```

### Available Scripts

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript and bundle with Rollup |
| `npm run watch` | Watch mode — rebuilds and restarts the plugin on changes |
| `npm test` | Run the full test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Lint source files with ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run validate` | Validate the plugin with Stream Deck CLI |
| `npm run pack` | Build, test, and package the plugin for distribution |

### Project Structure

```
.
├── com.pedrofuentes.github-utilities.sdPlugin/   # Compiled plugin directory
│   ├── bin/                                       # Build output
│   ├── imgs/                                      # Plugin icons and images
│   ├── logs/                                      # Runtime logs
│   ├── ui/                                        # Property inspector HTML files
│   └── manifest.json                              # Plugin manifest
├── src/                                           # TypeScript source
│   ├── actions/                                   # Stream Deck actions
│   │   ├── repo-stats.ts                          # Repo Stats action
│   │   ├── workflow-status.ts                     # Workflow Status action
│   │   ├── pr-counter.ts                          # PR Counter action
│   │   ├── issue-counter.ts                       # Issue Counter action
│   │   ├── release-monitor.ts                     # Release Monitor action
│   │   ├── commit-activity.ts                     # Commit Activity action
│   │   └── branch-comparison.ts                   # Branch Comparison action
│   │   ├── branch-network.ts                      # Branch Network action (SD+ only)
│   │   ├── contribution-heatmap.ts                 # Contribution Heatmap action (SD+ only)
│   │   ├── pr-review-queue.ts                      # PR Review Queue action
│   │   ├── fleet-monitor.ts                        # Fleet Monitor action
│   │   ├── security-health.ts                      # Security Health action
│   │   ├── discussions-monitor.ts                   # Discussions Monitor action
│   │   └── projects-board.ts                        # Projects V2 Board action
│   ├── utils/                                     # Shared utilities
│   │   ├── github.ts                              # Token/repo validation helpers
│   │   ├── github-api.ts                          # GitHub REST API client
│   │   ├── pi-data-provider.ts                    # PI datasource request handler
│   │   ├── button-renderer.ts                     # SVG button rendering
│   │   ├── marquee-controller.ts                  # Marquee scrolling text controller
│   │   ├── polling-coordinator.ts                 # Centralized polling with error backoff
│   │   ├── spinner-animator.ts                    # Animated loading spinner controller
│   │   ├── github-graphql.ts                      # GraphQL API client
│   │   ├── graphql-query-coordinator.ts           # Batched GraphQL query coordinator
│   │   ├── graphql-query-builder.ts               # Dynamic GraphQL query composition
│   │   ├── repo-data-cache.ts                     # Per-repo cache with field-level staleness
│   │   ├── data-fragments.ts                      # GraphQL→REST interface extractors
│   │   ├── touch-strip-renderer.ts                # Touch strip SVG rendering
│   │   └── index.ts                               # Barrel exports
│   ├── types.ts                                   # Shared type definitions
│   └── plugin.ts                                  # Plugin entry point
├── tests/                                         # Test files (1562 tests across 44 files)
│   ├── actions/                                   # Action tests
│   ├── utils/                                     # Utility tests
│   ├── integration/                               # Cross-layer integration tests
│   └── renderers/                                 # SVG snapshot/golden master tests
├── rollup.config.mjs                              # Rollup bundler config
├── tsconfig.json                                  # TypeScript config
├── vitest.config.ts                               # Test runner config
└── package.json
```

### Key Architectural Components

- **`BaseGitHubAction`** — Abstract base class all 14 actions extend. Provides shared polling, URL debouncing, error handling, and cleanup.
- **`github-api/`** — Domain-split API modules (core, repos, PRs, issues, workflows, security, datasources) with `fetchWithRetry` and Zod schema validation.
- **`FragmentStrategy`** — Strategy pattern for coordinator fragment dispatch. Each `DataFragmentName` has a strategy class encapsulating GraphQL extraction, REST fallback, and result assignment.
- **`DebouncedUrlOpener`** — Shared utility for double-click detection (first click schedules URL open after 400ms; second click cancels and triggers refresh).
- **`RenderDebouncer`** — Debounced render callbacks for dial rotation events.

### Key Dependencies

| Package | Purpose |
|---|---|
| `@elgato/streamdeck` | Stream Deck SDK — core plugin API |
| `zod` | Runtime API response validation |
| `rollup` | JavaScript bundler |
| `@rollup/plugin-typescript` | TypeScript compilation in Rollup |
| `@rollup/plugin-node-resolve` | Node module resolution for Rollup |
| `vitest` | Test runner |
| `@vitest/coverage-v8` | Code coverage |

### Testing

All code changes **must** include appropriate tests. Tests are required to pass before any release package can be built. The test suite uses [Vitest](https://vitest.dev/).

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch

# Generate a coverage report
npm run test:coverage
```

Coverage thresholds are enforced:
- **Branches:** 80%
- **Functions:** 80%
- **Lines:** 80%
- **Statements:** 80%

### Packaging for Release

Release packages are built using the Stream Deck CLI. The `pack` script enforces that all tests pass before packaging.

```bash
npm run pack
```

This produces a `.streamDeckPlugin` file in the `release/` directory.

## Roadmap

- [x] **Repo Stats** — Display repository statistics (10 stat types including stars, issues, forks, PRs, language, size, license, and more)
- [x] **Workflow Status** — Display GitHub Actions workflow run status and deployment tracking
- [x] **Pull Request Counter** — Display open/closed/all PR count with state filtering
- [x] **Issue Counter** — Display issue count (excluding PRs) with state filtering
- [x] **Release Monitor** — Track and display latest release version with pre-release support
- [x] **Commit Activity** — Show recent commit count (24h / 7d / 30d)
- [x] **Branch Comparison** — Show ahead/behind counts between two branches
- [x] **Stream Deck+ Encoder Support** — Dial/touch strip controls for Repo Stats and Workflow Status with rich visualizations (sparklines, heatmaps, status atmospheres)
- [x] **PR Review Queue** — Show review-requested PR count with urgency gradient, browse individual PRs via dial
- [x] **Git Branch Network** — Real commit graph topology on touch strip powered by git-network-graph (1, 2, or 4 quarter layouts)
- [x] **Workflow Dispatch** — Trigger workflow runs via long-touch on Stream Deck+
- [x] **Security Health** — Arc gauge combining Dependabot + Code Scanning alerts
- [x] **Contribution Heatmap** — 52-week GitHub contribution grid spanning the full touch strip
- [x] **Fleet Monitor** — Monitor multiple repos at a glance across 4 touch strip quarters
- [x] **Discussions Monitor** — Display discussion count and answered ratio
- [x] **Projects V2 Board** — Monitor GitHub Projects V2 board status and item counts

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Links

- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Elgato Marketplace](https://marketplace.elgato.com/stream-deck/plugins)
- [Marketplace Makers Discord](https://discord.gg/GehBUcu627)
