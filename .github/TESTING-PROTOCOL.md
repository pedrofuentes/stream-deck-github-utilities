# Testing Protocol

> Referenced from [AGENTS.md](../AGENTS.md). Load this file when preparing a release, running tests, or providing manual test flows.

Testing has **two mandatory phases** that MUST both complete before any release. The agent handles automated checks; the user performs real-life verification on hardware. **Neither phase can be skipped.**

## Phase 1: Automated Pre-Release Checks (Agent Responsibility)

Before asking the user for testing, the agent MUST complete ALL of these steps in order:

1. **Documentation & PI verification** — run the checklist from AGENTS.md Critical Rule #4. Compare PI HTML dropdowns, labels, and help text against source code types. Fix mismatches before proceeding.
2. **Run the full test suite** — `npm test` (all tests must pass, zero failures)
3. **Build the plugin** — `npm run build` (must succeed with no errors)
4. **Validate the manifest** — `streamdeck validate com.pedrofuentes.github-utilities.sdPlugin`
5. **Restart the plugin on the device** — `streamdeck restart com.pedrofuentes.github-utilities`
6. **Check Stream Deck logs** (optional) — inspect `com.pedrofuentes.github-utilities.sdPlugin/logs/` for runtime errors after restart

### Stream Deck CLI for Testing

The `streamdeck` CLI provides these testing-relevant commands:

| Command | Purpose | Automated? |
|---|---|---|
| `streamdeck validate <path>` | Validates manifest structure & schemas | ✅ Agent runs this |
| `streamdeck restart <uuid>` | Hot-reloads plugin on device (no manual restart needed) | ✅ Agent runs this |
| `streamdeck stop <uuid>` | Stops plugin (useful for debugging) | ✅ Agent can use |
| `streamdeck dev` | Enables developer mode for debugging | ✅ Agent can enable |
| `streamdeck pack <path>` | Packages `.streamDeckPlugin` artifact | ✅ Agent runs at release |

**What the CLI CANNOT do** (and why real-life testing is mandatory):
- No simulated button presses or key events
- No visual verification of button rendering on OLED hardware
- No screenshot capture from Stream Deck buttons
- No automated UI/integration testing
- No way to verify Property Inspector dropdowns or settings panels
- No way to verify URL-opening behavior on key press

The CLI is a pre-flight tool — it catches structural and build errors but **cannot replace human verification on hardware**.

## Phase 2: Manual Real-Life Testing (User Responsibility — MANDATORY)

**The agent MUST always ask the user to test on their physical Stream Deck before any release.** This is non-negotiable. The agent must:

1. **Provide a detailed manual test flow** (see format below) listing every test case with expected results
2. **Wait for explicit user confirmation** that testing passed before proceeding to merge/tag/release
3. **Never skip this step** — even for "small" changes, things can look different on OLED hardware

If the user reports issues during testing, the agent must fix them and restart from Phase 1.

## Manual Test Flow Format

**Every time the agent is about to ask the user to test**, it MUST provide a structured test flow using this format. The test flow should cover ALL new functionality and any areas that could be affected by the changes:

```markdown
## Manual Test Flow — v{version} ({summary})

### Prerequisites
- [ ] Plugin restarted via CLI (agent should have done this)
- [ ] Stream Deck device connected and visible

### Test Cases

#### {Feature/Fix Name}
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | {action to perform} | {what should happen} | ⬜ |
| 2 | {action to perform} | {what should happen} | ⬜ |

#### {Another Feature/Fix Name}
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | {action to perform} | {what should happen} | ⬜ |

### Regression Checks
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | {verify existing feature still works} | {expected behavior} | ⬜ |
```

The test flow must include:
- **All new features** with step-by-step verification
- **All bug fixes** with steps to verify the bug is resolved
- **Regression checks** for existing features that could be affected
- **Edge cases** worth checking on hardware (long text, missing data, error states)

## Manual Test Flow Style Guide

Follow these rules when writing test flows:

1. **Group test cases by feature/fix** — each gets its own `####` heading and table
2. **Steps are atomic** — one action per row, not "do A then B then check C"
3. **Expected results are specific** — say exactly what URL opens, what text appears, what accent color shows. Never "it works"
4. **Include the exact values** where possible — `https://github.com/{owner}/{repo}/pulls` not "the pulls page"
5. **Cover null/empty/edge cases** — "Select Language for a repo with no language → Shows N/A"
6. **Regression checks are mandatory** — always verify existing features still work after changes
7. **Prerequisites section** lists what should already be done (agent restart, device connected)
8. **Use ⬜ checkboxes** in the Pass column for the user to mentally track

