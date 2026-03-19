# GitHub Utilities for Stream Deck — Roadmap

> **Version**: v2.0.0 (current)
> **Last Updated**: March 2026
> **Status**: Active — Phases 1–5 complete, v2.1.0–v2.2.0 shipped; 14 actions with full Stream Deck+ support and GraphQL batch query coordinator

---

## Table of Contents

- [Current State](#current-state)
- [Completed — Phase 1](#completed--phase-1)
- [Completed — Phase 2](#completed--phase-2)
- [Phase 3 — Stream Deck+ Encoder Foundation](#phase-3--stream-deck-encoder-foundation-v160)
- [Phase 4 — Encoder Expansion + New Actions](#phase-4--encoder-expansion--new-actions-v170)
- [Phase 5 — Security & Data Visualizations](#phase-5--security--data-visualizations-v180)
- [Phase 6 — Profiles & Ecosystem](#phase-6--profiles--ecosystem-v200)
- [Touch Strip Design Language](#touch-strip-design-language)
- [GraphQL API Migration](#graphql-api-migration)
- [Multi-Quarter Compositions](#multi-quarter-compositions)
- [Implementation Priority Matrix](#implementation-priority-matrix)
- [Suggested Next Steps](#suggested-next-steps)
- [Deferred / Dropped](#deferred--dropped)
- [Token Permissions Reference](#token-permissions-reference)
- [API Endpoints Reference](#api-endpoints-reference)
- [Stream Deck SDK Features Reference](#stream-deck-sdk-features-reference)

---

## Current State

### Existing Actions (v2.0.0)

| Action | Description | API Endpoints Used |
|--------|-------------|-------------------|
| **Repo Stats** | Displays 10 stat types (stars, issues, forks, watchers, PRs, language, size, license, default branch, visibility) with short-press cycling and long-press URL opening | `GET /repos/{owner}/{repo}`, `GET /search/issues?q=repo:{owner}/{repo}+type:pr+is:open` |
| **Workflow Status** | Shows latest workflow run status with deployment info; opens URL on press | `GET /repos/{owner}/{repo}/actions/runs`, `GET /repos/{owner}/{repo}/deployments`, `GET /repos/{owner}/{repo}/deployments/{id}/statuses` |
| **PR Counter** | Displays open/closed/all PR count; press to open PRs page | `GET /search/issues?q=repo:{owner}/{repo}+type:pr+is:{state}` (Search API) |
| **Issue Counter** | Displays issue count (excluding PRs); press to open issues page | `GET /search/issues?q=repo:{owner}/{repo}+type:issue+is:{state}` (Search API) |
| **Release Monitor** | Shows latest release tag, relative time, pre-release indicator; press to open release | `GET /repos/{owner}/{repo}/releases/latest`, `GET /repos/{owner}/{repo}/releases?per_page=1` |
| **Commit Activity** | Shows commit count for 24h/7d/30d time windows; press to open commits | `GET /repos/{owner}/{repo}/stats/commit_activity` |
| **Branch Comparison** | Shows ahead/behind counts between two branches; press to open compare | `GET /repos/{owner}/{repo}/compare/{base}...{head}` |
| **Branch Network** | Metro-map style branch diagram on SD+ touch strip (encoder-only) | `GET /repos/{owner}/{repo}/branches` |
| **Contribution Heatmap** | 52-week contribution grid on SD+ touch strip; profile (GraphQL) or repo (REST) mode (encoder-only) | GraphQL `contributionsCollection`, `GET /repos/{owner}/{repo}/stats/commit_activity` |
| **PR Review Queue** | Displays count of PRs awaiting your review with urgency gradient | `GET /search/issues?q=review-requested:@me+type:pr+is:open` |
| **Fleet Monitor** | Compact multi-metric repo dashboard (workflow + PRs + sparkline) | `GET /repos/{owner}/{repo}/actions/runs`, `GET /search/issues`, `GET /repos/{owner}/{repo}/stats/commit_activity` |
| **Security Health** | Dependabot alert summary with A–F grade and arc gauge | `GET /repos/{owner}/{repo}/dependabot/alerts` |
| **Discussions Monitor** | Displays discussion count and answered status for a repository | GraphQL `repository.discussions` |
| **Projects V2 Board** | Shows project board status, item counts, and progress | GraphQL `repository.projectsV2` |

### Existing Infrastructure

- GitHub REST API client (`github-api.ts`, ~1,250 lines) with error handling, rate limit parsing, datasource APIs, Search API integration
- SVG-based icon rendering (`button-renderer.ts`) with dynamic status colors, 14 status icons, consistent color palette
- Marquee scrolling controller (`marquee-controller.ts`) for long text on buttons
- Animated loading spinner (`spinner-animator.ts`) for frame-based loading animations
- Property Inspector with FilterableSelect, searchable dropdowns for repos, workflows, branches, environments
- PI data provider (`pi-data-provider.ts`) for WebSocket-based PI ↔ plugin communication
- Global settings for GitHub token, per-action settings for configuration
- Short press / long press differentiation (≥500ms threshold)
- Setup state prompts on unconfigured buttons
- WebSocket echo suppression for PI ↔ plugin settings sync
- Touch strip renderer (`touch-strip-renderer.ts`) with sparklines, arc gauges, heatmaps, metro-maps
- GraphQL API client (`github-graphql.ts`) for contribution calendar
- GraphQL batch query coordinator (`graphql-query-coordinator.ts`) with per-repo caching and REST fallback
- Dynamic GraphQL query builder (`graphql-query-builder.ts`) with 9 composable data fragments
- Per-repository data cache (`repo-data-cache.ts`) with field-level staleness tracking
- Data fragment extractors (`data-fragments.ts`) bridging GraphQL responses to existing REST interfaces
- Generic GraphQL query executor (`github-graphql.ts`) with structured error handling
- Custom encoder layout (`layouts/github-full-canvas.json`) — 200×100 full-canvas pixmap
- Multi-quarter contiguous rendering with shared scroll coordination
- Double-click detection for instant refresh
- 14 actions across 30 test files

---

## Completed — Phase 1

All Phase 1 quick wins were shipped in **v1.2.0**.

### ✅ 1.1 Repo Stats: Open URL on Press
Long-press (≥500ms) opens the relevant GitHub page for the current stat type:
- **Stars** → stargazers, **Issues** → issues, **Forks** → network/members, **Watchers** → watchers
- **Pull Requests** → pulls, **Language/Size/License/Branch/Visibility** → repo page

### ✅ 1.2 Repo Stats: Additional Stat Types
Six new stat types added (10 total): Pull Requests, Language, Size (auto-formatted KB/MB/GB), License, Default Branch, Visibility. Topics was deferred — all others shipped.

### ✅ 1.5 Long Press vs Short Press
Implemented via `onKeyDown`/`onKeyUp` timing with a 500ms threshold:
- **Short press** → Cycle to next stat type
- **Long press** → Open URL in browser

### ✅ Marquee Scrolling (bonus)
Added `MarqueeController` for text that exceeds button width — smooth horizontal scrolling on both value and label lines.

### ✅ FilterableSelect PI Component (bonus)
Added searchable/filterable dropdowns for repositories, workflows, branches, and environments in the Property Inspector.

### ✅ v1.3.0–v1.3.4: Stability & Polish
Post-Phase 1 releases focused on reliability, packaging, and UX polish:

- **v1.3.0** — Setup state: buttons show a clear prompt when token or repo is not configured
- **v1.3.1** — Packaging fix: bundled all dependencies into `plugin.js`
- **v1.3.2** — SDK compatibility (SDKVersion 3), adopted template collaboration protocol
- **v1.3.3** — Fixed multi-button stat cycling (#1), replaced sidebar action icons with crisp white SVGs
- **v1.3.4** — Fixed PI settings race conditions (echo suppression), disabled user title overlay, updated default key images

### Remaining (not yet started)
- **1.3 Workflow Status: Show Run Duration** — Display run duration on the button
- **1.4 Error State Improvements** — Rate limit display, distinct error visuals, `showAlert()` for transient errors (setup state partially addresses this)

---

## Completed — Phase 2

All Phase 2 actions were implemented with full test coverage (73 new tests across 5 test files).

### ✅ 2.1 Pull Request Counter
Display open/closed/all PR count for a repo. Press to open PRs page.
- State filter: `open` | `closed` | `all`
- Auto-refresh on configurable interval (default 5 minutes)
- Marquee scrolling for long repo names
- Accurate count via GitHub Search API (`type:pr` qualifier)

### ✅ 2.2 Issue Counter
Display issue count (excluding PRs) for a repo. Press to open issues page.
- State filter: `open` | `closed` | `all`
- Accurate separation of issues from PRs via GitHub Search API (`type:issue` qualifier)
- Marquee scrolling for long repo names

### ✅ 2.3 Release Monitor
Show latest release version/tag for a repo. Press to open release page.
- Include pre-releases toggle with visual "Pre" indicator
- Shows version tag + relative time (e.g., "2d ago")
- Dual marquee scrolling (repo name + version tag)
- "None" display when no releases exist
- Press opens release URL (or fallback to releases page)

### ✅ 2.4 Commit Activity
Show recent commit count for configurable time windows.
- Time range: 24h / 7d / 30d
- Handles GitHub's 202 "computing" response gracefully (shows "...")
- Auto-refresh on configurable interval (default 5 minutes)
- Press to open commits page

### ✅ 2.5 Branch Comparison / Ahead-Behind
Show ahead/behind counts between two branches.
- Display: "↑3 ↓1" format, or "Even" when identical
- Color-coded status: diverged (yellow), ahead (green), behind (red), identical (teal)
- Branch label: "head→base" for clarity
- FilterableSelect dropdowns for branch selection (populated after repo selection)
- Press to open branch comparison page

---

## Completed — Phase 3 — Stream Deck+ Encoder Foundation ✅

**Priority**: HIGH — biggest differentiator for the plugin. Stream Deck+ encoder and touch strip support transforms every existing action into a richer, more data-dense experience.

### 3.1 Encoder Infrastructure
**Effort**: Small | **Priority**: P0

Shared foundation for all encoder-enabled actions:
- Create `github-full-canvas.json` — shared `pixmap` layout file for full-canvas SVG rendering on the touch strip (200×100)
- New `touch-strip-renderer.ts` module — SVG generation utilities for touch strip content (sparklines, hero numbers, status glows, run history dots)
- Manifest updates: `"Controllers": ["Keypad", "Encoder"]` on existing actions, `Encoder.layout` pointing to `github-full-canvas.json`
- Helper for `setFeedback({ canvas: encodedSVG })` to push rendered SVGs to the strip

### 3.2 Repo Stats Encoder
**Effort**: Medium | **Priority**: P0

Encoder support for the Repo Stats action:
- **Touch strip**: Hero number (48–72px) displaying the current stat value, with a sparkline Bézier curve showing recent trend data where applicable (stars, issues, PRs). Left-edge ambient accent color identifies the stat type without reading.
- **Rotate**: Cycle through stat types (same order as short-press on keypad)
- **Press**: Open URL for the current stat type (same as long-press on keypad)
- **Tap (touch)**: Force refresh data immediately
- **TriggerDescription**: Dynamic labels — e.g., "Next Stat" / "Open GitHub" / "Refresh"

**Manifest**: Add `Encoder` block to Repo Stats action definition
**SDK Features**: `onDialRotate`, `onDialPress`, `onTouchTap`, `setFeedback`, `setTriggerDescription`

### 3.3 Workflow Status Encoder
**Effort**: Medium | **Priority**: P0

Encoder support for the Workflow Status action:
- **Touch strip**: Atmospheric status glow — radial gradient fills the strip with the workflow status color (green/red/yellow/etc.). Run history dots across the bottom as Tufte small-multiples (each dot = one recent run, colored by status).
- **Rotate**: Browse recent workflow runs (updates touch strip and keypad display)
- **Press**: Open URL for the currently-selected run
- **Tap (touch)**: Force refresh
- **TriggerDescription**: Dynamic labels — e.g., "Browse Runs" / "Open Run" / "Refresh"

### 3.4 Remaining Phase 1 Polish
**Effort**: Small | **Priority**: P1

Finish the two remaining Phase 1 items alongside encoder work:
- **1.3 Workflow Status: Show Run Duration** — Display run duration on the button (and on the touch strip for encoder view)
- **1.4 Error State Improvements** — Rate limit display, distinct error visuals, `showAlert()` for transient errors (setup state partially addresses this)

---

## Completed — Phase 4 — Encoder Expansion + New Actions ✅

Extend encoder support to all remaining actions and introduce new encoder-first actions.

### 4.1 Encoder for Remaining 5 Actions
**Effort**: Large | **Priority**: P1

Add encoder/touch strip support to the remaining Phase 2 actions:

- **Commit Activity** — Two touch strip views:
  - *Heatmap view*: 7×4 grid (28 days) of colored cells showing commit density
  - *Sparkline view*: Smooth Bézier curve of daily commit counts with area fill gradient and endpoint dot
  - Rotate cycles time window (24h → 7d → 30d), press opens commits page
- **Branch Comparison** — Touch strip shows ahead/behind as a divergence diagram (two bar segments from center). Rotate swaps head/base branches, press opens compare page.
- **PR Counter** — Hero number with accent color, optional mini-bar showing open vs closed ratio. Rotate cycles state filter (open → closed → all), press opens PRs page.
- **Issue Counter** — Same pattern as PR Counter. Rotate cycles state filter, press opens issues page.
- **Release Monitor** — Hero version tag with relative time. Sparkline of release frequency if multiple releases exist. Rotate cycles between release details (tag, time, author), press opens release page.

### 4.2 PR Review Queue (NEW Action)
**Effort**: Medium | **Priority**: P1

A new action (button + encoder) showing how many PRs are waiting for your review.

**Button display**: Review-requested PR count with urgency gradient — green (0), yellow (1–3), orange (4–6), red (7+)
**Touch strip**: Hero count with list of PR titles scrollable via rotate. Urgency gradient background matches the button.
**Rotate**: Browse individual PRs waiting for review
**Press**: Open the selected PR (or the review-requested search page if on the count view)

**API**: `GET /search/issues?q=review-requested:@me+type:pr+is:open`
**Token**: `Pull requests: Read` (already required)
**URL on press**: `https://github.com/pulls/review-requested` or individual PR URL

### 4.3 Git Branch Network (NEW Encoder-Only Action)
**Effort**: Large | **Priority**: P1

Metro-map style branch diagram rendered on the touch strip. Encoder-only — no keypad button.

**Touch strip**: Stylized branch topology showing merge/diverge points as a metro/subway map. Branches rendered as colored lines with dots at commit points. Supports **contiguous rendering** across 1, 2, or 4 adjacent encoder quarters for a wider view.

**Rotate**: Scroll the timeline (left = older, right = newer)
**Press**: Open the network graph page in the browser

**API**: `GET /repos/{owner}/{repo}/commits` (for commit history), `GET /repos/{owner}/{repo}/branches` (for branch topology)
**Token**: `Contents: Read` (already required)
**URL on press**: `https://github.com/{owner}/{repo}/network`

### 4.4 Workflow Dispatch
**Effort**: Medium | **Priority**: P1

Add workflow dispatch capability to the existing Workflow Status encoder:
- **Long-touch** on the Workflow Status encoder touch strip triggers a workflow dispatch for the configured workflow
- Confirmation glow before dispatching (touch-and-hold 1.5s)
- Graceful degradation: if the token only has `Actions: Read`, the long-touch does nothing (no error, no prompt to upgrade)
- Success/failure feedback via `showOk()` / `showAlert()`

**API**: `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`
**Token**: `Actions: Write` (optional — plugin works fully without it, dispatch simply unavailable)

---

## Completed — Phase 5 — Security & Data Visualizations ✅

Rich data visualization actions leveraging the touch strip's graphical capabilities.

### 5.1 Security Health (NEW Action)
**Effort**: Medium | **Priority**: P2

Apple Watch-inspired arc gauge on the touch strip combining Dependabot + Code Scanning alert data into a single health score.

**Button display**: Overall health score (0–100) with color gradient (red → yellow → green)
**Touch strip**: Circular arc gauge filling from left to right. Severity dots breakdown below the arc — critical (red), high (orange), medium (yellow), low (blue). Total count as hero number inside the arc.
**Rotate**: Cycle between alert types (All → Dependabot → Code Scanning)
**Press**: Open the repository security overview page
**Tap (touch)**: Force refresh

**API**:
- `GET /repos/{owner}/{repo}/dependabot/alerts?state=open` — Dependabot alerts
- `GET /repos/{owner}/{repo}/code-scanning/alerts?state=open` — Code scanning alerts

**Token**: `Dependabot alerts: Read` (required), `Code scanning alerts: Read` (optional — graceful degradation if not granted)
**URL on press**: `https://github.com/{owner}/{repo}/security`

### 5.2 Contribution Heatmap (NEW Encoder-Only Action)
**Effort**: Medium | **Priority**: P2

GitHub's iconic 52-week contribution grid rendered on the touch strip. Encoder-only — no keypad button.

**Touch strip**: 364 data points rendered as a color-coded grid across 800×100px. Supports **contiguous rendering** across 1 or 4 adjacent encoder quarters. When using 4 quarters, the full 52-week heatmap is displayed seamlessly across all strips. Single quarter shows ~13 weeks.

**Color scale**: GitHub's contribution palette — `#0d1117` (none), `#0e4429`, `#006d32`, `#26a641`, `#39d353` (most)
**Rotate**: Scroll through weeks (useful in single-quarter mode)
**Press**: Open the user's contribution page

**API**: `GET /users/{username}/events` (approximation from public events) or GraphQL `contributionsCollection` query
**Token**: `Metadata: Read`

### 5.3 Fleet Monitor (NEW Action)
**Effort**: Medium | **Priority**: P2

Compact per-repo summary designed to be placed across 4 encoder quarters for fleet-wide monitoring.

**Touch strip (per quarter)**: Compact layout showing repo name (truncated), workflow status badge (colored dot), open PR count, and a tiny activity sparkline. Each quarter monitors one repo independently.

**Button display**: Aggregate health — "4/4 ✓" or "3/4 ⚠" showing how many monitored repos are healthy
**Rotate**: Cycle through repos in the quarter (if multiple configured)
**Press**: Open the currently-displayed repo in the browser

**API**: Reuses existing endpoints — `GET /repos/{owner}/{repo}/actions/runs`, `GET /search/issues?q=...+type:pr+is:open`, `GET /repos/{owner}/{repo}/stats/commit_activity`
**Token**: Same as existing actions (no new permissions)

---

## Phase 6 — Profiles & Ecosystem (v2.0.0)

Pre-built configurations and ecosystem expansion for effortless setup.

### 6.1 Bundled Profiles
**Effort**: Small | **Priority**: P3

Ship pre-configured `.streamDeckProfile` files that users can install with one click:

| Profile | Layout | Actions |
|---------|--------|---------|
| **GitHub Dashboard** | 4/4 encoders | Stats + Workflow + PRs/Issues + Activity |
| **Contribution Graph** | 4/4 encoders | Heatmap × 4 (contiguous 52-week view) |
| **Branch Network** | 4/4 encoders | Branch Network × 4 (contiguous timeline) |
| **Repo Health** | 3/4 encoders | PR Review + Workflow + Security |
| **Fleet Monitor** | 4/4 encoders | Fleet × 4 (one repo per quarter) |

**Manifest**: Use `Profiles` property to bundle `.streamDeckProfile` files

### 6.2 Multi-Repo Workflow Grid
**Effort**: Large | **Priority**: P3

If demand warrants: a single action that monitors workflows across multiple repos, displaying a grid of status indicators (colored dots) showing fleet health. May be superseded by Fleet Monitor (5.3) depending on user feedback.

---

## Touch Strip Design Language

Design principles governing all touch strip / encoder rendering in this plugin.

### Canvas & Layout
- **Single `pixmap` layout** (`github-full-canvas.json`) for full rendering freedom — all touch strip content is a 200×100 SVG pushed as a single canvas element via `setFeedback({ canvas })`. No built-in layout widgets.
- **GitHub dark palette**: True black `#000000` background, `#e6edf3` primary text, accent color per data type (matching the existing `COLORS` constant from `button-renderer.ts`).

### Typography & Data Density
- **Tufte's data-ink ratio**: Maximize data, minimize chrome. Hero numbers rendered at 48–72px dominate the strip. Minimal labels at 12–14px only where needed for context.
- **Ambient accent color**: A subtle vertical bar or gradient on the left edge of the strip identifies the stat/action type by color — the user can identify the data without reading text.

### Sparklines
- **Smooth Bézier curves** with area fill gradient (accent color at 30% opacity fading to transparent). Endpoint dot marks the current value.
- Data normalized to strip height; no axis labels, no gridlines — pure data shape.

### Status Visualization
- **Atmospheric status glow**: For workflow/deployment status, a radial gradient fills the entire strip with the status color at low opacity, creating an ambient mood that's visible at a glance.
- **Run history dots**: Tufte small-multiples principle — each dot represents one data point (one workflow run), colored by its conclusion status, arranged in a horizontal row near the bottom of the strip.

### Multi-Quarter Rendering
- **Contiguous rendering**: Actions that span multiple encoder quarters (Heatmap, Branch Network, Fleet Monitor) share a global coordinate system. Each quarter renders its portion of the full SVG by offsetting into the shared canvas. The plugin calculates which segment to render based on the action's configured quarter position (1 of 4, 2 of 4, etc.).

---

## GraphQL API Migration

The plugin now supports GitHub's GraphQL API alongside REST. GraphQL enables richer data with fewer API calls.

### Current GraphQL Usage
- **Contribution Heatmap** (v1.8.0) — `contributionsCollection` query fetches the profile-level contribution calendar (all repos, all contribution types)

### Planned GraphQL Migration (v2.x)

**Batched Queries** — Replace multiple REST calls with single GraphQL queries:
- A single query can fetch repo stats + PR count + latest workflow + latest release simultaneously
- Reduces API calls from ~4 per action to 1, significantly improving rate limit efficiency
- Actions sharing the same repo can share a single batched query result

**New Actions Enabled by GraphQL:**
| Action | GraphQL Query | What It Shows |
|--------|--------------|---------------|
| **Discussions Monitor** | `repository.discussions` | Discussion count, latest topics, answer status |
| **Projects V2 Board** | `repository.projectsV2` | Project board status, item counts, progress |
| **Sponsorship Tracker** | `user.sponsorsListing` | Sponsor count, monthly income (for OSS maintainers) |
| **Review Requests (Enhanced)** | `search(type:ISSUE)` with review-requested | Richer PR data: review status, checks, mergeable state |

**Improvements to Existing Actions:**
| Action | Current (REST) | Improved (GraphQL) |
|--------|---------------|-------------------|
| Repo Stats | 1 call per stat | All stats in 1 query |
| PR Review Queue | Search API (limited fields) | Full PR details (reviews, checks, labels) |
| Fleet Monitor | 3 parallel REST calls per repo | 1 batched query per repo |
| Commit Activity | `/stats/commit_activity` (52 weeks max) | `contributionsCollection` (configurable range) |

**Architecture for Batched Queries:**
- A shared `GraphQLQueryCoordinator` will collect all active actions' data needs
- On each polling tick, build ONE batched query for all actions sharing the same token
- Distribute results to individual actions
- Force-refresh on a single action triggers only that action's portion of the query

### Migration Strategy
- Phase 1 (done): Contribution calendar via GraphQL ✅
- Phase 2 (done): Batch query coordinator for repo data (stats + PRs + workflows in one call) ✅
- Phase 3 (done): New GraphQL-only actions (Discussions, Projects V2) ✅
- Phase 4: Full REST → GraphQL migration for all repo-scoped data

---

## Multi-Quarter Compositions

Approved multi-quarter layouts for Stream Deck+ touch strip. Each layout documents which actions occupy which encoder quarters.

| Layout | Name | Quarters | Composition |
|--------|------|----------|-------------|
| **A** | Repository Dashboard | 4/4 | Stats + Workflow + PRs/Issues + Activity |
| **B** | Full Contribution Heatmap | 4/4 | 52-week heatmap rendered contiguously across all 4 quarters |
| **C** | Workflow + Deployment Pair | 2/4 | Workflow Status + Workflow Status (different repos or workflows) |
| **D** | Branch Comparison Head vs Base | 2/4 | Branch Comparison × 2 (head branch quarter + base branch quarter) |
| **E** | Repo Health Trio | 3/4 | PR Review Queue + Workflow Status + Security Health |
| **F** | Multi-Repo Fleet Monitor | 4/4 | Fleet Monitor × 4 (one repo per quarter) |
| **G** | Git Branch Network | 2/4 or 4/4 | Branch Network spanning 2 or 4 quarters for timeline depth |

---

## Implementation Priority Matrix

| Feature | Effort | Impact | Priority | Phase | Status |
|---------|--------|--------|----------|-------|--------|
| ~~Repo Stats: Open URL~~ | Small | High | ~~P0~~ | 1 | ✅ v1.2.0 |
| ~~Long Press vs Short Press~~ | Medium | Medium | ~~P1~~ | 1 | ✅ v1.2.0 |
| ~~Repo Stats: Additional Types~~ | Small | Medium | ~~P1~~ | 1 | ✅ v1.2.0 |
| ~~Setup State Prompt~~ | Small | Medium | ~~P1~~ | 1 | ✅ v1.3.0 |
| ~~Stability & Polish~~ | Small | High | ~~P0~~ | — | ✅ v1.3.1–v1.3.4 |
| ~~PR Counter~~ | Medium | High | ~~P0~~ | 2 | ✅ v1.4.0 |
| ~~Issue Counter~~ | Medium | High | ~~P0~~ | 2 | ✅ v1.4.0 |
| ~~Release Monitor~~ | Medium | High | ~~P1~~ | 2 | ✅ v1.4.0 |
| ~~Commit Activity~~ | Medium | Medium | ~~P1~~ | 2 | ✅ v1.4.0 |
| ~~Branch Comparison~~ | Medium | Medium | ~~P2~~ | 2 | ✅ v1.4.0 |
| ~~Visual Polish~~ | Medium | Medium | ~~P2~~ | — | ✅ v1.4.0 |
| ~~v1.5.0 Release~~ | — | — | — | — | ✅ v1.5.0 |
| Encoder Infrastructure | Small | High | **P0** | 3 | — |
| Repo Stats Encoder | Medium | High | **P0** | 3 | — |
| Workflow Status Encoder | Medium | High | **P0** | 3 | — |
| Workflow Run Duration | Small | Low | **P1** | 3 | Planned |
| Error State Improvements | Small | Medium | **P1** | 3 | Partial (setup state done) |
| Encoder for Remaining Actions | Large | Medium | **P1** | 4 | — |
| PR Review Queue | Medium | High | **P1** | 4 | — |
| Git Branch Network | Large | Medium | **P1** | 4 | — |
| Workflow Dispatch | Medium | Medium | **P1** | 4 | — |
| Security Health | Medium | Medium | **P2** | 5 | — |
| Contribution Heatmap | Medium | Medium | **P2** | 5 | — |
| Fleet Monitor | Medium | Medium | **P2** | 5 | — |
| Bundled Profiles | Small | Low | **P3** | 6 | — |
| Multi-Repo Workflow Grid | Large | Low | **P3** | 6 | — |
| ~~GraphQL Batch Query Coordinator~~ | Large | High | ~~P0~~ | — | ✅ v2.1.0 |
| ~~Discussions Monitor~~ | Medium | Medium | ~~P1~~ | — | ✅ v2.2.0 |
| ~~Projects V2 Board~~ | Medium | Medium | ~~P1~~ | — | ✅ v2.2.0 |

---

## Suggested Next Steps

1. ~~**v1.2.0**: Phase 1 quick wins (Repo Stats URL + additional stat types + long press)~~ ✅ **Done**
2. ~~**v1.3.x**: Stability & polish (setup state, packaging, PI race conditions, SDK compat)~~ ✅ **Done**
3. ~~**v1.4.0**: Phase 2 actions (PR Counter, Issue Counter, Release Monitor, Commit Activity, Branch Comparison) + Visual Polish (animated loading, consistent palette)~~ ✅ **Done**
4. ~~**v1.5.0**: Release polish and stabilization~~ ✅ **Done**
5. **v1.6.0**: Stream Deck+ encoder foundation — `pixmap` layout, `touch-strip-renderer.ts`, Repo Stats encoder, Workflow Status encoder, remaining Phase 1 polish (run duration, error improvements)
6. **v1.7.0**: Encoder for all remaining actions + PR Review Queue + Git Branch Network + Workflow Dispatch
7. **v1.8.0**: Security Health gauge + Contribution Heatmap + Fleet Monitor
8. **v2.0.0**: Bundled Profiles, ecosystem expansion
9. ~~**v2.1.0**: GraphQL batched query coordinator — reduce API calls across all actions sharing the same repo~~ ✅ **Done**
10. ~~**v2.2.0**: New GraphQL actions — Discussions Monitor, Projects V2 Board~~ ✅ **Done**
11. **v2.3.0**: Discussions Monitor enhancements — category filtering (PI dropdown of available categories), state filter (open/closed/all), dial rotate to cycle through categories, short press to cycle display (count → latest topic → answered ratio). Projects V2 Board enhancements — filter by open/closed projects via PI dropdown.
12. **v2.4.0+**: Sponsorship Tracker, enhanced Review Requests with full PR data, full REST → GraphQL migration

---

## Deferred / Dropped

Items from earlier roadmap phases that have been deprioritized, subsumed by other features, or dropped entirely.

| Item | Original Phase | Status | Reason |
|------|---------------|--------|--------|
| Repository Traffic (3.1) | Phase 3 (old) | **Deferred** | Requires `Administration: Read` permission, niche audience |
| Code Scanning Alerts (3.3) | Phase 3 (old) | **Deferred** | Subsumed by Security Health gauge (Phase 5) |
| Secret Scanning Alerts (3.4) | Phase 3 (old) | **Deferred** | Subsumed by Security Health gauge (Phase 5) |
| Contributor Activity (3.6) | Phase 3 (old) | **Dropped** | Novelty, not actionable — doesn't drive developer decisions |
| Milestone Progress (3.7) | Phase 3 (old) | **Dropped** | GitHub Projects V2 has largely replaced milestones |
| GitHub Pages Status (3.8) | Phase 3 (old) | **Dropped** | Workflow Status already covers deployment status for Pages workflows |
| Actions Usage / Billing (3.9) | Phase 3 (old) | **Dropped** | Rarely needed day-to-day; billing dashboard in GitHub is sufficient |
| Notification Counter (5.1) | Phase 5 (old) | **Blocked** | Fine-grained tokens don't support `GET /notifications`; no viable workaround |
| Organization Dashboard (5.3) | Phase 5 (old) | **Dropped** | Too complex, niche audience — org-level monitoring better served by dedicated tools |
| Commit Status Checks (5.5) | Phase 5 (old) | **Dropped** | Redundant with Workflow Status action (which already shows CI/CD status) |
| Language Breakdown (5.6) | Phase 5 (old) | **Dropped** | Not useful at 144px button size; already available as Repo Stats "Language" type |
| Releases Changelog View (5.7) | Phase 5 (old) | **Dropped** | Touch strip too small for meaningful markdown rendering |

---

## Token Permissions Reference

Summary of which permissions each action/feature requires with a **fine-grained personal access token**.

### Already Required (Current Actions)
| Permission | Level | Used By |
|-----------|-------|---------|
| Metadata | Read | Repo Stats (stars, forks, watchers, language, size, license, default branch, visibility) |
| Pull requests | Read | Repo Stats — PR count, PR Counter action, PR Review Queue (Phase 4) |
| Actions | Read | Workflow Status (runs, workflows, environments) |
| Deployments | Read | Workflow Status (deployments, deployment statuses) |
| Issues | Read | Issue Counter action |
| Contents | Read | Release Monitor, Commit Activity, Branch Comparison, Git Branch Network (Phase 4) |

### New Permissions Needed by Phase

| Permission | Level | Required For |
|-----------|-------|-------------|
| Actions | Write | Workflow Dispatch (Phase 4) — optional, graceful degradation if not granted |
| Dependabot alerts | Read | Security Health (Phase 5) |
| Code scanning alerts | Read | Security Health (Phase 5) — optional, graceful degradation if not granted |
| Discussions | Read | Discussions Monitor |
| Projects | Read | Projects V2 Board |

### GraphQL API
The GraphQL API uses the same personal access token as REST. No additional permissions needed for public data. For private contribution data in the Contribution Heatmap "All contributions" mode, the token needs access to the user's private repositories.

### Not Available with Fine-Grained Tokens
| Feature | Reason |
|---------|--------|
| Notifications | `GET /notifications` is not available for fine-grained PATs |

---

## API Endpoints Reference

New endpoints to implement for each feature, grouped by permission.

### Metadata: Read (no additional permission needed)
```
GET /repos/{owner}/{repo}                         → repo info (already used)
GET /repos/{owner}/{repo}/stats/commit_activity    → weekly commit activity
GET /repos/{owner}/{repo}/stats/participation      → weekly commit count
GET /repos/{owner}/{repo}/stats/contributors       → contributor stats
GET /repos/{owner}/{repo}/stats/code_frequency     → weekly additions/deletions
GET /repos/{owner}/{repo}/stats/punch_card         → hourly commit count
GET /repos/{owner}/{repo}/contributors             → contributor list
GET /repos/{owner}/{repo}/languages                → language breakdown
GET /repos/{owner}/{repo}/tags                     → tag list
GET /repos/{owner}/{repo}/topics                   → topic list
GET /repos/{owner}/{repo}/stargazers               → stargazer list
GET /repos/{owner}/{repo}/events                   → repository events
```

### Contents: Read
```
GET /repos/{owner}/{repo}/releases                 → list releases
GET /repos/{owner}/{repo}/releases/latest          → latest release
GET /repos/{owner}/{repo}/releases/tags/{tag}      → release by tag
GET /repos/{owner}/{repo}/commits                  → commit list (with filters)
GET /repos/{owner}/{repo}/compare/{base}...{head}  → branch comparison
GET /repos/{owner}/{repo}/community/profile        → community health
```

### Pull requests: Read
```
GET /repos/{owner}/{repo}/pulls                    → list pull requests
GET /repos/{owner}/{repo}/pulls/{pull_number}      → specific PR
GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews → PR reviews
```

### Issues: Read
```
GET /repos/{owner}/{repo}/issues                   → list issues
GET /repos/{owner}/{repo}/milestones               → list milestones
GET /repos/{owner}/{repo}/milestones/{number}      → specific milestone
```

### Administration: Read
```
GET /repos/{owner}/{repo}/traffic/views            → page views (14 days)
GET /repos/{owner}/{repo}/traffic/clones           → clone count (14 days)
GET /repos/{owner}/{repo}/traffic/popular/paths    → top pages
GET /repos/{owner}/{repo}/traffic/popular/referrers → top referrers
```

### Security Permissions
```
GET /repos/{owner}/{repo}/dependabot/alerts        → Dependabot alerts
GET /repos/{owner}/{repo}/code-scanning/alerts     → Code scanning alerts
GET /repos/{owner}/{repo}/secret-scanning/alerts   → Secret scanning alerts
```

### Pages: Read
```
GET /repos/{owner}/{repo}/pages                    → Pages config/status
GET /repos/{owner}/{repo}/pages/builds/latest      → latest Pages build
```

### Commit statuses: Read
```
GET /repos/{owner}/{repo}/commits/{ref}/status     → combined status
GET /repos/{owner}/{repo}/commits/{ref}/statuses   → individual statuses
```

### GraphQL API
```
https://api.github.com/graphql (POST)

Queries used:
- `viewer { contributionsCollection { contributionCalendar { ... } } }` — Profile heatmap
- Planned: `repository { ... }` batched queries for multi-action data
```

---

## Stream Deck SDK Features Reference

SDK capabilities available for enhancing the plugin.

### Currently Used
- `SingletonAction` — Base class for actions
- `onWillAppear` / `onWillDisappear` — Lifecycle management
- `onKeyDown` / `onKeyUp` — Button press handling (with long-press detection)
- `onDidReceiveSettings` — Settings change handling
- `onSendToPlugin` — PI data source communication
- `setImage()` — Dynamic SVG rendering on buttons
- `setTitle()` — Updating button title text
- `system.openUrl()` — Opening URLs in browser

### Available to Leverage

| Feature | Description | Use Case |
|---------|-------------|----------|
| **Dials/Encoders** | Rotate, press, touch on Stream Deck+ | Cycle through stats/repos/workflows |
| **Touch Strip Layouts** | Rich display on SD+ touch strip | Show detailed stats, progress bars |
| **Built-in Layouts** | `$X1` (icon), `$A1` (value), `$B1` (indicator), `$B2` (gradient), `$C1` (double indicator) | Progress bars for milestones, usage meters |
| **Custom Layouts** | JSON-based layout files | Tailored stat displays on touch strip |
| **setFeedback()** | Update layout item values | Dynamic data on touch strip |
| **setFeedbackLayout()** | Switch layout programmatically | Context-aware displays |
| **setTriggerDescription()** | Label dial actions | Push/Rotate/Touch descriptions |
| **Multi-State Keys** | 2-state toggle (manifest `States`) | Toggle between views (status/detail) |
| **showOk() / showAlert()** | Temporary visual feedback | Success/error confirmation |
| **Profiles** | Bundled Stream Deck profiles | Pre-configured dashboards |
| **onKeyUp** | Key release event | Long-press detection |
| **Target.Hardware / Software** | Separate HW/SW rendering | Different displays per target |
| **Multi-Actions** | User combines actions into one key press | Named states for multi-action support |
| **VisibleInActionsList** | Hide deprecated actions | Action deprecation without breaking |
