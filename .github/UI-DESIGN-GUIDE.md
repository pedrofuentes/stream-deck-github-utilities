# UI & Design Guidelines

> Referenced from [AGENTS.md](../AGENTS.md). Load this file when designing buttons, Property Inspector panels, or any visual element.

These guidelines cover both **Stream Deck button design** (SVG on OLED hardware) and **Property Inspector / Settings** design (HTML panels in the Stream Deck desktop app). They are based on **real implementation experience** — every rule below was learned by building, testing on hardware, and iterating.

## Design Thinking Process

Before designing any UI element, follow this process:

1. **Understand the purpose** — What information must the user get at a glance? For buttons: status, number, label. For settings: configuration + feedback.
2. **Pick a bold aesthetic direction** — Don't default to generic. GitHub's dark theme is our foundation — lean into it with confidence.
3. **Consider constraints** — Stream Deck keys are physically 72×72 pixels (rendered at 144×144). OLED displays are _tiny_. Every pixel counts.
4. **Find differentiation** — What makes this recognizable vs. other plugins? Strong use of accent colors, clean iconography, and information density.

---

## Stream Deck Button Design (SVG, 144×144 → 72×72 OLED)

### Key Constraints
- **Canvas size**: 144×144 SVG viewport, rendered on 72×72 physical OLED pixels
- **Viewing distance**: ~60cm (arm's length) — must be readable at a glance
- **OLED characteristics**: True black (`#000000`) is off/unlit; high contrast is free; glow/bloom effects look stunning
- **Animation**: SVG `<animate>` and `<animateTransform>` are supported for loading/progress indicators

### SVG Encoding — THE ONLY METHOD THAT WORKS

```typescript
// ✅ CORRECT — this is the ONLY encoding that renders on Stream Deck hardware:
ev.action.setImage("data:image/svg+xml," + encodeURIComponent(svg));

// ❌ BROKEN — base64 does NOT render on hardware:
ev.action.setImage("data:image/svg+xml;base64," + btoa(svg));

// ❌ BROKEN — charset parameter breaks rendering:
ev.action.setImage("data:image/svg+xml;charset=utf8," + encodeURIComponent(svg));
```

This was discovered through extensive hardware testing. The `encodeURIComponent` method is the only one that works reliably across all Stream Deck models. Always clear the title when using SVG images: `ev.action.setTitle("")`.

### SVG Rendering Limitations on Stream Deck

These were all discovered during development and cause silent rendering failures:

| Feature | Works? | Notes |
|---|---|---|
| Nested `<svg>` elements | ❌ | Stream Deck's SVG renderer does not support them |
| `<g transform="translate() scale()">` | ✅ | Use this instead of nested SVGs for positioning icons |
| `<animate>` (opacity, etc.) | ✅ | Works for loading dots, pulse effects |
| `<animateTransform type="rotate">` | ✅ | Works for spinning progress indicators |
| SVG `<text>` elements | ✅ | Renders correctly with system fonts |
| CSS `@keyframes` in SVG | ❌ | Not supported — use SVG `<animate>` elements |
| `<foreignObject>` | ❌ | Not supported |
| External stylesheets/fonts in SVG | ❌ | Only inline styles and system fonts (see font stack below) |
| SVG filters (`<filter>`) | ⚠️ | Basic blur works; complex filter chains may fail |
| Radial/linear gradients | ✅ | Work well, great for OLED glow effects |

### Visual Hierarchy (Order of Importance)
1. **Primary data** (count number, status) — largest, boldest, center of canvas
2. **Status color** — immediate visual cue (green = good, red = bad, yellow = in-progress)
3. **Icon** — reinforces type/status, supports the primary data
4. **Label** (stat type, workflow name) — secondary, smaller
5. **Metadata** (repo name, environment) — smallest, muted, bottom of canvas

### Typography Rules

```
Primary numbers:    36–40px, bold, white (#e6edf3)
Status labels:      14–16px, bold, accent color
Secondary labels:   10–11px, accent color or white
Metadata text:      9–10px, muted (#8b949e)
```

- **Font stack**: `"SF Pro", "Segoe UI", Arial, Helvetica, sans-serif` — but in SVG, only `Arial, Helvetica, sans-serif` renders reliably on all platforms. That's what the actual buttons use.
- **Never use thin/light weights** — they disappear on OLED at 72px.
- **Always bold primary data** — `font-weight="bold"` on the main number/value text.

### Dynamic Font Sizing (Learned from Text Stats)

When a button displays text instead of a number (e.g., "TypeScript", "Apache-2.0"), the text can exceed what fits at the default font size. The solution is **dynamic font sizing based on character count**:

```typescript
// From renderStatImage() — battle-tested breakpoints:
let fontSize = 30;                    // Default for short values (≤4 chars: "MIT", "42k")
if (displayValue.length > 9) fontSize = 18;   // Long: "TypeScript", "Apache-2.0"
else if (displayValue.length > 6) fontSize = 22;  // Medium: "4.2 MB", "Public"
else if (displayValue.length > 4) fontSize = 26;  // Slightly long: "12.5k"
```

When font size changes, the **max character limit for truncation must also adapt**:
```typescript
const maxLine2Chars = line2FontSize <= 22 ? 16 : 12;
// Smaller font = more chars fit = higher truncation threshold
```

This prevents both overflow AND unnecessary truncation of values that would fit.

### Truncation Rules

- **Always truncate with `..`** (two dots, not three — saves space on tiny displays)
- Repo names: max 14 characters on buttons (line1)
- Primary value: 12 characters (at 30px font), 16 characters (at ≤22px font)
- Metadata/line3: max 18 characters
- Workflow names: max 18 characters
- **Never let text overflow** — it either gets cut off or wraps unpredictably in SVG

### Color Palette (GitHub Dark Theme)
```
Background:     #0d1117 (dark base — use as SVG rect fill)
Surface:        #161b22 (elevated surfaces — cards, status boxes)
Text Primary:   #e6edf3 (white-ish — main data)
Text Muted:     #8b949e (gray — metadata, labels)
Border:         #30363d (subtle borders)

Accent – Stars:          #e3b341 (gold)
Accent – Issues:         #3fb950 (green)
Accent – Forks:          #58a6ff (blue)
Accent – Watchers:       #d2a8ff (purple)
Accent – Pull Requests:  #3fb950 (green — same as issues, contextually distinct)
Accent – Language:       #f78166 (orange)
Accent – Size:           #8b949e (gray — neutral data)
Accent – License:        #d29922 (amber/gold)
Accent – Default Branch: #58a6ff (blue — same as forks)
Accent – Visibility:     #8b949e (gray — neutral data)

Status – Success:      #3fb950
Status – Failure:      #f85149
Status – In Progress:  #d29922
Status – Queued:       #58a6ff
Status – Cancelled:    #8b949e
Status – Deploying:    #a371f7
Error:                 #f85149
```

**Color assignment principle**: Each stat type gets a distinct accent color used for the top bar AND the label text. Reuse is OK when the stat types are contextually different (e.g., Issues and Pull Requests both green but never confused).

### OLED-Specific Best Practices
- **Use true black backgrounds** (`#0d1117`, not `#000000` — subtle warmth reads better)
- **Prefer filled shapes over outlined** — outlines with stroke-width <3 get lost at 72px
- **Use color-filled status indicators** — a solid green circle communicates faster than a green outline
- **Radial gradients for glow** — OLED renders low-opacity accent gradients behind icons beautifully
- **Limit text to 2–3 lines** — anything more is illegible at this size
- **Avoid fine details** — thin lines, small dots, intricate patterns all degrade at 72px

### Button Layout Patterns

**Text layout** (repo stats — numbers, text values):
```
┌════════════════════════┐  ← accent bar (6px, stat-type color)
│                        │
│     owner/repo         │  ← line1: 18px, muted gray, max 14 chars
│                        │
│       42.5k            │  ← line2: 30px (dynamic), bold white
│                        │
│       Stars            │  ← line3: 15px, muted gray
│                        │
└────────────────────────┘
```

**Icon layout** (workflow status — centered SVG icon):
```
┌════════════════════════┐  ← accent bar (6px, status color)
│                        │
│     owner/repo         │  ← line1: 18px, muted gray
│                        │
│        [✓ 40px]        │  ← centered icon, status-colored
│                        │
│     Success            │  ← line3: 15px, muted gray
│                        │
└────────────────────────┘
```

**Vertical positioning is adaptive** — positions shift based on which lines are present:

| Lines Present | line1 Y | line2/icon Y | line3 Y |
|---|---|---|---|
| All three | 46 | 88 (text) / 50 (icon) | 124 / 120 |
| Line1 + Line2 only | 56 | 100 | — |
| Line2 + Line3 only | — | 70 | 112 |
| Line2 only | — | 86 (centered) | — |

### Icon Design Rules

Status icons use a **36×36 viewBox** coordinate space, then get scaled/positioned with `<g transform="translate(x,y) scale(s)">`:

```xml
<!-- Example: position a 36×36 icon at 40×40 rendered size -->
<g transform="translate(52, 50) scale(1.1111)">
  <!-- icon primitives here -->
</g>
```

- **Use simple primitives**: `<polyline>`, `<line>`, `<circle>`, `<polygon>` — not complex paths
- **Minimum stroke-width**: 2.5 for circles/outlines, 3.0–3.5 for primary strokes (checkmarks, X marks)
- **Always use `stroke-linecap="round"` and `stroke-linejoin="round"`** — sharp corners disappear at small sizes
- **Color via template replacement**: Use `%%COLOR%%` placeholder in icon templates, replace at render time
- **Provide a default icon** (question mark in circle) for unknown/unexpected statuses

### Animation Guidelines
- Use `<animate>` for loading states (opacity pulse on dots)
- Use `<animateTransform type="rotate">` for spinning progress indicators
- Keep animation duration 1.2–2s for comfortable pacing
- Stagger animation `begin` values for sequential dot effects (e.g., 0s, 0.4s, 0.8s for three loading dots)

### Render States Every Action MUST Handle

Every button action should have dedicated render functions for these states:

| State | What to show | Example function |
|---|---|---|
| **Data display** | Primary data + label + repo name | `renderStatImage()`, `renderWorkflowImage()` |
| **Loading** | "Loading" text, muted accent | `renderLoadingImage()` |
| **Error** | Error message + "Press to retry" | `renderErrorImage(message)` |
| **Unconfigured** | "Setup" + "Open Settings" | `renderUnconfiguredImage()` |
| **Special states** | E.g., active deployment | `renderDeployingImage()` |

---

## Data Display Patterns

### Numeric vs. Text Stats

When a stat can be either a number or text, use a **unified display function** (`getStatDisplay`) that handles both:

```typescript
// Numeric stats → formatCount (e.g., 42500 → "42.5k")
// Text stats → raw value or formatted value
switch (statType) {
    case "stars": case "issues": case "forks": case "watchers": case "pull_requests":
        return formatCountFn(getStatValue(stats, statType));  // Numeric
    case "language":
        return stats.language ?? "None";  // Text, with null fallback
    case "size":
        return formatRepoSize(stats.size);  // Formatted (KB → "4.2 MB")
    case "visibility":
        return stats.visibility === "private" ? "Private" : "Public";  // Mapped
}
```

### Null/Missing Data Fallbacks

Always provide meaningful fallback text for nullable fields:

| Field | Null value | Display |
|---|---|---|
| Language | `null` (no dominant language) | "None" |
| License | `null` (no license file) | "None" |
| License | `"NOASSERTION"` (unparseable) | `null` → "None" |
| PR count | API error | `0` (graceful fallback) |

### Human-Readable Formatting

- **Counts**: `formatCount()` — 1234 → "1.2k", 1234567 → "1.2M"
- **Sizes**: `formatRepoSize()` — GitHub API returns KB, convert to KB/MB/GB: 4300 → "4.2 MB", 1500000 → "1.5 GB"
- **Capitalize display values**: "private" → "Private", "public" → "Public"

---

## Property Inspector & Settings Design

### General Principles
- Follow the **sdpi-components** v4 visual language — dark background, light text
- Use `<sdpi-item>`, `<sdpi-select>` etc. for consistency with other Stream Deck plugins
- Custom styles should complement, not fight, the sdpi theme
- Keep sections clearly separated with headings and `<hr>` dividers
- Use status indicators (colored text) for feedback: green = success, red = error, yellow = loading, gray = idle

### Dropdown Design for Multiple Options

When a dropdown has many options (e.g., 10 stat types), use **emoji prefixes** for quick visual scanning:

```html
<option value="stars">⭐ Stars</option>
<option value="issues">🔵 Open Issues</option>
<option value="forks">🔀 Forks</option>
<option value="pull_requests">🟢 Pull Requests</option>
<option value="language">💻 Language</option>
<option value="size">📦 Size</option>
<option value="license">📜 License</option>
<option value="visibility">🔒 Visibility</option>
```

This makes it easy to identify options at a glance without reading every label.

### Filterable Dropdown Pattern (`FilterableSelect`)

For **dynamic/datasource-driven dropdowns** that can have many items (repos, branches, workflows), use the `FilterableSelect` combobox component instead of `<sdpi-select datasource="...">`.

#### When to use

| Dropdown type | Item count | Use FilterableSelect? |
|---|---|---|
| Repository list | 10–200+ | **Yes** — users with many repos need search |
| Branch list | 5–100+ | **Yes** — repos can have dozens of branches |
| Workflow list | 1–30+ | **Yes** — some orgs have many workflow files |
| Environment list | 1–10 | **Yes** — for consistency with other filters |
| Static options (stat type, refresh interval) | ≤10 fixed | **No** — use `<sdpi-select>` with inline `<option>` |

**Rule of thumb**: If the dropdown is populated dynamically via a datasource, use `FilterableSelect`. If it has fixed/inline options known at build time, use `<sdpi-select>`.

#### Architecture

```
┌─ <sdpi-item label="Repository"> ──────────┐
│   ┌─ <div id="repoSelect"> ─────────────┐ │
│   │  ┌ FilterableSelect ──────────────┐  │ │
│   │  │ [  Selected Label          ▾ ] │  │ │   ← trigger button
│   │  │ [ ↻ ]                          │  │ │   ← refresh button
│   │  └────────────────────────────────┘  │ │
│   └──────────────────────────────────────┘ │
└────────────────────────────────────────────┘

┌─ Dropdown (portalled to <body>) ───────────┐
│ 🔍 Search repositories…                    │   ← search input (shown when items > threshold)
├─────────────────────────────────────────────┤
│ owner/repo-1                                │   ← scrollable list
│ owner/repo-2                             ✓  │   ← selected item highlighted blue
│ owner/repo-3                                │
│ ...                                         │
├─────────────────────────────────────────────┤
│                               3 of 47       │   ← result count (when filtering)
└─────────────────────────────────────────────┘
```

Key design decisions:
1. **Dropdown portalled to `<body>`** — avoids overflow clipping by `<sdpi-item>` shadow DOM
2. **`position: fixed`** — positioned relative to viewport, no scroll offset issues
3. **Search input auto-hidden** — only shown when selectable items exceed `threshold` (default: 8)
4. **Uses `sdpi-datasource` CustomEvents** — decoupled from specific data keys
5. **Handles settings persistence** — sends `setSettings` via WebSocket directly (no sdpi-components dependency)
6. **Error items shown as disabled** — items with `disabled: true` or `⚠` prefix are non-selectable

#### API Reference

```javascript
// Initialize
const repoFS = new FilterableSelect({
    container: document.getElementById('repoSelect'),  // mount point (plain <div>)
    setting: 'repo',                                    // Stream Deck setting key
    datasource: 'getRepos',                             // PI datasource event name
    placeholder: 'Choose a repository',                 // placeholder text
    searchPlaceholder: 'Search repositories…',          // search input placeholder
    threshold: 8,                                       // search shown when items > N
    onChange: (value, label) => { ... },                 // called when value changes
    onSelect: (value, label) => { ... },                // called on every selection
});

// Public methods
repoFS.refresh();         // re-request data from plugin (shows spin animation)
repoFS.value;             // get selected value
repoFS.value = 'owner/r'; // set selected value programmatically
repoFS.setItems(items);   // manually set items array
repoFS.open() / close();  // programmatic open/close
repoFS.destroy();         // clean up DOM

// Listen for changes externally
document.getElementById('repoSelect').addEventListener('change', (e) => {
    console.log(e.detail.value, e.detail.label);
});
```

#### Prerequisites (WebSocket Interceptor)

FilterableSelect requires these `window` globals, set up by the PI HTML interceptors:

```javascript
// Set by WebSocket proxy (already in PI pages):
window._sdWebSocket    // WebSocket instance for sending messages

// Set by connectElgatoStreamDeckSocket wrapper:
window._sdUuid         // Registration UUID (used as context)
window._sdAction       // Action UUID (e.g. 'com.pedrofuentes.github-utilities.repo-stats')
window._actionSettings // Current action settings from actionInfo

// Dispatched by WebSocket message handler when datasource data arrives:
window.dispatchEvent(new CustomEvent('sdpi-datasource', {
    detail: { event: 'getRepos', items: [...] }
}));
```

#### HTML Template

Replace `<sdpi-select datasource="...">` with a plain `<div>`:

```html
<!-- Before (sdpi-components native) -->
<sdpi-item label="Repository">
    <sdpi-select setting="repo" datasource="getRepos" show-refresh id="repoSelect"></sdpi-select>
</sdpi-item>

<!-- After (FilterableSelect) -->
<sdpi-item label="Repository">
    <div id="repoSelect"></div>
</sdpi-item>
```

Static dropdowns stay as `<sdpi-select>` with inline `<option>` elements — no change needed.

#### Styling

FilterableSelect uses sdpi-components CSS variables (`--input-bg-color`, `--font-color`, etc.) with dark theme fallbacks. The dropdown panel uses explicit colors for depth hierarchy:

| Element | Color | Purpose |
|---|---|---|
| Trigger bg | `var(--input-bg-color, #3d3d3d)` | Matches native selects |
| Dropdown bg | `#252525` | Darker for depth separation |
| Search input bg | `#1a1a1a` | Even darker for focus area |
| Selected item | `#264f78` bg, `#58a6ff` text | Blue accent for selection |
| Hover item | `#383838` | Subtle highlight |
| Disabled item | `#666` italic | Non-interactive items |

#### Viewport-Aware Positioning (Critical)

The Stream Deck Property Inspector panel has a **small, fixed-height viewport**. Dropdowns near the bottom of the page will be clipped if they open downward. FilterableSelect handles this automatically:

1. **Measure space** — on every `open()`, measure `spaceBelow` (viewport bottom minus trigger bottom) and `spaceAbove` (trigger top)
2. **Flip decision** — if `spaceBelow < min(naturalHeight, 120px)` AND `spaceAbove > spaceBelow`, open upward
3. **Dynamic max-height** — constrain `.fs-list` max-height to `availableSpace - chrome` (search input + count footer ≈ 65px)
4. **Flip layout** — when opening upward, use `flex-direction: column-reverse` so search stays closest to the trigger
5. **Reset on close** — clear dynamic sizing so next open re-measures fresh

```javascript
// Simplified positioning logic
var spaceBelow = viewportH - rect.bottom - gap;
var spaceAbove = rect.top - gap;
var openAbove = spaceBelow < minUsable && spaceAbove > spaceBelow;

if (openAbove) {
    dropdown.style.bottom = (viewportH - rect.top + gap) + 'px';
    dropdown.classList.add('flip-up');  // column-reverse
} else {
    dropdown.style.top = (rect.bottom + gap) + 'px';
}
list.style.maxHeight = (availableSpace - chrome) + 'px';
```

**Why this matters**: The PI panel is typically 300-500px tall. A dropdown with 50+ repos at ~26px each needs ~1300px — it will always overflow. Without flip+constrain, the bottom items are completely invisible and unreachable.

### WebSocket Interception Pattern

To share settings between the Property Inspector and a settings popup (or to intercept data from the plugin), use the **WebSocket proxy pattern**:

```javascript
// Intercept sdpi-components' WebSocket to capture messages
(function() {
    const NativeWS = window.WebSocket;
    window.WebSocket = new Proxy(NativeWS, {
        construct(target, args) {
            const ws = new target(...args);
            window._sdWebSocket = ws;  // Store reference for popup communication
            ws.addEventListener("message", function(evt) {
                const data = JSON.parse(evt.data);
                if (data.event === "didReceiveGlobalSettings") {
                    window._globalSettings = data.payload?.settings || {};
                }
            });
            return ws;
        }
    });
})();
```

The popup window communicates back via `window.opener._sdWebSocket`.

### Setup Popup (Global Settings)
- Modal-like popup window opened via `window.open()`
- Communicates with parent PI via `window.opener._sdWebSocket`
- Uses system dark theme (`background: #1a1d23`, `color: #e6edf3`)
- Section headings: 11px, uppercase, letter-spaced 0.8px, muted color (`#8b949e`)
- Buttons: primary green (`#238636`) for main actions, secondary gray (`#21262d`) for others
- Token input: monospace font (`"SF Mono", "Cascadia Code", Consolas`), password type with show/hide toggle
- Input focus: blue border (`#58a6ff`) + subtle box-shadow glow

### Status Feedback Design

Status messages use **color-coded text AND colored borders** for maximum clarity:

```css
.status-box.success { color: #3fb950; border-color: #238636; }
.status-box.error   { color: #f85149; border-color: #da3633; }
.status-box.loading { color: #d29922; border-color: #9e6a03; }
.status-box.idle    { color: #8b949e; border-color: #30363d; }
```

### Feedback & Interaction Patterns
- **Immediate validation feedback** — after token save, show success/error within 300ms
- **Loading states** — show "Validating…" or "Loading…" in yellow/amber (`#d29922`)
- **Error detail** — explain what went wrong AND what action to take (e.g., "Token needs `repo` scope — go to GitHub Settings → Developer settings")
- **Token status in PI** — always visible, updates on data changes (MutationObserver on dropdowns)
- **Dropdown refresh** — `show-refresh` attribute on `<sdpi-select>`, `_refreshDropdowns()` callback from popup

### Help Text with Numbered Steps

For setup instructions embedded in the UI, use a **numbered step pattern** with styled numbers:

```html
<div class="help-step">
    <span class="help-num">1</span>
    <span>Go to <a href="...">GitHub Settings → Developer settings</a></span>
</div>
```

This is cleaner than paragraph text and matches the Stream Deck's information-dense aesthetic.

---

## URL-Opening UX Pattern

When a button press should open a URL in the browser:

1. **Store the URL** — after each successful data fetch, store the resolved URL in a `Map<string, string>` keyed by action ID
2. **Open on `onKeyDown`** — use `streamDeck.system.openUrl(url)` 
3. **Provide fallback URL** — if the button hasn't fetched data yet (URL not in map), construct a URL from settings:
   ```typescript
   const fallbackUrl = `https://github.com/${settings.owner}/${settings.repo}`;
   ```
4. **Clean up on disappear** — delete the stored URL in `onWillDisappear`

This ensures the button always does something useful when pressed, even before the first data fetch.

---

## Anti-Patterns to Avoid
- ❌ Generic/cookie-cutter designs — no "AI aesthetic" (purple gradients on white)
- ❌ Thin, decorative fonts — illegible on small displays
- ❌ Low-contrast text — especially on OLED where muted text can vanish
- ❌ Too much information — force prioritization, not information overload
- ❌ Complex SVG paths at small scale — simplify icons for 72px
- ❌ Inline styles in PI HTML where CSS classes would suffice
- ❌ Unstyled native HTML elements — always match the dark theme
- ❌ Hardcoded font sizes for variable-length content — always use dynamic sizing
- ❌ `base64` or `charset=utf8` in SVG data URIs — only `encodeURIComponent` works
- ❌ Nested `<svg>` elements — Stream Deck renderer doesn't support them
- ❌ Three-dot ellipsis (`...`) — use two dots (`..`) to save precious horizontal space
- ❌ Returning raw API values to display — always format (capitalize, convert units, provide fallbacks)
- ❌ Using `<sdpi-select datasource="...">` for large dynamic lists — use `FilterableSelect` instead (see above)
- ❌ Custom dropdowns without viewport-aware positioning — PI panel is small; always measure space and flip/constrain

---

## References & External Documentation

These are the primary sources used to build these guidelines. Future agents should consult them when designing new UI elements or troubleshooting rendering issues.

### Stream Deck SDK & Platform

| Resource | URL | What it covers |
|---|---|---|
| Stream Deck SDK — Getting Started | https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/ | Plugin architecture, manifest, action lifecycle |
| Stream Deck SDK — Actions & Events | https://docs.elgato.com/streamdeck/sdk/references/events/ | `setImage`, `setTitle`, key events, settings API |
| Stream Deck SDK — Manifest Schema | https://docs.elgato.com/streamdeck/sdk/references/manifest/ | `Actions`, `States`, `ShowTitle`, icon paths |
| Stream Deck CLI | https://docs.elgato.com/streamdeck/cli/intro | `validate`, `restart`, `pack`, `link`, `dev` |
| sdpi-components (PI framework) | https://sdpi-components.dev/ | `<sdpi-item>`, `<sdpi-select>`, dark theme, `setting` attribute |
| Stream Deck SDK — Property Inspector | https://docs.elgato.com/streamdeck/sdk/references/property-inspector/ | PI lifecycle, `sendToPlugin`, global settings |

### Design Systems & Color

| Resource | URL | What it covers |
|---|---|---|
| GitHub Primer Design System | https://primer.style/ | Color tokens, dark theme foundations |
| GitHub Primer — Color Primitives | https://primer.style/foundations/color/overview | Exact hex values for dark mode (`#0d1117`, `#e6edf3`, etc.) |
| GitHub Primer — Icons (Octicons) | https://primer.style/foundations/icons | Icon style reference (stroke weights, sizes) |

### SVG & Rendering

| Resource | URL | What it covers |
|---|---|---|
| MDN — SVG Reference | https://developer.mozilla.org/en-US/docs/Web/SVG | SVG elements, attributes, coordinate systems |
| MDN — SVG `<animate>` | https://developer.mozilla.org/en-US/docs/Web/SVG/Element/animate | Animation syntax for loading states |
| MDN — SVG `<text>` | https://developer.mozilla.org/en-US/docs/Web/SVG/Element/text | Text rendering, `text-anchor`, font sizing |
| MDN — `encodeURIComponent` | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent | Why this is the correct encoding for data URIs |
| SVG Viewport & ViewBox | https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/viewBox | Understanding 144×144 viewport → 72×72 physical mapping |

### Typography & OLED

| Resource | URL | What it covers |
|---|---|---|
| System Font Stack (CSS-Tricks) | https://css-tricks.com/snippets/css/system-font-stack/ | Cross-platform font stacks that render at small sizes |

### Key Learnings Not Found in Docs

These were discovered through trial-and-error on hardware and are **not documented** in any official source:

1. **SVG encoding**: Only `"data:image/svg+xml," + encodeURIComponent(svg)` works. Base64 and charset variants render blank on hardware. No official Elgato doc mentions this.
2. **Nested `<svg>` elements**: Silently fail — no error, just blank. Use `<g>` with transforms instead.
3. **CSS `@keyframes` in SVG**: Not supported by Stream Deck's renderer. Must use SVG-native `<animate>` elements.
4. **`<foreignObject>`**: Not supported. Cannot embed HTML inside SVG on Stream Deck.
5. **Background color**: `#0d1117` (GitHub dark) reads better than pure `#000000` on OLED despite both being "dark."
6. **Two-dot truncation**: `..` instead of `...` saves one character — meaningful at 12-char limits.
7. **Dynamic font sizing thresholds**: The 30/26/22/18px breakpoints at 4/6/9 characters were tuned by testing real stat values on hardware.
8. **PI viewport is small and fixed** — the Property Inspector panel is typically 300–500px tall. Any custom dropdown, tooltip, or overlay MUST measure available viewport space and flip/constrain itself. Native `<select>` gets this for free from the OS; custom dropdowns do not.
9. **`position: fixed` + portalling to `<body>`** — custom overlays inside `<sdpi-item>` shadow DOM get clipped. Portal the dropdown to `<body>` and use `position: fixed` with `getBoundingClientRect()` for reliable positioning.
10. **Flex `column-reverse` for flip-up menus** — when a dropdown opens upward, reverse the flex direction so the search input stays adjacent to the trigger button (closest to the user's click point), maintaining natural interaction flow.
