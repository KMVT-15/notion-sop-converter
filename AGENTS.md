# AGENTS.md: City SOPs website

Handoff notes for anyone (human or agent) working on this project. [README.md](README.md) covers how to use it.

## What this is

A Node static-site generator. It reads the KMVT city SOPs from Notion with an integration token, then writes a folder with an `index.html` listing the SOPs and one `<slug>.html` per SOP. The folder is hosted on KMVT's internal network behind the VPN: **no auth**, rebuilt by hand (`npm run build`) or by a cron job the owner sets up (`npm run build:if-changed`, added on request 2026-10-10). Those were the owner's decisions; don't add CI, other scheduling or login without asking.

Source page: Notion **Endeavors › City SOP Improvements › City Operations** (`3f47446c6b1f80e4bb50f410da1d15b3`). Don't confuse it with the older **Wiki › City Operations**. The production build must use the API token, never the Claude Notion connector.

This replaced `reference/python-tool/kmvt_sop.py`, a single-file HTML exporter. That tool, its docs and an example output (`reference/Sunnyvale.html`) are kept as reference; don't delete them.

## The look is a fixed spec

The SOP page design was approved by the owner over several review rounds. **[reference/python-tool/AGENTS.md](reference/python-tool/AGENTS.md) §3–§11 still bind:** cards, callout tones, step badges, a/b/c list lettering, ink headings with only the title blue, no decorative rules, print rules, type scale, colors.

- `assets/css/sop.css` is that tool's CSS **plus the owner-approved changes listed in `tests/parity/approved-css-changes.js`**. `npm run test:parity` fails on any other difference. To change the look, get the owner's OK, then add an entry there.
- **Approved changes so far:**
  - 2026-10-09: photos are as wide as their container (was max 3.2in × 2.2in), capped at 4.5in tall, with no border or white background. This supersedes the photo-size rules in the reference AGENTS.md §8. Print now runs longer: Sunnyvale is 6 Letter pages with its fixture photos.
  - 2026-10-09: the **kmvt15.org** text at the top right of the header was removed (owner request). The header is now just the lockup and the purple rule.
  - 2026-10-09: the on-screen **Print / Save PDF button was removed** (owner request), along with its CSS. Browser printing (⌘P) still uses the print styles and footer.
  - 2026-10-09: on screen the background is plain white, with no "paper sheet" (no gray surround, shadow or rounded edge). Content stays centered at max 8.5in with the same padding. This supersedes the reference AGENTS.md §3.3 and §11 screen look; print is unchanged.
- Website-only styles (home page list, logo link, photo viewer, link buttons) go in `assets/css/site.css`.
- **No blue outlines after mouse use** (owner request). In-page link targets aren't highlighted, and the photo viewer drops focus when opened by mouse so no focus ring appears when it closes. Keyboard-only focus rings (`:focus-visible`, shown when tabbing) stay for accessibility.

## Pipeline

```
src/build.js     CLI + orchestration: list SOPs, load all, convert all, render all, write, swap in
src/notion.js    REST client: API version 2022-06-28 (pinned), 3 in flight, global back-off on 429, pagination
src/load.js      async: fetch block trees in parallel; drop skipped sections BEFORE fetching them;
                 attach children / inline databases / downloaded assets to the raw blocks
src/convert.js   pure: raw blocks -> document model (port of the Python Converter)
src/render.js    pure: model -> body HTML (port of the Python Renderer), plus anchor ids
src/rich-text.js rich_text -> inline HTML (whitespace-outside-annotations rule, etc.)
src/links.js     Notion hrefs -> "#b-<block>" / "<slug>.html#b-<block>" / notion.so
src/assets.js    download + resize photos and icons to WebP (sharp; heic-convert for iPhone HEIC), attached files;
                 cache in .cache/ keyed on the URL without its X-Amz signature
src/pages.js     page shells: SOP page (sheet, @page footer) and home page
src/serve.js     local preview server only
assets/          logo.svg (brand artwork; never retype it), css/, fonts/ (Jost, OFL)
```

Order matters in `build()`: **every** page is converted before **any** page is rendered. Links on page A can point at a block on page B, and B's block only gets its `id="b-…"` if something links to it.

