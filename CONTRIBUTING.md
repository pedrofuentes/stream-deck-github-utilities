# Contributing to Stream Deck GitHub Utilities

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## Getting Started

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/stream-deck-github-utilities.git
cd stream-deck-github-utilities
```

### 2. Install Prerequisites

- **Node.js** >= 20: [Download](https://nodejs.org/)
- **Stream Deck CLI**: `npm install -g @elgato/cli`
- **Stream Deck Software** >= 6.9: [Download](https://www.elgato.com/s/downloads?product=Stream%20Deck)

### 3. Install Dependencies

```bash
npm install
```

### 4. Development Workflow

```bash
# Start the development watcher
npm run watch

# In a separate terminal, run tests in watch mode
npm run test:watch
```

## Development Guidelines

### Branch Naming

Use descriptive branch names:
- `feature/action-name` — for new features/actions
- `fix/issue-description` — for bug fixes
- `docs/description` — for documentation changes
- `test/description` — for test additions or changes
- `refactor/description` — for code refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat(actions): add repository star count action
fix(utils): handle null token in validation
test(utils): add edge cases for formatCount
docs(readme): update installation instructions
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `style`, `perf`, `ci`

### Code Style

- **TypeScript** is mandatory — no plain JavaScript in `src/`.
- Use **strict mode** — the tsconfig enforces it.
- Follow existing code patterns and naming conventions.
- Use **tabs** for indentation (matching the Stream Deck SDK convention).
- Always type function parameters and return values explicitly.

### Testing Requirements

**All code changes must include tests.** This is non-negotiable.

- Place test files alongside the code they test or in the `tests/` directory mirroring the `src/` structure.
- Test file naming: `*.test.ts` or `*.spec.ts`
- Write tests for:
  - **Happy path** — expected normal usage
  - **Edge cases** — boundary values, empty inputs, null/undefined
  - **Error cases** — invalid inputs, API failures, network errors
- Coverage thresholds (80% for branches, functions, lines, statements) are enforced.
- **All tests must pass before a PR can be merged.**

### Integration Tests

Cross-layer tests live in `tests/integration/`. These mock only `globalThis.fetch` and let real coordinator, extractors, renderers, and strategies run. Add integration tests when:
- Adding new data fragments (verify extraction → cache → result flow)
- Changing API response handling (verify schema → transformation → rendering)

### Snapshot Tests

SVG renderer output is captured as golden master snapshots in `tests/renderers/`. After changing any render function, run `npx vitest run tests/renderers/ --update` to regenerate snapshots, then review the diff.

Run tests:
```bash
npm test                # Run all tests once
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Adding a New Action

Follow these steps and refer to the existing **Repo Stats** and **Workflow Status** actions as references.

> **Note:** All actions now use the GraphQL Query Coordinator for data fetching. New actions should integrate with the coordinator rather than making direct REST API calls. The coordinator batches queries across actions sharing the same repository, reducing API calls and improving cache efficiency.

1. **Define settings** in `src/types.ts` — must include `[key: string]: JsonValue` index signature
2. **Create action class** in `src/actions/your-action.ts`:
   - Use `@action({ UUID: "com.pedrofuentes.github-utilities.your-action" })` decorator
   - Extend `BaseGitHubAction<YourSettings>` (from `./base-github-action.js`) — provides polling, URL debouncing, error handling, PI data requests, and cleanup
   - Implement `onWillAppear`, `onKeyDown`, `onDidReceiveSettings`
   - Override `onWillDisappear` — call `await super.onWillDisappear(ev)` then clean up action-specific state
   - For double-click: use `this.urlOpener.handlePress()` + `this.urlOpener.scheduleOpen()` (inherited from base)
3. **Integrate with GraphQL Coordinator** (for actions that query GitHub data):
   - Import `coordinator` from `src/utils/graphql-query-coordinator`
   - Subscribe in `onWillAppear` with the data fragments your action needs
   - Unsubscribe is handled by `BaseGitHubAction.onWillDisappear()`
   - Fetch data via `coordinator.fetchData()` instead of direct REST API calls
   - For force-refresh (double-click), use `coordinator.invalidateAndFetch()`
   - Add a new `FragmentStrategy` in `src/utils/fragment-strategies.ts` if your action needs new data
   - Register the strategy in the `fragmentRegistry` Map
   - See `src/actions/discussions-monitor.ts` or `src/actions/projects-board.ts` for examples
