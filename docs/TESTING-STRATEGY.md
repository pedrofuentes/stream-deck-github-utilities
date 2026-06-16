# Testing Strategy

> Extended testing context for AI agents. Referenced from AGENTS.md.
> **The TDD mandate (tests before implementation) is enforced in AGENTS.md and verified by Sentinel.**
> This document covers the details of HOW to test.

---

## Test Types

| Type | Purpose | Location | Runner |
|------|---------|----------|--------|
| Unit | Action lifecycle, pure functions, formatting, renderers | `tests/actions/`, `tests/utils/`, `tests/renderers/` (`*.test.ts`) | Vitest |
| Integration | Cross-layer flows (API → render, polling) | `tests/integration/` | Vitest |
| Manual device | Runtime behavior, button display, PI rendering on hardware | physical Stream Deck (see `.github/TESTING-PROTOCOL.md`) | Manual (no automated E2E) |

## Coverage Requirements

- **New code**: 80% diff coverage required (lines added/modified in the PR)
- **Project-wide coverage**: must never decrease from the previous merge baseline
- **Critical paths**: 100% coverage required (GitHub token handling, API error & rate-limit paths)
- **Run coverage**: `npm run test:coverage` (Vitest v8; thresholds 80% branches/functions/lines/statements in `vitest.config.ts`)
- **Sentinel verifies coverage thresholds on every PR**

## Test-Only PRs

PRs that only add tests to existing (untested) code use commit type `test(scope)` and are exempt from test-first choreography ordering (there is no `feat`/`fix` to follow). Sentinel verifies the tests are meaningful and pass.

## Testing Patterns

### Mocking
Mock the `@elgato/streamdeck` SDK and the global `fetch` with Vitest. Use `vi.hoisted()` to declare mock functions that the `vi.mock()` factory closes over (factories are hoisted above imports), so the action sees mocks at module-evaluation time. Drive `fetch` per-test to simulate GitHub responses and error codes (401/403/404/429).

```typescript
// tests/actions/repo-stats.test.ts — mock the SDK BEFORE importing the action
const { mockGetGlobalSettings, mockRegisterAction, mockLoggerError } = vi.hoisted(() => ({
	mockGetGlobalSettings: vi.fn(),
	mockRegisterAction: vi.fn(),
	mockLoggerError: vi.fn(),
}));

vi.mock("@elgato/streamdeck", () => {
	class MockSingletonAction {}            // the @action decorator extends this
	return {
		action: () => (target: unknown) => target,
		SingletonAction: MockSingletonAction,
		default: {
			settings: { getGlobalSettings: mockGetGlobalSettings },
			logger: { error: mockLoggerError },
			actions: { registerAction: mockRegisterAction },
		},
	};
});

// Then drive fetch per-test:
globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ stargazers_count: 42 }) });
```

### Test Naming Convention
```
describe("RepoStatsAction", () => {
  it("should render an error button when the GitHub token is missing", () => {
    // Arrange → Act → Assert
  });
});
```

### What Must Be Tested
- All public API functions
- Error paths and edge cases (not just happy paths)
- State transitions
- Input validation and boundary conditions

### What Should NOT Be Tested
- Framework internals
- Third-party library behavior
- Implementation details (test behavior, not structure)

## CI Integration

- No CI yet — run `npm test` locally; the Sentinel review sub-agent verifies the full suite on the reviewed SHA before merge
- All tests must pass before Sentinel review begins
- Flaky tests must be fixed immediately, not skipped
