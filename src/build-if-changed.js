#!/usr/bin/env node
// Rebuilds the site only if something changed in Notion since the last build. Made for cron:
//
//   */5 * * * * cd /path/to/notion-sop-converter && /path/to/node src/build-if-changed.js >> .cache/cron.log 2>&1
//
// Prints nothing when there's nothing to do. Options are the same as `npm run build`
// (e.g. --out /srv/sops) and are passed through to it.
//
// What counts as a change: an SOP edited, added, removed, renamed or reordered under the
// parent page; an entry in an inline database (e.g. Contact Info) added, removed or edited;
// or sop.config.json settings. Code/CSS changes in this repo don't count; build those by hand.
import { spawn } from "node:child_process";
import path from "node:path";
import { DEFAULTS, listSops, loadToken, parseArgs, ROOT, settings } from "./build.js";
import { describeChanges, lockHeld, readSnapshot, snapshot } from "./changes.js";
import { Notion } from "./notion.js";

/** Snapshot of Notion now, in the same shape the build records. Only reads timestamps, not page contents. */
async function currentSnapshot(api, cfg, prev) {
  const { root, entries } = await listSops(api, cfg);
  const takenAt = api.serverDate || new Date();
  const pages = await Promise.all(entries.map((e) => api.page(e.id)));
  const databases = {};
  await Promise.all(Object.entries(prev.databases).map(async ([id, db]) => {
    try {
      databases[id] = { ...db, rows: await api.query(id) };
    } catch {
      // deleted or unshared: leaving it out counts as a change
    }
  }));
  return snapshot({ cfg, root, takenAt, sops: entries.map((e, i) => ({ ...e, edited: pages[i].last_edited_time })), databases });
}

const stamp = () => new Date().toLocaleString("sv-SE"); // local time, "2026-10-10 18:27:03"

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (args.help) {
    console.log("Usage: npm run build:if-changed [-- build options]\nRebuilds only if Notion changed since the last build; see src/build-if-changed.js.");
    return;
  }
  const { config, outDir, lockFile } = settings(args);
  if (lockHeld(lockFile)) return; // a build is running now; the next check will catch anything it misses

  let reasons;
  const prev = readSnapshot(outDir);
  if (!prev) {
    reasons = ["no previous build to compare with"];
  } else {
    const token = loadToken();
    if (!token) {
      console.error(`[${stamp()}] No Notion token. Put NOTION_TOKEN=… in .env (see README.md).`);
      process.exit(1);
    }
    try {
      reasons = describeChanges(prev, await currentSnapshot(new Notion(token), { ...DEFAULTS, ...config }, prev));
    } catch (e) {
      console.error(`[${stamp()}] Couldn't check Notion for changes: ${e.message}`);
      process.exit(1);
    }
  }
  if (!reasons.length) return;

  console.log(`[${stamp()}] Rebuilding: ${reasons.join("; ")}`);
  // Same as `npm run build`, run with this node so it works under cron's minimal PATH.
  const child = spawn(process.execPath, [path.join(ROOT, "src", "build.js"), ...argv], { stdio: "inherit" });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main();
