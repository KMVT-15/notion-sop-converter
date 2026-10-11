#!/usr/bin/env node
// Visual QA for a built page using headless Chrome: desktop + phone screenshots and a print PDF.
//   node tests/render-check.js .demo/sunnyvale.html /tmp/qa
// Then look at the PDF pages, e.g. `pdftoppm -r 70 -png /tmp/qa/print.pdf /tmp/qa/page`.
// Check: page count, page breaks, footer text, clipped logo, stray ** or *.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
];

const [page, outArg] = process.argv.slice(2);
if (!page) {
  console.error("Usage: node tests/render-check.js <page.html> [outdir]");
  process.exit(2);
}
const chrome = process.env.CHROME || CHROMES.find(existsSync);
if (!chrome) {
  console.error("Couldn't find Chrome/Edge; set CHROME=/path/to/chrome");
  process.exit(1);
}
const out = path.resolve(outArg || "qa");
mkdirSync(out, { recursive: true });
const url = pathToFileURL(path.resolve(page)).href;

function run(args) {
  const profile = mkdtempSync(path.join(os.tmpdir(), "sop-qa-"));
  try {
    execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--user-data-dir=${profile}`,
      "--virtual-time-budget=4000", ...args, url], { stdio: "ignore", timeout: 120_000 });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

run(["--window-size=1200,3200", `--screenshot=${path.join(out, "screen.png")}`]);
run(["--window-size=390,4200", `--screenshot=${path.join(out, "mobile.png")}`]);
run(["--no-pdf-header-footer", `--print-to-pdf=${path.join(out, "print.pdf")}`]);
console.log(`Wrote screen.png, mobile.png and print.pdf to ${out}`);
