# AGENTS.md: KMVT SOP → printable HTML

Handoff notes for anyone (human or agent) continuing this project. The README covers how to *use* the tool. This file covers **how the output must look and why**, plus how to change it safely.

---

## 1. What this project is

KMVT 15 (Silicon Valley Community Media) writes its city-meeting SOPs (City Council, Planning Commission, etc. for Sunnyvale, Mountain View, Los Altos, Los Altos Hills, SVCEA, LAH Fire District) in Notion, from a shared **Template** page. `kmvt_sop.py` turns one SOP page into **one self-contained, printable, brand-consistent `.html` file**. Optionally it also makes a PDF via headless Chrome or Edge.

The output is printed on **US Letter** and handed to operators. It's also opened on screen. The design was iterated with the owner (William Gardner, KMVT technical support). The decisions in §3 are **approved requirements**, so don't change them without asking.

## 2. Files

```
kmvt-sop/
  kmvt_sop.py      single-file tool: Notion API → block model → HTML. Stdlib only.
                   Contains the full CSS (CSS = r"""…""") and the logo SVG (LOGO_SVG).
  fonts/           Jost woff2 (400/500/600/700/800 + 400 italic) + OFL license. Base64-embedded at build time.
  README.md        setup + usage for the end user
  AGENTS.md        this file
  tests/           mock Notion API harness + render/QA helper (see §12)
```

There's no separate CSS file or template engine. **All styling lives in `CSS` in `kmvt_sop.py`.** Per-document CSS (the `@page` footer text) is generated in `build_html()`.

Code constraints:
- **Python 3.8+.** macOS's system `python3` may be old.
  - **No backslashes inside f-string `{…}` expressions.** That's a SyntaxError before Python 3.12. Assign to a variable first.
  - No `match`, and no `X | Y` type hints.
- **Standard library only.** Pillow and pillow-heif are optional, imported in try/except.
  - macOS `sips` is the fallback for HEIC conversion and resizing.
  - `certifi` is used if present, to work around python.org SSL certificate issues.

## 3. Approved design decisions (requirements)

These came straight from the owner's review rounds:

1. **Cards stay cards; 2 columns stay 2 columns.** Every top-level Notion callout with the default or gray color becomes a "card". Column lists stay side-by-side in print and only stack on narrow screens.
2. **Target US Letter, but stay paper-agnostic.**
   - The CSS deliberately does **not** set `@page { size }`, so A4 also works.
   - Layout is fluid inside the page box.
3. **Screen vs. print:**
   - **On screen:** a centered white "sheet" (max 8.5in wide, with padding and shadow) on a gray background, plus a floating "Print / Save PDF" button.
   - **In print:** none of that chrome. The only margin is `@page{margin:.5in .5in .55in}`; the extra bottom margin is room for the footer.
   - The owner said "don't use margins when printed". We interpreted that as no screen padding or centering in print, while keeping the 0.5in printer-safe page margin. Changing it is a one-line edit.
4. **No changelog.**
   - Any heading titled "Change Log" or "Changelog" is skipped, along with everything under it until the next heading of the same or higher level.
   - Databases with those titles are skipped too.
   - Skipped sections are **never fetched**.
   - Add more titles with `--skip`.
5. **Callout colors keep their meaning:**
   - **Purple** = troubleshooting (bug icon).
   - **Red** = warning (warning-triangle icon).
   - Both get a 3pt left accent bar so they're still distinguishable on a B&W printer.
6. **Brand title hierarchy, adapted for print.** The guide's screen sizes don't translate to paper, so the sizes are in pt (§6).
7. **Dial back color in the typography** (round 2 feedback):
   - Every heading is ink-colored. The **only colored text heading is the document title (brand blue)**.
   - The eyebrow label, "kmvt15.org", ordered-list markers and UI-path underlines are ink or muted gray.
   - Color is reserved for the logo and header rule (purple), step badges (blue), checkboxes (purple), callouts, and tags.
