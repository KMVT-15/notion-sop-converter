// Full-page HTML shells: one per SOP, plus the home page that lists them.
import { readFileSync } from "node:fs";
import { esc } from "./html.js";

const LOGO = readFileSync(new URL("../assets/logo.svg", import.meta.url), "utf8").trim();
const EYEBROW = "Standard Operating Procedure";
const GENERATOR = "city-sops";

const head = (title, cssHref, extra = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${GENERATOR}">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${esc(cssHref)}">${extra}
</head>`;

/** Print footer ("KMVT 15 · Sunnyvale SOP" / "Page X of Y"); needs the title, so it's per page. */
function pageCss(title) {
  const safe = title.replace(/["\\<>]/g, "");
  return '@page{@bottom-left{content:"KMVT 15 · ' + safe + ' SOP";font:8pt/1 "Futura PT","Jost",sans-serif;color:#6f6a76}' +
    '@bottom-right{content:"Page " counter(page) " of " counter(pages);font:8pt/1 "Futura PT","Jost",sans-serif;color:#6f6a76}}';
}

/**
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.updated  formatted "Updated" date, or ""
 * @param {string} p.content  rendered body HTML
 * @param {string} p.cssHref
 * @param {string} p.jsHref  photo viewer script
 */
export function sopPage({ title, updated, content, cssHref, jsHref }) {
  const meta = updated ? `<p class="doc-meta">Updated ${esc(updated)}</p>` : "";
  const extra = `\n<style>${pageCss(title)}</style>` + (jsHref ? `\n<script src="${esc(jsHref)}" defer></script>` : "");
  return `${head(`${title} · KMVT SOP`, cssHref, extra)}
<body>
<main class="sheet">
<header class="doc-head"><a class="home-link" href="index.html" aria-label="All SOPs">${LOGO}</a></header>
<div class="title-block">
<p class="eyebrow">${esc(EYEBROW)}</p>
<h1 class="doc-title">${esc(title)}</h1>
${meta}
</div>
${content}
</main>
</body>
</html>
`;
}

const CHEVRON = '<svg class="sop-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

function iconHtml(icon, title) {
  if (icon?.src) return `<span class="sop-icon"><img src="${esc(icon.src)}" alt=""></span>`;
  if (icon?.emoji) return `<span class="sop-icon emoji" aria-hidden="true">${esc(icon.emoji)}</span>`;
  const initial = [...title.trim()][0] || "?";
  return `<span class="sop-icon mono" aria-hidden="true">${esc(initial.toUpperCase())}</span>`;
}

/**
 * @param {object} p
 * @param {string} p.title  e.g. "City Operations" (the Notion parent page's title)
 * @param {Array<{title: string, slug: string, updated: string, icon: object|null}>} p.sops
 * @param {string} p.builtAt  formatted build time
 * @param {string} p.cssHref
 */
export function homePage({ title, sops, builtAt, cssHref }) {
  const items = sops.map((s) => `<li><a class="sop-link" href="${esc(s.slug)}.html">${iconHtml(s.icon, s.title)}` +
    `<span class="sop-text"><span class="sop-name">${esc(s.title)}</span>` +
    (s.updated ? `<span class="sop-meta">Updated ${esc(s.updated)}</span>` : "") +
    `</span>${CHEVRON}</a></li>`).join("\n");
  const list = sops.length ? `<ul class="sop-list">\n${items}\n</ul>` : '<p class="empty">No SOPs have been published yet.</p>';
  return `${head(`${title} · KMVT SOPs`, cssHref)}
<body class="home">
<main class="sheet">
<header class="doc-head">${LOGO}</header>
<div class="title-block">
<p class="eyebrow">Standard Operating Procedures</p>
<h1 class="doc-title">${esc(title)}</h1>
</div>
${list}
<p class="site-foot">Built from Notion on ${esc(builtAt)}.</p>
</main>
</body>
</html>
`;
}
