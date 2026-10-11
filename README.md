# City SOPs website

Builds a small website from the KMVT city SOPs in Notion: a home page that lists every SOP, and one page per SOP in the approved printable KMVT design (the same look as the old single-file export). The output is a plain folder of HTML, CSS, fonts and images, with no server code, so any internal web server can host it.

Source: **Endeavors › City SOP Improvements › City Operations** in Notion. Every page directly under it becomes an SOP, except `Template`.

---

## One-time setup

**1. Node.js 20.12 or newer.** Check with `node --version`. Then, in this folder:

```bash
npm install
```

**2. A Notion integration** (skip if you already made one for the old Python tool):
1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
2. Name it `KMVT SOP Export`, pick the KMVT workspace, set the type to **Internal**.
3. Under **Capabilities**, *Read content* is all it needs.
4. Copy the **Internal Integration Secret**.

**3. Give it access.** In Notion, open **City SOP Improvements** (or **City Operations**) → `•••` → **Connections** → add the integration. Every page under it, including the inline Contact Info databases, becomes readable.

**4. Save the token.** Copy `.env.example` to `.env` and paste the secret after `NOTION_TOKEN=`. The build also accepts a `NOTION_TOKEN` environment variable, or `~/.config/kmvt-sop/token` from the old tool.

---

## Building and publishing

```bash
npm run build
```

This writes the site to `dist/`. It takes a few seconds per SOP, and photos are converted to compact WebP files and cached in `.cache/`, so rebuilds are faster. Rebuild whenever the SOPs change in Notion, or let cron do it (below).

```
dist/
  index.html          list of SOPs
  sunnyvale.html      one page per SOP, named after its Notion title
  assets/             site.css, fonts, photos, page icons, attached files
```

**To publish**, copy the contents of `dist/` to the internal web server, for example:

```bash
rsync -a --delete dist/ webserver:/var/www/sops/
```

Or build straight into the served folder with `npm run build -- --out /path/to/served/folder`. The folder must be empty the first time. After that the build replaces it on every run, but only if it made the folder: it won't overwrite a folder with someone else's files in it.

All links are relative, so the site works at any URL path and even opened straight from a file share.

If a build fails (Notion is down, the token is wrong…), the previous `dist/` is left exactly as it was.

**Options:** `--out DIR`, `--no-images` (skip photo downloads; placeholders instead), `--no-cache` (re-download every photo), `--config FILE`.

**Preview locally:** `npm run serve` → <http://localhost:8080>.

### Serving it with nginx

Point nginx's `root` straight at the build folder:

```nginx
server {
    listen 80;
    server_name sops.example.internal;
    root /path/to/notion-sop-converter/dist;
    index index.html;
}
```

- **Don't `chown` the folder to `www-data`.** The build makes every file readable by everyone (files 644, folders 755), which is all nginx needs. Each build replaces the folder, so a chown wouldn't last anyway, and it stops the next build from deleting the old copy.
- **If the project lives in `/root`** (or any private folder), nginx can't reach anything inside it. Put `{ "outDir": "/var/www/sops" }` in `sop.config.local.json` and point nginx's `root` there.
- **403 Forbidden** almost always means nginx's user can't *pass through* one of the folders above `dist`. On Ubuntu, home folders are usually `750`.
  - Find the blocking folder: `namei -l /path/to/notion-sop-converter/dist/index.html`. Look for a folder without `x` in its last three permission characters.
  - Fix it with `chmod o+x` on that folder, which lets others pass through without listing it. Or build somewhere outside your home folder with `--out` (the build needs write access to the folder that contains it).
  - nginx's error log (`/var/log/nginx/error.log`) names the path it was denied.
- **SELinux** (RHEL, Fedora, Rocky): files under a home folder also need `sudo chcon -R -t httpd_sys_content_t /path/to/dist`. That has to be repeated after each build, so building into `/var/www` with `--out` is simpler.

### Rebuilding automatically (cron)

`npm run build:if-changed` checks Notion and runs the build only if something changed since the last build. It checks for:

- an SOP edited, added, removed, renamed or reordered
- a Contact Info (or other inline database) entry added, removed or edited
- a change to `sop.config.json`

It needs only a couple of Notion requests per SOP and prints nothing when there's nothing to do, so it's cheap to run often. When it does rebuild, it logs a line saying why, e.g. `[2026-10-10 18:27:03] Rebuilding: "Sunnyvale" edited`, followed by the usual build output.

Add it to your crontab (`crontab -e`). Use the full path to `node` (`which node`), because cron doesn't use your shell's PATH:

```
*/5 * * * * cd /path/to/notion-sop-converter && /opt/homebrew/bin/node src/build-if-changed.js >> .cache/cron.log 2>&1
```

Any build options are passed through, so to keep the web server's folder up to date directly, add `--out /path/to/served/folder`. Notes:

- **Code changes:** changes to this project's code or styles aren't detected; run `npm run build` yourself after updating it.
- **No overlap:** only one build runs at a time, manual or cron. A cron check that finds a build running skips that round, and the next one catches up.
- **Failures:** if a build fails, the site is left as it was and the next check tries again.
- **Minute rounding:** Notion's edit times are rounded to the minute, so an edit made within a minute or two of a build triggers one extra rebuild to make sure it's included.

---

## Settings (`sop.config.json`)

