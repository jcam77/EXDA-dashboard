# EXDA design guide

How EXDA looks and why, so that new screens, and new apps in the same family
(for example a team skills app), stay consistent.

- **Audience:** anyone building or changing EXDA screens, or starting a new app
  in the EXDA style.
- **Source of truth:** the theme tokens in
  [frontend/src/index.css](../frontend/src/index.css) and
  [frontend/tailwind.config.js](../frontend/tailwind.config.js). This guide
  explains them; if the two ever disagree, fix the guide.
- **State:** EXDA 5.0.5 (November 2026). It replaces the old
  `design_guidelines.json` (February 2026), which described an earlier, grey look.

---

## 1. Character

Calm, technical and readable. EXDA is used on test days, often on a laptop in a
control room, so it favours clarity over decoration.

- **Dark first, light equal.** Both themes are complete; every screen must work
  in both.
- **One accent colour:** teal (`primary`). Other colours carry meaning (warning,
  error, success, data categories), never decoration.
- **Quiet surfaces:** cards with a thin border on a slightly darker background;
  no heavy shadows, no gradients in content.
- **Minimal by default:** MVP mode shows only what a test day needs; advanced
  tools are one switch away.
- **Plain words:** short labels and messages that say what happens
  ("Saved 08:37", "Unlink these files"), no jargon where a plain word exists.

## 2. Colour

Use **theme tokens only** (`bg-card`, `text-muted-foreground`, `border-border`,
`text-primary`, `bg-warning/10` …). They switch between dark and light in one
place. Never use fixed palette colours (`text-zinc-400`, `bg-amber-500`,
`text-emerald-400` …) in new code: they cannot follow the theme and are often
unreadable in one of the two.

> Older screens (mainly the Plan tab) still use some fixed `zinc` / `black` /
> `white` classes. A compatibility layer in `index.css` maps those onto the
> tokens, so they look right, but it is legacy: do not add to it, and replace
> such classes with tokens when touching that code.

### Tokens

Contrast is measured against `card` and `background`; normal text needs at
least **4.5:1**.

| Token | Use | Dark | Light | Text contrast (dark / light) |
| --- | --- | --- | --- | --- |
| `background` | Page | `220 29% 6%` | `210 28% 96%` | — |
| `card` | Cards, panels, dialogs | `220 29% 11%` | `210 35% 98%` | — |
| `foreground` | Main text | `210 33% 96%` | `220 28% 14%` | 16.0 / 15.5 |
| `muted-foreground` | Secondary text, labels, hints | `210 15% 70%` | `220 14% 30%` | 8.2 / 8.6 |
| `muted` | Subtle fills (chips, hover) | `220 12% 22%` | `210 24% 94%` | — |
| `border` | Card and input borders | `220 18% 22%` | `194 34% 76%` | — |
| `primary` | Accent: active tab, main actions, links, checked boxes | `192 70% 62%` | `192 78% 32%` | 8.9 / 4.9 |
| `success` | Done, OK, active status | `152 24% 74%` | `152 34% 36%` | 10.2 / 4.8 |
| `warning` | Needs attention, planning status, read-only | `35 80% 52%` | `33 85% 32%` | 7.3 / 5.4 |
| `destructive` | Errors, delete, Close Project | `0 78% 62%` | `0 72% 40%` | 4.9 / 6.6 |
| `info` | Neutral information | `194 37% 79%` | `194 37% 38%` | 11.2 / 5.0 |

`secondary` and `accent` are below 4.5:1 in one theme each: use them only for
fills and borders, never for text.

### Patterns

- **Tinted panel** (warnings, notices, filters): `rounded-lg border
  border-warning/40 bg-warning/10 text-warning` — same pattern with `primary`,
  `destructive` or `success`. Tints are always `/5`–`/25`, never solid.
- **Status badges:** active = `success`, planning = `warning`, archived =
  `muted-foreground`; always with the status word, never colour alone.
- **Checkboxes** use `primary` (set globally); warning colours are for warnings.

### Data categories (charts, word clouds)

Categorical colours are a separate, validated palette, not the status tokens:
`--cloud-methods` (blue), `--cloud-measured` (green), `--cloud-skills`
(violet), `--cloud-facility` (red, as in the DBI logo), `--cloud-fuels`
(amber); grey (`muted-foreground`) for a last, neutral category.

- They were checked with a colour-vision validator (all pairs, both themes):
  colour-blind separation ΔE ≥ 9.3, normal-vision ΔE ≥ 15.7, text contrast ≥
  4.6:1. **Re-run the validator for any change or new colour**; do not pick
  chart colours by eye.
