<!-- 
  Release Notes — Stream Deck GitHub Utilities
  Most recent version first.
  Character limit per entry: 1,500
-->

## v2.2.0
<!-- Characters: ~580 / 1,500 -->

New actions and smarter API usage with the GraphQL batch query coordinator.

**New Actions:**
- **💬 Discussions Monitor** — track discussion count and answered status for any repository
- **📊 Projects V2 Board** — monitor GitHub Projects V2 boards with item counts and progress

**Under the Hood:**
- **GraphQL Batch Query Coordinator** — actions sharing the same repository now batch their data needs into a single GraphQL query, significantly reducing API calls and improving rate limit efficiency
- All 14 actions now route through the coordinator for optimized data fetching with automatic REST fallback

---

## v2.0.0 — 2026-03-19
<!-- Characters: ~1,350 / 1,500 -->

The biggest release yet — Stream Deck+ support and 5 brand-new actions.

**Stream Deck+ Support:**
- **Full encoder support** for all 12 actions — rotate dials, tap the touch strip, long-touch for quick actions
- **Touch strip visualizations** — Tufte-inspired sparklines, arc gauges, contribution heatmaps, metro-map branch diagrams, and fleet dashboards rendered directly on the strip
- **Multi-quarter layouts** — heatmaps and branch networks can span 2 or 4 adjacent encoder slots for panoramic views
- **Workflow dispatch** — long-touch the Workflow Status dial to trigger a workflow run

**New Actions:**
- **PR Review Queue** — count of PRs awaiting your review with urgency gradient (blue → amber → red)
- **Fleet Monitor** — compact repo health dashboard: workflow status + PR count + commit sparkline in one key
- **Security Health** — Dependabot alert summary with A–F letter grade and arc gauge visualization
- **Branch Network** — metro-map style git branch diagram on the touch strip (SD+ only)
- **Contribution Heatmap** — 52-week GitHub contribution grid on the touch strip (SD+ only)

**Improvements:**
- Double-click any keypad button for instant refresh
- Workflow run duration now displayed on the workflow status button
- GraphQL API for profile-level contribution calendar data

---

## v1.5.0 — 2026-02-25
<!-- Characters: ~850 / 1,500 -->

Reliability and performance improvements under the hood.

**Architecture:**
- **Centralized polling** — all 7 actions now share a unified PollingCoordinator, replacing per-action timer management for cleaner, more consistent behavior
- **Exponential error backoff** — on consecutive API failures, polling intervals automatically increase (up to 32× the base interval) to reduce unnecessary requests; pressing the button resets the backoff for an immediate retry
- **Generation counter** — prevents stale async API responses from overwriting fresher data when settings change rapidly

**API Improvements:**
- **HTTP 429 handling** — dedicated rate-limit-exceeded error with Retry-After header parsing (supports both integer seconds and HTTP-date formats)
- Improved 403 rate limit error messages with reset time information

**Visual:**
- **Native SVG spinner** — loading animation now uses a single SVG with `<animateTransform>`, eliminating frame-based timer overhead

---

## v1.4.0 — 2026-02-24
<!-- Characters: ~950 / 1,500 -->

Major feature release — 5 new actions and visual polish.

**New Actions:**
- **PR Counter** — display open, closed, or all pull request counts for any repository
- **Issue Counter** — display issue counts (accurately excluding PRs) with state filtering
- **Release Monitor** — track the latest release version with relative time and pre-release support
- **Commit Activity** — show commit counts for the last 24 hours, 7 days, or 30 days
- **Branch Comparison** — show ahead/behind counts between two branches with color-coded status

**Visual Polish:**
- Animated loading spinner during data fetches (replaces static "Loading" text)
- Consistent color palette across all actions using centralized theme colors

**Improvements:**
- Migrated PR and issue counting to GitHub Search API for more reliable counts
- All new actions support press-to-open-on-GitHub, configurable refresh intervals, and searchable repository dropdowns
- Updated token scope guidance to include permissions for all actions

---

## v1.3.4 — 2026-02-23
<!-- Characters: ~370 / 1,500 -->

Settings reliability and UX polish.

- Fixed stat dropdown changes not persisting on first selection after choosing a repository
- Fixed settings echo race condition between Property Inspector and plugin (WebSocket echo suppression)
- Disabled user title field to prevent overlay on full-SVG buttons
- Updated default key images with proper SVG setup prompts

---

## v1.3.3 — 2026-02-22
<!-- Characters: ~230 / 1,500 -->

Multi-button fix and icon refresh.

- Fixed second Repo Stats button not cycling stat types independently (#1)
- Replaced sidebar action icons with crisp white SVGs for better visibility

---

## v1.3.2 — 2026-02-21
<!-- Characters: ~220 / 1,500 -->

SDK compatibility and maintenance update.

- Fixed SDK version compatibility (updated to SDKVersion 3)
- Adopted stream-deck-template collaboration protocol for standardized development practices

---

## v1.3.1 — 2026-02-21
<!-- Characters: ~160 / 1,500 -->

Packaging fix for reliable installation.

- Fixed plugin packaging by bundling all dependencies (including @elgato/streamdeck and ws) directly into the plugin binary

---

## v1.3.0 — 2026-02-21
<!-- Characters: ~250 / 1,500 -->

Setup experience improvements.

- Added "Setup" state — buttons now show a clear prompt when your GitHub token or repository isn't configured yet, guiding you to open Settings
- Restructured plugin directory layout for cleaner builds

---

## v1.2.0 — 2026-02-21
<!-- Characters: ~550 / 1,500 -->

Major usability upgrade with new interaction patterns and smarter dropdowns.

- **Short press cycles stat types** — tap a Repo Stats button to quickly flip through Stars, Issues, Forks, and all other stats without opening settings
- **Long press opens GitHub** — hold a button for 500ms+ to open the repository or workflow run directly in your browser
- **Marquee scrolling** — long text values (language names, branch names, license types) now scroll smoothly instead of being truncated
- **Searchable dropdowns** — the Property Inspector now features FilterableSelect dropdowns with type-to-filter for repositories, workflows, branches, and environments
- Fixed dropdown positioning when near the bottom of the Property Inspector viewport
- Fixed FilterableSelect not restoring previously saved settings when reopening the Property Inspector

---

## v1.1.1 — 2026-02-21
<!-- Characters: ~180 / 1,500 -->

Private repository visibility fix.

- Fixed private repositories not appearing in the repository dropdown by adding visibility=all parameter and pagination support
- Updated setup instructions with repository scope guidance for fine-grained tokens

---

## v1.1.0 — 2026-02-20
<!-- Characters: ~290 / 1,500 -->

First feature release with workflow interaction and full action suite.

- **Repo Stats action** — display stars, issues, forks, watchers, PRs, language, size, license, default branch, and visibility for any GitHub repository
- **Workflow Status action** — monitor GitHub Actions workflow runs with color-coded status icons and deployment tracking
- **Open in browser** — press the Workflow Status button to open the latest workflow run in your browser
- Auto-refresh with configurable intervals
- Error states with retry hints
