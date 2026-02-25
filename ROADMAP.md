# GitHub Utilities for Stream Deck — Roadmap

> **Version**: v1.4.0 (current)
> **Last Updated**: February 2026
> **Status**: Active — Phase 1, Phase 2 & Visual Polish complete, Phase 3 next

---

## Table of Contents

- [Current State](#current-state)
- [Completed — Phase 1](#completed--phase-1)
- [Completed — Phase 2](#completed--phase-2)
- [Phase 3 — Advanced Actions](#phase-3--advanced-actions)
- [Phase 4 — Stream Deck+ & Polish](#phase-4--stream-deck--polish)
- [Phase 5 — Future / Stretch Goals](#phase-5--future--stretch-goals)
- [Token Permissions Reference](#token-permissions-reference)
- [API Endpoints Reference](#api-endpoints-reference)
- [Stream Deck SDK Features Reference](#stream-deck-sdk-features-reference)

---

## Current State

### Existing Actions (v1.4.0)

| Action | Description | API Endpoints Used |
|--------|-------------|-------------------|
| **Repo Stats** | Displays 10 stat types (stars, issues, forks, watchers, PRs, language, size, license, default branch, visibility) with short-press cycling and long-press URL opening | `GET /repos/{owner}/{repo}`, `GET /search/issues?q=repo:{owner}/{repo}+type:pr+is:open` |
| **Workflow Status** | Shows latest workflow run status with deployment info; opens URL on press | `GET /repos/{owner}/{repo}/actions/runs`, `GET /repos/{owner}/{repo}/deployments`, `GET /repos/{owner}/{repo}/deployments/{id}/statuses` |
| **PR Counter** | Displays open/closed/all PR count; press to open PRs page | `GET /search/issues?q=repo:{owner}/{repo}+type:pr+is:{state}` (Search API) |
| **Issue Counter** | Displays issue count (excluding PRs); press to open issues page | `GET /search/issues?q=repo:{owner}/{repo}+type:issue+is:{state}` (Search API) |
| **Release Monitor** | Shows latest release tag, relative time, pre-release indicator; press to open release | `GET /repos/{owner}/{repo}/releases/latest`, `GET /repos/{owner}/{repo}/releases?per_page=1` |
| **Commit Activity** | Shows commit count for 24h/7d/30d time windows; press to open commits | `GET /repos/{owner}/{repo}/stats/commit_activity` |
| **Branch Comparison** | Shows ahead/behind counts between two branches; press to open compare | `GET /repos/{owner}/{repo}/compare/{base}...{head}` |

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
- 463 tests across 16 test files

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

## Phase 3 — Advanced Actions

More specialized actions for power users and teams.

### 3.1 Repository Traffic
**Effort**: Medium | **Priority**: Medium

Show repo traffic data — views, unique visitors, clones.

**Display**: View count, clone count, or unique visitors with trend arrow

**Configuration**:
- Repository selection
- Metric: views / unique viewers / clones / unique cloners
- Refresh interval

**API**:
- `GET /repos/{owner}/{repo}/traffic/views` — page view count (last 14 days)
- `GET /repos/{owner}/{repo}/traffic/clones` — clone count (last 14 days)
- `GET /repos/{owner}/{repo}/traffic/popular/paths` — top pages
- `GET /repos/{owner}/{repo}/traffic/popular/referrers` — top referral sources

**Token**: `Administration: Read` (traffic endpoints require admin permission)
**URL on press**: `https://github.com/{owner}/{repo}/graphs/traffic`

### 3.2 Dependabot Alert Counter
**Effort**: Medium | **Priority**: Medium

Show count of open Dependabot security alerts.

**Display**: Alert count with severity color (green = 0, yellow = low/medium, red = high/critical)

**Configuration**:
- Repository selection
- Severity filter: `critical` | `high` | `medium` | `low`
- Refresh interval

**API**: `GET /repos/{owner}/{repo}/dependabot/alerts?state=open`
**Token**: `Dependabot alerts: Read`
**URL on press**: `https://github.com/{owner}/{repo}/security/dependabot`

### 3.3 Code Scanning Alert Counter
**Effort**: Medium | **Priority**: Medium

Show count of open code scanning (CodeQL) alerts.

**Display**: Alert count with severity color

**Configuration**:
- Repository selection
- Severity filter
- Tool filter (CodeQL, etc.)
- Refresh interval

**API**: `GET /repos/{owner}/{repo}/code-scanning/alerts?state=open`
**Token**: `Code scanning alerts: Read`
**URL on press**: `https://github.com/{owner}/{repo}/security/code-scanning`

### 3.4 Secret Scanning Alert Counter
**Effort**: Medium | **Priority**: Low

Show count of open secret scanning alerts.

**Display**: Alert count, red when > 0

**API**: `GET /repos/{owner}/{repo}/secret-scanning/alerts?state=open`
**Token**: `Secret scanning alerts: Read`
**URL on press**: `https://github.com/{owner}/{repo}/security/secret-scanning`

### 3.5 Security Dashboard (Combined)
**Effort**: Large | **Priority**: Medium

A single button that combines Dependabot + Code Scanning + Secret Scanning alert counts into one overview.

**Display**: Total alert count, color-coded by worst severity. Could cycle between different alert types.

**Token**: Requires `Dependabot alerts: Read` + `Code scanning alerts: Read` + `Secret scanning alerts: Read`

### 3.6 Contributor Activity
**Effort**: Medium | **Priority**: Low

Show top contributor or contributor count for a repo.

**API**:
- `GET /repos/{owner}/{repo}/stats/contributors` — all contributors with commit counts
- `GET /repos/{owner}/{repo}/contributors?per_page=1` — contributor list

**Token**: `Metadata: Read`

### 3.7 Milestone Progress
**Effort**: Medium | **Priority**: Low

Show progress of a specific milestone (open vs closed issues).

**Display**: Progress percentage, visual bar, "12/20" format

**Configuration**:
- Repository selection
- Milestone selection (via PI dropdown)
- Refresh interval

**API**:
- `GET /repos/{owner}/{repo}/milestones` — list milestones with `open_issues` and `closed_issues`
- `GET /repos/{owner}/{repo}/milestones/{milestone_number}` — specific milestone

**Token**: `Issues: Read` or `Pull requests: Read`
**URL on press**: `https://github.com/{owner}/{repo}/milestone/{number}`

### 3.8 GitHub Pages Status
**Effort**: Medium | **Priority**: Low

Show GitHub Pages deployment status and last build result.

**Display**: Status icon (checkmark/X), last build time

**API**:
- `GET /repos/{owner}/{repo}/pages` — Pages configuration and status
- `GET /repos/{owner}/{repo}/pages/builds/latest` — latest build result

**Token**: `Pages: Read`
**URL on press**: Pages URL from `html_url` field, or `https://github.com/{owner}/{repo}/deployments/activity_log?environment=github-pages`

### 3.9 Actions Usage / Billing
**Effort**: Medium | **Priority**: Low

Show GitHub Actions minutes usage for the user.

**Display**: Minutes used, percentage of quota

**API**: `GET /users/{username}/settings/billing/usage` (requires Plan permission)
**Token**: `Plan: Read` (user permission)

---

## Phase 4 — Stream Deck+ & Polish

Leveraging Stream Deck+ hardware features and UX improvements.

### 4.1 Encoder/Dial Support for Repo Stats
**Effort**: Medium | **Priority**: Medium

For Stream Deck+ owners, add dial/encoder controller support:
- **Rotate**: Cycle through stat types (stars → forks → issues → watchers → PRs)
- **Press**: Open URL for current stat
- **Touch strip**: Display stat value with icon and label using layout

**Manifest**: Add `"Controllers": ["Keypad", "Encoder"]` and `Encoder.layout` to Repo Stats action
**SDK Features**: `onDialRotate`, `setFeedback`, `setFeedbackLayout`, `setTriggerDescription`

### 4.2 Encoder/Dial Support for Workflow Status
**Effort**: Medium | **Priority**: Medium

- **Rotate**: Cycle through recent workflow runs
- **Press**: Open URL for current run
- **Touch strip**: Display run status, branch, duration using layout

### 4.3 Multi-Repo Dashboard Dial
**Effort**: Large | **Priority**: Low

A dial action that lets you cycle through multiple repos and shows stats on the touch strip.

- **Rotate**: Cycle through configured repos
- **Press**: Open current repo in browser
- **Touch strip**: Show repo name, stats overview

### 4.4 Bundled Profiles
**Effort**: Small | **Priority**: Low

Ship pre-configured profiles for common layouts:
- **DevOps Dashboard**: Workflow status × 4 repos
- **Open Source Monitor**: Stars + Issues + PRs + Releases
- **Security Overview**: Dependabot + Code Scanning + Secret Scanning + Workflow Status

**Manifest**: Use `Profiles` property to bundle `.streamDeckProfile` files

### 4.5 Multi-State Button for Workflow Status
**Effort**: Medium | **Priority**: Low

Use the SDK's 2-state feature to toggle between:
- **State 0**: Latest run status
- **State 1**: Deployment status

Or: State 0 = normal view, State 1 = detailed view (duration, branch, etc.)

### ✅ 4.6 Visual Polish
Shipped in **v1.4.0**.

- **Animated loading states** — frame-based spinner SVG animation during API fetches (SpinnerAnimator class)
- **Consistent color palette** — centralized `COLORS` constant used across all actions (including new accent colors for releases, commits, branches)
- **Dark theme only** — confirmed OLED Stream Deck displays are always dark; no light theme needed
- **Typography** — existing dynamic font sizing system (30/26/22/18px breakpoints) adequate

---

## Phase 5 — Future / Stretch Goals

Ideas that require more research or may depend on future API/SDK capabilities.

### 5.1 Notification Counter
**Effort**: Large | **Priority**: Medium

Show unread GitHub notification count. Requires the Notifications API which is **not available with fine-grained tokens** — only classic tokens support `GET /notifications`. This would require supporting classic tokens as an alternative auth method.

**Workaround**: Could poll `GET /repos/{owner}/{repo}/events` for recent activity as a proxy.

### 5.2 Workflow Dispatch (Trigger Builds)
**Effort**: Large | **Priority**: Medium

Trigger a workflow run from a button press.

**API**: `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`
**Token**: `Actions: Write` (requires write permission — currently read-only)

This is a compelling feature but requires the user to grant write permissions. Could be optional, with the button showing just status when read-only.

### 5.3 Organization Dashboard
**Effort**: Large | **Priority**: Low

For users who work with GitHub organizations:
- Org-level stats, member count
- Cross-repo workflow status
- Org billing/usage

**API**: Various `/orgs/{org}/*` endpoints
**Token**: Various organization-level permissions

### 5.4 PR Review Status
**Effort**: Large | **Priority**: Medium

Show PR review status (approved/changes requested/pending review) for a specific PR or for all PRs you need to review.

**API**:
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
- `GET /repos/{owner}/{repo}/pulls?requested_reviewer={username}`

**Token**: `Pull requests: Read`

### 5.5 Commit Status Checks
**Effort**: Medium | **Priority**: Low

Show combined commit status for a specific branch/commit.

**API**: `GET /repos/{owner}/{repo}/commits/{ref}/status`
**Token**: `Commit statuses: Read`

### 5.6 Repository Language Breakdown
**Effort**: Medium | **Priority**: Low

Show language breakdown as a visual bar or list.

**API**: `GET /repos/{owner}/{repo}/languages`
**Token**: `Metadata: Read`

### 5.7 Releases Changelog Quick View
**Effort**: Large | **Priority**: Low

Show latest release notes rendered on the touch strip or as a quick notification.

**API**: `GET /repos/{owner}/{repo}/releases/latest` — `body` field contains markdown
**Token**: `Contents: Read`

### 5.8 Multi-Repo Workflow Grid
**Effort**: Large | **Priority**: Low

A single action that monitors workflows across multiple repos. Display as a grid of status indicators (colored dots) showing health of your fleet.

---

## Token Permissions Reference

Summary of which permissions each action/feature requires with a **fine-grained personal access token**.

### Already Required (Current Actions)
| Permission | Level | Used By |
|-----------|-------|---------|
| Metadata | Read | Repo Stats (stars, forks, watchers, language, size, license, default branch, visibility) |
| Pull requests | Read | Repo Stats — PR count, PR Counter action |
| Actions | Read | Workflow Status (runs, workflows, environments) |
| Deployments | Read | Workflow Status (deployments, deployment statuses) |
| Issues | Read | Issue Counter action |
| Contents | Read | Release Monitor, Commit Activity, Branch Comparison |

### New Permissions Needed by Phase

| Permission | Level | Required For |
|-----------|-------|-------------|
| Administration | Read | Repository Traffic (3.1) |
| Dependabot alerts | Read | Dependabot Alerts (3.2), Security Dashboard (3.5) |
| Code scanning alerts | Read | Code Scanning Alerts (3.3), Security Dashboard (3.5) |
| Secret scanning alerts | Read | Secret Scanning Alerts (3.4), Security Dashboard (3.5) |
| Pages | Read | GitHub Pages Status (3.8) |
| Commit statuses | Read | Commit Status Checks (5.5) |
| Plan | Read (user) | Actions Usage/Billing (3.9) |
| Actions | Write | Workflow Dispatch (5.2) — optional |

### Not Available with Fine-Grained Tokens
| Feature | Reason |
|---------|--------|
| Notifications | `GET /notifications` is not available for fine-grained PATs |
| Discussions | GitHub Discussions API uses GraphQL, not REST |

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
| Workflow: Show Run Duration | Small | Low | **P1** | 1 | Planned |
| Error State Improvements | Small | Medium | **P1** | 1 | Partial (setup state done) |
| ~~Commit Activity~~ | Medium | Medium | ~~P1~~ | 2 | ✅ v1.4.0 |
| ~~Branch Comparison~~ | Medium | Medium | ~~P2~~ | 2 | ✅ v1.4.0 |
| Encoder/Dial for Repo Stats | Medium | Medium | **P2** | 4 | — |
| Encoder/Dial for Workflow | Medium | Medium | **P2** | 4 | — |
| Dependabot Alerts | Medium | Medium | **P2** | 3 | — |
| Code Scanning Alerts | Medium | Medium | **P2** | 3 | — |
| Repository Traffic | Medium | Medium | **P2** | 3 | — |
| Security Dashboard | Large | Medium | **P2** | 3 | — |
| ~~Visual Polish~~ | Medium | Medium | ~~P2~~ | 4 | ✅ v1.4.0 |
| Workflow Dispatch | Large | Medium | **P3** | 5 | — |
| Milestone Progress | Medium | Low | **P3** | 3 | — |
| GitHub Pages Status | Medium | Low | **P3** | 3 | — |
| Bundled Profiles | Small | Low | **P3** | 4 | — |
| PR Review Status | Large | Medium | **P3** | 5 | — |
| Organization Dashboard | Large | Low | **P4** | 5 | — |
| Notifications (classic token) | Large | Medium | **P4** | 5 | — |

---

## Suggested Next Steps

1. ~~**v1.2.0**: Phase 1 quick wins (Repo Stats URL + additional stat types + long press)~~ ✅ **Done**
2. ~~**v1.3.x**: Stability & polish (setup state, packaging, PI race conditions, SDK compat)~~ ✅ **Done**
3. ~~**v1.4.0**: Phase 2 actions (PR Counter, Issue Counter, Release Monitor, Commit Activity, Branch Comparison) + Visual Polish (animated loading, consistent palette)~~ ✅ **Done**
4. **v1.5.0**: Remaining Phase 1 polish (run duration, error improvements) + Phase 3 security actions
5. **v2.0.0**: Stream Deck+ support (dials/encoders), advanced actions, visual overhaul

---

## Notes for Discussion

- **Token permission strategy**: Should we prompt users to add permissions as they enable features? Or require all upfront?
- **Classic token support**: Worth adding for notification access? Or stay fine-grained only?
- **GraphQL API**: GitHub's GraphQL API could enable Discussions, Projects V2 board status, and more efficient batched queries. Worth considering for v3.0?
- **Caching strategy**: As we add more actions, consider a shared cache layer to avoid redundant API calls across actions monitoring the same repo.
- **Rate limiting**: With more actions, rate limit management becomes critical. Consider a request queue/throttle system.
- **Multi-repo monitoring**: Several features could benefit from a "repo group" concept where users configure multiple repos and see aggregate data.
- **Topics stat type**: Deferred from v1.2.0 — needs UI design for displaying a list on a small button (marquee list? count only?).
