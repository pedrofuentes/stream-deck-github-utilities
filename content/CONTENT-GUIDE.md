# Marketplace Content Guide — Stream Deck GitHub Utilities

This guide instructs AI agents (and humans) on how to create, update, and maintain the Elgato Marketplace listing content for this plugin.

## Directory Structure

```
content/
├── CONTENT-GUIDE.md          # This file — agent instructions
├── description.md            # Plugin description (source of truth for text)
├── release-notes.md          # Release notes history (source of truth for text)
├── marketplace-content.html  # Copy-paste ready HTML for the WYSIWYG editor
├── assets/                   # SVG source files + generated PNGs
│   ├── icon.svg              # 288×288 plugin icon
│   ├── icon.png              # Generated — do not edit
│   ├── thumbnail.svg         # 1920×960 hero image
│   ├── thumbnail.png         # Generated — do not edit
│   ├── gallery-1-*.svg       # 1920×960 gallery images (min 3)
│   ├── gallery-1-*.png       # Generated — do not edit
│   ├── gallery-2-*.svg
│   ├── gallery-2-*.png
│   ├── gallery-3-*.svg
│   ├── gallery-3-*.png
│   └── gallery-4-*.svg       # Optional additional gallery images
scripts/
└── convert-content-assets.ts # SVG → PNG converter
```

## Elgato Marketplace Asset Requirements

| Asset | Format | Max Size | Dimensions | Aspect Ratio | Notes |
|---|---|---|---|---|---|
| **Icon** | PNG or JPG | ≤ 2 MB | 288 × 288 | 1:1 | Plugin identity in the marketplace |
| **Thumbnail** | PNG or JPG | ≤ 5 MB | 1920 × 960 | 2:1 | Hero image shown in listing |
| **Gallery** | PNG/JPG ≤ 10 MB or MP4 ≤ 50 MB | See format | 1920 × 960 (image) or 1920 × 1080 (video) | 2:1 or 16:9 | **Minimum 3 images required** |
| **Description** | Plain text (HTML via WYSIWYG) | 4,000 characters | — | — | Supports bold, lists, headings |
| **Release Notes** | Plain text (HTML via WYSIWYG) | 1,500 characters per version | — | — | Only latest version shown |

## When to Update Each Asset

| Asset | Update Frequency | Trigger |
|---|---|---|
| Description | When features change | New action added, stat type added, major behavior change |
| Release Notes | **Every release** | Always write notes for each version |
| `marketplace-content.html` | **Every release** | Must stay in sync with description + release notes |
| Icon | Rarely | Only if plugin identity/branding changes |
| Thumbnail | When actions change | New action added, key layout changes |
| Gallery images | When UI changes | New action, new states, PI redesign |

## How to Write Release Notes

### Template

```markdown
## vX.Y.Z — YYYY-MM-DD
<!-- Characters: NNN / 1,500 -->

Short one-line summary of this release.

- Feature or fix description (user-facing language)
- Another change
- Bug fix description
```

### Rules

- **User-facing changes only** — skip internal refactors, test additions, docs-only changes, build config
- **Start with the most impactful change**
- **Use action verbs**: "Added", "Fixed", "Improved", "Removed"
- **Keep under 1,500 characters** — count includes all formatting
- **No technical jargon** — write for Stream Deck users, not developers
- **Group related changes** — don't list every commit separately
- **Include character count** in a comment after the heading

### What to Include

- New features and actions
- Bug fixes that affected users
- Performance improvements users can feel
- UI/UX changes in the Property Inspector or buttons
- New stat types, status types, or display modes

### What to Exclude

- Internal refactors (code restructuring, variable renames)
- Test additions or test framework changes
- Documentation-only changes
- Build system / CI changes
- Dependency version bumps (unless they fix a user-facing issue)

## How to Update the Description

### Rules