8. **Ordered lists letter the way Notion does:** top level 1. 2. 3., one level deep (including inside a callout or card) a. b. c., two deep i. ii. iii., then it cycles. Steps inside meeting-instruction cards therefore show a/b/c.
9. **No rule lines after headings** (round 3). An earlier version drew a hairline extending from section headings, and the owner removed it. Don't add decorative rules.
10. Additions the owner accepted, so keep them:
    - KMVT 15 lockup header with a purple 2.5pt rule
    - "Standard Operating Procedure" eyebrow
    - "Updated ‹Notion last-edited date›"
    - Numbered blue badge for "Step N: …" headings
    - Printable empty checkboxes for to-dos
    - "KMVT 15 · ‹Title› SOP" / "Page X of Y" footers
    - Print button on screen

## 4. Brand foundations (from *2026 KMVT Brand Guide*)

**Colors**

| Name | Hex | RGB | CMYK | Pantone |
|---|---|---|---|---|
| Purple (primary, logo) | `#7a257a` | 122 37 122 | 62 100 17 4 | 249 C |
| Blue | `#5275ba` | 82 117 186 | 73 53 0 0 | 7456 C |
| Green | `#009d84` | 0 157 132 | 82 15 59 1 | 3285 C |

- The guide also lists "overlapping light" tints (`0050ba`, `0090bd`, `00587f`, `4e21b8`). They aren't used here.
- **Gradient rules:**
  - Don't put purple between blue and green.
  - Don't fade gradients over black.
  - No gradients are used in this project.

**Typography**
- **Headings: Brandon Grotesque.** The guide uses it bold or black, and never for body text. Avoid ALL-CAPS headings except for acronyms. "Bold all-lowercase" headings are for playful or creative graphics only, not SOPs.
- **Body: Futura PT Book.**
- **Guide hierarchy:** Heading → Subheading (both blue, Brandon) → Lead (Futura, larger) → Body → Button.
- **Here:** Brandon and Futura PT are commercial (Adobe Fonts), so the CSS asks for them first, by local name, and falls back to **Jost**.
  - Jost is a free (OFL) Futura-style font, embedded in every file so print is identical offline.
  - Headings use Jost 700/800 as the stand-in for Brandon Bold/Black.
  - Font stacks: `--font-head: "Brandon Grotesque","brandon-grotesque","Jost","Futura PT",system-ui,sans-serif`; `--font-body: "Futura PT","futura-pt","Jost","Futura",system-ui,sans-serif`.

**Logo**
- Header uses the **horizontal lockup "KMVT 15 / Silicon Valley Community Media"** in brand purple.
  - It was extracted as vector paths from the brand guide PDF (page 11, the small top-left lockup that the guide uses as its own letterhead).
  - Stored as one compact path with `fill="currentColor"` in `LOGO_SVG` (viewBox `0 0 710.2 92.9`), and rendered at 30pt tall.
- Guide rules to respect:
  - **Never retype** "MVT" or "Silicon Valley Community Media". Use the provided artwork unmodified.
  - The logo may be recolored only to brand purple, blue, green, black or white.
  - Keep clear space equal to one of the mark's squares.
  - For very small print, use the mark alone.
- `.lockup` has explicit `aspect-ratio` + `flex:none`. Without them, Chrome shrank it in the flex header and clipped "Media". Don't remove them.

## 5. Page anatomy (top to bottom)

1. `.doc-head`: lockup (left) + "kmvt15.org" (right, muted, 9pt Brandon), with a **2.5pt purple bottom rule**.
2. `.title-block`:
   - eyebrow "Standard Operating Procedure" (9.5pt, muted)
   - **document title** (26pt, heading font 800, **blue**)
   - "Updated October 10, 2026" (9pt, muted), from the page's `last_edited_time` in "Month D, YYYY" format
3. Body content, in Notion order.
4. Print footer (CSS `@page` margin boxes, Chrome/Edge 131+ only; Safari omits it):
   - bottom-left "KMVT 15 · ‹Title› SOP"
   - bottom-right "Page X of Y"
   - both 8pt, muted

## 6. Type scale (print-first, in pt)

