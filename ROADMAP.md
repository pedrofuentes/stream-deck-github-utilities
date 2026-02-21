# GitHub Utilities for Stream Deck — Roadmap

> **Version**: v1.1.0 (current)
> **Last Updated**: $(date)
> **Status**: Draft for review and discussion

---

## Table of Contents

- [Current State](#current-state)
- [Phase 1 — Quick Wins & Improvements](#phase-1--quick-wins--improvements)
- [Phase 2 — New Actions (High Value)](#phase-2--new-actions-high-value)
- [Phase 3 — Advanced Actions](#phase-3--advanced-actions)
- [Phase 4 — Stream Deck+ & Polish](#phase-4--stream-deck--polish)
- [Phase 5 — Future / Stretch Goals](#phase-5--future--stretch-goals)
- [Token Permissions Reference](#token-permissions-reference)
- [API Endpoints Reference](#api-endpoints-reference)
- [Stream Deck SDK Features Reference](#stream-deck-sdk-features-reference)

---

## Current State

### Existing Actions (v1.1.0)

| Action | Description | API Endpoints Used |
|--------|-------------|-------------------|
| **Repo Stats** | Displays stars, issues, forks, or watchers count | `GET /repos/{owner}/{repo}` |
| **Workflow Status** | Shows latest workflow run status with deployment info; opens URL on press | `GET /repos/{owner}/{repo}/actions/runs`, `GET /repos/{owner}/{repo}/deployments`, `GET /repos/{owner}/{repo}/deployments/{id}/statuses` |

### Existing Infrastructure

- GitHub REST API client (`github-api.ts`, 770 lines) with error handling, rate limit parsing
- SVG-based icon rendering (`button-renderer.ts`) with dynamic status colors
- Property Inspector with data source APIs for repo, workflow, branch, environment dropdowns
- Global settings for GitHub token, per-action settings for configuration
- 265 tests across 9 test files

---

## Phase 1 — Quick Wins & Improvements

Low-effort, high-impact improvements to existing actions.

### 1.1 Repo Stats: Open URL on Press
**Effort**: Small | **Priority**: High

Currently Repo Stats refreshes on press. Add URL opening like Workflow Status.

- **Stars** → `https://github.com/{owner}/{repo}/stargazers`
- **Issues** → `https://github.com/{owner}/{repo}/issues`
- **Forks** → `https://github.com/{owner}/{repo}/network/members`
- **Watchers** → `https://github.com/{owner}/{repo}/watchers`

**API**: No new endpoints needed.
**Token**: No additional permissions.

### 1.2 Repo Stats: Additional Stat Types
**Effort**: Small | **Priority**: Medium

The repo API already returns many more fields we can expose:

| New Stat Type | API Field | Description |
|--------------|-----------|-------------|
| Pull Requests | `GET /repos/{owner}/{repo}/pulls` | Open PR count |
| Language | `language` field on repo | Primary language |
| Size | `size` field on repo | Repo size in KB |
| License | `license.spdx_id` on repo | License type |
| Default Branch | `default_branch` on repo | Branch name |
| Visibility | `private`/`visibility` on repo | Public/Private |
| Topics | `topics` on repo | List of topics |

**Token**: `Pull requests: Read` for PR count. Others already available via `Metadata: Read`.

### 1.3 Workflow Status: Show Run Duration
**Effort**: Small | **Priority**: Low

Display run duration on the button (e.g., "2m 34s") using `run_started_at` and `updated_at` from the runs API response.

**API**: Already available in current response.
**Token**: No additional permissions.

### 1.4 Error State Improvements
**Effort**: Small | **Priority**: Medium

- Show rate limit remaining count when approaching the limit
- Display time until rate limit reset
- Distinct visual for auth errors vs network errors vs rate limit
- Use `showAlert()` for transient errors

### 1.5 Long Press vs Short Press
**Effort**: Medium | **Priority**: Medium

Differentiate between short press and long press:
- **Short press** → Open URL in browser
- **Long press** → Force refresh data

Can be implemented by tracking `onKeyDown` / `onKeyUp` timing.

---

## Phase 2 — New Actions (High Value)

New Stream Deck buttons that provide the most daily utility.

### 2.1 Pull Request Counter
**Effort**: Medium | **Priority**: High

Display open PR count for a repo (or filtered by state). Press to open PRs page.

**Display**: Count + PR icon, color-coded (green = 0 open, yellow = few, red = many)

**Configuration**:
- Repository selection
- State filter: `open` | `closed` | `all`
- Optional: filter by label, author, or base branch
- Refresh interval

**API**: `GET /repos/{owner}/{repo}/pulls?state=open&per_page=1` (use response headers for total count, or `per_page=100` and count)
**Token**: `Pull requests: Read`
**URL on press**: `https://github.com/{owner}/{repo}/pulls`

### 2.2 Issue Counter
**Effort**: Medium | **Priority**: High

Display open issue count for a repo. Press to open issues page.

**Display**: Count + issue icon, color-coded by severity/count

**Configuration**:
- Repository selection
- State filter: `open` | `closed` | `all`
- Optional: filter by label, assignee, milestone
- Refresh interval

**API**: `GET /repos/{owner}/{repo}/issues?state=open` (note: this also returns PRs, need to filter or use the repo's `open_issues_count` field)
**Token**: `Issues: Read`
**URL on press**: `https://github.com/{owner}/{repo}/issues`

### 2.3 Release Monitor
**Effort**: Medium | **Priority**: High

Show the latest release version/tag for a repo. Useful for monitoring dependencies or your own projects.

**Display**: Version tag (e.g., "v2.3.1"), release name, published date, pre-release indicator

**Configuration**:
- Repository selection
- Include pre-releases toggle
- Refresh interval

**API**:
- `GET /repos/{owner}/{repo}/releases/latest` — latest stable release
- `GET /repos/{owner}/{repo}/releases?per_page=1` — latest release including pre-releases

**Token**: `Contents: Read` (releases are under Contents permission)
**URL on press**: Release HTML URL (`html_url` from response)

### 2.4 Commit Activity
**Effort**: Medium | **Priority**: Medium

Show recent commit count (last 24h, 7d, or 30d).

**Display**: Commit count + trend indicator, optionally on a specific branch

**Configuration**:
- Repository selection
- Time range: 24h / 7d / 30d
- Optional: branch filter
- Refresh interval

**API**:
- `GET /repos/{owner}/{repo}/stats/commit_activity` — weekly commit count (last year)
- `GET /repos/{owner}/{repo}/stats/participation` — weekly commit count (owner vs all)
- `GET /repos/{owner}/{repo}/commits?since={date}&per_page=1` — count via pagination headers

**Token**: `Metadata: Read` (stats endpoints) or `Contents: Read` (commits list)
**URL on press**: `https://github.com/{owner}/{repo}/commits`

### 2.5 Branch Comparison / Ahead-Behind
**Effort**: Medium | **Priority**: Medium

Show how many commits a branch is ahead/behind another branch (e.g., `develop` vs `main`).

**Display**: "↑3 ↓1" format showing ahead/behind counts

**Configuration**:
- Repository selection
- Base branch (e.g., `main`)
- Head branch (e.g., `develop`)
- Refresh interval

**API**: `GET /repos/{owner}/{repo}/compare/{base}...{head}` — returns `ahead_by`, `behind_by`
**Token**: `Contents: Read`
**URL on press**: `https://github.com/{owner}/{repo}/compare/{base}...{head}`

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

### 4.6 Visual Polish
**Effort**: Medium | **Priority**: Medium

- Animated loading states (spinner SVG)
- Smooth transitions between states
- Consistent color palette across all actions
- Dark/light theme support
- Better typography in SVG rendering

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
| Metadata | Read | Repo Stats (stars, forks, watchers, language, tags, topics, contributors, stats) |
| Actions | Read | Workflow Status (runs, workflows, environments) |
| Deployments | Read | Workflow Status (deployments, deployment statuses) |

### New Permissions Needed by Phase

| Permission | Level | Required For |
|-----------|-------|-------------|
| Pull requests | Read | PR Counter (2.1), PR Review Status (5.4), Repo Stats PR count (1.2) |
| Issues | Read | Issue Counter (2.2), Milestone Progress (3.7) |
| Contents | Read | Release Monitor (2.3), Commit Activity (2.4), Branch Comparison (2.5) |
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
- `onKeyDown` — Button press handling
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

| Feature | Effort | Impact | Priority | Phase |
|---------|--------|--------|----------|-------|
| Repo Stats: Open URL | Small | High | **P0** | 1 |
| PR Counter | Medium | High | **P0** | 2 |
| Issue Counter | Medium | High | **P0** | 2 |
| Release Monitor | Medium | High | **P1** | 2 |
| Long Press vs Short Press | Medium | Medium | **P1** | 1 |
| Repo Stats: Additional Types | Small | Medium | **P1** | 1 |
| Commit Activity | Medium | Medium | **P1** | 2 |
| Branch Comparison | Medium | Medium | **P2** | 2 |
| Encoder/Dial for Repo Stats | Medium | Medium | **P2** | 4 |
| Encoder/Dial for Workflow | Medium | Medium | **P2** | 4 |
| Dependabot Alerts | Medium | Medium | **P2** | 3 |
| Code Scanning Alerts | Medium | Medium | **P2** | 3 |
| Repository Traffic | Medium | Medium | **P2** | 3 |
| Security Dashboard | Large | Medium | **P2** | 3 |
| Visual Polish | Medium | Medium | **P2** | 4 |
| Workflow Dispatch | Large | Medium | **P3** | 5 |
| Milestone Progress | Medium | Low | **P3** | 3 |
| GitHub Pages Status | Medium | Low | **P3** | 3 |
| Bundled Profiles | Small | Low | **P3** | 4 |
| PR Review Status | Large | Medium | **P3** | 5 |
| Organization Dashboard | Large | Low | **P4** | 5 |
| Notifications (classic token) | Large | Medium | **P4** | 5 |

---

## Suggested Next Steps

1. **v1.2.0**: Implement Phase 1 quick wins (Repo Stats URL + additional stat types + long press)
2. **v1.3.0**: PR Counter + Issue Counter actions (most universally useful new actions)
3. **v1.4.0**: Release Monitor + Commit Activity
4. **v2.0.0**: Stream Deck+ support (dials/encoders), security actions, visual overhaul

---

## Notes for Discussion

- **Token permission strategy**: Should we prompt users to add permissions as they enable features? Or require all upfront?
- **Classic token support**: Worth adding for notification access? Or stay fine-grained only?
- **GraphQL API**: GitHub's GraphQL API could enable Discussions, Projects V2 board status, and more efficient batched queries. Worth considering for v3.0?
- **Caching strategy**: As we add more actions, consider a shared cache layer to avoid redundant API calls across actions monitoring the same repo.
- **Rate limiting**: With more actions, rate limit management becomes critical. Consider a request queue/throttle system.
- **Multi-repo monitoring**: Several features could benefit from a "repo group" concept where users configure multiple repos and see aggregate data.
