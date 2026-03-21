# P3 Long-Term Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the 5 remaining code review items (P3 tier) to eliminate unsafe type assertions, reduce settings duplication, improve testability, and add regression safety nets.

**Architecture:** Each task targets a specific layer. Settings composition (M4) and golden master tests depend on API validation (M3) being done first. Singleton removal (H10) and timer extraction are fully independent.

**Tech Stack:** TypeScript, Vitest (snapshot testing), Zod (new dependency for runtime validation)

---

## Dependency Graph

```
Phase 1 (parallel — independent):
  Task 1: Settings interface composition (M4)  ───┐
  Task 2: Remove singleton coordinator (H10)   ───┤
  Task 3: Extract timer management             ───┤
                                                   │
Phase 2 (depends on Phase 1 merge):               │
  Task 4: Runtime API response validation (M3) ───┤
                                                   │
Phase 3 (depends on Task 4):                       │
  Task 5: Golden master / snapshot tests       ────┘
```

---

## Task 1: Settings Interface Composition (M4)

**Files:**
- Modify: `src/types.ts:277-431`

**Step 1: Write the failing test**

Create `tests/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type {
	RepoStatsSettings,
	WorkflowStatusSettings,
	IssueCounterSettings,
	PullRequestCounterSettings,
	BranchNetworkSettings,
	FleetMonitorSettings,
	SecurityHealthSettings,
	DiscussionsMonitorSettings,
	ProjectsBoardSettings,
} from "../src/types.js";

describe("Settings interface composition", () => {
	it("all repo-scoped settings have repo and refreshInterval", () => {
		expectTypeOf<RepoStatsSettings>().toHaveProperty("repo");
		expectTypeOf<RepoStatsSettings>().toHaveProperty("refreshInterval");
		expectTypeOf<WorkflowStatusSettings>().toHaveProperty("repo");
		expectTypeOf<IssueCounterSettings>().toHaveProperty("repo");
		expectTypeOf<BranchNetworkSettings>().toHaveProperty("repo");
	});

	it("state-filtered settings share stateFilter type", () => {
		expectTypeOf<IssueCounterSettings["stateFilter"]>().toEqualTypeOf<PullRequestCounterSettings["stateFilter"]>();
	});

	it("minimal settings equal base settings", () => {
		expectTypeOf<BranchNetworkSettings>().toMatchTypeOf<FleetMonitorSettings>();
		expectTypeOf<SecurityHealthSettings>().toMatchTypeOf<DiscussionsMonitorSettings>();
		expectTypeOf<ProjectsBoardSettings>().toMatchTypeOf<FleetMonitorSettings>();
	});
});
```

**Step 2: Run test to verify it passes (type tests should pass with current interfaces)**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS (these are type-level assertions on existing interfaces)

**Step 3: Refactor settings interfaces**

In `src/types.ts`, replace the 13 settings interfaces with a composition hierarchy:

```typescript
/** Base settings shared by all repo-scoped actions. */
export interface RepoActionSettings {
	repo?: string;
	refreshInterval?: number;
	[key: string]: JsonValue;
}

/** Settings for actions with state filtering (open/closed/all). */
export interface StateFilteredSettings extends RepoActionSettings {
	stateFilter?: "open" | "closed" | "all";
}

/** Settings for actions with branch filtering. */
export interface BranchFilterSettings extends RepoActionSettings {
	branch?: string;
}

// Then each action-specific interface extends the appropriate base:
export interface RepoStatsSettings extends RepoActionSettings {
	statType?: StatType;
}

export interface WorkflowStatusSettings extends BranchFilterSettings {
	workflowFile?: string;
	environment?: string;
}

export interface PullRequestCounterSettings extends StateFilteredSettings {}
export interface IssueCounterSettings extends StateFilteredSettings {}

// Minimal actions just alias the base:
export type BranchNetworkSettings = RepoActionSettings;
export type FleetMonitorSettings = RepoActionSettings;
export type SecurityHealthSettings = RepoActionSettings;
export type DiscussionsMonitorSettings = RepoActionSettings;
export type ProjectsBoardSettings = RepoActionSettings;
```

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL tests pass (type aliases are backward compatible)

