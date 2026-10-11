import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import { isHeic, processImage, stableUrl } from "../src/assets.js";

test("iPhone HEIC photos are converted to WebP", async () => {
  const raw = readFileSync(new URL("fixtures/images/IMG_1986.heic", import.meta.url));
  assert.ok(isHeic(raw));
  const out = await processImage(raw, "IMG_1986.heic");
  assert.equal(out.ext, "webp");
  assert.deepEqual([out.width, out.height], [900, 1200]);
  assert.equal((await sharp(out.buf).metadata()).format, "webp");
});

test("large photos shrink to 2000px on the long edge and honor EXIF orientation", async () => {
  // 3000x2000 stored landscape, EXIF says rotate 90° -> displayed 2000x3000 -> 1333x2000
  const raw = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#456" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const out = await processImage(raw, "photo.jpg");
  assert.deepEqual([out.ext, out.width, out.height], ["webp", 1333, 2000]);
});

test("PNG screenshots become much smaller WebPs and keep their transparency", async () => {
  // a noisy RGBA image: PNG compresses it poorly, like real screenshots and photos
  const w = 800, h = 500, px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    const x = (i / 4) % w, y = Math.floor(i / 4 / w);
    px.set([(x * 7 + y * 3) % 256, (x ^ y) & 255, (x * y) % 256, x < 20 ? 0 : 255], i); // transparent left edge
  }
  const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  const out = await processImage(png, "shot.png");
  const meta = await sharp(out.buf).metadata();
  assert.deepEqual([out.ext, meta.format, meta.hasAlpha], ["webp", "webp", true]);
  assert.ok(out.buf.length < png.length / 2, `WebP ${out.buf.length} B vs PNG ${png.length} B`);
});

test("cache keys ignore Notion's per-request URL signatures", () => {
  const a = "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/file-uuid/up_next.png?X-Amz-Signature=aaa&X-Amz-Date=1";
  const b = "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/file-uuid/up_next.png?X-Amz-Signature=bbb&X-Amz-Date=2";
  assert.equal(stableUrl(a), stableUrl(b));
  assert.equal(stableUrl("https://example.com/a.png?v=2"), "https://example.com/a.png?v=2");
});
