# Architecture Decision Records — Stream Deck GitHub Utilities

> **Record every significant technical decision here.** When choosing between approaches,
> document what was chosen and why. This prevents future agents and developers from
> re-debating settled decisions or accidentally reversing them.
>
> Do NOT write decisions to AGENTS.md — they belong here.

## Format

```markdown
### ADR-NNN: Decision Title
**Date**: YYYY-MM-DD
**Status**: Proposed / Accepted / Superseded by ADR-NNN
**Context**: What problem or question prompted this decision?
**Decision**: What was decided?
**Alternatives considered**: What other options were evaluated?
**Consequences**: What are the trade-offs? What does this enable or prevent?
```

## Decisions

<!-- Add new decisions below this line, most recent first -->

### ADR-004: Adopt the agents-template workflow (worktrees + TDD + Sentinel)
**Date**: 2026-06-16
**Status**: Accepted
**Context**: The project needed a stronger, mechanically-enforced quality gate than the prior simple GitHub Flow.
**Decision**: Migrate to `agents-template` v0.16.0 — git worktrees per task, strict test-first commit choreography, and a mandatory Sentinel review sub-agent (Method A) before every merge. Branch protection on `main` is light (block force-push/deletion only) to keep solo self-merges unblocked.
**Alternatives considered**: Keep GitHub Flow; hybrid (Sentinel without worktrees); full CI-enforced Sentinel (Method B — deferred, no CI yet).
**Consequences**: Higher process rigor and review coverage; the Stream Deck-specific **physical-device test gate** is preserved as HUMAN REQUIRED and the **no-auto-push** policy is preserved as ASK FIRST, since Sentinel cannot verify on-hardware runtime behavior.

### ADR-003: Validate GitHub API responses with Zod
**Date**: 2026-06-16
**Status**: Accepted
**Context**: GitHub REST/GraphQL payloads vary by endpoint and permission level; unchecked shape assumptions caused brittle rendering.
**Decision**: Define Zod schemas in `src/utils/github-api/schemas.ts` and validate responses at the API boundary.
**Alternatives considered**: Hand-written type guards; trusting `as` casts.
**Consequences**: Runtime safety and clearer error labels; a small validation overhead and schema-maintenance cost per endpoint.

### ADR-002: Encode button SVGs with `encodeURIComponent` and avoid nested `<svg>`
**Date**: 2026-06-16
**Status**: Accepted
**Context**: Buttons rendered blank on physical Stream Deck hardware with base64/`charset` data URIs and with nested `<svg>` elements.
**Decision**: Always use `"data:image/svg+xml," + encodeURIComponent(svg)` and compose icons with `<g transform>` instead of nested `<svg>`.
**Alternatives considered**: base64 data URIs; nested `<svg>` for icon placement.
**Consequences**: Reliable on-device rendering; rendering code must position/scale icon paths via transforms. (See `.github/UI-DESIGN-GUIDE.md`.)

### ADR-001: Share action behavior via a `BaseGitHubAction` abstract base
**Date**: 2026-06-16
**Status**: Accepted
**Context**: 15 actions duplicated polling, double-click URL handling, error display, and cleanup.
**Decision**: Centralize that behavior in `src/actions/base-github-action.ts`; every action extends `BaseGitHubAction<TSettings>`.
**Alternatives considered**: Per-action duplication; mixins/composition helpers.
**Consequences**: Consistent lifecycle and far less duplication; actions must call `super.onWillDisappear(ev)` before action-specific cleanup.
