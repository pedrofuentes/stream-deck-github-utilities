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

Run tests:
```bash
npm test                # Run all tests once
npm run test:watch      # Watch mode
npm run test:coverage   # With coverage report
```

### Adding a New Action

Follow these steps and refer to the existing **Repo Stats** and **Workflow Status** actions as references:

1. **Define settings** in `src/types.ts` — must include `[key: string]: JsonValue` index signature
2. **Create action class** in `src/actions/your-action.ts`:
   - Use `@action({ UUID: "com.pedrofuentes.github-utilities.your-action" })` decorator
   - Extend `SingletonAction<YourSettings>`
   - Handle `onWillAppear`, `onWillDisappear`, `onKeyDown`, `onDidReceiveSettings`
   - For polling: use `Map<string, Timer>` keyed by `ev.action.id`
3. **Register** in `src/plugin.ts`
4. **Add manifest entry** in `com.pedrofuentes.github-utilities.sdPlugin/manifest.json`
5. **Create Property Inspector** in `com.pedrofuentes.github-utilities.sdPlugin/ui/` using `sdpi-components.js`
6. **Create icons** in `com.pedrofuentes.github-utilities.sdPlugin/imgs/actions/your-action/` (icon.svg 20x20, key.svg 144x144)
7. **Use button renderer** from `src/utils/button-renderer.ts` for button SVGs
8. **Write tests** in `tests/actions/your-action.test.ts` — mock SDK with `vi.hoisted()` + `vi.mock()`
9. **Update README** features section and roadmap

### Adding Utility Functions

1. Add the function to the appropriate file in `src/utils/`
2. Export it from `src/utils/index.ts`
3. Write tests covering all code paths and edge cases
4. Document the function with JSDoc comments

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
4. Create a `.streamDeckPlugin` file in the `dist/` directory

**Only maintainers create release packages.** Contributors should focus on code changes and tests.

## Reporting Issues

- Use [GitHub Issues](https://github.com/pedrofuentes/stream-deck-github-utilities/issues) to report bugs or request features.
- Include steps to reproduce for bugs.
- Include your Stream Deck software version and OS version.

## Questions?

Open a [discussion](https://github.com/pedrofuentes/stream-deck-github-utilities/discussions) or reach out via the [Marketplace Makers Discord](https://discord.gg/GehBUcu627).
