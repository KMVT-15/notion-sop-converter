// Document model -> SOP body HTML. Markup and class names match the approved
// print design (reference/python-tool/AGENTS.md §5–§9); styles live in assets/css/sop.css.
import { esc, fmtDate, linkTarget, textOf } from "./html.js";
import { compact } from "./notion.js";
import { colorClass, rich } from "./rich-text.js";

const ICONS = {
  bug: '<path d="M8 4.5a4 4 0 0 1 8 0"/><rect x="6.5" y="6.5" width="11" height="13" rx="5.5"/><path d="M12 10v9.5M6.5 12H3m18 0h-3.5M7 8 4.5 5.5M17 8l2.5-2.5M6.6 16 4 18.5m13.4-2.5L20 18.5"/>',
  warning: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  lightbulb: '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.6-1.5 2.5h-4c0-.9-.6-1.8-1.5-2.5z"/>',
  checkmark: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
};
const ICON_ALIASES = {
  bug: "bug", warning: "warning", error: "warning", alert: "warning", info: "info", information: "info",
  lightbulb: "lightbulb", "light-bulb": "lightbulb", checkmark: "checkmark", check: "checkmark",
};
const MAP_PIN = '<svg class="map-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
const TONE_DEFAULT_ICON = { red: "warning", purple: "bug", yellow: "lightbulb", green: "checkmark" };
const NOTION_COLORS = /_(gray|lightgray|brown|orange|yellow|green|blue|purple|pink|red)$/;

