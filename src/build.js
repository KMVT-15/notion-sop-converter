#!/usr/bin/env node
// Builds the SOP website: every child page of the configured Notion parent page
// (minus exclusions) becomes <slug>.html, plus an index.html that lists them.
//
//   npm run build                     -> ./dist
//   npm run build -- --out /srv/sops  -> somewhere else
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Assets } from "./assets.js";
import { convert } from "./convert.js";
import { fmtDate, fmtDateTime, slugify } from "./html.js";
import { createLinker } from "./links.js";
import { loadBlocks } from "./load.js";
import { MapResolver } from "./maps.js";
import { compact, Notion, NotionError, pageIdFrom } from "./notion.js";
import { homePage, sopPage } from "./pages.js";
import { render } from "./render.js";
import { plain } from "./rich-text.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKER = ".city-sops-build"; // marks an output folder as ours, so it's safe to replace
const RESERVED_SLUGS = new Set(["index", "assets"]);

export const DEFAULTS = {
  exclude: ["Template"],
  skipSections: ["Change Log", "Changelog"],
  timezone: "America/Los_Angeles",
  outDir: "dist",
};

const USAGE = `Usage: npm run build [-- options]

  --out DIR      where to write the site (default: "outDir" in sop.config.json, i.e. ./dist)
  --no-images    don't download photos (faster; pages show placeholders)
  --no-cache     re-download and re-process every image
  --config FILE  use a different config file (default: sop.config.json)

Needs a Notion integration token in NOTION_TOKEN or .env (see README.md).`;

/**
 * Build the whole site. Writes to a temporary folder first and only replaces
 * `outDir` if everything succeeded, so a failed build leaves the old site in place.
 */
export async function build({
  api, config, outDir, images = true, cache = true,
  cacheDir = path.join(ROOT, ".cache", "assets"), log = console.log, now = new Date(),
}) {
  const cfg = { ...DEFAULTS, ...config };
  const rootId = pageIdFrom(cfg.rootPage || "");
  if (!rootId) throw new Error('"rootPage" in sop.config.json must be a Notion page link or id.');
  outDir = path.resolve(outDir);
  await assertReplaceable(outDir);

  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    log(`  ! ${msg}`);
  };
  const timeZone = cfg.timezone;
  const skip = cfg.skipSections.map((s) => s.trim().toLowerCase());
  const excluded = new Set(cfg.exclude.map((s) => s.trim().toLowerCase()));

  const [root, children] = await Promise.all([api.page(rootId), api.children(rootId)]);
  const entries = children
    .filter((b) => b.type === "child_page")
    .map((b) => ({ id: b.id, title: (b.child_page?.title || "").trim() || "Untitled" }))
    .filter((e) => !excluded.has(e.title.toLowerCase()));
  assignSlugs(entries);
  const slugById = new Map(entries.map((e) => [e.id, e.slug]));

  await fs.mkdir(path.dirname(outDir), { recursive: true });
  const tmp = await fs.mkdtemp(path.join(path.dirname(outDir), `.${path.basename(outDir)}.tmp-`));
  await fs.chmod(tmp, 0o755); // mkdtemp makes it owner-only; the web server must be able to read it
  let docs;
  try {
    const assets = new Assets({ outDir: path.join(tmp, "assets"), cacheDir, images, useCache: cache, warn });
    const maps = new MapResolver({ cacheFile: path.join(cacheDir, "maps.json") });
    docs = await Promise.all(entries.map(async (e) => {
      const unsupported = []; // block types Notion's API can't read (e.g. buttons)
      const pageWarn = (msg) => warn(`${e.title}: ${msg}`);
      const [page, blocks] = await Promise.all([api.page(e.id), loadBlocks(api, e.id, { skip, assets, maps, warn: pageWarn, unsupported })]);
      for (const [type, n] of countBy(unsupported)) {
        pageWarn(type === "button"
          ? `left out ${n} Notion button${n === 1 ? "" : "s"}; Notion's API can't read buttons. Use a link on its own line instead (see README).`
          : `left out ${n} "${type}" block${n === 1 ? "" : "s"} that Notion's API can't read.`);
      }
      const targets = new Set(); // blocks that links on this page jump to
      const ctx = { link: createLinker({ pageId: e.id, slugById, targets }), timeZone };
      const model = convert(blocks, ctx);
      return { ...e, ctx, model, targets, icon: await assets.icon(page.icon), updated: fmtDate(page.last_edited_time, timeZone) };
    }));

    const { cssHref, jsHref } = await writeStatic(tmp);
    const targets = new Set(docs.flatMap((d) => [...d.targets]));
    const emitted = new Set();
    for (const doc of docs) {
      const content = render(doc.model, { ...doc.ctx, targets, emitted });
      await fs.writeFile(path.join(tmp, `${doc.slug}.html`), sopPage({ title: doc.title, updated: doc.updated, content, cssHref, jsHref }));
      log(`• ${doc.title} → ${doc.slug}.html`);
    }
    for (const doc of docs) {
      for (const t of doc.targets) {
        if (!emitted.has(t)) warn(`${doc.title}: a link points to Notion block ${t}, which isn't on the site, so it won't jump anywhere`);
      }
    }

    const siteTitle = cfg.siteTitle || pageTitle(root);
    await fs.writeFile(path.join(tmp, "index.html"), homePage({
      title: siteTitle,
      sops: docs.map((d) => ({ title: d.title, slug: d.slug, updated: d.updated, icon: d.icon })),
      builtAt: fmtDateTime(now, timeZone),
      cssHref,
    }));
    await fs.writeFile(path.join(tmp, MARKER), `Built by city-sops on ${now.toISOString()}. This folder is replaced on every build.\n`);
    await swapIn(tmp, outDir);
    if (images) await assets.pruneCache();
    await maps.save();
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  return { outDir, warnings, pages: docs.map((d) => ({ id: d.id, title: d.title, slug: d.slug })) };
}