1. **Keep under 4,000 characters** — count after writing, trim if needed
2. **Update the character count** in the metadata header
3. **Update the version** in the metadata header
4. **Marketing tone** — enthusiastic, highlight value, not technical docs
5. **Update feature lists** when adding new actions or stat types
6. **Don't remove sections** — the structure should stay consistent
7. **Keep Getting Started steps current** with actual setup flow

### What to Change When Adding an Action

1. Add it to the "What You Get" section with emoji and feature bullets
2. Update the headline/summary if scope expanded significantly
3. Verify stat type lists match the code's `StatType` enum
4. Verify workflow statuses mentioned match the code's status list
5. Update character count

## How to Regenerate PNGs from SVGs

```bash
npm run content:assets
```

This runs `scripts/convert-content-assets.ts` which:
1. Reads all `.svg` files from `content/assets/`
2. Converts each to PNG at native viewBox dimensions using `@resvg/resvg-js`
3. Logs filename, dimensions, and file size for each output
4. Validates file sizes against marketplace limits

**Always run this after editing any SVG in `content/assets/`.**

## How to Update the HTML Copy-Paste File

The `marketplace-content.html` file is a standalone HTML page that renders the description and release notes as formatted HTML. The user opens it in a browser, selects content from the white content boxes, and pastes into the Elgato Marketplace WYSIWYG editor.

### Update Process

1. Edit `description.md` and/or `release-notes.md` first (these are the source of truth)
2. Open `marketplace-content.html` in a text editor
3. Update the description HTML to match `description.md`:
   - Convert markdown bold (`**text**`) to `<strong>text</strong>`
   - Convert markdown lists to `<ul><li>` elements
   - Convert markdown headings to `<h2>`, `<h3>` tags
   - Preserve emoji characters as-is
4. Update the release notes tabs:
   - Add a new tab button for the new version
   - Add a new tab content panel with the HTML-formatted notes
   - Ensure the newest version tab is active by default
5. Verify character counters still work (they count the visible text in each content box)
6. Open the file in a browser and test the copy-paste flow

### Critical Rules for the HTML File

- **Content boxes MUST have white/light background** — this ensures pasted text has proper formatting in the WYSIWYG editor
- **The page wrapper can use dark theme** — only the copyable areas need white backgrounds
- **Tab switching must work with JavaScript** — no framework dependencies, vanilla JS only
- **Character counters must be live** — update as content is selected
- **Include instructions** at the top explaining the copy-paste workflow

## Visual Design Language

All marketplace assets follow a consistent visual language derived from the plugin's own button renderer.

### Color Palette

| Color | Hex | Usage |
|---|---|---|
| Background | `#0d1117` | Primary background (GitHub dark) |
| Surface | `#161b22` | Card/panel backgrounds |
| Text Primary | `#ffffff` / `#e6edf3` | Headings, main text |
| Text Secondary | `#9ca3af` / `#8b949e` | Descriptions, labels |
| Border | `#30363d` | Separators, outlines |
| Stars | `#e3b341` | Gold accent |
| Issues/PRs | `#3fb950` | Green accent |
| Forks/Branch | `#58a6ff` | Blue accent |
| Watchers | `#d2a8ff` | Purple accent |
| Language | `#f78166` | Salmon accent |
| Error/Failure | `#f85149` | Red accent |
| Success | `#3fb950` | Green workflow status |
| In Progress | `#d29922` | Yellow/amber workflow status |
| Deploying | `#a371f7` | Purple deployment status |

### Typography