4. **Register** in `src/plugin.ts`
5. **Add manifest entry** in `plugin/manifest.json`
6. **Create Property Inspector** in `plugin/ui/` using `sdpi-components.js`
7. **Create icons** in `plugin/imgs/actions/your-action/` (icon.svg 20x20, key.svg 144x144)
8. **Use button renderer** from `src/utils/button-renderer.ts` for button SVGs
9. **Write tests** in `tests/actions/your-action.test.ts` — mock SDK with `vi.hoisted()` + `vi.mock()`
10. **Update README** features section and roadmap

### Adding Utility Functions

1. Add the function to the appropriate file in `src/utils/`
2. Export it from `src/utils/index.ts`
3. Write tests covering all code paths and edge cases
4. Document the function with JSDoc comments
5. For new API functions that call GitHub endpoints, add a Zod schema in `src/utils/github-api/schemas.ts` and use `.parse()` instead of `as` type assertions on API responses.

### Architecture: GraphQL Query Coordinator

The plugin uses a **GraphQL Query Coordinator** layer between actions and the GitHub API. Instead of each action making independent REST/GraphQL calls, all 14 actions subscribe to the coordinator with the data fragments they need. The coordinator:

- **Batches queries** — combines fragments from multiple actions into a single GraphQL request per repository
- **Caches per-repo** — `repo-data-cache.ts` tracks field-level staleness so only stale fields are re-fetched
- **Builds queries dynamically** — `graphql-query-builder.ts` composes the minimal GraphQL query for requested fields
- **Dispatches via strategies** — `fragment-strategies.ts` encapsulates each fragment's extraction, REST fallback, and result assignment
- **Retries transient failures** — `fetchWithRetry()` in `github-api/core.ts` retries 429/502/503/504 with exponential backoff

Key files:
- `src/utils/graphql-query-coordinator.ts` — singleton coordinator (subscribe, fetch, invalidate)
- `src/utils/fragment-strategies.ts` — strategy pattern with 12 fragment strategies
- `src/utils/graphql-query-builder.ts` — dynamic query composition
- `src/utils/repo-data-cache.ts` — per-repo cache with field-level TTL
- `src/utils/data-fragments.ts` — GraphQL→REST interface extractors
- `src/utils/github-api/` — domain-split API modules (core, repos, PRs, issues, workflows, security, datasources)

## Pull Request Process

### Before Submitting

1. **Run the full test suite:** `npm test`
2. **Run linting:** `npm run lint`
3. **Build successfully:** `npm run build`
4. **Validate the plugin:** `npm run validate`
5. **Update documentation** if your changes affect the public API or user experience.

### PR Checklist

- [ ] Tests added/updated for all changes
- [ ] All tests pass (`npm test`)
- [ ] Code lints cleanly (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Plugin validates (`npm run validate`)
- [ ] Documentation updated (README, JSDoc, etc.)
- [ ] Commit messages follow conventional commit format
- [ ] Branch is up-to-date with `main`

### Review Process

1. Submit your PR against the `main` branch.
2. Provide a clear description of what your PR does and why.
3. Link any related issues.
4. A maintainer will review your PR and may request changes.
5. Once approved, a maintainer will merge your PR.

## Packaging & Releases

Release packages are created using the Stream Deck CLI:

```bash
npm run pack
```

This command will:
1. Build the TypeScript source
2. Run the full test suite (all tests must pass)
3. Validate the plugin manifest
4. Create a `.streamDeckPlugin` file in the `release/` directory

**Only maintainers create release packages.** Contributors should focus on code changes and tests.

## Reporting Issues

- Use [GitHub Issues](https://github.com/pedrofuentes/stream-deck-github-utilities/issues) to report bugs or request features.
- Include steps to reproduce for bugs.
- Include your Stream Deck software version and OS version.

## Questions?

Open a [discussion](https://github.com/pedrofuentes/stream-deck-github-utilities/discussions) or reach out via the [Marketplace Makers Discord](https://discord.gg/GehBUcu627).