**Step 5: Run build**

Run: `npm run build`
Expected: Clean build

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: compose settings interfaces from shared bases

Replace 13 independent settings interfaces with composition hierarchy:
RepoActionSettings (base) → StateFilteredSettings, BranchFilterSettings.
Minimal-settings actions use type aliases. Eliminates ~100 lines of
field duplication while maintaining full backward compatibility.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Remove Singleton Coordinator (H10)

**Files:**
- Modify: `src/utils/graphql-query-coordinator.ts:407-408`
- Modify: `src/actions/base-github-action.ts:31,77`
- Modify: `src/utils/index.ts` (remove coordinator export)
- Modify: All 14 action files (remove direct coordinator imports)

**Step 1: Write the failing test**

Add to `tests/utils/graphql-query-coordinator.test.ts`:

```typescript
describe("coordinator instantiation", () => {
	it("GraphQLQueryCoordinator can be instantiated independently", () => {
		const cache = new RepoDataCache();
		const coord = new GraphQLQueryCoordinator(cache);
		expect(coord).toBeInstanceOf(GraphQLQueryCoordinator);
	});

	it("no module-level singleton export exists", async () => {
		const module = await import("../../src/utils/graphql-query-coordinator.js");
		expect(module).not.toHaveProperty("coordinator");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/graphql-query-coordinator.test.ts -t "no module-level singleton"`
Expected: FAIL — `coordinator` is currently exported

**Step 3: Move coordinator to BaseGitHubAction as static property**

In `src/actions/base-github-action.ts`:
```typescript
import { GraphQLQueryCoordinator } from "../utils/graphql-query-coordinator.js";
import { RepoDataCache } from "../utils/repo-data-cache.js";

export abstract class BaseGitHubAction<TSettings> extends SingletonAction<TSettings> {
	/** Shared coordinator instance for all actions. */
	protected static coordinator = new GraphQLQueryCoordinator(new RepoDataCache());
	// ...
}
```

In `src/utils/graphql-query-coordinator.ts`:
- Remove `export const coordinator = new GraphQLQueryCoordinator();`
- Keep the class export

In all 14 action files:
- Remove `import { coordinator } from "../utils/graphql-query-coordinator.js";`
- Replace `coordinator.` with `(this.constructor as typeof BaseGitHubAction).coordinator.` — OR simpler: add a `protected get coordinator()` getter in base class

Actually, simpler approach — add an instance getter in base:
```typescript
protected get coordinator(): GraphQLQueryCoordinator {
	return (this.constructor as typeof BaseGitHubAction).coordinator;
}
```
Then all `coordinator.method()` calls become `this.coordinator.method()`.

In `src/utils/index.ts`:
- Remove `coordinator` from exports

**Step 4: Run tests**

Run: `npm test`
Expected: ALL tests pass

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove singleton coordinator, use static class property

Move coordinator from module-level singleton to BaseGitHubAction static
property. Actions access via this.coordinator getter. Enables test
isolation by overriding the static property in test setup.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: Extract Timer Management (Testability)

**Files:**
- Create: `src/utils/render-debouncer.ts`
- Modify: `src/actions/branch-network.ts` (lines 57, 118, 152)
- Modify: `src/actions/contribution-heatmap.ts` (lines 44, 103-109)
- Modify: `src/actions/workflow-status.ts` (lines 282, 336-342)
- Create: `tests/utils/render-debouncer.test.ts`

**Step 1: Write the failing test**