export function iconSvg(icon, tone) {
  let name = null;
  if (icon) {
    if (icon.type === "emoji") return `<span class="ico emoji">${esc(icon.emoji || "")}</span>`;
    if (icon.type === "icon") name = ICON_ALIASES[icon.icon?.name]; // newer API versions
    const url = (icon.external || icon.file || {}).url || "";
    if (url.includes("/icons/")) {
      const base = url.split("?")[0].split("/").pop().split(".")[0].replace(NOTION_COLORS, "");
      name = ICON_ALIASES[base];
    }
  }
  if (!name) {
    if (!tone) return "";
    name = TONE_DEFAULT_ICON[tone] || "info";
  }
  return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

const clsAttr = (color) => (color && color !== "default" ? ` class="${colorClass(color)}"` : "");

/** Python's "%g": up to 6 significant digits, no trailing zeros. */
const g = (n) => String(Number(n.toPrecision(6)));

// Inline databases render as a gallery of mini-cards; property order is by type.
const PROP_ORDER = ["title", "rich_text", "phone_number", "email", "url", "number", "date",
  "people", "checkbox", "status", "select", "multi_select", "formula"];

const tag = (name, color) => `<span class="tag tag-${esc(color || "default")}">${esc(name)}</span>`;

export function propHtml(v, ctx = {}) {
  const t = v.type;
  const d = v[t];
  if ((d === null || d === undefined || d === "" || d === false || (Array.isArray(d) && !d.length)) && t !== "checkbox") return "";
  switch (t) {
    case "title":
    case "rich_text":
      return rich(d, ctx);
    case "email":
      return `<a href="mailto:${esc(d)}">${esc(d)}</a>`;
    case "phone_number":
      return `<a href="tel:${d.replace(/[^0-9+]/g, "")}">${esc(d)}</a>`;
    case "url":
      return `<a href="${esc(d)}"${linkTarget(d)}>${esc(d)}</a>`;
    case "number":
      return esc(String(d));
    case "checkbox":
      return d ? "✓" : "";
    case "date":
      return esc(fmtDate(d.start, ctx.timeZone) + (d.end ? ` – ${fmtDate(d.end, ctx.timeZone)}` : ""));
    case "select":
    case "status":
      return tag(d.name || "", d.color);
    case "multi_select":
      return d.map((o) => tag(o.name || "", o.color)).join("");
    case "people":
      return esc(d.map((p) => p.name).filter(Boolean).join(", "));
    case "formula": {
      const val = d[d.type];
      return val === null || val === undefined || val === "" ? "" : esc(String(val));
    }
    default:
      return "";
  }
}

export class Renderer {
  /**
   * @param {object} ctx
   * @param {Set<string>} [ctx.targets]  compact block ids that links point at; these get id="b-…"
   * @param {Set<string>} [ctx.emitted]  filled with the anchor ids actually written
   * @param {(href: string) => string} [ctx.link]  passed to rich() for database text
   * @param {string} [ctx.timeZone]
   */
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.targets = ctx.targets || new Set();
  }

  /** ` id="b-…"` when something links to this block, else "". */
  anchor(id) {
    if (!id) return "";
    const c = compact(id);
    if (!this.targets.has(c)) return "";
    this.ctx.emitted?.add(c);
    return ` id="b-${c}"`;
  }

  blocks(blocks, depth = 0) {
    return blocks.map((b) => this[`r_${b.type}`](b, depth)).filter(Boolean).join("\n");
  }

  r_heading(b, depth) {
    const tagName = `h${Math.min(b.level + 1, 6)}`;
    let cls = `h${b.level}` + (b.color && b.color !== "default" ? ` ${colorClass(b.color)}` : "");
    const id = this.anchor(b.id);
    const m = /^Step\s+(\d+)\s*[:.\-–—]\s*(.*)$/.exec(b.plain.trim());
    if (m && depth > 0) {
      return `<${tagName} class="${cls} step-title"${id}><span class="step-num">${m[1]}</span>` +
        `<span>${esc(m[2])}</span></${tagName}>`;
    }
    if (depth === 0 && b.level <= 2) cls += " section-head";
    return `<${tagName} class="${cls}"${id}>${b.html}</${tagName}>`;
  }

  r_para(b) {
    return `<p${clsAttr(b.color)}${this.anchor(b.id)}>${b.html}</p>`;
  }

  r_map(b) {
    const button = (href, label) => `<a class="button" href="${esc(href)}"${linkTarget(href)}>${label}</a>`;
    const links = [button(b.google, "Google Maps"), b.apple && button(b.apple, "Apple Maps")].filter(Boolean).join(" ");
    const detail = b.detail ? `<p class="map-detail">${esc(b.detail)}</p>` : "";
    return `<div class="map-tile"${this.anchor(b.id)}>${MAP_PIN}<div class="map-text"><p class="map-title">${esc(b.title)}</p>${detail}</div>` +
      `<p class="map-links">${links}</p></div>`;
  }

  r_buttons(b) {
    const links = b.items.map((it) => `<a class="button" href="${esc(it.href)}"${linkTarget(it.href)}${this.anchor(it.id)}>${esc(it.label)}</a>`);
    return `<p class="buttons">${links.join(" ")}</p>`;
  }

  r_quote(b, depth) {
    return `<blockquote${this.anchor(b.id)}>${b.html}${this.blocks(b.children || [], depth + 1)}</blockquote>`;
  }

  r_divider(b) {
    return `<hr${this.anchor(b.id)}>`;
  }

  r_code(b) {
    return `<pre${this.anchor(b.id)}><code>${esc(b.text)}</code></pre>`;
  }

  r_toggle(b, depth) {
    return `<div class="toggle"${this.anchor(b.id)}><p class="toggle-summary">${b.html}</p>` +
      `${this.blocks(b.children, depth + 1)}</div>`;
  }

  r_image(b) {
    const cap = b.caption ? `<figcaption>${b.caption}</figcaption>` : "";
    const alt = esc(textOf(b.caption) || b.name);
    const id = this.anchor(b.id);
    if (b.src) {
      const size = b.width && b.height ? ` width="${b.width}" height="${b.height}"` : "";
      return `<figure class="photo"${id}><img src="${esc(b.src)}" alt="${alt}"${size}>${cap}</figure>`;
    }
    return `<figure class="photo missing-photo"${id}><div class="ph"><span>Photo not available<br>` +
      `<small>${esc(b.name)}</small></span></div>${cap}</figure>`;
  }

  r_list(b, depth) {
    const items = b.items.map((it) => {
      const kids = it.children.length ? this.blocks(it.children, depth + 1) : "";
      const attrs = clsAttr(it.color) + this.anchor(it.id);
      if (b.kind === "todo") {
        const box = it.checked ? '<span class="box checked" aria-hidden="true"></span>' : '<span class="box" aria-hidden="true"></span>';
        return `<li${attrs}>${box}<span>${it.html}${kids}</span></li>`;
      }
      return `<li${attrs}>${it.html}${kids}</li>`;
    }).join("");
    if (b.kind === "todo") return `<ul class="checklist">${items}</ul>`;
    if (b.kind === "ol") {
      // Notion letters nested lists 1. / a. / i. by depth unless the list sets a format.
      const fmt = { letters: " alpha", roman: " roman" }[b.format || ""] ?? ["", " alpha", " roman"][depth % 3];
      const start = Number(b.start) || 1;
      const st = start !== 1 ? ` start="${start}" style="counter-reset:step ${start - 1}"` : "";
      return `<ol class="steps${fmt}"${st}>${items}</ol>`;
    }
    return `<ul>${items}</ul>`;
  }

  r_callout(b, depth) {
    const color = b.color || "default";
    let tone = color.endsWith("_background") ? color.slice(0, -"_background".length) : "";
    const inner = this.blocks(b.children, depth + 1);
    const id = this.anchor(b.id);
    if (!tone || tone === "default" || (tone === "gray" && depth === 0)) {
      if (depth === 0) {
        // Default/gray top-level callouts are "cards"; cards with photos may split between steps in print.
        const cls = inner.includes('class="photo') ? "card has-media" : "card";
        return `<section class="${cls}"${id}>${inner}</section>`;
      }
      tone = "gray";
    }
    const ico = iconSvg(b.icon, tone);
    return `<div class="callout tone-${tone}"${id}>${ico}<div class="callout-body">${inner}</div></div>`;
  }

  r_columns(b, depth) {
    const cols = b.cols;
    if (!cols.length) return "";
    const ratios = cols.map((c) => (typeof c.ratio === "number" && c.ratio > 0 ? c.ratio : 1 / cols.length));
    const tpl = ratios.map((r) => `${g(r)}fr`).join(" ");
    // Columns are not a nesting level for list lettering, so depth is unchanged.
    const inner = cols.map((c) => `<div class="column"${this.anchor(c.id)}>${this.blocks(c.children, depth)}</div>`).join("");
    return `<div class="columns"${this.anchor(b.id)} style="grid-template-columns:${tpl}">${inner}</div>`;
  }

  r_table(b) {
    if (!b.rows.length) return "";
    const rows = b.rows.map((r, n) => {
      const tagName = b.header && n === 0 ? "th" : "td";
      const cells = r.cells.map((c, k) => {
        const shade = k === 0 && b.rowHeader && tagName === "td" ? ' class="shade"' : "";
        return `<${tagName}${shade}>${c}</${tagName}>`;
      }).join("");
      return `<tr${this.anchor(r.id)}>${cells}</tr>`;
    });
    return `<table class="simple"${this.anchor(b.id)}>${rows.join("")}</table>`;
  }

  r_database(b) {
    if (b.error) return `<p class="missing">[Couldn’t load database “${esc(b.title)}”]</p>`;
    const schema = b.schema;
    const names = Object.keys(schema).filter((n) => PROP_ORDER.includes(schema[n].type));
    names.sort((x, y) => PROP_ORDER.indexOf(schema[x].type) - PROP_ORDER.indexOf(schema[y].type));
    if (!b.rows.length) return '<p class="missing">(no entries)</p>';
    const cards = b.rows.map((row) => {
      const parts = [];
      for (const n of names) {
        const v = row[n];
        if (!v) continue;
        const h = propHtml(v, this.ctx);
        if (!h) continue;
        const typ = v.type;
        if (typ === "title") parts.push(`<p class="person-name">${h}</p>`);
        else if (typ === "select" || typ === "multi_select" || typ === "status") parts.push(`<p class="prop prop-tags">${h}</p>`);
        else {
          const c = { phone_number: "prop-phone", email: "prop-email", rich_text: "prop-text" }[typ] || "prop-other";
          parts.push(`<p class="prop ${c}">${h}</p>`);
        }
      }
      return `<div class="mini-card">${parts.join("")}</div>`;
    });
    return `<div class="gallery"${this.anchor(b.id)}>${cards.join("")}</div>`;
  }
}

export const render = (model, ctx) => new Renderer(ctx).blocks(model);
