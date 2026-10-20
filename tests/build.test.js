import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build, settings } from "../src/build.js";
import { Notion, NotionError } from "../src/notion.js";
import { startFakeNotion, TEST_TOKEN } from "./fake-notion.js";
import { CHANGELOG_DB, EXAMPLE_SKIPPED_PARA, OPERATOR_PC_BLOCK, ROOT_ID, SUNNYVALE_CONTACTS_DB, SUNNYVALE_ID, TEMPLATE_ID } from "./fixtures/notion.js";

const work = mkdtempSync(path.join(os.tmpdir(), "sop-build-test-"));
const quiet = () => {};
let fake;

before(async () => {
  fake = await startFakeNotion({ pageSize: 2, rateLimitFirst: 2 }); // tiny pages + early 429s exercise pagination and retry
});
after(async () => {
  await fake.close();
  rmSync(work, { recursive: true, force: true });
});

const run = (outDir, opts = {}) => build({
  api: new Notion(TEST_TOKEN, { base: fake.apiBase }), outDir, config: { rootPage: ROOT_ID },
  cacheDir: path.join(work, "cache"), log: quiet, now: new Date("2026-10-10T01:42:00Z"), ...opts,
});

test("builds a home page plus one page per SOP, leaving out Template", async () => {
  const out = path.join(work, "site");
  const r = await run(out);
  assert.deepEqual(r.pages.map((p) => p.slug), ["sunnyvale", "example-city"]);
  assert.deepEqual(r.warnings, ["Sunnyvale: left out 2 Notion buttons; Notion's API can't read buttons. Use a link on its own line instead (see README)."]);
  const files = readdirSync(out).sort();
  assert.deepEqual(files, [".city-sops-build", "assets", "example-city.html", "index.html", "sunnyvale.html"]);
  assert.equal((statSync(out).mode & 0o777).toString(8), "755", "web server must be able to read the folder");

  const home = readFileSync(path.join(out, "index.html"), "utf8");
  assert.match(home, /<h1 class="doc-title">City Operations<\/h1>/);
  assert.ok(home.indexOf('href="sunnyvale.html"') < home.indexOf('href="example-city.html"'), "keeps Notion's page order");
  assert.doesNotMatch(home, /Template/);
  assert.match(home, /Built from Notion on October 9, 2026 at 6:42 PM\./);
  assert.match(home, /<span class="sop-icon"><img src="assets\/icons\/[0-9a-f]{12}\.webp"/);
  assert.match(home, /<span class="sop-icon emoji" aria-hidden="true">🏛️<\/span>/);

  const sv = readFileSync(path.join(out, "sunnyvale.html"), "utf8");
  assert.match(sv, /<a class="home-link" href="index.html"/);
  assert.doesNotMatch(sv + home, /kmvt15\.org<\/span>|class="site"/, "no kmvt15.org text in the header");
  assert.match(sv, /<p class="doc-meta">Updated October 9, 2026<\/p>/);
  assert.match(sv, /@bottom-left\{content:"KMVT 15 · Sunnyvale SOP"/);
  assert.match(sv, /<link rel="stylesheet" href="assets\/site\.css\?v=[0-9a-f]{8}">/);
  assert.match(sv, /<script src="assets\/site\.js\?v=[0-9a-f]{8}" defer><\/script>/);
  assert.match(sv, /<img src="assets\/img\/[0-9a-f]{12}\.webp" alt="parking_sunnyvale\.jpg" width="2000" height="1333">/);
  const anchor = OPERATOR_PC_BLOCK.replace(/-/g, "");
  assert.match(sv, new RegExp(`<a href="#b-${anchor}" class="internal"><em>Operator PC</em></a> using`));
  assert.match(sv, new RegExp(`<h4 class="h3" id="b-${anchor}">Operator PC</h4>`));
  assert.equal((sv.match(/<img src="assets\/img\/[0-9a-f]{12}\.webp" alt="[^"]+" width="\d+" height="\d+">/g) || []).length, 6);
  assert.doesNotMatch(sv, /notion\.so|amazonaws|X-Amz/, "no Notion or expiring links left on the page");

  const ex = readFileSync(path.join(out, "example-city.html"), "utf8");
  assert.match(ex, new RegExp(`<a href="sunnyvale.html#b-${anchor}" class="internal">Operator PC</a>`));
  assert.match(ex, /<a href="sunnyvale.html" class="internal"><span class="mention">Sunnyvale<\/span><\/a>/);
  assert.match(ex, /<a href="assets\/files\/[0-9a-f]{12}-Wiring%20diagram\.pdf">Wiring diagram\.pdf<\/a>/);
  assert.doesNotMatch(ex, /must never appear/);
  const nt = ' target="_blank" rel="noopener"';
  assert.ok(ex.includes(`<p class="buttons"><a class="button" href="https://maps.example.com/city-hall"${nt}>Open parking map</a> ` +
    `<a class="button" href="https://forms.example.com/keycard"${nt}>Keycard request form</a></p>`));
  assert.ok(ex.includes(`<p><a href="https://playback.example.kmvt.net"${nt}>https://playback.example.kmvt.net</a></p>`));
  assert.ok(ex.includes(`<a href="https://www.notion.so/Wiki-2f97446c6b1f800fa4fcd419e77ebf9c"${nt}>Wiki</a>`), "links that stay in Notion open in a new tab");
  assert.ok(ex.includes('<a href="assets/files/'), "attached files are on the site");
  const tiles = [...ex.matchAll(/<div class="map-tile">.*?<\/div><p class="map-links">(.*?)<\/p><\/div>/g)];
  assert.equal(tiles.length, 2, "two Google Maps links on their own line -> two map tiles");
  assert.match(tiles[0][0], /<p class="map-title">Location<\/p><p class="map-detail">37\.370701, -122\.038075<\/p>/);
  assert.ok(tiles[0][1].includes(`href="https://www.google.com/maps/search/?api=1&amp;query=37.370701%2C-122.038075"${nt}>Google Maps</a>`));
  assert.ok(tiles[0][1].includes(`href="https://maps.apple.com/?ll=37.370701,-122.038075&amp;q=37.370701%2C-122.038075"${nt}>Apple Maps</a>`));
  assert.match(tiles[1][0], /<p class="map-title">Studio parking<\/p><p class="map-detail">37\.3688301, -122\.0363496<\/p>/);
  assert.ok(tiles[1][1].includes(`>Google Maps</a> <a class="button" href="https://maps.apple.com/?ll=37.3688301,-122.0363496&amp;q=Studio%20parking"${nt}>Apple Maps</a>`));
  assert.match(ex, /<p>Directions are also in <a href="https:\/\/www\.google\.com\/maps\/place\/[^"]+" target="_blank" rel="noopener">Google Maps<\/a>\.<\/p>/);
  assert.doesNotMatch(ex, /<a href="(sunnyvale\.html|#|assets\/)[^"]*" target=/, "site links stay in the same tab");
  assert.ok(existsSync(path.join(out, "assets", "site.js")));

  const css = readFileSync(path.join(out, "assets", "site.css"), "utf8");
  assert.match(css, /src:url\(fonts\/jost-latin-800-normal\.woff2\)/);
  assert.ok(existsSync(path.join(out, "assets", "fonts", "jost-latin-800-normal.woff2")));
});

test("skipped sections and sub-pages are never fetched", () => {
  const paths = fake.calls.map((c) => c.path);
  assert.ok(!paths.some((p) => p.includes(CHANGELOG_DB)), "Change Log database queried");
  assert.ok(!paths.some((p) => p.includes(EXAMPLE_SKIPPED_PARA)), "content under a Change Log heading fetched");
  assert.ok(!paths.some((p) => p.includes(TEMPLATE_ID)), "excluded Template page fetched");
});

test("contact cards are in Notion's order: the view's sort if it has one, else oldest first", async () => {
  const db = fake.workspace.databases[SUNNYVALE_CONTACTS_DB];
  const rows = db.rows;
  const names = async () => {
    const out = path.join(work, "order");
    await run(out, { images: false });
    return [...readFileSync(path.join(out, "sunnyvale.html"), "utf8").matchAll(/<p class="person-name">([^<]+)</g)].map((m) => m[1]);
  };
  try {
    db.rows = [...rows].reverse(); // the API's unsorted order isn't the order Notion shows
    assert.deepEqual(await names(), ["William Gardner", "Sydney Bucek", "David Carnahan"]);
    db.views = [{ id: "v1", sorts: [{ property: "Name", direction: "ascending" }] }, { id: "v2", sorts: null }];
    assert.deepEqual(await names(), ["David Carnahan", "Sydney Bucek", "William Gardner"], "first view's sort");
  } finally {
    db.rows = rows;
    delete db.views;
  }
});

test("rebuilding reuses cached images, drops unused cache entries, and replaces the previous site", async () => {
  const out = path.join(work, "site");
  writeFileSync(path.join(out, "stale.html"), "old");
  const stale = path.join(work, "cache", "0123456789abcdef0123");
  writeFileSync(`${stale}.json`, "{}");
  writeFileSync(`${stale}.bin`, "old image");
  const before = fake.calls.filter((c) => c.path.startsWith("/files/")).length;
  await run(out);
  const downloads = fake.calls.filter((c) => c.path.startsWith("/files/")).length - before;
  assert.equal(downloads, 0, "cached images were downloaded again");
  assert.ok(!existsSync(path.join(out, "stale.html")));
  assert.ok(!existsSync(`${stale}.bin`), "unused cache entry kept");
  assert.ok(readdirSync(path.join(work, "cache")).length > 0, "cache emptied");
  assert.deepEqual(readdirSync(work).filter((f) => f.includes(".tmp-") || f.includes(".old-")), [], "temp folders left behind");
});

test("refuses to replace a folder it didn't create", async () => {
  const out = path.join(work, "webroot");
  mkdirSync(out);
  writeFileSync(path.join(out, "index.html"), "someone else's site");
  await assert.rejects(run(out), /already has files that this tool didn't create/);
  assert.equal(readFileSync(path.join(out, "index.html"), "utf8"), "someone else's site");
});

test("a build that fails partway leaves the existing site untouched", async () => {
  const out = path.join(work, "site");
  const before = readFileSync(path.join(out, "index.html"), "utf8");
  const api = new Notion(TEST_TOKEN, { base: fake.apiBase });
  const children = api.children.bind(api);
  api.children = async (id) => {
    if (id === SUNNYVALE_ID) throw new NotionError("Notion API error 502: simulated outage");
    return children(id);
  };
  await assert.rejects(run(out, { api }), /simulated outage/);
  assert.equal(readFileSync(path.join(out, "index.html"), "utf8"), before);
  assert.deepEqual(readdirSync(work).filter((f) => f.includes(".tmp-")), [], "temp folder left behind");
});

test("a wrong token fails with a clear message", async () => {
  await assert.rejects(run(path.join(work, "x"), { api: new Notion("wrong-token", { base: fake.apiBase }) }), /rejected the token \(401\)/);
});

test("an unshared root page gives the Connections hint", async () => {
  await assert.rejects(run(path.join(work, "x"), { config: { rootPage: "https://www.notion.so/Nope-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }),
    /Connections > add your integration/);
});

test("the site is readable by the web server's user even under a strict umask", async () => {
  const out = path.join(work, "umask-site");
  const old = process.umask(0o077); // would make files 600 and folders 700
  try {
    await run(out);
  } finally {
    process.umask(old);
  }
  const modes = [out, path.join(out, "index.html"), path.join(out, "assets"), path.join(out, "assets", "img"),
    path.join(out, "assets", "site.css")].map((p) => (statSync(p).mode & 0o777).toString(8));
  assert.deepEqual(modes, ["755", "644", "755", "755", "644"]);
});

test("if the previous copy can't be deleted (e.g. chowned to www-data), the build still succeeds and says so", async () => {
  const out = path.join(work, "chowned-site");
  await run(out);
  const locked = path.join(out, "assets", "img");
  chmodSync(locked, 0o555); // like a folder owned by another user: its files can't be deleted
  try {
    const r = await run(out);
    assert.equal(r.warnings.length, 2, r.warnings.join("\n")); // the Sunnyvale buttons warning, plus this one
    assert.match(r.warnings[1], /the new site is in place, but the previous copy couldn't be deleted \(EACCES\)/);
    assert.ok(existsSync(path.join(out, "index.html")));
  } finally {
    for (const d of readdirSync(work).filter((f) => f.startsWith(".chowned-site.old-"))) {
      chmodSync(path.join(work, d, "assets", "img"), 0o755);
      rmSync(path.join(work, d), { recursive: true, force: true });
    }
  }
});

test("outDir in the config can be absolute (e.g. /var/www/sops) or relative to the config file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sop-settings-"));
  const cfg = (outDir) => {
    writeFileSync(path.join(dir, "sop.config.json"), JSON.stringify({ rootPage: ROOT_ID, outDir }));
    return settings({ config: path.join(dir, "sop.config.json") }).outDir;
  };
  assert.equal(cfg("/var/www/sops"), "/var/www/sops");
  assert.equal(cfg("dist"), path.join(dir, "dist"));
  assert.equal(settings({ config: path.join(dir, "sop.config.json"), out: "/srv/x" }).outDir, "/srv/x", "--out wins");
  writeFileSync(path.join(dir, "sop.config.local.json"), JSON.stringify({ outDir: "/var/www/local" }));
  const s = settings({ config: path.join(dir, "sop.config.json") });
  assert.equal(s.outDir, "/var/www/local", "sop.config.local.json overrides the shared config");
  assert.equal(s.config.rootPage, ROOT_ID, "and keeps everything else");
  rmSync(dir, { recursive: true, force: true });
});
