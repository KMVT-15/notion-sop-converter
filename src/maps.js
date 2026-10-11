// A Google Maps link on its own line becomes a "map tile" with Google Maps and Apple Maps
// buttons. The Apple Maps link is generated from the Google one: short links
// (maps.app.goo.gl/…) are resolved at build time to find the coordinates or place name.
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { plain } from "./rich-text.js";

const GOOGLE_MAPS = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)([/?#]|$)/i;
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)\s*$/;

export const isGoogleMapsUrl = (href) => GOOGLE_MAPS.test(href || "");

/**
 * A paragraph whose only content is one Google Maps link (linked text, or a pasted
 * link "mention" chip) -> { href, label }. label is "" when there's no useful name.
 */
export function mapLink(rt) {
  const runs = (rt || []).filter((t) => (t.plain_text || "").trim());
  if (!runs.length) return null;
  const href = runs[0].href;
  const linkish = (t) => t.type === "text" || t.mention?.type === "link_mention";
  if (!isGoogleMapsUrl(href) || runs.some((t) => t.href !== href || !linkish(t))) return null;
  let label = runs[0].type === "mention" ? runs[0].mention.link_mention?.title || "" : plain(runs).trim();
  if (/^https?:\/\//i.test(label) || COORDS.test(label) || /^google maps$/i.test(label)) label = "";
  return { href, label };
}

/** Coordinates and/or place name from a full Google Maps URL; null if it has neither. */
export function parseGoogleMapsUrl(url) {
  let u, pathname;
  try {
    u = new URL(url);
    pathname = decodeURIComponent(u.pathname.replace(/\+/g, " "));
  } catch {
    return null;
  }
  const out = {};
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url); // a place's exact pin
  if (pin) [out.lat, out.lng] = [pin[1], pin[2]];
  const place = /\/maps\/place\/([^/@]+)/.exec(pathname)?.[1];
  const search = /\/maps\/search\/([^/@]+)/.exec(pathname)?.[1];
  const params = ["q", "query", "ll", "destination", "daddr"].map((k) => u.searchParams.get(k));
  for (const c of [place, search, ...params].filter(Boolean)) {
    const m = COORDS.exec(c);
    if (m && !out.lat) [out.lat, out.lng] = [m[1], m[2]];
    else if (!m && c === place && !out.name) out.name = c.trim();
    else if (!m && !out.query) out.query = c.trim();
  }
  const view = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),/.exec(pathname); // map center, last resort
  if (!out.lat && view) [out.lat, out.lng] = [view[1], view[2]];
  return out.lat || out.name || out.query ? out : null;
}

/** Apple Maps link for a parsed place; null if there's nothing to point at. */
export function appleMapsUrl(place, label = "") {
  const name = label || place.name;
  if (place.lat) return `https://maps.apple.com/?ll=${place.lat},${place.lng}&q=${encodeURIComponent(name || `${place.lat},${place.lng}`)}`;
  const q = place.query || name;
  return q ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : null;
}

/**
 * Google Maps link for a parsed place, in Google's documented cross-platform format
 * (opens the Maps app on phones, the website elsewhere). Short maps.app.goo.gl links
 * can show "unsupported link" in the phone app, so they're only used as a fallback.
 */
export function googleMapsUrl(place, href) {
  const q = place?.lat ? `${place.lat},${place.lng}` : place?.query || place?.name;
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : href;
}

/** What the tile shows: { title, detail, google, apple }. */
export function mapTile({ href, label, place }) {
  const p = place || {};
  const title = label || p.name || "Location";
  const detail = p.lat ? `${p.lat}, ${p.lng}` : p.query && p.query !== title ? p.query : "";
  return { title, detail, google: googleMapsUrl(place, href), apple: place ? appleMapsUrl(place, label) : null };
}

/** Resolves Google Maps links (following short-link redirects), with a cache in .cache/. */
export class MapResolver {
  constructor({ cacheFile, fetch = globalThis.fetch }) {
    this.cacheFile = cacheFile;
    this.fetch = fetch;
    this.used = {};
    try {
      this.cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
    } catch {
      this.cache = {};
    }
  }

  /** -> parsed place, or null if the link can't be worked out. */
  async resolve(href) {
    if (this.cache[href]) return (this.used[href] = this.cache[href]);
    let url = href;
    let place = parseGoogleMapsUrl(url);
    try {
      for (let hop = 0; !place && hop < 5; hop++) {
        const res = await this.fetch(url, { redirect: "manual", headers: { "User-Agent": "city-sops" }, signal: AbortSignal.timeout(15_000) });
        const next = res.headers.get("location");
        await res.body?.cancel();
        if (!next) break;
        url = new URL(next, url).href;
        place = parseGoogleMapsUrl(url);
      }
    } catch {
      place = null;
    }
    if (place) this.cache[href] = this.used[href] = place;
    return place;
  }

  /** Keep only the links this build used. */
  async save() {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(this.used, null, 1));
  }
}
