// Loaded Notion blocks -> a small document model the renderer understands.
// Pure (no I/O): everything it needs was attached by load.js.
import { esc, linkTarget } from "./html.js";
import { mapTile } from "./maps.js";
import { absoluteNotion, plain, rich } from "./rich-text.js";

const LIST_KINDS = { bulleted_list_item: "ul", numbered_list_item: "ol", to_do: "todo" };
const LINK_TYPES = new Set(["bookmark", "embed", "link_preview", "file", "pdf", "video", "audio"]);

/** Last path segment of a URL, decoded ("Screenshot%20A.png" -> "Screenshot A.png"). */
export function fileName(url) {
  const base = String(url).split("?")[0].split("/").pop() || "";
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

/**
 * A paragraph whose only content is one link (e.g. "Open parking map") -> { href, label }.
 * These render as buttons, standing in for Notion buttons, which the API can't read.
 * Bare URLs and page mentions stay ordinary links.
 */
export function linkButton(rt) {
  const runs = (rt || []).filter((t) => (t.plain_text || "").trim());
  if (!runs.length || runs.some((t) => t.type !== "text" || !t.href || t.annotations?.code)) return null;
  const href = runs[0].href;
  if (runs.some((t) => t.href !== href)) return null;
  const label = plain(rt).trim();
  if (/^(https?:\/\/|www\.)\S+$/i.test(label)) return null;
  return { href, label };
}

/**
 * @param {Array} blocks  loaded blocks (see load.js)
 * @param {object} ctx  passed to rich(): { link, timeZone }
 */
export function convert(blocks, ctx) {
  const R = (rt) => rich(rt, ctx);
  const kids = (b) => (b.children ? convert(b.children, ctx) : []);
  const out = [];
  for (const b of blocks) {
    const t = b.type;
    const d = b[t] || {};
    if (t in LIST_KINDS) {
      const item = { id: b.id, html: R(d.rich_text), checked: Boolean(d.checked), color: d.color || "default", children: kids(b) };
      const kind = LIST_KINDS[t];
      const last = out[out.length - 1];
      if (last && last.type === "list" && last.kind === kind) last.items.push(item);
      else out.push({ type: "list", kind, items: [item], format: d.list_format, start: d.list_start_index || 1 });
      continue;
    }
    const hm = /^heading_(\d)$/.exec(t || "");
    if (hm) {
      out.push({ type: "heading", id: b.id, level: Number(hm[1]), html: R(d.rich_text), plain: plain(d.rich_text), color: d.color || "default" });
      out.push(...kids(b)); // toggleable headings: show contents
      continue;
    }
    if (t === "paragraph") {
      if (b.map) {
        out.push({ type: "map", id: b.id, ...mapTile(b.map) });
        out.push(...kids(b));
        continue;
      }
      const button = linkButton(d.rich_text);
      if (button) {
        // consecutive link-only paragraphs share one row of buttons
        const item = { id: b.id, label: button.label, href: ctx.link ? ctx.link(button.href) : absoluteNotion(button.href) };
        const last = out[out.length - 1];
        if (last && last.type === "buttons") last.items.push(item);
        else out.push({ type: "buttons", items: [item] });
        out.push(...kids(b));
        continue;
      }
      const h = R(d.rich_text);
      if (h.trim()) out.push({ type: "para", id: b.id, html: h, color: d.color || "default" });
      out.push(...kids(b));
    } else if (t === "callout") {
      const children = [];
      if (plain(d.rich_text).trim()) children.push({ type: "para", html: R(d.rich_text), color: "default" });
      children.push(...kids(b));
      out.push({ type: "callout", id: b.id, color: d.color || "default", icon: d.icon, children });
    } else if (t === "column_list") {
      const cols = (b.children || []).filter((c) => c.type === "column").map((c) => ({
        id: c.id, ratio: c.column?.width_ratio, children: kids(c),
      }));
      out.push({ type: "columns", id: b.id, cols });
    } else if (t === "toggle") {
      out.push({ type: "toggle", id: b.id, html: R(d.rich_text), children: kids(b) });
    } else if (t === "quote") {
      out.push({ type: "quote", id: b.id, html: R(d.rich_text), children: kids(b) });
    } else if (t === "divider") {
      out.push({ type: "divider", id: b.id });
    } else if (t === "code") {
      out.push({ type: "code", id: b.id, text: plain(d.rich_text) });
    } else if (t === "image") {
      const url = d.file?.url || d.external?.url || "";
      out.push({
        type: "image", id: b.id,
        src: b.asset?.src || (d.type === "external" ? url : ""),
        width: b.asset?.width, height: b.asset?.height,
        name: fileName(url) || "image", caption: R(d.caption),
      });
    } else if (t === "table") {
      const rows = (b.children || []).filter((r) => r.type === "table_row")
        .map((r) => ({ id: r.id, cells: (r.table_row?.cells || []).map(R) }));
      out.push({ type: "table", id: b.id, rows, header: Boolean(d.has_column_header), rowHeader: Boolean(d.has_row_header) });
    } else if (t === "child_database") {
      out.push({ type: "database", id: b.id, ...(b.database || { title: d.title || "", error: true }) });
    } else if (t === "synced_block") {
      out.push(...kids(b));
    } else if (LINK_TYPES.has(t)) {
      // Notion-hosted files are downloaded (their links expire); external ones are linked as-is.
      const url = d.url || d.external?.url || d.file?.url || "";
      const hosted = d.type === "file";
      const label = plain(d.caption) || d.name || (hosted ? fileName(url) : url.split("?")[0]);
      const href = hosted ? b.asset?.src : url;
      if (href) out.push({ type: "para", id: b.id, color: "default", html: `<a href="${esc(href)}"${linkTarget(href)}>${esc(label)}</a>` });
      else if (url) out.push({ type: "para", id: b.id, color: "default", html: `<span class="missing">${esc(label)} (file not available)</span>` });
    } else if (t === "child_page") {
      out.push({ type: "para", id: b.id, color: "default", html: `<span class="mention">${esc(d.title || "")}</span>` });
    } else if (t === "equation") {
      out.push({ type: "para", id: b.id, color: "default", html: esc(d.expression || "") });
    }
    // table_of_contents, breadcrumb, link_to_page, button/unsupported: skipped
  }
  return out;
}
