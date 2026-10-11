// Downloads photos, page icons and attached files during the build (Notion's signed
// file links expire after about an hour), resizes photos and converts them to WebP,
// and writes them under <site>/assets/. Processed results are cached in .cache/ so
// rebuilds skip unchanged images; entries a build no longer uses are deleted.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { fileName } from "./convert.js";

export const PHOTO_MAX_PX = 2000; // keeps typical screenshots at full resolution for the full-screen view
const ICON_PX = 128;
// WebP q85: ~6x smaller than PNG for the Sunnyvale screenshots, with UI text indistinguishable at 1:1.
export const WEBP_QUALITY = 85;
// Part of every image cache key, so changing size or format re-processes cached images.
const RECIPE = `webp-q${WEBP_QUALITY}`;

const sha1 = (data) => createHash("sha1").update(data).digest("hex");

/** Signed Notion file URLs change on every request; key the cache on the stable part. */
export function stableUrl(url) {
  try {
    const u = new URL(url);
    if ([...u.searchParams.keys()].some((k) => k.toLowerCase().startsWith("x-amz-"))) return u.origin + u.pathname;
  } catch {
    // not a URL; use as-is
  }
  return url;
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
export const isHeic = (buf) =>
  buf.length > 12 && buf.toString("latin1", 4, 8) === "ftyp" && HEIF_BRANDS.has(buf.toString("latin1", 8, 12));
const isSvg = (buf, name) => /\.svg$/i.test(name) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.toString("utf8", 0, 256));

async function heicToJpeg(buf) {
  // sharp's prebuilt binaries can't decode HEVC-compressed HEIC (iPhone photos).
  const { default: convert } = await import("heic-convert");
  return Buffer.from(await convert({ buffer: buf, format: "JPEG", quality: 0.92 }));
}

/**
 * Photo -> { buf, ext, width, height }: auto-rotated, at most `maxPx` on the long edge,
 * encoded as WebP (transparency kept, e.g. macOS window-screenshot shadows). SVGs pass through.
 */
export async function processImage(raw, name, maxPx = PHOTO_MAX_PX) {
  if (isSvg(raw, name)) return { buf: raw, ext: "svg" };
  let input = raw;
  if (isHeic(raw)) {
    try {
      input = await heicToJpeg(raw);
    } catch {
      // maybe AVIF-in-HEIF, which sharp handles itself
    }
  }
  const { data, info } = await sharp(input, { failOn: "none" }).autoOrient()
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toBuffer({ resolveWithObject: true });
  return { buf: data, ext: "webp", width: info.width, height: info.height };
}

export class Assets {
  /**
   * @param {object} opts
   * @param {string} opts.outDir  <site>/assets
   * @param {string} opts.cacheDir
   * @param {boolean} [opts.images]  false = don't download photos (--no-images)
   * @param {boolean} [opts.useCache]
   * @param {(msg: string) => void} opts.warn
   */
  constructor({ outDir, cacheDir, images = true, useCache = true, warn }) {
    Object.assign(this, { outDir, cacheDir, images, useCache, warn });
    this.active = 0;
    this.waiting = [];
    this.used = new Set(); // cache keys this build needed
  }

  /**
   * Delete cached images this build didn't use (replaced photos, old formats).
   * Only call after a complete build that downloaded images, or a partial one would empty the cache.
   */
  async pruneCache() {
    let names;
    try {
      names = await fs.readdir(this.cacheDir);
    } catch {
      return 0;
    }
    const stale = names.filter((n) => /^[0-9a-f]{20}\.(json|bin)$/.test(n) && !this.used.has(n.slice(0, 20)));
    await Promise.all(stale.map((n) => fs.rm(path.join(this.cacheDir, n), { force: true })));
    return stale.length / 2;
  }

  /** Image block data -> { src, width, height } or null (placeholder / external URL fallback). */
  async image(d) {
    const url = d.file?.url || d.external?.url;
    if (!url || !this.images) return null;
    const name = fileName(url) || "image";
    try {
      return await this.cached(`photo-${PHOTO_MAX_PX}-${RECIPE}`, url, "img", async (raw) => processImage(raw, name));
    } catch (e) {
      this.warn(`couldn't download image ${name}: ${e.message}`);
      return null;
    }
  }

  /** Page icon -> { emoji } | { src } | null. */
  async icon(icon) {
    if (!icon) return null;
    if (icon.type === "emoji") return { emoji: icon.emoji };
    const url = icon.file?.url || icon.external?.url;
    if (!url || !this.images) return null;
    try {
      return await this.cached(`icon-${ICON_PX}-${RECIPE}`, url, "icons", async (raw) => processImage(raw, fileName(url), ICON_PX));
    } catch (e) {
      this.warn(`couldn't download page icon: ${e.message}`);
      return null;
    }
  }

  /** Notion-hosted attachment (file/pdf/video/audio block) -> { src } or null. */
  async file(d) {
    const url = d.file?.url;
    if (!url) return null;
    const name = (d.name || fileName(url) || "file").replace(/[\\/:*?"<>|#%]+/g, "-");
    try {
      return await this.cached("file", url, "files", async (raw) => ({ buf: raw, name }));
    } catch (e) {
      this.warn(`couldn't download file ${name}: ${e.message}`);
      return null;
    }
  }

  async cached(kind, url, subdir, process) {
    const key = sha1(`${kind}|${stableUrl(url)}`).slice(0, 20);
    this.used.add(key);
    const metaPath = path.join(this.cacheDir, `${key}.json`);
    const dataPath = path.join(this.cacheDir, `${key}.bin`);
    let result = null;
    if (this.useCache && existsSync(metaPath) && existsSync(dataPath)) {
      try {
        result = { ...JSON.parse(await fs.readFile(metaPath, "utf8")), buf: await fs.readFile(dataPath) };
      } catch {
        result = null;
      }
    }
    if (!result) {
      result = await process(await this.download(url));
      await fs.mkdir(this.cacheDir, { recursive: true });
      const { buf, ...meta } = result;
      await fs.writeFile(dataPath, buf);
      await fs.writeFile(metaPath, JSON.stringify(meta));
    }
    return this.publish(result, subdir);
  }

  /** Write into the site under a content-hashed name, so browsers never show a stale copy. */
  async publish({ buf, ext, name, width, height }, subdir) {
    const hash = sha1(buf).slice(0, 12);
    const file = name ? `${hash}-${name}` : `${hash}.${ext}`;
    const dir = path.join(this.outDir, subdir);
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, file);
    if (!existsSync(dest)) await fs.writeFile(dest, buf);
    const src = `assets/${subdir}/${file.split("/").map(encodeURIComponent).join("/")}`;
    return width && height ? { src, width, height } : { src };
  }

  async download(url) {
    // Cap parallel downloads; Notion's file host is separate from the API rate limit.
    if (this.active >= 6) await new Promise((r) => this.waiting.push(r));
    else this.active++;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "city-sops" }, signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