`sop.config.json` is shared (it's in git). For settings that differ on one machine, typically `outDir` on the server, create **`sop.config.local.json`** next to it with just those keys. It's git-ignored and overrides the shared file:

```json
{ "outDir": "/var/www/sops" }
```

| Key | Meaning |
|---|---|
| `rootPage` | Link to the Notion page whose sub-pages are the SOPs. Change this if the SOPs move, e.g. into the Wiki. |
| `exclude` | Sub-page titles to leave off the site (default `["Template"]`). |
| `skipSections` | Heading/database titles left out of every SOP, with everything under them (default `Change Log`, `Changelog`). They're never even downloaded. |
| `timezone` | Time zone for "Updated" dates and the build time (default `America/Los_Angeles`). |
| `outDir` | Where `npm run build` writes the site (default `dist`). Relative to this file, or absolute, e.g. `/var/www/sops`. |
| `cacheDir` | Where photos, map lookups and the build lock are kept (default `.cache`). |
| `siteTitle` | Optional. Home page title; defaults to the Notion page's title ("City Operations"). |

---

## Writing SOPs in Notion

- **New SOP:** duplicate `Template` under City Operations, rename it, fill it in, rebuild.
- **Order on the home page** follows the order of the pages in Notion; drag them to reorder.
- **Page file name** comes from the title (`Los Altos Hills` → `los-altos-hills.html`). Renaming a page changes its address, so update any bookmarks.
- **Page icon** (e.g. a city seal) shows next to the SOP on the home page. With no icon, the first letter is shown.
- **Links** between SOPs and to blocks on the same page (like the Glossary entries) work on the site, with no Notion account needed. They're gray, like Notion's links between pages. A link to anything else in Notion still opens Notion. Links that leave the site (other websites, Notion) open in a new tab.
- **Attached files** (PDFs etc.) uploaded to Notion are copied into the site, because Notion's own file links expire after an hour.
- **Maps:** a Google Maps link on its own line (pasted as a link chip, or as linked text) becomes a map tile with **Google Maps** and **Apple Maps** buttons. The build works out the Apple Maps link by following the Google link to its coordinates or place name. The tile's title is the link text, e.g. link the words `Sunnyvale City Hall parking`; a pasted chip with no name shows "Location". Google Maps links inside a sentence stay ordinary links.
- **Buttons:** Notion's API can't read Notion's own **button** blocks (it reports them with no label or link), so they're left out and the build warns. Instead, put a **link on its own line**: type the button text (e.g. `Open parking map`), select it, and add the link. On the site it becomes a purple button, and several such lines in a row become a row of buttons. A bare URL on its own line stays an ordinary link.

How Notion content is styled (same as the old tool, except photos are bigger and unframed):

| In Notion | On the site / in print |
|---|---|
| Callout (default/gray color) at the top level | Card |
| Purple-background callout | Troubleshooting box (purple, bug icon) |
| Red-background callout | Warning box (red, warning icon) |
| Other colored callouts | Matching tinted box |
| Heading inside a card starting `Step 3: …` | Blue numbered badge + title |
| Numbered list inside a card | a. b. c. (top level 1. 2. 3., deeper i. ii.), like Notion |
| To-do list | Checkboxes you can tick on screen (click the box or the text). Ticks aren't saved; reloading the page clears them. Unticked boxes print empty |
| Columns | Columns (stack on phone screens) |
| Inline database (e.g. Contact Info) | Small contact-style cards; select tags keep their Notion color |
| Images (incl. iPhone HEIC) | Converted to WebP (up to 2000px). Shown as wide as the card/column they're in (small images aren't enlarged), at most 4.5" tall, no frame. Click to view full screen |
| A paragraph that's only a Google Maps link | Map tile with Google Maps + Apple Maps buttons |
| A paragraph that's only a link | Button (printed as an outlined label) |
| Notion button block | Left out (the API can't read it); the build warns |
| Table with **Header row** / **Header column** turned on | Shaded header row / first column |
| `Change Log` heading/database | Left out |

To print an SOP or save it as a PDF, use the browser's Print (⌘P / Ctrl+P). Printed pages get the KMVT footer and page numbers (Chrome/Edge).

---

## Troubleshooting

- **`No Notion token`**: create `.env` (setup step 4).
- **`401`**: the token is wrong or was regenerated.
- **`404 … can't find that page`**: the page isn't shared with the integration (setup step 3).
- **`already has files that this tool didn't create`**: `--out` points at a folder with other files in it. Empty it, or pick another folder.
- **`! couldn't download image …`**: that photo shows a "Photo not available" placeholder. Run the build again.
- **`! … a link points to Notion block …, which isn't on the site`**: an SOP links to a block that's in a skipped section or was deleted. Fix the link in Notion.
- **`! … couldn't work out where the Google Maps link … points`**: the tile shows only the Google Maps button. Usually Google was unreachable during the build; build again. If it persists, use a full Google Maps link instead of a short `maps.app.goo.gl` one.
- **`! … left out N Notion buttons`**: replace each Notion button with a link on its own line (see *Buttons* above).

## Known limitations

- **Notion buttons** aren't in the API at all; see *Buttons* above.
- **Table widths and column colors:** not in the API. Tables size to their content, and a gray *column color* isn't shaded. Turn on **Header column** in the table's options to shade the first column instead.
- **Linked databases** (views of a database that lives elsewhere) can't be read; use inline databases.
- **"Updated" date** is the page's last edit in Notion. Edits inside an inline database (e.g. a contact's phone number) may not change it.

---

## For developers

```bash
npm test               # unit + end-to-end tests against a fake Notion API (no token needed)
npm run test:parity    # markup must match the original Python tool (needs python3)
npm run demo           # build the fixture workspace into .demo/ (then: npm run serve -- .demo)
node tests/render-check.js .demo/sunnyvale.html qa/   # screenshots + print PDF via headless Chrome
```

See [AGENTS.md](AGENTS.md) for how it works and the design rules. The original Python tool and an example of its output are kept in [reference/](reference/).

Jost font: © The Jost Project Authors, SIL Open Font License 1.1 (`assets/fonts/OFL-Jost.txt`).
