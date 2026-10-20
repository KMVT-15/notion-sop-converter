// End-to-end: run the real `build-if-changed` command (as cron would) against the fake Notion API,
// changing the fake workspace between runs.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readSnapshot } from "../src/changes.js";
import { startFakeNotion, TEST_TOKEN } from "./fake-notion.js";
import { ROOT_ID, SUNNYVALE_CONTACTS_DB, SUNNYVALE_ID } from "./fixtures/notion.js";

const SCRIPT = fileURLToPath(new URL("../src/build-if-changed.js", import.meta.url));
const work = mkdtempSync(path.join(os.tmpdir(), "sop-cron-test-"));
const configFile = path.join(work, "sop.config.json");
const site = path.join(work, "site");
let fake;

before(async () => {
  fake = await startFakeNotion();
  writeFileSync(configFile, JSON.stringify({ rootPage: ROOT_ID, outDir: "site", cacheDir: "cache" }));
});
after(async () => {
  await fake.close();
  rmSync(work, { recursive: true, force: true });
});

// Async on purpose: the fake API runs in this process, so a blocking child would deadlock it.
const check = async () => {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [SCRIPT, "--config", configFile], {
    env: { ...process.env, NOTION_TOKEN: TEST_TOKEN, NOTION_API_BASE: fake.apiBase },
  });
  return { out: stdout.trim(), err: stderr.trim() };
};
const anHourAgo = () => new Date(Math.floor(Date.now() / 60_000) * 60_000 - 3_600_000).toISOString();

test("first run builds; a second run with no changes does nothing and prints nothing", async () => {
  const first = await check();
  assert.match(first.out, /Rebuilding: no previous build to compare with/);
  assert.match(first.out, /Built 2 SOPs into/);
  const snap = readSnapshot(site);
  assert.deepEqual(snap.sops.map((s) => s.title), ["Sunnyvale", "Example City"]);
  assert.deepEqual(Object.keys(snap.databases), [SUNNYVALE_CONTACTS_DB]);

  assert.deepEqual(await check(), { out: "", err: "" });
});

test("an edited SOP triggers a rebuild that says why", async () => {
  fake.workspace.pages[SUNNYVALE_ID].last_edited_time = anHourAgo();
  const { out } = await check();
  assert.match(out, /Rebuilding: "Sunnyvale" edited/);
  assert.match(out, /Built 2 SOPs/);
  assert.equal((await check()).out, "");
});

test("an edited contact entry triggers a rebuild (it doesn't change the page's edit time)", async () => {
  fake.workspace.databases[SUNNYVALE_CONTACTS_DB].rows[0].last_edited_time = anHourAgo();
  assert.match((await check()).out, /Rebuilding: "Sunnyvale": Contact Info entries changed/);
});

test("a new sort on the contacts' view triggers a rebuild", async () => {
  fake.workspace.databases[SUNNYVALE_CONTACTS_DB].views = [{ id: "v1", sorts: [{ property: "Name", direction: "ascending" }] }];
  assert.match((await check()).out, /Rebuilding: "Sunnyvale": Contact Info sort order changed/);
  assert.equal((await check()).out, "");
});

test("a new SOP under the parent page triggers a rebuild", async () => {
  const w = fake.workspace;
  const id = "e0000000-0000-4000-8000-00000000e002";
  w.page(id, "Los Altos", { edited: anHourAgo() });
  w.children[id] = [w.P([{ type: "text", text: { content: "Hello" }, annotations: {}, plain_text: "Hello", href: null }])];
  w.children[ROOT_ID].push({ ...w.blk("child_page", { title: "Los Altos" }, null, id), has_children: true });
  const { out } = await check();
  assert.match(out, /Rebuilding: new SOP "Los Altos"/);
  assert.ok(existsSync(path.join(site, "los-altos.html")));
});

test("while a build holds the lock, the check quietly skips", async () => {
  fake.workspace.pages[SUNNYVALE_ID].last_edited_time = new Date(Date.parse(anHourAgo()) + 60_000).toISOString();
  const lock = path.join(work, "cache", "build.lock");
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, String(process.pid)); // this test process is alive, so the lock is held
  try {
    assert.deepEqual(await check(), { out: "", err: "" });
  } finally {
    rmSync(lock, { force: true });
  }
  assert.match((await check()).out, /Rebuilding: "Sunnyvale" edited/, "picked up on the next run");
});