## Website decisions (on top of the print spec)

- **Flat files with relative links** (`sunnyvale.html`, `assets/…`). This works at any URL path, on any web server, and from a file share. Don't switch to `/sunnyvale/` folders.
- **Shared assets** instead of base64 embedding. Images get content-hashed names; the CSS link has a `?v=hash` query.
- **Logo links home** on SOP pages. The owner said a back button isn't needed, so there's no visible one.
- **Link rewriting:** see `links.js`. Only blocks that are actually linked get an id, so the markup stays identical to the Python tool. If a linked block isn't on the site, the build warns.
- **Notion-hosted attachments are downloaded**, because their signed URLs expire in about an hour.
- **Photo viewer** (owner request, 2026-10-09):
  - `assets/site.js` makes each `figure.photo img` open full screen in a `<dialog>`. Esc, a click, or × closes it, and it works by keyboard too.
  - Markup is untouched; the script adds `role`/`tabindex` at runtime.
  - This supersedes the reference rule "no JavaScript beyond the print button".
  - Photos are stored at up to **2000px** (`PHOTO_MAX_PX`; the Python tool used 1400). That keeps typical screenshots at full resolution for the viewer.
- **All photos and page icons are WebP, quality 85** (owner request), with transparency kept. On the real Sunnyvale images this cut 5.9 MB of PNG/JPEG to 1.1 MB, and UI text is indistinguishable at 1:1. SVGs pass through unchanged. No PNG/JPEG fallback: every current browser, and Chrome's print, handles WebP.
- **Image cache:** keys include size + format (`RECIPE`), so changing either re-processes everything. After a successful build that downloaded images, entries the build didn't use are deleted (`pruneCache()`). It's skipped with `--no-images`, which would otherwise empty the cache.
- **Checkable to-dos** (owner request): `assets/site.js` turns each `.checklist` item's `.box` into a `role="checkbox"`. Clicking the box or the item's text toggles it, but not clicks on links, photos or tables, or on nested items. Checked items get Notion-style gray strikethrough (`li.done`). Ticks are deliberately **not saved**: reloading starts a fresh list (owner decision; a 12-hour `localStorage` memory was tried and removed). Markup is untouched (parity).
- **Site links are gray** (owner request): `rich()` adds `class="internal"` to relative links (in-page anchors, other SOP pages), styled `--muted` with a soft underline like Notion's page links. External links stay blue.
- **External links open in a new tab:** `linkTarget()` in html.js adds `target="_blank" rel="noopener"` to absolute http(s) links. Site links are always relative, so they never get it.
- **Map tiles** (owner request, `src/maps.js`): a paragraph that's only a Google Maps link (text link or `link_mention` chip) becomes `div.map-tile` with Google + Apple Maps buttons. Short links are resolved at build time by following redirects (`redirect: "manual"`, up to 5 hops). Coordinates/name are parsed from the full URL: `!3d…!4d…` pin > `/search/` or `?q=` coordinates > `/place/<name>` > `@lat,lng` center. Google button: Google's documented cross-platform format `google.com/maps/search/?api=1&query=<lat>,<lng>`, never the author's `maps.app.goo.gl` short link, which the Google Maps phone app rejected as "unsupported link" (owner report); the short link is only a fallback when unresolved. Apple link: `maps.apple.com/?ll=<lat>,<lng>&q=<label>` (checked: opens 650 W Olive Ave for Sunnyvale). Results cache in `.cache/assets/maps.json` (only links used by the last build). Title = link text > Google place name > "Location". The build warns, with no Apple button, if a link can't be resolved.
- **Buttons:**
  - Notion's API returns button blocks as `{"type": "unsupported", "unsupported": {"block_type": "button"}}`, with no label or URL. This is true in both 2022-06-28 and 2025-09-03 (checked against the live page).
  - The build counts unsupported blocks per page and warns.
  - Stand-in convention: a paragraph whose only content is one link (not a bare URL, not code) renders as `<a class="button">`, and consecutive ones share one `<p class="buttons">` row (`linkButton()` in convert.js).
