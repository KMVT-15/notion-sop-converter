import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { acquireLock, describeChanges, lockHeld, releaseLock, snapshot } from "../src/changes.js";

const snap = ({ takenAt = "2026-10-10T12:00:00Z", sops, rows, cfg } = {}) => snapshot({
  cfg: cfg || { rootPage: "root", exclude: ["Template"], outDir: "dist" },
  root: { last_edited_time: "2026-10-09T20:00:00.000Z" },
  takenAt: new Date(takenAt),
  sops: sops || [
    { id: "a", title: "Sunnyvale", edited: "2026-10-09T21:00:00.000Z" },
    { id: "b", title: "Mountain View", edited: "2026-10-08T21:00:00.000Z" },
  ],
  databases: { db1: { page: "Sunnyvale", title: "Contact Info", rows: rows || [{ id: "r1", last_edited_time: "2026-10-09T20:54:00.000Z" }] } },
});

test("nothing changed -> nothing to do", () => {
  assert.deepEqual(describeChanges(snap(), snap({ takenAt: "2026-10-10T13:00:00Z" })), []);
});

test("edits, new/removed/renamed/reordered SOPs, contact entries and settings are all changes", () => {
  const prev = snap();
  const [sv, mv] = prev.sops;
  const sops = (list) => describeChanges(prev, snap({ sops: list }));
  assert.deepEqual(sops([{ ...sv, edited: "2026-10-10T09:00:00.000Z" }, mv]), ['"Sunnyvale" edited']);
  assert.deepEqual(sops([sv, mv, { id: "c", title: "Los Altos", edited: "2026-10-10T09:00:00.000Z" }]), ['new SOP "Los Altos"']);
  assert.deepEqual(sops([sv]), ['"Mountain View" removed']);
  assert.deepEqual(sops([{ ...sv, title: "City of Sunnyvale" }, mv]), ['"Sunnyvale" renamed to "City of Sunnyvale"']);
  assert.deepEqual(sops([mv, sv]), ["SOPs reordered"]);
  assert.deepEqual(describeChanges(prev, snap({ rows: [{ id: "r1", last_edited_time: "2026-10-10T09:00:00.000Z" }] })), ['"Sunnyvale": Contact Info entries changed']);
  assert.deepEqual(describeChanges(prev, snap({ rows: [] })), ['"Sunnyvale": Contact Info entries changed'], "a removed entry");
  assert.deepEqual(describeChanges(prev, snap({ cfg: { rootPage: "root", exclude: [] } })), ["settings changed"]);
  assert.deepEqual(describeChanges(prev, snap({ cfg: { rootPage: "root", exclude: ["Template"], outDir: "/srv/sops" } })), [], "where the site is written isn't a change");
});

test("an edit within 2 minutes of the last build gets one more build (Notion's times are rounded to the minute)", () => {
  const edited = "2026-10-10T11:59:00.000Z"; // same minute-ish as the build at 12:00:30
  const sops = [{ id: "a", title: "Sunnyvale", edited }];
  const builtRightAfter = snap({ takenAt: "2026-10-10T12:00:30Z", sops });
  assert.deepEqual(describeChanges(builtRightAfter, snap({ takenAt: "2026-10-10T12:05:00Z", sops })), ["edits made right around the last build may not be in it"]);
  const rebuiltLater = snap({ takenAt: "2026-10-10T12:05:00Z", sops });
  assert.deepEqual(describeChanges(rebuiltLater, snap({ takenAt: "2026-10-10T12:10:00Z", sops })), [], "settled after the extra build");
});

test("the build lock: one build at a time, stale locks are taken over", async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "lock-")), "build.lock");
  assert.equal(await acquireLock(file), true);
  assert.equal(lockHeld(file), false, "our own lock doesn't block us");
  await releaseLock(file);

  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"]);
  try {
    writeFileSync(file, String(other.pid));
    assert.equal(lockHeld(file), true);
    assert.equal(await acquireLock(file), false);
  } finally {
    other.kill();
  }
  await new Promise((r) => other.once("exit", r));
  assert.equal(lockHeld(file), false, "holder exited");
  assert.equal(await acquireLock(file), true, "stale lock taken over");
  await releaseLock(file);
});
