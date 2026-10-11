#!/usr/bin/env node
// Builds the site from the fixture workspace (no Notion token needed) into ./.demo,
// using the real build pipeline against a local fake Notion API.
//   npm run demo && npm run serve -- .demo
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../src/build.js";
import { Notion } from "../src/notion.js";
import { startFakeNotion, TEST_TOKEN } from "./fake-notion.js";
import { ROOT_ID } from "./fixtures/notion.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = path.resolve(process.argv[2] || path.join(root, ".demo"));
const fake = await startFakeNotion();
try {
  const api = new Notion(TEST_TOKEN, { base: fake.apiBase });
  const r = await build({
    api, outDir, config: { rootPage: ROOT_ID },
    cacheDir: path.join(root, ".cache", "demo-assets"),
  });
  const n = r.warnings.length;
  console.log(`\nBuilt ${r.pages.length} fixture SOPs into ${outDir} (${api.requests} fake API requests, ${n} warning${n === 1 ? "" : "s"}).`);
} finally {
  await fake.close();
}