- **Primary font**: Arial, Helvetica, sans-serif
- **Headings**: Bold, white (#ffffff)
- **Body text**: Regular weight, light gray (#e6edf3)
- **Muted text**: Regular weight, medium gray (#8b949e or #9ca3af)

### Layout Patterns

- **Key mockups**: 144×144 rounded rectangles with 16px corner radius, 6px colored accent bar at top
- **Background gradient**: `#0d1117` → `#161b22` (subtle)
- **Content grouping**: Use surface color (`#161b22`) panels on background (`#0d1117`)
- **Accent bars**: 6px tall, full width, stat-type-specific color
- **Icon placement**: Centered 40×40 in key, using `<g transform>` (no nested `<svg>`)

### Key Mockup Pattern

When showing Stream Deck keys in gallery images, replicate the actual button appearance:

```
┌════════════════════════┐  ← colored accent bar (6px)
│                        │
│     repo-name          │  ← 18px, muted gray
│                        │
│     VALUE              │  ← 30px, bold, white (or icon)
│                        │
│     Label              │  ← 15px, muted gray
│                        │
└────────────────────────┘
```

## Release Workflow Checklist

When preparing a release, complete these content tasks:

- [ ] Write release notes in `content/release-notes.md` for the new version
- [ ] Verify character count is under 1,500
- [ ] Review `content/description.md` — update if features changed
- [ ] Verify description character count is under 4,000
- [ ] Update `content/marketplace-content.html` with matching HTML
- [ ] Test copy-paste from HTML file in a browser
- [ ] Update gallery SVGs in `content/assets/` if key display changed
- [ ] Run `npm run content:assets` to regenerate PNGs
- [ ] Verify PNG file sizes are within marketplace limits
- [ ] Commit content changes with the version bump
- [ ] After GitHub Release: open HTML file in browser, copy, paste into Elgato Marketplace WYSIWYG
- [ ] After GitHub Release: upload new asset PNGs if changed

## Elgato Marketplace Upload Procedure

1. **Log in** to the [Elgato Marketplace Developer Portal](https://marketplace.elgato.com/developer)
2. **Navigate** to your plugin listing
3. **Description tab**:
   - Open `marketplace-content.html` in your browser
   - Click inside the Description content box
   - `Ctrl+A` to select all text in the box, `Ctrl+C` to copy
   - Click into the WYSIWYG editor on the portal, `Ctrl+A` to select existing content, `Ctrl+V` to paste
   - Verify formatting looks correct (bold, lists, headings)
4. **Release Notes tab**:
   - Switch to the latest version's tab in the HTML file
   - Select the release note content, copy, paste into the portal
5. **Assets tab**:
   - Upload `icon.png` (288×288)
   - Upload `thumbnail.png` (1920×960)
   - Upload all `gallery-*.png` files (minimum 3)
6. **Review** the preview and **publish**

## FAQ for Agents

### Q: Do I need to update the HTML file every time I change the markdown?
**Yes.** The markdown files are the source of truth, but the HTML file is what the user actually copies into the marketplace. They must stay in sync.

### Q: Can I use base64 images in the SVGs?
**No.** Use inline SVG elements only. The `@resvg/resvg-js` converter handles SVG-native content. External resources (images, fonts) may not render.

### Q: What if the description exceeds 4,000 characters?
Trim the least important content. Priority order: headline > action features > workflow highlights > getting started > privacy note > requirements.

### Q: What if release notes exceed 1,500 characters?
Combine related items, shorten descriptions, remove least impactful changes. The marketplace only shows the latest version's notes prominently.

### Q: Can I add video to the gallery?
Yes, MP4 ≤ 50 MB at 1920×1080 (16:9). But images are easier to maintain and don't require screen recording. Prefer images unless showing animation or interaction flow.

### Q: Should I update the icon when adding a new action?
No, unless the new action fundamentally changes what the plugin is about. The icon represents the plugin identity, not individual actions.

### Q: How do I test that the copy-paste works?
Open `marketplace-content.html` in a browser. Select content in a white box. Paste into any rich text editor (Google Docs, Word, or the Elgato portal itself). Verify bold text, lists, and headings are preserved.

### Q: What fonts are available in the SVG converter?
System fonts only. The converter uses `@resvg/resvg-js` which accesses system-installed fonts. Stick to Arial/Helvetica/sans-serif for cross-platform compatibility.