Create `tests/utils/render-debouncer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RenderDebouncer } from "../../src/utils/render-debouncer.js";

describe("RenderDebouncer", () => {
	beforeEach(() => { vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it("debounces render calls", () => {
		const debouncer = new RenderDebouncer();
		const callback = vi.fn();
		debouncer.schedule("action1", callback, 16);
		debouncer.schedule("action1", callback, 16); // replaces first
		vi.advanceTimersByTime(16);
		expect(callback).toHaveBeenCalledTimes(1);
	});

	it("cleans up on dispose", () => {
		const debouncer = new RenderDebouncer();
		const callback = vi.fn();
		debouncer.schedule("action1", callback, 16);
		debouncer.cleanup("action1");
		vi.advanceTimersByTime(100);
		expect(callback).not.toHaveBeenCalled();
	});

	it("tracks separate actions independently", () => {
		const debouncer = new RenderDebouncer();
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		debouncer.schedule("a1", cb1, 16);
		debouncer.schedule("a2", cb2, 16);
		debouncer.cleanup("a1");
		vi.advanceTimersByTime(16);
		expect(cb1).not.toHaveBeenCalled();
		expect(cb2).toHaveBeenCalledTimes(1);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/render-debouncer.test.ts`
Expected: FAIL — module not found

**Step 3: Implement RenderDebouncer**

Create `src/utils/render-debouncer.ts`:

```typescript
/**
 * Manages debounced render callbacks per action ID.
 * Replaces inline setTimeout patterns in actions that need
 * render debouncing (e.g., dial rotation → re-render after short delay).
 */
export class RenderDebouncer {
	private timers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Schedule a render callback, cancelling any pending one for this action. */
	schedule(actionId: string, callback: () => void, delayMs: number): void {
		this.cleanup(actionId);
		this.timers.set(actionId, setTimeout(() => {
			this.timers.delete(actionId);
			callback();
		}, delayMs));
	}

	/** Cancel any pending render for this action. Call in onWillDisappear. */
	cleanup(actionId: string): void {
		const timer = this.timers.get(actionId);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(actionId);
		}
	}
}
```

Export from `src/utils/index.ts`.

**Step 4: Refactor action files**

Replace inline `renderTimeout` / setTimeout patterns in `branch-network.ts`, `contribution-heatmap.ts` with `RenderDebouncer` instances. The `workflow-status.ts` dispatch timeouts are already tracked via `dispatchTimeouts` Map (fixed in P0) — leave those as-is.

**Step 5: Run tests and commit**

Run: `npm test`
Expected: ALL tests pass

```bash
git add -A
git commit -m "refactor: extract RenderDebouncer utility for timer management

Replace inline renderTimeout setTimeout patterns in branch-network
and contribution-heatmap with shared RenderDebouncer class. Provides
schedule/cleanup API matching DebouncedUrlOpener pattern.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Runtime API Response Validation (M3)

**Files:**
- Add dependency: `npm install zod`
- Create: `src/utils/github-api/schemas.ts`
- Modify: `src/utils/github-api/repos.ts`, `pull-requests.ts`, `issues-releases.ts`, `workflows.ts`, `security-branches.ts`, `datasources.ts`
- Create: `tests/utils/github-api/schemas.test.ts`

**Step 1: Install Zod**

```bash
npm install zod
```

**Step 2: Write the failing test**

Create `tests/utils/github-api/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { RepoStatsSchema, WorkflowRunSchema, ReleaseSchema } from "../../../src/utils/github-api/schemas.js";

