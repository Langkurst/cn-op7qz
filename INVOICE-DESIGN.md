# DESIGN.md: invoice checker

Feel (one sentence): a warm paper ledger, where each bill is written into a sheet line by line and every line gets a tick or a flag.

Main reference: Equals (equals.com), Big Type / Editorial. Borrowed detail, the only one: Acctual's dark "physical" pill button with a 1px inner ring and a `0 1px 2px` shadow, used for the primary action only.

It must not look like NZ Redact, which uses a cool light Inter style. This page is warm paper, a serif display face and ledger rules.

Only `invoice-checker.html` uses `assets/css/invoice.css`. The page still links `system.css` first, but `invoice.css` declares its own fonts, tokens, reset and components, so it does not depend on anything in `system.css`.

## Fonts

| Role | Face | Settings |
|---|---|---|
| Display | Instrument Serif 400, roman and italic (OFL) | h1 `clamp(56px, 9vw, 112px)`, weight 400, tracking `-0.02em`, line-height 1.0, `text-wrap: balance`. Section h2 48px / 1.0 / `-0.015em`. "Tax invoice" on the sheet 40px. The verdict 30px / 1.05. The amount to raise 52px. Italic is used once, for the closing words of the h1. |
| Text | Geist variable, latin and latin-ext subsets (OFL) | Body 15px / 1.55, weight 400; app text 14px; strong 560. Lede 17px. |
| Mono | Geist Mono variable (OFL) | Labels: uppercase 12px, tracking `+0.06em`, weight 500. State chips 11px, same tracking. Numbers: 13.5px, `tabular-nums`, right-aligned in every money and quantity column. |

The font files are this page's own copies in `assets/fonts/ledger/` (licences beside them), under page-only family names (`Ledger Serif`, `Ledger Sans`, `Ledger Mono`), so a change to the shared fonts cannot change this page. All four are preloaded. `font-display: swap` with system fallbacks (Georgia, system-ui, ui-monospace).

## Colours (tinted, named after ledger things)

Light is warm paper; dark is the same ledger at night. No `#fff`, no `#000`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#f4f0e6` | `#15130f` | Page |
| `--folio` | `#fbf8f1` | `#1c1915` | The ledger sheet, the invoice, dialogs |
| `--blotter` | `#ede8dc` | `#25211b` | Toolbar, inbox, quiet fills |
| `--ink` | `#26231e` | `#eee8dc` | Text, step 1 |
| `--pencil` | `#5a5448` | `#b5ac9b` | Text, step 2 |
| `--graphite` | `#655e51` | `#a0978a` | Text, step 3 (labels, row numbers) |
| `--rule` | `rgba(38,38,38,.12)` | `rgba(238,232,220,.12)` | 0.5px hairlines everywhere |
| `--rule-strong` | `rgba(38,38,38,.26)` | `rgba(238,232,220,.26)` | Table header underline |
| `--field` | `#847e72` | `#7a7366` | Input borders, at least 3:1 on sheet and blotter |
| `--red-ink` | `#b9381c` | `#ff7550` | The one loud accent |
| `--matched` / `--matched-bg` | `#2c6539` / `#e1ecdc` | `#92cf9c` / `#17281a` | Quiet state: ticked, ready to pay |
| `--hold` / `--hold-bg` | `#8a4700` / `#f5e6c8` | `#efbd6f` / `#35280f` | Quiet state: flagged, holds the bill |
| `--carbon` / `--carbon-bg` | `#2a4c96` / `#e5eaf3` | `#a8bff0` / `#1b2334` | Quiet state: a note |
| `--pill` / `--pill-ink` | `#1f1c18` / `#fbf8f1` | `#eee8dc` / `#1c1915` | The borrowed primary button (hover `#36312a` / `#fbf6ec`) |

Red ink is allowed in three places only: the margin rule down the left of the invoice sheet, the marker on the bill that is open, and the focus ring (plus the brief cell ring while values are written, which fades out). Every text and state pair is at least 4.5:1; `tests/features.test.js` checks this from the tokens in `invoice.css`.

## Radius system

- 3px: ledger cells, inputs, `kbd`, state chips.
- 4px: secondary buttons, issue rows.
- 6px: the ledger window, dialogs, the rules table.
- 999px: the borrowed pill (primary action only).

Nothing else.

## Surfaces

