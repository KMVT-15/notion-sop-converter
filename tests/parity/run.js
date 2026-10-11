#!/usr/bin/env node
// Parity check: the Node renderer must produce the same SOP markup as the original
// Python tool (reference/python-tool/kmvt_sop.py) for the same Notion data.
//
//   npm run test:parity        (needs python3; on macOS the Python tool converts HEIC with sips)
//
// Compared: the document body (everything after the title block). Intentional
// differences are normalized away first: image/link URLs (files vs. data URIs,
// rewritten Notion links), image width/height attributes, link-target ids,
// target="_blank" on external links, and class="internal" on site links.
// Also checks that assets/css/sop.css is byte-identical to the Python tool's CSS
// plus the owner-approved changes listed in approved-css-changes.js.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Assets } from "../../src/assets.js";
import { convert } from "../../src/convert.js";
import { createLinker } from "../../src/links.js";
import { loadBlocks } from "../../src/load.js";
import { Notion } from "../../src/notion.js";
import { render } from "../../src/render.js";
import { startFakeNotion, TEST_TOKEN } from "../fake-notion.js";
import { SUNNYVALE_ID, TEMPLATE_ID } from "../fixtures/notion.js";
import approvedCssChanges from "./approved-css-changes.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REF = path.join(ROOT, "reference", "python-tool", "kmvt_sop.py");
const PAGES = { Template: TEMPLATE_ID, Sunnyvale: SUNNYVALE_ID };

const normalize = (html) => html
  .replace(/ id="b-[0-9a-f]{32}"/g, "")
  .replace(/ target="_blank" rel="noopener"/g, "")
  .replace(/ class="internal"/g, "")
  .replace(/ (src|href)="[^"]*"/g, ' $1=""')
  .replace(/ width="\d+" height="\d+"/g, "")
  .trim();

function pythonBody(file) {
  const html = readFileSync(file, "utf8");
  const start = html.indexOf("</div>", html.indexOf('<div class="title-block">')) + "</div>".length;
  return html.slice(start, html.lastIndexOf("</main>"));
}

function firstDifference(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return { at: i, python: a.slice(Math.max(0, i - 80), i + 120), node: b.slice(Math.max(0, i - 80), i + 120) };
}

const fake = await startFakeNotion();
const work = mkdtempSync(path.join(os.tmpdir(), "sop-parity-"));
let failed = false;
try {
  let expectedCss = /CSS = r"""(.*?)"""/s.exec(readFileSync(REF, "utf8"))[1].replace(/^\n/, "");
  for (const change of approvedCssChanges) {
    if (!expectedCss.includes(change.from)) {
      console.log(`✗ approved CSS change from ${change.date} no longer applies: ${change.why}`);
      failed = true;
    }
    expectedCss = expectedCss.replace(change.from, change.to);
  }
  const nodeCss = readFileSync(path.join(ROOT, "assets", "css", "sop.css"), "utf8");
  const n = approvedCssChanges.length;
  console.log(expectedCss === nodeCss
    ? `✓ sop.css matches the Python tool's CSS${n ? ` plus ${n} approved change${n === 1 ? "" : "s"}` : ""}`
    : "✗ sop.css differs from the Python tool's CSS plus approved changes (tests/parity/approved-css-changes.js)");
  failed ||= expectedCss !== nodeCss;

  for (const [title, id] of Object.entries(PAGES)) {
    const pyOut = path.join(work, "py", title);
    mkdirSync(pyOut, { recursive: true });
    // Async: the fake API runs in this process, so a sync child would deadlock it.
    await promisify(execFile)("python3", [path.join(ROOT, "tests", "parity", "reference_build.py"), REF, fake.apiBase, TEST_TOKEN, id, pyOut]);
    const pyFile = path.join(pyOut, readdirSync(pyOut).find((f) => f.endsWith(".html")));

    const api = new Notion(TEST_TOKEN, { base: fake.apiBase });
    const assets = new Assets({ outDir: path.join(work, "node", "assets"), cacheDir: path.join(work, "cache"), warn: console.warn });
    const blocks = await loadBlocks(api, id, { skip: ["change log", "changelog"], assets, warn: console.warn });
    const ctx = { link: createLinker({ pageId: id, slugById: new Map(), targets: new Set() }), timeZone: "UTC" };
    const nodeBody = render(convert(blocks, ctx), ctx);

    const a = normalize(pythonBody(pyFile));
    const b = normalize(nodeBody);
    if (a === b) {
      console.log(`✓ ${title}: body markup identical (${b.length.toLocaleString()} chars)`);
    } else {
      failed = true;
      const d = firstDifference(a, b);
      console.log(`✗ ${title}: first difference at char ${d.at}\n  python: …${d.python}…\n  node:   …${d.node}…`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  await fake.close();
}
process.exitCode = failed ? 1 : 0;
