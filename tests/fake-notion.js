// A local stand-in for api.notion.com serving tests/fixtures/notion.js.
// Records every request so tests can assert what was (and wasn't) fetched.
import http from "node:http";
import { buildWorkspace } from "./fixtures/notion.js";

export const TEST_TOKEN = "test-token";

const parts0 = (path) => path.split("/")[0];

/** Query sorts on timestamps and text-like properties (enough for the fixtures). Stable, like Notion's. */
function sorted(rows, sorts = []) {
  const value = (r, s) => {
    if (s.timestamp) return r[s.timestamp] || "";
    const p = r.properties[s.property] || {};
    const v = p[p.type];
    return Array.isArray(v) ? v.map((t) => t.plain_text).join("") : v?.name ?? v ?? "";
  };
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const c = String(value(a, s)).localeCompare(String(value(b, s)));
      if (c) return s.direction === "descending" ? -c : c;
    }
    return 0;
  });
}

/**
 * @param {object} [opts]
 * @param {number} [opts.pageSize]  max results per page (small values exercise pagination)
 * @param {number} [opts.rateLimitFirst]  answer this many API requests with 429 first
 */
export async function startFakeNotion({ pageSize = 100, rateLimitFirst = 0 } = {}) {
  const calls = [];
  let w;
  let limited = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    const notFound = (what) => send(404, { object: "error", status: 404, code: "object_not_found", message: `Could not find ${what}.` });

    if (url.pathname.startsWith("/files/")) {
      calls.push({ method: req.method, path: url.pathname });
      const f = w.files[decodeURIComponent(url.pathname.slice("/files/".length))];
      if (!f) return res.writeHead(404).end();
      if (!url.searchParams.get("X-Amz-Signature")) return res.writeHead(403).end();
      res.writeHead(200, { "Content-Type": f.type });
      return res.end(f.buf);
    }
    if (!url.pathname.startsWith("/v1/")) return notFound("route");
    const path = url.pathname.slice(4);
    calls.push({ method: req.method, path });
    if (req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return send(401, { object: "error", status: 401, code: "unauthorized", message: "API token is invalid." });
    }
    // Like the real API: views exist only in newer versions; everything else is read as 2022-06-28 shapes.
    const version = parts0(path) === "views" ? "2025-09-03" : "2022-06-28";
    if (req.headers["notion-version"] !== version) return send(400, { object: "error", status: 400, message: "Bad Notion-Version" });
    if (limited < rateLimitFirst) {
      limited++;
      return send(429, { object: "error", status: 429, code: "rate_limited", message: "Slow down." }, { "Retry-After": "0" });
    }

    const parts = path.split("/");
    const limit = Math.min(pageSize, Number(url.searchParams.get("page_size")) || 100);
    if (req.method === "GET" && parts[0] === "pages" && parts.length === 2) {
      return w.pages[parts[1]] ? send(200, w.pages[parts[1]]) : notFound(`page with ID: ${parts[1]}`);
    }
    if (req.method === "GET" && parts[0] === "blocks" && parts[2] === "children") {
      const id = parts[1];
      if (!w.children[id] && !w.blockIds.has(id) && !w.pages[id]) return notFound(`block with ID: ${id}`);
      return send(200, paginate(w.children[id] || [], url.searchParams.get("start_cursor"), limit));
    }
    if (req.method === "GET" && parts[0] === "views" && parts.length === 1) {
      const db = w.databases[url.searchParams.get("database_id")];
      if (!db) return notFound("database");
      return send(200, paginate((db.views || []).map(({ id }) => ({ object: "view", id })), url.searchParams.get("start_cursor"), limit));
    }
    if (req.method === "GET" && parts[0] === "views" && parts.length === 2) {
      const view = Object.values(w.databases).flatMap((db) => db.views || []).find((v) => v.id === parts[1]);
      return view ? send(200, { object: "view", sorts: null, ...view }) : notFound(`view with ID: ${parts[1]}`);
    }
    if (parts[0] === "databases") {
      const db = w.databases[parts[1]];
      if (!db) return notFound(`database with ID: ${parts[1]}`);
      if (req.method === "GET" && parts.length === 2) return send(200, { ...db.meta, id: parts[1] });
      if (req.method === "POST" && parts[2] === "query") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const { start_cursor: cursor, page_size: size, sorts } = JSON.parse(body || "{}");
        return send(200, paginate(sorted(db.rows, sorts), cursor, Math.min(pageSize, size || 100)));
      }
    }
    return notFound("route");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  w = await buildWorkspace(base);
  return {
    base,
    apiBase: `${base}/v1`,
    calls,
    workspace: w,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }),
  };
}

function paginate(list, cursor, size) {
  const start = cursor ? Number(cursor) : 0;
  const end = start + size;
  return { object: "list", results: list.slice(start, end), has_more: end < list.length, next_cursor: end < list.length ? String(end) : null };
}