describe("API response schemas", () => {
	it("validates a correct repo stats response", () => {
		const data = { stargazers_count: 42, forks_count: 5, open_issues_count: 10, full_name: "owner/repo" };
		expect(() => RepoStatsSchema.parse(data)).not.toThrow();
	});

	it("rejects missing required fields", () => {
		expect(() => RepoStatsSchema.parse({})).toThrow();
	});

	it("provides defaults for optional fields", () => {
		const result = RepoStatsSchema.parse({ stargazers_count: 0, forks_count: 0, open_issues_count: 0, full_name: "a/b" });
		expect(result.language).toBeNull();
	});
});
```

**Step 3: Create Zod schemas**

Create `src/utils/github-api/schemas.ts` with schemas for the most critical response types:

- `RepoStatsSchema` — validates fetchRepoStats response
- `WorkflowRunSchema` — validates workflow run objects
- `WorkflowRunsResponseSchema` — validates the workflow_runs array response
- `ReleaseSchema` — validates release objects
- `PullRequestSearchSchema` — validates search API response
- `DeploymentSchema` — validates deployment objects
- `DependabotAlertSchema` — validates security alert objects
- `BranchComparisonSchema` — validates compare endpoint response

Each schema should use `.passthrough()` to allow extra fields from the API, and `.default()` for optional fields.

**Step 4: Apply schemas in API modules**

Replace `as Record<string, unknown>` casts with `Schema.parse(data)` calls. Start with the 10 most dangerous assertions (listed in the analysis). Use `.safeParse()` where you want graceful degradation instead of throwing.

**Step 5: Run tests and commit**

Run: `npm test && npm run build`

```bash
git add -A
git commit -m "feat: add Zod runtime validation for GitHub API responses

Add schemas.ts with Zod schemas for 8 critical API response types.
Replace unsafe 'as' type assertions with schema validation in API
modules. Provides runtime safety against GitHub API shape changes.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: Golden Master / Snapshot Tests (Regression Risk)

**Files:**
- Create: `tests/renderers/button-renderer.snapshot.test.ts`
- Create: `tests/renderers/touch-strip-renderer.snapshot.test.ts`
- Generated: `tests/renderers/__snapshots__/` (auto-created by Vitest)

**Step 1: Create button renderer snapshot tests**

Create `tests/renderers/button-renderer.snapshot.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
	renderStatImage, renderWorkflowImage, renderDeployingImage,
	renderLoadingImage, renderErrorImage, renderUnconfiguredImage,
	renderPRCountImage, renderIssueCountImage, renderReleaseImage,
	renderCommitActivityImage, renderDiscussionsImage,
	renderBranchComparisonImage,
} from "../../src/utils/button-renderer.js";

describe("Button renderer snapshots", () => {
	it("renderStatImage — stars", () => {
		expect(renderStatImage("42K", "stars", "facebook/react")).toMatchSnapshot();
	});

	it("renderStatImage — language", () => {
		expect(renderStatImage("TypeScript", "language", "microsoft/vscode")).toMatchSnapshot();
	});

	it("renderErrorImage — rate limited", () => {
		expect(renderErrorImage("Rate Limited")).toMatchSnapshot();
	});

	it("renderUnconfiguredImage", () => {
		expect(renderUnconfiguredImage()).toMatchSnapshot();
	});

	// ... one test per render function with representative data
});
```

**Step 2: Create touch strip renderer snapshot tests**

Similar pattern for all 10 touch strip render functions.

**Step 3: Generate snapshots**

Run: `npx vitest run tests/renderers/ --update`
This creates the `__snapshots__` directory with `.snap` files.

**Step 4: Verify snapshots detect changes**

Temporarily modify a color constant in button-renderer.ts, run tests, verify they FAIL, then revert.

**Step 5: Commit**

```bash
git add -A
git commit -m "test: add golden master snapshot tests for all renderers

Add snapshot tests for 18 button-renderer and 10 touch-strip-renderer
functions. Snapshots capture exact SVG output, detecting any
unintentional visual regressions from code changes.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Execution Notes

- **Tasks 1-3** are fully independent and can be dispatched in parallel
- **Task 4** (Zod validation) adds a runtime dependency — most impactful but also most invasive
- **Task 5** (snapshots) should run last since it captures the "known good" state after all other changes
- Total estimated: ~2,000-2,500 new/changed lines across 5 tasks