## Example: Real Test Flow (v1.2.0)

This is a real test flow delivered for the v1.2.0 release. Future agents should match this level of detail and structure:

```markdown
## Manual Test Flow — v1.2.0 (Repo Stats Enhancements)

### Prerequisites
- [ ] Plugin restarted via CLI (agent should have done this)
- [ ] Stream Deck device connected and visible

### Test Cases

#### 1. Open URL on Key Press (Repo Stats)
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | Configure a Repo Stats button with **Stars** stat type | Button displays star count | ⬜ |
| 2 | **Press** the Stars button | Browser opens `https://github.com/{owner}/{repo}/stargazers` | ⬜ |
| 3 | Configure a Repo Stats button with **Open Issues** stat type | Button displays issue count | ⬜ |
| 4 | **Press** the Issues button | Browser opens `https://github.com/{owner}/{repo}/issues` | ⬜ |
| 5 | Configure a Repo Stats button with **Forks** | Button displays fork count | ⬜ |
| 6 | **Press** the Forks button | Browser opens `https://github.com/{owner}/{repo}/forks` | ⬜ |

#### 2. New Stat Types — Property Inspector Dropdown
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | Open Property Inspector for a Repo Stats action | Dropdown shows **10 options**: Stars, Open Issues, Forks, Watchers, Pull Requests, Language, Size, License, Default Branch, Visibility | ⬜ |
| 2 | Each option has an emoji prefix | ⭐ 🔵 🔀 👁️ 🟢 💻 📦 📜 🌿 🔒 | ⬜ |

#### 3. New Stat Types — Button Display
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | Select **Pull Requests** for a public repo with PRs | Shows open PR count as a number (e.g., "12") with green accent | ⬜ |
| 2 | Select **Language** for a repo with a language set | Shows language name (e.g., "TypeScript") with orange accent; text fits button | ⬜ |
| 3 | Select **Size** | Shows human-readable size (e.g., "4.2 MB") with gray accent | ⬜ |
| 4 | Select **License** for a repo with a license | Shows SPDX ID (e.g., "MIT", "Apache-2.0") with yellow accent | ⬜ |
| 5 | Select **Default Branch** | Shows branch name (e.g., "main") with blue accent | ⬜ |
| 6 | Select **Visibility** for a public repo | Shows "Public" with gray accent | ⬜ |
| 7 | Select **Visibility** for a private repo | Shows "Private" with gray accent | ⬜ |
| 8 | Select **Language** for a repo with no language | Shows "N/A" | ⬜ |
| 9 | Select **License** for a repo with no license | Shows "None" | ⬜ |

#### 4. New Stat Types — URL Opening
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | Press button set to **Pull Requests** | Opens `https://github.com/{owner}/{repo}/pulls` | ⬜ |
| 2 | Press button set to **Language** | Opens `https://github.com/{owner}/{repo}` (repo root) | ⬜ |
| 3 | Press button set to **Visibility** | Opens `https://github.com/{owner}/{repo}/settings` | ⬜ |

### Regression Checks
| # | Step | Expected Result | Pass? |
|---|------|----------------|-------|
| 1 | Verify existing **Stars** button still refreshes on interval | Count updates automatically | ⬜ |
| 2 | Verify **Workflow Status** action still works | Status displays correctly, press opens workflow URL | ⬜ |
| 3 | Remove/clear the token and verify error state | Buttons show appropriate error message | ⬜ |
| 4 | Re-add token and verify recovery | Buttons recover and display data again | ⬜ |
```

## Testing Rules Summary

| Rule | Details |
|---|---|
| Agent runs automated checks | Tests, build, validate, restart — every time |
| Agent provides manual test flow | Structured table with steps & expected results |
| User tests on real hardware | Physical Stream Deck, not just "looks good in code" |
| User must confirm before release | Explicit "all good" or issue report |
| Failures loop back to Phase 1 | Fix → re-test → re-validate → re-ask user |
| No exceptions for "small" changes | OLED rendering, button behavior, PI panels can all surprise |