- **Dates use `timezone`** (default America/Los_Angeles). The Python tool showed UTC, so its "Updated" date could be a day ahead in the evening. Date-only values are never shifted.
- **Home page:** the same sheet, header and title styling as the SOPs. It's a list of card-style rows (page icon or initial, title, Updated date), in Notion's order. Template is excluded via config.
- **Change detection for cron** (`src/changes.js`, `src/build-if-changed.js`):
  - Every build writes a JSON **snapshot** into the output folder's `.city-sops-build` marker: the SOP list (ids, titles, order), each SOP page's `last_edited_time`, each inline database's rows (ids + `last_edited_time`, hashed), the parent page's time, a hash of the settings (minus outDir/cacheDir), and `takenAt`.
  - `takenAt` uses Notion's own clock (the `Date` header, `api.serverDate`).
  - The checker takes the same snapshot with only timestamp requests: parent page, its children, each SOP page, and each database known from the last snapshot. If `describeChanges()` returns reasons, it spawns `node src/build.js` with the same args, using `process.execPath` because cron's PATH is minimal.
  - Inline database row edits don't bump the page's time, which is why rows are tracked separately. New databases show up as a page edit.
  - **Notion's times are rounded to the minute:** anything edited within `SETTLE_MS` (2 min) of the previous `takenAt` triggers one more build.
  - **Lock:** `<cacheDir>/build.lock` (pid). `npm run build` takes it, and refuses to start while another live build holds it. The checker silently skips while it's held. A dead holder's lock is taken over.
  - An old plain-text marker, or none, means "no previous build", so the checker rebuilds once.
- **Settings:** `sop.config.json` is shared and in git (no secrets; the token is in `.env`). A git-ignored `sop.config.local.json` overrides it per machine, e.g. the server's `outDir: /var/www/sops`, because `/root` isn't reachable by nginx. `outDir`/`cacheDir` may be absolute or relative to the config file.
- **Safe output swap:** build into a hidden temp folder next to `outDir`, then `makeReadable()` it (folders 755, files 644, whatever the umask; `mkdtemp` alone is owner-only), then rename it into place. Served by nginx straight from `dist` (owner, 2026-10-10). The site needs no chown. If deleting the previous copy fails afterwards (e.g. someone chowned it to www-data), that's a warning, not a failed build, because the new site is already live. The build refuses to replace a non-empty folder without the `.city-sops-build` marker, since `--out` might be pointed at a shared web root.

## Testing

- `npm test`: node:test. Unit tests plus an end-to-end build against `tests/fake-notion.js`, which serves `tests/fixtures/notion.js`. Pages are 2 results long and the first 2 requests return 429, so pagination and retry are always exercised. It asserts that Change Log content and excluded pages are never fetched.
- `npm run test:parity`: runs the original Python tool and the Node port against the same fake API and diffs the body markup. Image/link URLs, width/height and anchor ids are normalized first. It must stay identical.
  - The fake API runs in the test process, so the Python child must be spawned **async**: `execFileSync` deadlocks.
- `tests/build-if-changed.test.js` runs the real checker CLI as cron would (async `execFile`, `NOTION_API_BASE` pointed at the fake API, a temp config with its own `cacheDir`) and edits the fake workspace between runs.
- `npm run demo`: builds the fixture workspace into `.demo/`. `node tests/render-check.js <page> <dir>` takes screenshots and a Letter PDF via headless Chrome; inspect with `pdftoppm -r 50 -png`.
- **Fixtures:**
  - Sunnyvale is the real page's content, rebuilt in API shape, with generated images.
  - Example City is fixture-only and covers blocks the real SOPs don't use yet.
  - The two HEIC files are real HEVC HEICs made with macOS `sips`.

## Gotchas

- `sharp`'s prebuilt binaries can't decode HEVC HEIC, which is why `heic-convert` exists. It's imported lazily because it's a large wasm module.
- `sharp` is pinned to an exact version. Check `npm audit` when bumping it (0.35.5 fixed a librsvg CVE).
- **Checked against the live API (2026-10-09):**
  - Column `width_ratio` is returned: Sunnyvale renders 0.4375fr/0.5625fr.
  - Links to blocks resolve to in-page anchors.
  - A gray table *column color* isn't exposed, so it's unshaded; use "Header column" instead.
  - Buttons are unsupported (see above).
- **Never print or read `.env`.** The build loads it itself.
