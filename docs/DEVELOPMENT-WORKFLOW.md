# Development Workflow

> Extended workflow context for AI agents. Referenced from AGENTS.md.
> **The MUST rules (TDD, branching, worktrees, incremental development, Sentinel) are enforced in AGENTS.md.**
> This document covers the detailed HOW.

---

## Git Worktrees for Isolation

Every increment MUST use a git worktree for isolation:

```bash
# Fetch latest main, create worktree with new branch
git fetch origin main
git worktree add .worktrees/feature-name -b feature/feature-name main

# Change into the worktree
cd .worktrees/feature-name

# If worktree already exists (retry/recovery), just cd into it
# git worktree list  # check existing worktrees

# List active worktrees
git worktree list

# Remove a worktree when done (after merge — cd back to main worktree first)
cd <main-worktree-root>
git worktree remove .worktrees/feature-name
git branch -D feature/feature-name
```

### Why Worktrees Are Required
- Prevents interference between parallel work
- Each agent/increment has a clean working directory
- No risk of uncommitted changes from one task affecting another
- Easy cleanup after merge

## Branching Details

### Branch Lifecycle
1. Fetch latest: `git fetch origin main`
2. Create worktree + branch from `main`: `git worktree add .worktrees/name -b feature/name main && cd .worktrees/name`
3. TDD: write failing tests, implement, refactor
4. Commit following the format in AGENTS.md
5. Push branch: `git push -u origin feature/name`
6. Open PR: `gh pr create` or via GitHub UI
7. Invoke Sentinel for review
8. Address any Sentinel feedback, re-submit
9. On Sentinel approval, merge to `main`
10. Cleanup: `cd <main-root> && git worktree remove .worktrees/name && git branch -D feature/name`

### Branch Naming Convention
| Prefix | Use For |
|--------|---------|
| `feature/` | New features |
| `fix/` | Bug fixes |
| `refactor/` | Code refactoring |
| `docs/` | Documentation changes |
| `test/` | Test additions or fixes |
| `chore/` | Build, CI, dependency updates |

## Pull Request Process

### Before Opening a PR
1. All tests pass in the worktree
2. Linting passes
3. Commit messages follow the format
4. PR represents a single logical unit

### PR Title Format
`type(scope): Short description`

### Sentinel Review
→ See [`docs/SENTINEL.md`](./SENTINEL.md) for the full process and invocation methods.

### After Merge
```bash
cd <main-worktree-root>
git worktree remove .worktrees/feature-name
git branch -D feature/name
git pull origin main
```
- Start next increment from the plan
- If other worktrees are in progress, rebase them: `cd .worktrees/other && git fetch origin main && git rebase origin/main`

## Sub-Agent Delegation

### When to Delegate
- Complex research that requires deep analysis
- Documentation generation
- Test data creation or fixture generation
- Performance profiling and optimization analysis
- Security vulnerability assessment

### How to Delegate
- Provide the sub-agent with full context (requirements, constraints, relevant code)
- Each sub-agent works in its own context
- Integrate sub-agent output back into the main work
- All sub-agent output must follow AGENTS.md rules

## Environment Setup

**Prerequisites**: Node.js 20+, npm, the [Elgato Stream Deck app](https://www.elgato.com/stream-deck), and the Stream Deck CLI (`npm i -g @elgato/cli`).

**First-time setup**
```bash
npm install
npm run build
streamdeck link release/com.pedrofuentes.github-utilities.sdPlugin
streamdeck restart com.pedrofuentes.github-utilities
```

**Iterate**: `npm run watch` rebuilds and restarts the plugin on change.

**Full deploy sequence after a build** (the symlink can go stale after major changes — just restarting is not enough):
```bash
npm run build && streamdeck link release/com.pedrofuentes.github-utilities.sdPlugin && streamdeck restart com.pedrofuentes.github-utilities
```

**Validate & package**:
```bash
npm run validate                                                          # streamdeck validate (manifest schema + load)
streamdeck pack release/com.pedrofuentes.github-utilities.sdPlugin --force --output .
```

**GitHub token**: actions read a global token from the plugin's Property Inspector (a PAT with `repo` scope). There is no `.env` — the token lives in Stream Deck global settings. Never log it in plaintext (use `maskToken()`).

**Release & marketplace**: follow the Release Process in [`.github/TESTING-PROTOCOL.md`](../.github/TESTING-PROTOCOL.md) and [`content/CONTENT-GUIDE.md`](../content/CONTENT-GUIDE.md). ⚠️ Never package or publish a release without the user confirming a successful test on **physical Stream Deck hardware** (HUMAN REQUIRED).