| Element | Font | Size | Weight | Color | Margins (top/bottom) |
|---|---|---|---|---|---|
| Body | body | 10.5 / lh 1.45 | 400 | ink `#231f2a` | p: 0 / 5 |
| Doc title | head | 26 / lh 1.05 | 800 | **blue** | n/a |
| Notion H1 (`h2.h1`) e.g. "Overview", "Meeting Instructions" | head | 19 | 800 | ink | 20 / 8 |
| Notion H2 at top level (`h3.h2.section-head`) e.g. "Before Meeting" | head | 13 | 800 | ink | 12 / 7 |
| Notion H2 inside a card (card title) e.g. "Quick Checklist" | head | 14 | 800 | ink | 14 / 7 |
| Notion H3 (`h4.h3`) | head | 12 | 700 | ink | 10 / 5 |
| "Step N: Title" H3 inside a card | head | 12.5 | 800 | ink, plus blue badge | n/a |
| Notion H4 (`h5.h4`) e.g. "Before Meeting" inside the checklist | head | 10.5 | 700 | ink | 9 / 3 |
| Contact name | head | 11 | 700 | ink | n/a |
| Contact props, tags, captions | body | 9 / 8 / 8.5 | n/a | muted | n/a |
| Tables | body | 9.5 | n/a | ink | n/a |
| Footer | body | 8 | n/a | muted | n/a |

- Notion heading level N renders as HTML `h{N+1}` with class `hN`, because the doc title is the only `h1`.
- First and last children of cards, callouts, columns and mini-cards get zero outer margin.

## 7. Color usage

- **Ink** `#231f2a` for text and headings.
- **Muted** `#6f6a76` for meta text, Notion "gray" text, and descriptions.
- **Rule** `#e2dee7`.
- **Card** background `#f5f4f2` with border `#e4e1e6`.
- `print-color-adjust: exact` is set on `html`, so backgrounds print.
- **Callout tones** (background / accent bar and icon):

  | Tone | Background | Accent |
  |---|---|---|
  | gray | `#f1f1ef` | `#787774` |
  | **purple** | `#f3eaf3` | `#7a257a` |
  | **red** | `#fceae9` | `#c4332b` |
  | blue | `#e9f0f8` | `#5275ba` |
  | green | `#e6f4f1` | `#00826d` |
  | yellow | `#fbf3db` | `#b07d14` |
  | orange | `#fbecdd` | `#c86410` |
  | brown | `#f4eeee` | `#8f5f49` |
  | pink | `#faf1f5` | `#b8417f` |

  Purple and blue use the brand hexes; the rest are Notion-like.
- **Notion select tags** (light background / dark text):
  - purple `#efe2ef`/`#7a257a`
  - blue `#dfe7f4`/`#34548f`
  - green `#d9efea`/`#00705e`
  - yellow `#fbecc4`/`#7a5512`
  - red `#fde0dc`/`#9b2a22`
  - orange `#fadec9`/`#8a4310`
  - pink `#f5e0e9`/`#8c2e5e`
  - brown `#eee0da`/`#5f3a2a`
  - default `#e3e2e0`/`#32302c`
- **Notion text colors:** `color` becomes class `c-‹color›`, and `‹color›_background` becomes class `hl-‹color›` (a highlight).

## 8. Components and their rules

**Card (default or gray top-level callout)**
- Rounded 7pt, 0.75pt border, padding 11/13/10pt, 9pt gap below.
- `break-inside: avoid`, so the card never splits across pages.
- **Exception:** a card containing a photo gets `.has-media`. It may split, but only *between* list items (`li` avoids breaks), and `box-decoration-break: clone` gives each fragment its own border and radius. This stops tall photo cards from leaving half-empty pages.
- A gray callout *nested* in something renders as a gray `.callout`, not a card.

**Colored callout (`.callout.tone-X`)**
- Flex row: 14pt icon + body. 3pt left accent bar, radius 5pt, padding 8/11/7/9pt. Never splits.
- The callout's own first line (often bold, e.g. "**Do not click…**") renders as a paragraph. The gray follow-up text is muted.
- **Icons** are inline SVG (stroke 1.8, `currentColor` = accent), mapped from Notion's built-in icon name: `bug`, `warning`/`error`/`alert`, `info`, `lightbulb`, `checkmark`.
  - Emoji icons render as text.
  - With no or unknown icon, the default comes from tone: red → warning, purple → bug, yellow → lightbulb, green → checkmark, else info.
  - Don't use Notion's icon image URLs; they're not reachable offline.

