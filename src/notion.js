// Minimal Notion REST client: retries, rate-limit back-off, pagination, a concurrency cap.
// Pinned to the same API version the original Python tool used, so block shapes match.

export const NOTION_VERSION = "2022-06-28";
// The Views API (a database's saved views and their sorts) only exists in this newer version.
export const VIEWS_VERSION = "2025-09-03";
const DEFAULT_BASE = "https://api.notion.com/v1";

export class NotionError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Notion {
  /**
   * @param {string} token  Notion integration secret
   * @param {object} [opts]
   * @param {string} [opts.base]  API base URL (tests point this at a fake server)
   * @param {number} [opts.concurrency]  max requests in flight (Notion averages 3 req/s per integration)
   */
  constructor(token, { base = process.env.NOTION_API_BASE || DEFAULT_BASE, concurrency = 3 } = {}) {
    this.token = token;
    this.base = base.replace(/\/+$/, "");
    this.concurrency = concurrency;
    this.requests = 0;
    this.active = 0;
    this.waiting = [];
    this.pausedUntil = 0;
  }

  async req(method, path, body, version = NOTION_VERSION) {
    await this.acquire();
    try {
      return await this.send(method, path, body, version);
    } finally {
      this.release();
    }
  }

  async acquire() {
    if (this.active < this.concurrency) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  async send(method, path, body, version) {
    const url = `${this.base}/${path.replace(/^\/+/, "")}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const pause = this.pausedUntil - Date.now();
      if (pause > 0) await sleep(pause);
      let res;
      try {
        this.requests++;
        res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Notion-Version": version,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        if (attempt < 2) {
          await sleep(1000);
          continue;
        }
        throw new NotionError(`Couldn't reach Notion: ${e.cause?.message || e.message}`);
      }
      if (res.status === 429 || res.status >= 500) {
        await res.arrayBuffer().catch(() => {});
        const header = res.headers.get("retry-after");
        const secs = header !== null && header.trim() !== "" && !Number.isNaN(Number(header)) ? Number(header) : 1 + attempt;
        // Back off every request, not just this one: the limit is per integration.
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + secs * 1000);
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        const date = res.headers.get("date");
        if (date) this.serverDate = new Date(date); // Notion's clock, for comparing with its edit times
        return JSON.parse(text);
      }
      let msg = "";
      try {
        msg = JSON.parse(text).message || "";
      } catch {
        // non-JSON error body
      }
      if (res.status === 401) throw new NotionError("Notion rejected the token (401). Check NOTION_TOKEN.");
      if (res.status === 404) {
        throw new NotionError(
          "Notion says it can't find that page/database (404). Make sure the page (or a parent page such as " +
          "'City SOP Improvements') is shared with your integration: open it in Notion > ••• > Connections > " +
          `add your integration.\n  ${msg}`);
      }
      throw new NotionError(`Notion API error ${res.status}: ${msg}`);
    }
    throw new NotionError("Notion kept rate-limiting the request; try again in a minute.");
  }

  page(id) {
    return this.req("GET", `pages/${id}`);
  }

  async children(id) {
    const out = [];
    let cursor = null;
    do {
      const q = `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await this.req("GET", q);
      out.push(...(r.results || []));
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    return out;
  }

  database(id) {
    return this.req("GET", `databases/${id}`);
  }

  /** A database's saved views ({id} only), in tab order. */
  async views(databaseId) {
    const out = [];
    let cursor;
    do {
      const qs = new URLSearchParams({ database_id: databaseId, page_size: "100", ...(cursor && { start_cursor: cursor }) });
      const r = await this.req("GET", `views?${qs}`, undefined, VIEWS_VERSION);
      out.push(...(r.results || []));
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);
    return out;
  }

  view(id) {
    return this.req("GET", `views/${id}`, undefined, VIEWS_VERSION);
  }

  async query(id, sorts) {
    const out = [];
    const body = { page_size: 100, ...(sorts && { sorts }) };
    for (;;) {
      const r = await this.req("POST", `databases/${id}/query`, body);
      out.push(...(r.results || []));
      if (!r.has_more) return out;
      body.start_cursor = r.next_cursor;
    }
  }
}

const UUID = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;

/** "3f47446c6b1f..." or dashed -> canonical dashed lowercase UUID. */
export function dashed(id) {
  const h = id.replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Block/page id without dashes, used for HTML anchors. */
export const compact = (id) => id.replace(/-/g, "").toLowerCase();

/** Page id from a Notion link or a bare id; null if there isn't one. */
export function pageIdFrom(s) {
  s = String(s).trim();
  const m = /([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?:[?#]|$)/i.exec(s) || /([0-9a-f]{32})/i.exec(s);
  return m ? dashed(m[1]) : null;
}

/** The last UUID in a string (Notion URL paths end with the page id). */
export function lastIdIn(s) {
  const all = String(s).match(UUID);
  return all ? dashed(all[all.length - 1]) : null;
}