- Borders are `0.5px solid var(--rule)` (Equals' half-pixel ring). Table headers use `--rule-strong`. The invoice total has an accounting double rule (`3px double var(--ink)`).
- Shadows: none, except the pill: `inset 0 0 0 1px rgba(255,255,255,.10), 0 0 0 1px #2b2722, 0 1px 2px rgba(31,28,24,.24)` (dark mode flips the ring to ink).
- No glass, no gradients, no dot grid, no stacked paper.

## Motion

- Signature curve: `--ease-ledger: cubic-bezier(.22, 1, .36, 1)`. Every transition and animation on the page uses it, including the cell ring.
- Hover and press: 120ms. Dialogs (`--sheet`): 150ms, opacity and `scale(.98)`. Value written into a cell: 180ms. Tick or flag: 160ms.
- Only `opacity` and `transform` are animated in keyframes. Transitions touch colour, background, border colour, opacity and transform only.
- Reduced motion: no write animation (values and marks are drawn in place), no dialog animation, transitions at 0s.

## Layout

- Max width 1266px (Equals), gutter `clamp(16px, 3vw, 32px)`.
- Hero is left-aligned and asymmetric: one mono label, the headline across the full width, then a 5 / 7 split: the lede on the left, a ruled three-row fact table on the right. Nothing centred.
- The app is one ledger window: toolbar, GST strip, then inbox / invoice / review at 1280px and up (15rem / fluid / 23rem), two columns from 896px, one column below.
- The inbox is numbered like spreadsheet rows. The invoice sheet has a red margin rule, with row numbers in the margin.
- The rules section is a 7 / 5 split, not three cards: two ruled tables on the left, "What it does not do" on a blotter panel on the right.
- No row of three equal cards anywhere.

## Product animation

When a bill is opened (and once on load for the bill that opens first), its values are written into the invoice sheet one after another: each line's item, quantity, unit price and amount rise into place in turn (40ms apart, 90ms between rows, shorter for long bills so it never passes 1.6 seconds), the amount cell flashes a red-ink ring, and the line's tick or flag lands 120ms after its amount. Then subtotal, GST and total are written the same way, each with its own tick or flag 120ms later. The whole bill settles in about one second. Editing a number does not replay it. The schedule comes from one function, `writeSchedule()` in `invoice-page.js`, and a test checks every mark lands 80 to 150ms after its value.

## Never

Inter at default settings, `#000` text, Tailwind default easing, one big shadow on every card, purple to blue gradient, emoji icons, centred everything, stock photos, a headline any competitor could use, three equal cards, generic fade-ups.

## Pre-ship checklist

Run on 10 November 2026 in Chrome (headless, Playwright) at 390 px (2x, touch) and 1440 px, light and dark, plus reduced motion. Each item lists what was measured.

| Item | Result | Measured |
|---|---|---|
| Font chosen on purpose and tuned | Pass | h1 Instrument Serif 400 at 112px (1440) and 56px (390), tracking -2.24px / -1.12px (-0.02em), line-height 1.0. Geist text, Geist Mono labels at 12px +0.06em uppercase. All fonts load from `assets/fonts/ledger` (4 requests, all 200). |
| No pure black text; neutrals tinted; 3 to 4 step text ramp | Pass | Ink `#26231e` / pencil `#5a5448` / graphite `#655e51` on paper `#f4f0e6`; dark `#eee8dc` / `#b5ac9b` / `#a0978a` on `#15130f`. A test fails on `#000000` or `#ffffff` in either theme. |
| Accent appears in 3 places or fewer per screen | Pass | Red ink found by a computed-style scan in 2 static places at every size and theme: the open bill's marker and the invoice margin rule. The focus ring is the third, only while something has focus. The cell ring is transient and ends at opacity 0. |
| Borders are low-alpha; shadows tiny or absent | Pass | Hairlines `0.5px rgba(38,38,38,.12)` (Chrome draws them as one device pixel: 1px at 1x, 0.5px at 2x). Elements with a shadow blur over 2px: 0. The only shadow is the pill's `0 1px 2px`. |
| Radius values come from the system, including one distinctive value | Pass | Only 3px, 4px, 6px and the 999px pill. A test fails on any other radius. |
| One signature easing curve, not the framework default | Pass | `cubic-bezier(.22, 1, .36, 1)` on every transition (120ms) and animation; a test fails on `cubic-bezier(.4, 0, .2, 1)` or on any animation without it. |
| At least one animation that shows the real product working | Pass | On load and when a bill opens: 30 animations (values, cell rings, marks). Every tick or flag lands 120ms after its value (sampled: 120, 120, 120, 120, 120, 120, 120). Settled after 2.5s: 0 running, all values and marks at opacity 1. Editing a number does not replay it. |
| Real screenshots, data or photos, no stock or abstract filler | Pass | The page is the working checker on the four sample bills; no images or decoration. |
| No row of three identical cards | Pass | The old three-card hero row and three-card rules grid are gone: a ruled fact table and a 7 / 5 rules split. Count of `.grid-cards`: 0. |
| Headline names something only this product does | Pass | "Each invoice is matched to its purchase order, line by line." A test checks it names the purchase order and the line by line match. |
| Phone width, light/dark, contrast 4.5:1, reduced motion all checked | Pass | No horizontal scroll at 390 or 1440 (scrollWidth equals clientWidth). axe-core WCAG 2 A/AA: 0 violations in all four views. Lowest text contrast from tokens: 4.71:1 light (red ink on blotter), 5.56:1 dark. Field borders 3.30:1 and 3.41:1. Focus ring 2px solid red ink. Reduced motion: 0 animations, everything visible at once, dialogs open without animation. |

Feature check in the same run: j, k, a, h and ? work and do nothing while typing; Copy query writes the supplier message to the clipboard and shows "Copied" for 1.5s; the New check form takes a two-row spreadsheet paste and adds the bill; entering the same invoice number again is held as a possible duplicate; the GST box reports valid and invalid numbers; the cents tolerance changes the result; the print stylesheet hides the inbox and shows the print heading; the theme switch works. No console errors.
