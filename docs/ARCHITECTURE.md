# Architecture

> Extended architectural context for AI agents. Referenced from AGENTS.md.

---

## Project Structure

Single-package Stream Deck plugin (not a monorepo). Source in `src/`, tests mirror it in `tests/`,
plugin assets in `plugin/`, and the assembled/loadable plugin is built into `release/` (gitignored).

```
stream-deck-github-utilities/
├── src/
│   ├── plugin.ts                  ← Entry point — registers actions, connects to Stream Deck
│   ├── types.ts                   ← Settings interfaces (extend RepoActionSettings; JsonValue index signature)
│   ├── actions/                   ← One class per Stream Deck action (15 total)
│   │   ├── base-github-action.ts  ← Abstract base (polling, URL debounce, error handling, cleanup)
│   │   ├── repo-stats.ts          ← Repository statistics
│   │   ├── workflow-status.ts     ← Workflow run + deployment status
│   │   └── …                      ← pr-counter, issue-counter, release-monitor, commit-activity,
│   │                                branch-comparison, branch-network, security-health,
│   │                                contribution-heatmap, fleet-monitor, pr-review-queue,
│   │                                projects-board, discussions-monitor
│   └── utils/
│       ├── github-api/            ← Domain-split GitHub REST modules (core, repos, pull-requests,
│       │                            issues-releases, workflows, security-branches, datasources,
│       │                            schemas.ts (Zod), index.ts barrel)
│       ├── github-api.ts          ← Aggregate API surface
│       ├── github.ts              ← Token validation, repo parsing, count formatting
│       ├── github-graphql.ts, graphql-query-builder.ts, graphql-query-coordinator.ts
│       ├── button-renderer.ts     ← 144×144 SVG button generation (GitHub dark theme, STATUS_ICONS)
│       ├── touch-strip-renderer.ts← Stream Deck+ dial / touch-strip rendering
│       ├── polling-coordinator.ts ← Shared adaptive polling (dedupes calls per repo)
│       ├── repo-data-cache.ts, pi-data-provider.ts, data-fragments.ts, fragment-strategies.ts
│       ├── debounced-url-opener.ts, render-debouncer.ts, marquee-controller.ts, spinner-animator.ts
│       └── index.ts               ← utils barrel
├── tests/                         ← Mirrors src/ (actions/, utils/, integration/, renderers/)
├── plugin/                        ← Source plugin assets (manifest.json, imgs/, ui/, .sdignore)
├── release/                       ← Build output (gitignored) — NEVER hand-edit
├── content/                       ← Elgato Marketplace listing content (see CONTENT-GUIDE.md)
├── scripts/                       ← Utility scripts (e.g., convert-content-assets.ts)
├── docs/                          ← Agent companion docs (this file, SENTINEL.md, …)
├── .github/                       ← TESTING-PROTOCOL.md, UI-DESIGN-GUIDE.md
├── AGENTS.md  ROADMAP.md  README.md  CONTRIBUTING.md  LICENSE
└── package.json  rollup.config.mjs  vitest.config.ts  tsconfig.json  eslint.config.js
```

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Button SVG encoding | `"data:image/svg+xml," + encodeURIComponent(svg)` | Only this form renders on Stream Deck hardware — base64/`charset` do not |
| Icon composition | `<g transform="translate() scale()">`, never nested `<svg>` | The device renderer does not support nested `<svg>` elements |
| Action base class | `BaseGitHubAction<T>` abstract base | Shares polling, URL debounce, error handling, and cleanup across all 15 actions |
| GitHub API layout | Domain-split modules under `utils/github-api/` | Isolates repos/PRs/issues/workflows/security concerns; `index.ts` barrel re-exports |
| Runtime validation | Zod schemas (`github-api/schemas.ts`) | Validates GitHub API responses at the boundary |
| Bundler | Rollup + `@rollup/plugin-typescript` | Produces the single `bin/` bundle the Stream Deck runtime loads; also type-checks |
| Polling | Shared `PollingCoordinator` | Deduplicates GitHub calls across buttons watching the same repo |

> Significant decisions and their alternatives are recorded as ADRs in [`../DECISIONS.md`](../DECISIONS.md).

## Module Boundaries

- `actions/` — extend `BaseGitHubAction`; depend on `utils/`. No action imports another action.
- `utils/github-api/` — pure data layer; performs network I/O, returns validated data. No Stream Deck SDK imports.
- `utils/button-renderer.ts` / `touch-strip-renderer.ts` — pure SVG string generation; no network, no SDK state.
- `plugin.ts` — wires actions to the SDK only.

## Data Flow

Property Inspector (`plugin/ui/*.html`) writes settings → action `onWillAppear` / `onDidReceiveSettings`
→ `PollingCoordinator` schedules a fetch → `utils/github-api/*` calls GitHub via `fetchWithRetry`
(timeout + exponential backoff) → Zod-validated data → `button-renderer` / `touch-strip-renderer`
builds the SVG → `action.setImage("data:image/svg+xml," + encodeURIComponent(svg))`.

## Code Patterns

**SVG encoding (hardware-critical):**
```typescript
// ✅ Only encodeURIComponent renders on Stream Deck hardware
await ev.action.setImage("data:image/svg+xml," + encodeURIComponent(svg));
await ev.action.setTitle("");                       // full-SVG buttons clear the title

// ❌ base64 / charset produce a blank key on the device
await ev.action.setImage("data:image/svg+xml;base64," + btoa(svg));
```

**Action settings (index signature is mandatory):**
```typescript
// ✅ Settings must be assignable to JsonObject for the SDK
import type { JsonValue } from "@elgato/utils";
interface RepoStatsSettings extends RepoActionSettings {
	statType?: StatType;
	[key: string]: JsonValue;                        // required by the SDK settings store
}

// ❌ Missing index signature → setSettings() type error
interface RepoStatsSettings { statType?: StatType; }
```

## Key Files

| File | Purpose |
|------|---------|
| `src/plugin.ts` | Registers every action with the Stream Deck SDK |
| `src/actions/base-github-action.ts` | Abstract base: polling, URL debounce, error & cleanup |
| `src/utils/button-renderer.ts` | All 144×144 SVG button rendering + `STATUS_ICONS` |
| `src/utils/github-api/index.ts` | Barrel for the domain-split GitHub API modules |
| `src/utils/github-api/schemas.ts` | Zod schemas validating GitHub API responses |
| `src/types.ts` | Settings interfaces (`RepoActionSettings`, `JsonValue` index signature) |
| `plugin/manifest.json` | Plugin + action definitions (validated by `streamdeck validate`) |
