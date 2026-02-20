# Stream Deck GitHub Utilities

A [Stream Deck](https://www.elgato.com/stream-deck) plugin that provides utilities to display information from GitHub directly on your Stream Deck device.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

Stream Deck GitHub Utilities brings GitHub data to your fingertips. Monitor repositories, track pull requests, view issues, and more — all from your Stream Deck.

> **Note:** This project is under active development. See the [Roadmap](#roadmap) section for planned features.

## Features

### Repo Stats

Display real-time GitHub repository statistics directly on a Stream Deck button.

- **Stars** — stargazers count with gold accent
- **Issues** — open issues count with green accent
- **Forks** — fork count with blue accent
- **Watchers** — watcher count with purple accent

Each button features:
- Minimalistic SVG design with GitHub's dark theme
- Auto-refresh on a configurable interval (1 min to 1 hour)
- Press-to-refresh for instant updates
- Clear error states with retry hints
- Setup prompt when unconfigured

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

### Smart Property Inspector

The Property Inspector features a dynamic, auto-populated UX:

- **Token entry** — paste your PAT once; repositories load automatically
- **Repository dropdown** — populated from your GitHub account (sorted by most recently pushed)
- **Cascading filters** — selecting a repo automatically loads its workflows, branches, and environments
- **Visual feedback** — status indicators show token validation and loading states
- Private repos are indicated with a lock icon

### Authentication

Uses a GitHub Personal Access Token (PAT) stored as a global plugin setting (shared across all actions).

1. Create a [fine-grained token](https://github.com/settings/tokens?type=beta) with the following permissions:
   - **Metadata** — read (required for Repo Stats)
   - **Actions** — read (required for Workflow Status)
   - **Deployments** — read (required for deployment tracking)
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
streamdeck link com.pedrofuentes.github-utilities.sdPlugin
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
│   │   └── workflow-status.ts                     # Workflow Status action
│   ├── utils/                                     # Shared utilities
│   │   ├── github.ts                              # Token/repo validation helpers
│   │   ├── github-api.ts                          # GitHub REST API client
│   │   ├── pi-data-provider.ts                    # PI datasource request handler
│   │   ├── button-renderer.ts                     # SVG button rendering
│   │   └── index.ts                               # Barrel exports
│   ├── types.ts                                   # Shared type definitions
│   └── plugin.ts                                  # Plugin entry point
├── tests/                                         # Test files (262 tests)
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

This produces a `.streamDeckPlugin` file in the `dist/` directory.

## Roadmap

- [x] **Repo Stats** — Display repository statistics (stars, issues, forks, watchers)
- [x] **Workflow Status** — Display GitHub Actions workflow run status and deployment tracking
- [ ] **PR Count** — Show open pull request count for a repository
- [ ] **Notification Count** — Show unread GitHub notification count
- [ ] **Release Monitor** — Track and display latest release version

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Links

- [Stream Deck SDK Documentation](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
- [Stream Deck CLI Documentation](https://docs.elgato.com/streamdeck/cli/intro)
- [Elgato Marketplace](https://marketplace.elgato.com/stream-deck/plugins)
- [Marketplace Makers Discord](https://discord.gg/GehBUcu627)