**Step heading.** A heading inside a card matching `^Step\s+(\d+)\s*[:.\-–—]\s*(.*)$` becomes a 17pt blue circular badge with the white number, then the title. The "Step N:" text is dropped. Only applies at depth > 0 (inside a card).

**Ordered list (`ol.steps`)**
- Custom counter. Marker is 600 weight, ink, right-aligned in a 12pt gutter with a 17pt indent.
- Style comes from nesting depth (§3.8). Classes are `.alpha` and `.roman`.
- Custom start numbers are honored via an inline `counter-reset`.
- Children such as images, tables, quotes and nested lists sit inside the `li`, under the text.

**To-do (`ul.checklist`)**
- Each item is a 10pt square with a 1.1pt **purple** border and white fill, for ticking with a pen.
- Checked items are filled purple with a white inset.
- Empty to-dos still render a box (a blank line to fill in).

**Columns (`.columns`)**
- CSS grid with `grid-template-columns` from the column width ratios (`25fr 75fr` etc.); equal when the API gives none. Gap 14pt.
- Stays multi-column in print. Below 720px on screen it stacks.
- Columns are **not** a nesting level for list lettering.
- Paragraphs consisting of inline code (schedule times) get line-height 1.9, so stacked chips don't touch.

**Inline database (e.g. Contact Info) → gallery of mini-cards**
- 3-column grid, 7pt gap. Each card is white with a 0.75pt border, radius 5pt, and never splits.
- **Property order by type:** title → text → phone → email → url → number → date → people → checkbox → status → select → multi-select → formula.
- **How each property looks:**
  - Title: name style.
  - Text: muted.
  - Phone and email: ink `tel:`/`mailto:` links with no underline.
  - Selects: colored tags.
- Empty properties are omitted. Relations and rollups are ignored.

**Tables (`table.simple`)**
- `width:auto` (not full width), white background, 0.75pt border, radius 4pt, 9.5pt text, cell padding 3.5/7pt, hairline row rules, no rule on the last row. Never splits.
- Header row (`th`): heading font 700 on `#f6f5f3`.
- **Row-header column** (Notion "header column", or a gray-colored first column): `td.shade`, `#f6f5f3` background, weight 500.
- Inline code in tables doesn't wrap.
- Tables inside list items get 4pt top margin.

**Images (`figure.photo`)**
- Embedded as a base64 data URI.
- Downscaled to a 1400px long edge.
  - Photos and HEIC become JPEG quality 82; PNGs with alpha stay PNG.
  - EXIF orientation is honored.
- Displayed at **max 3.2in wide × 2.2in tall**, left-aligned, radius 4pt, 0.75pt border. Never splits.
- Caption is 8.5pt muted.
- If download fails: a 2.2×1.4in dashed, hatched placeholder "Photo not available / ‹filename›", and the script warns.
- Notion's signed file URLs expire (~1h), so download during the run, never later.

**Quote.** 2.5pt ink left bar, 9pt padding, ink text. Example: the Teams check-in message in the Sunnyvale SOP.

**Code block.** Monospace 8.8pt on `#f4f3f5`, wraps.

**Inline code.** Monospace 0.86em, `#efedf1` background, 0.5pt border, radius 3px, `nowrap` on screen (wraps in print). Used for credentials, filenames and schedule times.

**Divider.** 1pt rule.

**Toggle.** Printed expanded, with the summary in 600 weight.

**Toggleable heading.** Printed expanded.

**Bookmark, embed, file, PDF, video.** Plain link with caption or filename.

**Child page.** Bold title text.

**Skipped:** buttons, table of contents, breadcrumbs, link-to-page, unsupported blocks, and empty paragraphs.

## 9. Inline text rules

