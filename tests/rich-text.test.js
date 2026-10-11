import assert from "node:assert/strict";
import test from "node:test";
import { fmtDate, slugify } from "../src/html.js";
import { rich } from "../src/rich-text.js";
import { rt } from "./fixtures/notion.js";

test("whitespace inside a formatting run moves outside the tag", () => {
  const html = rich([rt("Plug it in to the "), rt("CLK-01 ", { italic: true }), rt("port.")]);
  assert.equal(html, "Plug it in to the <em>CLK-01</em> port.");
});

test("a run that is only whitespace collapses to the space", () => {
  assert.equal(rich([rt("Operator PC", { italic: true }), rt(" ", { italic: true }), rt("using")]), "<em>Operator PC</em> using");
});

test("inline code keeps its spaces; annotations nest in a fixed order", () => {
  assert.equal(rich([rt(" a b ", { code: true })]), "<code> a b </code>");
  assert.equal(rich([rt("x", { bold: true, italic: true, underline: true, color: "gray" })]),
    '<span class="c-gray"><span class="u"><em><strong>x</strong></em></span></span>');
  assert.equal(rich([rt("hi", { color: "yellow_background" })]), '<span class="hl-yellow">hi</span>');
});

test("text is escaped and newlines become <br>", () => {
  assert.equal(rich([rt("<name> & 'you'\nnext")]), "&lt;name&gt; &amp; &#x27;you&#x27;<br>next");
});

test("relative Notion links become absolute without a linker", () => {
  assert.equal(rich([rt("Wiki", { href: "/Wiki-abc" })]), '<a href="https://www.notion.so/Wiki-abc" target="_blank" rel="noopener">Wiki</a>');
});

test("external links open in a new tab; links within the site don't, and are marked internal (gray)", () => {
  assert.match(rich([rt("x", { href: "https://playback.sv.kmvt.net" })]), /<a href="https:\/\/playback\.sv\.kmvt\.net" target="_blank" rel="noopener">/);
  assert.equal(rich([rt("x", { href: "#b-1" })], { link: (h) => h }), '<a href="#b-1" class="internal">x</a>');
  assert.equal(rich([rt("x", { href: "mountain-view.html" })], { link: (h) => h }), '<a href="mountain-view.html" class="internal">x</a>');
  assert.equal(rich([rt("x", { href: "mailto:a@b.org" })]), '<a href="mailto:a@b.org">x</a>');
});

test("date mentions use Month D, YYYY", () => {
  const mention = { type: "mention", mention: { type: "date", date: { start: "2026-07-14", end: "2026-07-16" } }, plain_text: "2026-07-14", annotations: {} };
  assert.equal(rich([mention]), '<span class="mention">July 14, 2026 – July 16, 2026</span>');
});

test("fmtDate: date-only values are not shifted by time zone; datetimes use the site time zone", () => {
  assert.equal(fmtDate("2026-07-14", "America/Los_Angeles"), "July 14, 2026");
  assert.equal(fmtDate("2026-10-10T01:26:05.392Z", "America/Los_Angeles"), "October 9, 2026");
  assert.equal(fmtDate("2026-10-10T01:26:05.392Z", "UTC"), "October 10, 2026");
});

test("slugify", () => {
  assert.equal(slugify("Los Altos Hills"), "los-altos-hills");
  assert.equal(slugify("LAH Fire District / SVCEA"), "lah-fire-district-svcea");
  assert.equal(slugify("Café & Co."), "cafe-and-co");
  assert.equal(slugify("!!!"), "");
});