function countBy(items) {
  const counts = new Map();
  for (const x of items) counts.set(x, (counts.get(x) || 0) + 1);
  return counts;
}

export function pageTitle(page) {
  for (const p of Object.values(page.properties || {})) {
    if (p.type === "title") return plain(p.title).trim() || "Untitled";
  }
  return "Untitled";
}

/** Give each SOP a unique file name from its title ("Los Altos Hills" -> "los-altos-hills"). */
export function assignSlugs(entries) {
  const used = new Set(RESERVED_SLUGS);
  for (const e of entries) {
    const base = slugify(e.title) || compact(e.id).slice(0, 8);
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    e.slug = slug;
  }
  return entries;
}

/**
 * Shared files: one stylesheet (fonts + the print design + website additions), the
 * photo viewer script, and the fonts. Returns their hrefs; the ?v= query changes
 * whenever a file does, so browsers never use a stale copy.
 */
async function writeStatic(siteDir) {
  const parts = await Promise.all(["fonts.css", "sop.css", "site.css"].map((f) => fs.readFile(path.join(ROOT, "assets", "css", f), "utf8")));
  const css = parts.join("\n");
  const js = await fs.readFile(path.join(ROOT, "assets", "site.js"), "utf8");
  await fs.mkdir(path.join(siteDir, "assets"), { recursive: true });
  await fs.writeFile(path.join(siteDir, "assets", "site.css"), css);
  await fs.writeFile(path.join(siteDir, "assets", "site.js"), js);
  await fs.cp(path.join(ROOT, "assets", "fonts"), path.join(siteDir, "assets", "fonts"), { recursive: true });
  const v = (s) => createHash("sha1").update(s).digest("hex").slice(0, 8);
  return { cssHref: `assets/site.css?v=${v(css)}`, jsHref: `assets/site.js?v=${v(js)}` };
}

async function assertReplaceable(outDir) {
  let entries;
  try {
    entries = await fs.readdir(outDir);
  } catch (e) {
    if (e.code === "ENOENT") return;
    if (e.code === "ENOTDIR") throw new Error(`${outDir} exists and isn't a folder.`);
    throw e;
  }
  if (entries.length && !entries.includes(MARKER)) {
    throw new Error(`${outDir} already has files that this tool didn't create. ` +
      "Empty it first or pick another folder; the build replaces the whole folder.");
  }
}

async function swapIn(tmp, outDir) {
  if (!existsSync(outDir)) {
    await fs.rename(tmp, outDir);
    return;
  }
  const old = path.join(path.dirname(outDir), `.${path.basename(outDir)}.old-${Date.now()}`);
  try {
    await fs.rename(outDir, old);
  } catch {
    // Can't move it (e.g. it's a mount point); replace its contents in place instead.
    for (const name of await fs.readdir(outDir)) await fs.rm(path.join(outDir, name), { recursive: true, force: true });
    await fs.cp(tmp, outDir, { recursive: true });
    await fs.rm(tmp, { recursive: true, force: true });
    return;
  }
  try {
    await fs.rename(tmp, outDir);
  } catch (e) {
    await fs.rename(old, outDir);
    throw e;
  }
  await fs.rm(old, { recursive: true, force: true });
}

function parseArgs(argv) {
  const args = { images: true, cache: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith("-")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--out" || a === "-o") args.out = value();
    else if (a === "--config") args.config = value();
    else if (a === "--no-images") args.images = false;
    else if (a === "--no-cache") args.cache = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return args;
}

function loadToken() {
  const envFile = path.join(ROOT, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  let token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  const legacy = path.join(os.homedir(), ".config", "kmvt-sop", "token"); // where the Python tool kept it
  if (!token && existsSync(legacy)) token = readFileSync(legacy, "utf8").trim();
  return token;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const configPath = path.resolve(args.config || path.join(ROOT, "sop.config.json"));
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const token = loadToken();
  if (!token) {
    console.error("No Notion token. Put NOTION_TOKEN=… in .env (see README.md).");
    process.exit(1);
  }
  const outDir = path.resolve(args.out || path.join(path.dirname(configPath), config.outDir || DEFAULTS.outDir));
  const api = new Notion(token);
  const started = Date.now();
  try {
    const r = await build({ api, config, outDir, images: args.images, cache: args.cache });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const n = r.warnings.length;
    console.log(`\nBuilt ${r.pages.length} SOP${r.pages.length === 1 ? "" : "s"} into ${outDir} in ${secs}s ` +
      `(${api.requests} Notion requests${n ? `, ${n} warning${n === 1 ? "" : "s"}` : ""}).`);
  } catch (e) {
    console.error(`\nBuild failed: ${e.message}`);
    if (existsSync(outDir)) console.error("The existing site was left unchanged.");
    if (!(e instanceof NotionError) && process.env.DEBUG) console.error(e.stack);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