- Assign colours in a fixed order per category; a filter must never repaint the
  remaining categories.
- Every coloured category also has a legend with its name.

## 3. Type

- **Font:** Inter (shipped with the app, `frontend/public/fonts`), weights
  400–800. Monospace (paths, file names, numbers in tables): `font-mono`.
- **Minimum size: 11 px.** Use 11 px (`text-[11px]`) only for meta text:
  badges, chips, captions, legends. Labels and normal text are 12 px
  (`text-xs`) or 14 px (`text-sm`).

| Role | Classes |
| --- | --- |
| Page title (one per tab, `PageHeader`) | `text-xl font-bold uppercase tracking-tight` |
| Section heading | `text-lg font-bold uppercase tracking-tight` |
| Card title | `text-sm font-semibold` |
| Body, inputs | `text-sm` |
| Labels, buttons | `text-xs font-semibold` |
| Small caps label (e.g. card headers) | `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground` |
| Meta (badges, chips, legends) | `text-[11px]` |

- **Buttons never break inside a word:** `whitespace-nowrap shrink-0`. If space
  runs out, hide secondary text (with the full text in `title`) or shorten
  names with `truncate` — never let a word split ("PROJEC / T").
- Numbers that are compared (peak table) use fixed decimals per unit and
  `tabular-nums` / `font-mono`.

## 4. Layout and components

- **Page:** every workspace tab starts with
  [PageHeader](../frontend/src/components/PageHeader.jsx): the tab's icon, an
  uppercase title, a one-line description, optional actions on the right.
- **Cards:** `rounded-lg border border-border bg-card`, padding `p-4` (dense)
  or `p-6`; groups of related cards `rounded-2xl border-primary/25
  bg-primary/[0.03]` (project groups on the Projects page). Collapsible cards
  use a full-width header button with a chevron and remember their state.
- **Spacing:** multiples of 4 px; `gap-2`/`gap-3` inside cards, `mb-6`/`mb-8`
  between blocks.
- **Buttons:**
  - Neutral: `rounded-md border border-border px-3 py-1.5 text-xs font-semibold
    text-muted-foreground hover:border-ring hover:text-foreground`
  - Main action: `border-primary/50 bg-primary/10 text-primary
    hover:bg-primary/20`
  - Destructive: `border-destructive/40 bg-destructive/15 text-destructive`
  - Icon buttons: `h-10 w-10` with `aria-label` and `title`.
- **Inputs:** `rounded-md border border-sidebar-border bg-input px-3 py-2
  text-sm`, focus `border-primary/60`.
- **Choosing terms:** [TagInput](../frontend/src/components/TagInput.jsx)
  (free short terms with suggestions) and
  [SkillPicker](../frontend/src/components/SkillPicker.jsx) (only from a shared
  list, grouped by category, with a deliberate "add to the list" step). Use the
  picker whenever names must match across projects or people.
- **Dialogs:** [UnifiedModal](../frontend/src/components/UnifiedModal.jsx) for
  confirmations and messages; destructive actions always ask first.
- **Filters:** chips in one row (`rounded-full border px-3 py-1 text-xs`),
  active chip `border-primary bg-primary/10 text-primary`. While a filter hides
  items, show a tinted bar "Showing N of M … Show all".
- **Paths:** show the folder name, with the full path in `title`; handle both
  `/` and `\` (Windows) — see `folderName` in `utils/pathCrumbs.js`.

## 5. Light and dark

- Design in dark, then check light: every new screen gets a screenshot in both
  themes before release.
- Logos have a dark and a light version (`logo-dark` / `logo-light`).
- Never rely on a colour that is only readable in one theme (fixed palette
  colours are the usual cause).

## 6. Accessibility

- Text contrast ≥ 4.5:1 (large text ≥ 3:1) in both themes; measure it.
- Never colour alone: statuses have words, categories have a legend,
  warnings have an icon and text.
- Every icon-only button has `aria-label` and `title`; interactive SVG
  elements (word cloud) are keyboard-reachable.
- Click targets at least 32 px high for main controls.

## 7. Starting a new app in this style

Copy the foundation, not the whole of EXDA:

1. `index.css` (tokens, fonts, base styles, without the legacy `zinc` mapping)
   and `tailwind.config.js`.
2. The components listed in section 4 that the app needs.
3. Launchers and setup scripts (same install rules: everything inside the app
   folder, nothing system-wide without asking), the release script, the test
   setup.
4. This guide, adapted: own name and logo (for a DBI-only app, the DBI logo
   only), same tokens and rules.
