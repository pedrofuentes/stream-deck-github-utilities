# Stream Deck GitHub Utilities

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that provides utilities to display information from GitHub directly on your Stream Deck device.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.5.0-blue.svg)](https://github.com/pedrofuentes/stream-deck-github-utilities/releases)
[![Tests](https://img.shields.io/badge/tests-493%20passed-brightgreen.svg)](https://github.com/pedrofuentes/stream-deck-github-utilities)

## Overview

Stream Deck GitHub Utilities brings GitHub data to your fingertips. Monitor repositories, track pull requests, view issues, and more — all from your Stream Deck.

> **Note:** This project is under active development. See the [Roadmap](#roadmap) section for planned features.

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

### Smart Property Inspector

The Property Inspector features a dynamic, auto-populated UX:

- **Token entry** — paste your PAT once; repositories load automatically
- **Searchable dropdowns** — type to filter repositories, workflows, branches, and environments
- **Repository dropdown** — populated from your GitHub account (sorted by most recently pushed)
- **Cascading filters** — selecting a repo automatically loads its workflows, branches, and environments
- **Visual feedback** — status indicators show token validation and loading states
- Private repos are indicated with a lock icon

### Authentication

Uses a GitHub Personal Access Token (PAT) stored as a global plugin setting (shared across all actions).

1. Create a [fine-grained token](https://github.com/settings/tokens?type=beta) with the following permissions:
   - **Metadata** — read (required for Repo Stats, Commit Activity)
   - **Actions** — read (required for Workflow Status)
   - **Deployments** — read (required for deployment tracking)
   - **Pull requests** — read (required for PR Counter)
   - **Issues** — read (required for Issue Counter)
   - **Contents** — read (required for Release Monitor, Branch Comparison)
2. Enter it once in the Property Inspector — it's shared across all buttons
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
│   ├── utils/                                     # Shared utilities
│   │   ├── github.ts                              # Token/repo validation helpers
│   │   ├── github-api.ts                          # GitHub REST API client
│   │   ├── pi-data-provider.ts                    # PI datasource request handler
│   │   ├── button-renderer.ts                     # SVG button rendering
│   │   ├── marquee-controller.ts                  # Marquee scrolling text controller
│   │   ├── polling-coordinator.ts                 # Centralized polling with error backoff
│   │   ├── spinner-animator.ts                    # Animated loading spinner controller
│   │   └── index.ts                               # Barrel exports
│   ├── types.ts                                   # Shared type definitions
│   └── plugin.ts                                  # Plugin entry point
├── tests/                                         # Test files (493 tests)
│   ├── actions/                                   # Action tests
│   └── utils/                                     # Utility tests
├── rollup.config.mjs                              # Rollup bundler config
├── tsconfig.json                                  # TypeScript config
├── vitest.config.ts                               # Test runner config
└── package.json
```

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
- [ ] **Notification Count** — Show unread GitHub notification count
- [ ] **Repository Traffic** — Display repo traffic data (views, clones, visitors)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Links

- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Elgato Marketplace](https://marketplace.elgato.com/stream-deck/plugins)
- [Marketplace Makers Discord](https://discord.gg/GehBUcu627)
