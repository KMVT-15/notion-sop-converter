// Notion rich_text arrays -> inline HTML.
import { esc, fmtDate, linkTarget } from "./html.js";

export const plain = (rt) => (rt || []).map((t) => t.plain_text || "").join("");

/** Notion color name -> CSS class: "gray" -> "c-gray", "red_background" -> "hl-red". */
export function colorClass(color) {
  return color.endsWith("_background") ? `hl-${color.slice(0, -"_background".length)}` : `c-${color}`;
}

/** Notion-relative links ("/p/…") made absolute; used when no site linker is given. */
export const absoluteNotion = (href) => (href.startsWith("/") ? `https://www.notion.so${href}` : href);

/**
 * @param {Array} rt  Notion rich_text array
 * @param {object} [ctx]
 * @param {(href: string) => string} [ctx.link]  rewrites hrefs (Notion links -> site pages / anchors)
 * @param {string} [ctx.timeZone]  for date mentions with a time
 */
export function rich(rt, ctx = {}) {
  const out = [];
  for (const t of rt || []) {
    const typ = t.type;
    let text = t.plain_text || "";
    if (typ === "equation") text = t.equation?.expression || text;
    const date = typ === "mention" && t.mention?.type === "date" ? t.mention.date : null;
    if (date?.start) {
      text = fmtDate(date.start, ctx.timeZone) + (date.end ? ` – ${fmtDate(date.end, ctx.timeZone)}` : "");
    }
    const a = t.annotations || {};
    let lead = "", core = text, trail = "";
    if (!a.code) {
      // Notion often stores a trailing space inside a bold/italic run ("*CLK-01 *port");
      // keep that whitespace outside the tag so words don't run together.
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
      [, lead, core, trail] = m;
    }
    if (!core) {
      out.push(esc(text).replace(/\n/g, "<br>"));
      continue;
    }
    let h = esc(core).replace(/\n/g, "<br>");
    if (a.code) h = `<code>${h}</code>`;
    if (typ === "mention") h = `<span class="mention">${h}</span>`;
    if (a.bold) h = `<strong>${h}</strong>`;
    if (a.italic) h = `<em>${h}</em>`;
    if (a.strikethrough) h = `<s>${h}</s>`;
    if (a.underline) h = `<span class="u">${h}</span>`;
    const color = a.color || "default";
    if (color !== "default") h = `<span class="${colorClass(color)}">${h}</span>`;
    if (t.href) {
      const href = ctx.link ? ctx.link(t.href) : absoluteNotion(t.href);
      // Relative = a page or anchor on this site (e.g. a glossary term): styled gray like Notion's page links.
      const internal = !/^[a-z][a-z0-9+.-]*:/i.test(href);
      h = `<a href="${esc(href)}"${internal ? ' class="internal"' : linkTarget(href)}>${h}</a>`;
    }
    out.push(esc(lead) + h + esc(trail));
  }
  return out.join("").replace(/\n/g, "<br>");
}
