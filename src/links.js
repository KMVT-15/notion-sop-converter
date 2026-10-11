// Rewrites Notion links so they work for readers without Notion access:
//   link to a block on the same SOP  -> "#b-<blockid>" (in-page jump)
//   link to another SOP on the site  -> "<slug>.html" (+ "#b-<blockid>")
//   any other Notion link            -> absolute notion.so URL (unchanged behavior)
//   non-Notion links                 -> unchanged
import { compact, lastIdIn } from "./notion.js";
import { absoluteNotion } from "./rich-text.js";

const NOTION_HOST = /(^|\.)notion\.(so|site|com)$/i;
const BLOCK_HASH = /^#([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$/i;

/**
 * @param {object} opts
 * @param {string} opts.pageId  the SOP being rendered (dashed UUID)
 * @param {Map<string,string>} opts.slugById  dashed page id -> slug, for every SOP on the site
 * @param {Set<string>} opts.targets  collects compact block ids that links point at
 */
export function createLinker({ pageId, slugById, targets }) {
  return function link(href) {
    let url;
    try {
      url = new URL(href, "https://www.notion.so");
    } catch {
      return href;
    }
    if (!href.startsWith("/") && !NOTION_HOST.test(url.hostname)) return href;
    const pid = lastIdIn(url.pathname);
    if (!pid) return absoluteNotion(href);
    const bm = BLOCK_HASH.exec(url.hash);
    const block = bm ? compact(bm[1]) : null;
    const anchor = block ? `#b-${block}` : "";
    const slug = pid === pageId ? "" : slugById.get(pid);
    if (slug === undefined) return absoluteNotion(href);
    if (block) targets.add(block);
    return slug ? `${slug}.html${anchor}` : anchor || "#";
  };
}
