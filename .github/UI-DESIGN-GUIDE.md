# UI & Design Guidelines

> Referenced from [AGENTS.md](AGENTS.md). Load this file when designing buttons, Property Inspector panels, or any visual element.

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
