// Change detection for scheduled rebuilds (npm run build:if-changed).
//
// Every build records a snapshot of what it was built from in the output folder's
// marker file: the SOP list, each SOP page's last-edited time, each inline database's
// rows, and the settings. The checker takes the same snapshot cheaply (about two
// Notion requests per SOP, no page contents) and rebuilds only if anything differs.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const MARKER = ".city-sops-build"; // marks an output folder as ours, and holds the snapshot

// Notion's timestamps are rounded to the minute, so an edit made in the same minute a build
// read the page looks unchanged afterwards. Anything edited this close to a build is rebuilt once more.
export const SETTLE_MS = 2 * 60 * 1000;

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 16);

/** Settings that change the output; outDir/cacheDir don't. */
export const configStamp = (cfg) => hash(JSON.stringify({ ...cfg, outDir: undefined, cacheDir: undefined }));

/** A database's rows -> { stamp, newest }: any added, removed or edited row changes the stamp. */
export function rowsStamp(rows) {
  const times = rows.map((r) => r.last_edited_time || "").sort();
  return { stamp: hash(rows.map((r) => `${r.id}@${r.last_edited_time}`).sort().join("\n")), newest: times.at(-1) || null };
}

/**
 * @param {object} p
 * @param {object} p.cfg  settings, with defaults applied
 * @param {object} p.root  the Notion parent page
 * @param {Array<{id: string, title: string, edited: string}>} p.sops  in Notion's order
 * @param {Object<string, {page: string, title: string, rows: Array}>} p.databases  inline databases by id
 * @param {Date} p.takenAt  when the data was read (Notion's clock when available)
 */
export function snapshot({ cfg, root, sops, databases, takenAt }) {
  return {
    takenAt: takenAt.toISOString(),
    config: configStamp(cfg),
    root: { edited: root.last_edited_time },
    sops: sops.map(({ id, title, edited }) => ({ id, title, edited })),
    databases: Object.fromEntries(Object.entries(databases).map(([id, db]) => [id, { page: db.page, title: db.title, ...rowsStamp(db.rows) }])),
  };
}

/** What changed between two snapshots, as readable reasons; [] means nothing. */
export function describeChanges(prev, next) {
  const reasons = [];
  if (prev.config !== next.config) reasons.push("settings changed");
  if (prev.root.edited !== next.root.edited) reasons.push("the SOPs' parent page changed");
  const before = new Map(prev.sops.map((s) => [s.id, s]));
  const after = new Map(next.sops.map((s) => [s.id, s]));
  for (const s of next.sops) {
    const old = before.get(s.id);
    if (!old) reasons.push(`new SOP "${s.title}"`);
    else if (old.title !== s.title) reasons.push(`"${old.title}" renamed to "${s.title}"`);
    else if (old.edited !== s.edited) reasons.push(`"${s.title}" edited`);
  }
  for (const s of prev.sops) if (!after.has(s.id)) reasons.push(`"${s.title}" removed`);
  if (!reasons.length && prev.sops.map((s) => s.id).join() !== next.sops.map((s) => s.id).join()) reasons.push("SOPs reordered");
  for (const [id, db] of Object.entries(prev.databases)) {
    if (next.databases[id]?.stamp !== db.stamp) reasons.push(`"${db.page}": ${db.title} entries changed`);
  }
  const cutoff = Date.parse(prev.takenAt) - SETTLE_MS;
  const recent = [prev.root.edited, ...prev.sops.map((s) => s.edited), ...Object.values(prev.databases).map((d) => d.newest)]
    .some((t) => t && Date.parse(t) >= cutoff);
  if (recent && !reasons.length) reasons.push("edits made right around the last build may not be in it");
  return reasons;
}

/** The snapshot recorded by the build in `outDir`, or null (no build yet, or an older tool version). */
export function readSnapshot(outDir) {
  try {
    return JSON.parse(readFileSync(path.join(outDir, MARKER), "utf8")).snapshot || null;
  } catch {
    return null;
  }
}

export const markerText = (snap, builtAt) =>
  `${JSON.stringify({ note: "Built by city-sops. This folder is replaced on every build.", builtAt: builtAt.toISOString(), snapshot: snap }, null, 1)}\n`;

// ---- one build at a time (cron and manual builds share the lock)

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

/** True if another live process holds the lock. */
export function lockHeld(file) {
  try {
    const pid = Number(readFileSync(file, "utf8"));
    return pid !== process.pid && pid > 0 && alive(pid);
  } catch {
    return false;
  }
}

/** Take the lock; false if a live process already holds it. A stale lock (dead process) is taken over. */
export async function acquireLock(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, String(process.pid), { flag: "wx" });
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (lockHeld(file)) return false;
      await fs.rm(file, { force: true });
    }
  }
  return false;
}

export const releaseLock = (file) => fs.rm(file, { force: true });