- **Bold** → `<strong>` at 600, not 700 (Jost 700 looks heavy at body size). Italic → `<em>`. Strike → `<s>`.
- **Underline** → `span.u` (1pt, offset 2pt, `currentColor`). In these SOPs underline marks **UI click paths** ("Scheduling > Classic", "Save"), so keep it.
- **Whitespace inside annotations:** Notion often stores a trailing space *inside* an italic or bold run ("*CLK-01 *port"). Always move leading and trailing whitespace outside the tag, or you get "CLK-01port" or stray asterisks.
- **Empty formatting runs** (e.g. an italic that's only a space) collapse to the space.
- **Mentions:**
  - Users render as "@Name" in 600 weight.
  - Pages render as the title in 600 weight.
  - Dates use "Month D, YYYY".
- **Links:**
  - On screen, links are blue with a 0.5pt underline.
  - **In print, all links are ink with no underline.** The text is already readable as written, e.g. "https://playback.mv.kmvt.net".
  - Relative Notion links (`/p/…#block`, e.g. glossary cross-references like *Operator PC*) get `https://www.notion.so` prefixed. They print as plain text.
- Line breaks inside a block (`\n`) → `<br>`.

## 10. Pagination rules (print)

- Headings: `break-after: avoid`.
- Never split: cards (except `.has-media`), callouts, mini-cards, tables, figures, and list items inside media cards.
- Expected trade-off: if a step and its screenshot don't fit, they move to the next page together and can leave a gap. That's accepted; the owner preferred it to splitting a step from its picture.
- Reference sizes:
  - Template: 2–3 Letter pages.
  - Sunnyvale: 4 pages, with photos still to be added.

## 11. Screen-only behavior

- Body background `#e9e6ec`. Sheet is white, max 8.5in, padding .55/.6/.65in, margin 28px auto, soft shadow.
- Print button is fixed top-right, purple, hidden under 900px wide and in print.
- **Under 720px:** sheet goes full-bleed with a 16px side gutter, columns and gallery go to a single column, and "kmvt15.org" is hidden.
- No dark mode on purpose. It's a paper document.

## 12. QA / testing

- **Render check:** open the HTML in Chromium (Playwright works) and do three things:
  1. Take a full-page screenshot at 1200px and 390px wide.
  2. `page.pdf(format='Letter', print_background=True, prefer_css_page_size=True)` after `emulate_media('print')`.
  3. Rasterize the PDF with `pdftoppm -r 80`, then look at every page: page count, breaks, clipped logo, stray `*` or `**`, footers present.
- `tests/render_check.py <html> <outdir>` does steps 1–2 and writes `print_a4.pdf` too.
- **Mock API:** `tests/mock_test.py <path/to/kmvt_sop.py> <tmp-dir> <out-dir>` builds a fake Notion API response of the Template page and runs the real `main()`.
  - Covers callouts, columns, to-dos, the contact database, Step headings, and HEIC/PNG images served from `file://`.
  - Asserts the Change Log database is never queried.
- Headless Chrome as root (CI or containers) needs `--no-sandbox`. On a Mac it doesn't.
- Before shipping, run a Python 3.8 syntax check (at minimum, no backslashes in f-string expressions).

## 13. Known limitations / open items

- **Column ratios:** the public API may not return column widths, so they fall back to equal widths. Notion shows Template Program Scheduling at 25/75 and Sunnyvale Playback Scheduling at 43.75/56.25. If a newer API version exposes `width_ratio` on column blocks, it's already read.
- **Table column widths** from Notion aren't in the API; tables auto-size.
- **Linked databases** (views of a database elsewhere) can't be read.
- **Database view type and property order:**
  - Neither is exposed, so every inline database renders as gallery cards with type-based ordering.
  - If an SOP needs a table-style database, add a flag (e.g. `--db-as-table TITLE`) and render `table.simple`.
- **Page icon and cover image** are deliberately not used (ink; brand header instead).
- **Footers** need Chrome/Edge 131+. Safari and Firefox print without them.
- Content gaps in the Notion SOPs themselves (empty checklists, "NEW PHOTOS NEEDED" placeholders, the template's sample callouts left in Sunnyvale's Glossary) print as-is. The tool doesn't edit content.

## 14. If you change the look

- Edit `CSS` in `kmvt_sop.py`. Keep tokens on `:root`, and keep sizes in **pt** (print-first).
- Re-run the mock test plus the render check, and compare against the approved look:
  - ink headings
  - blue title only
  - no heading rules
  - a/b/c steps
  - purple/red callouts with accent bars
  - 2–3 page Template
- Don't introduce:
  - external runtime dependencies (web fonts are embedded; the Google Fonts `<link>` is only a fallback if `fonts/` is missing)
  - JavaScript beyond the print button
  - colored headings
  - decorative rules
