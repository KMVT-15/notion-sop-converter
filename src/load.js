// Fetches a page's block tree from Notion. Children are attached as `block.children`,
// inline databases as `block.database`, downloaded media as `block.asset`, and
// resolved Google Maps links (for map tiles) as `block.map`.
// Skipped sections (e.g. "Change Log") are dropped before their contents are fetched.
import { mapLink } from "./maps.js";
import { plain } from "./rich-text.js";

// Blocks whose children the converter uses. child_page is deliberately absent:
// sub-pages render as their title only, so their content is never fetched.
const CONTAINERS = new Set([
  "paragraph", "heading_1", "heading_2", "heading_3", "heading_4", "callout", "column", "toggle", "quote",
  "bulleted_list_item", "numbered_list_item", "to_do",
]);
const FILE_TYPES = new Set(["file", "pdf", "video", "audio"]);

/**
 * @param {import('./notion.js').Notion} api
 * @param {string} blockId
 * @param {object} ctx
 * @param {string[]} ctx.skip  lower-cased section/database titles to leave out
 * @param {import('./assets.js').Assets} ctx.assets
 * @param {(msg: string) => void} ctx.warn
 * @param {string[]} [ctx.unsupported]  collects block types the API returns as "unsupported" (e.g. "button")
 * @param {import('./maps.js').MapResolver} [ctx.maps]  resolves Google Maps links for map tiles
 * @param {Array} [ctx.databases]  collects inline databases' row ids and edit times (for change detection)
 */
export async function loadBlocks(api, blockId, ctx) {
  const kept = dropSkipped(await api.children(blockId), ctx.skip);
  await Promise.all(kept.map((b) => loadBlock(api, b, ctx)));
  return kept;
}

/** Remove skipped headings, everything under them until the next same-or-higher heading, and skipped databases. */
export function dropSkipped(blocks, skip) {
  const out = [];
  let skipping = null;
  for (const b of blocks) {
    const t = b.type;
    const d = b[t] || {};
    const hm = /^heading_(\d)$/.exec(t || "");
    if (hm) {
      const level = Number(hm[1]);
      if (skipping !== null && level <= skipping) skipping = null;
      if (skip.includes(plain(d.rich_text).trim().toLowerCase())) skipping = level;
    }
    if (skipping !== null) continue;
    if (t === "child_database" && skip.includes((d.title || "").trim().toLowerCase())) continue;
    out.push(b);
  }
  return out;
}

async function loadBlock(api, b, ctx) {
  const t = b.type;
  const d = b[t] || {};
  const map = t === "paragraph" && ctx.maps ? mapLink(d.rich_text) : null;
  if (map) {
    b.map = { ...map, place: await ctx.maps.resolve(map.href) };
    if (!b.map.place) ctx.warn(`couldn't work out where the Google Maps link ${map.href} points, so its tile has no Apple Maps button`);
  }
  if (t === "synced_block") {
    const src = d.synced_from?.block_id;
    if (src || b.has_children) b.children = await loadBlocks(api, src || b.id, ctx);
  } else if (t === "column_list" || t === "table" || (CONTAINERS.has(t) && b.has_children)) {
    b.children = await loadBlocks(api, b.id, ctx);
  } else if (t === "child_database") {
    b.database = await loadDatabase(api, b.id, d.title || "", ctx);
  } else if (t === "image") {
    b.asset = await ctx.assets.image(d);
  } else if (FILE_TYPES.has(t) && d.type === "file") {
    b.asset = await ctx.assets.file(d);
  } else if (t === "unsupported") {
    ctx.unsupported?.push(d.block_type || "unknown");
  }
}

/**
 * The order Notion shows a database's rows in, as query sorts: the first view's sort, if it has one,
 * then oldest first (where Notion puts rows that haven't been dragged). The API can't read a manual
 * drag order, so a view with no sort comes out oldest first.
 */
export async function rowSorts(api, id, warn) {
  let sorts = [];
  try {
    const [first] = await api.views(id);
    if (first) sorts = (await api.view(first.id)).sorts || [];
  } catch (e) {
    warn?.(`couldn't read the sort order of a database (${id}); listing it oldest first: ${e.message}`);
  }
  return [...sorts, { timestamp: "created_time", direction: "ascending" }];
}

async function loadDatabase(api, id, title, ctx) {
  try {
    const [meta, sorts] = await Promise.all([api.database(id), rowSorts(api, id, ctx.warn)]);
    const rows = await api.query(id, sorts);
    title = title || plain(meta.title);
    // for change detection (changes.js): row edits don't change the page's last-edited time
    ctx.databases?.push({ id, title, sorts, rows: rows.map((r) => ({ id: r.id, last_edited_time: r.last_edited_time })) });
    return { title, schema: meta.properties || {}, rows: rows.map((r) => r.properties || {}) };
  } catch (e) {
    ctx.warn(`couldn't read database '${title}': ${e.message}`);
    return { title, error: true };
  }
}
