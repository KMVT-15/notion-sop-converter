import assert from "node:assert/strict";
import test from "node:test";
import { assignSlugs } from "../src/build.js";
import { convert, linkButton } from "../src/convert.js";
import { createLinker } from "../src/links.js";
import { render } from "../src/render.js";
import { rt } from "./fixtures/notion.js";

const para = (html, extra = {}) => ({ type: "para", html, color: "default", ...extra });
const item = (html, children = []) => ({ id: null, html, checked: false, color: "default", children });

test("ordered lists letter by depth: 1. / a. / i., and keep custom starts", () => {
  const list = (items, start = 1) => ({ type: "list", kind: "ol", items, start });
  const html = render([list([item("one", [list([item("two", [list([item("three")])])])])])]);
  assert.match(html, /^<ol class="steps"><li>one<ol class="steps alpha"><li>two<ol class="steps roman">/);
  assert.match(render([list([item("x")], 4)]), /<ol class="steps" start="4" style="counter-reset:step 3">/);
});

test("Step N headings get a badge only inside a card", () => {
  const h = { type: "heading", level: 3, html: "Step 2: Load graphics", plain: "Step 2: Load graphics", color: "default" };
  assert.equal(render([{ type: "callout", color: "default", children: [h] }]),
    '<section class="card"><h4 class="h3 step-title"><span class="step-num">2</span><span>Load graphics</span></h4></section>');
  assert.equal(render([h]), '<h4 class="h3">Step 2: Load graphics</h4>');
});

test("callouts: default/gray top level -> card; colored -> tone with icon; nested gray -> gray callout", () => {
  assert.match(render([{ type: "callout", color: "gray_background", children: [para("a")] }]), /^<section class="card">/);
  const red = render([{ type: "callout", color: "red_background", icon: null, children: [para("a")] }]);
  assert.match(red, /^<div class="callout tone-red"><svg class="ico"[^>]*><path d="M12 3.5/);
  const nested = render([{ type: "callout", color: "default", children: [{ type: "callout", color: "gray_background", children: [para("b")] }] }]);
  assert.match(nested, /<section class="card"><div class="callout tone-gray">/);
  const photo = { type: "image", src: "assets/img/a.jpg", name: "a.jpg", caption: "", width: 10, height: 5 };
  assert.match(render([{ type: "callout", color: "default", children: [photo] }]), /^<section class="card has-media">/);
});

test("columns use Notion width ratios when present, equal otherwise", () => {
  const cols = (r1, r2) => render([{ type: "columns", cols: [{ ratio: r1, children: [] }, { ratio: r2, children: [] }] }]);
  assert.match(cols(0.4375, 0.5625), /grid-template-columns:0\.4375fr 0\.5625fr/);
  assert.match(cols(undefined, undefined), /grid-template-columns:0\.5fr 0\.5fr/);
});

test("tables: header row and shaded row-header column", () => {
  const html = render([{ type: "table", rows: [{ cells: ["H1", "H2"] }, { cells: ["a", "b"] }], header: true, rowHeader: true }]);
  assert.equal(html, '<table class="simple"><tr><th>H1</th><th>H2</th></tr><tr><td class="shade">a</td><td>b</td></tr></table>');
});

test("databases render as mini-cards with properties ordered by type", () => {
  const html = render([{
    type: "database", title: "Contact Info",
    schema: { Org: { type: "select" }, Email: { type: "email" }, Name: { type: "title" } },
    rows: [{ Org: { type: "select", select: { name: "KMVT", color: "purple" } }, Email: { type: "email", email: "a@b.org" },
      Name: { type: "title", title: [{ type: "text", plain_text: "Ann", annotations: {} }] } }],
  }]);
  assert.equal(html, '<div class="gallery"><div class="mini-card"><p class="person-name">Ann</p>' +
    '<p class="prop prop-email"><a href="mailto:a@b.org">a@b.org</a></p><p class="prop prop-tags"><span class="tag tag-purple">KMVT</span></p></div></div>');
});

test("missing photos render a placeholder", () => {
  assert.match(render([{ type: "image", src: "", name: "up_next.png", caption: "" }]), /missing-photo.*Photo not available<br><small>up_next\.png<\/small>/);
});

test("only blocks that links point at get an anchor id", () => {
  const id = "3f57446c-6b1f-80df-bee3-d81e9d43a9f2";
  const model = [{ type: "heading", id, level: 3, html: "Operator PC", plain: "Operator PC", color: "default" },
    { type: "heading", id: "11111111-1111-1111-1111-111111111111", level: 3, html: "Other", plain: "Other", color: "default" }];
  const emitted = new Set();
  const html = render(model, { targets: new Set(["3f57446c6b1f80dfbee3d81e9d43a9f2"]), emitted });
  assert.equal(html, '<h4 class="h3" id="b-3f57446c6b1f80dfbee3d81e9d43a9f2">Operator PC</h4>\n<h4 class="h3">Other</h4>');
  assert.deepEqual([...emitted], ["3f57446c6b1f80dfbee3d81e9d43a9f2"]);
});

test("Notion links are rewritten to in-page anchors, other SOP pages, or notion.so", () => {
  const targets = new Set();
  const here = "0947446c-6b1f-8283-97de-01c9bf2f982a";
  const other = "3127446c-6b1f-8049-a7e1-cb713a6fa2e8";
  const link = createLinker({ pageId: here, slugById: new Map([[here, "sunnyvale"], [other, "mountain-view"]]), targets });
  const block = "3f57446c6b1f80dfbee3d81e9d43a9f2";
  assert.equal(link(`/p/0947446c6b1f828397de01c9bf2f982a?pvs=25#${block}`), `#b-${block}`);
  assert.equal(link(`https://www.notion.so/kmvt/Mountain-View-3127446c6b1f8049a7e1cb713a6fa2e8`), "mountain-view.html");
  assert.equal(link(`https://app.notion.com/p/3127446c6b1f8049a7e1cb713a6fa2e8#${block}`), `mountain-view.html#b-${block}`);
  assert.equal(link("/Wiki-2f97446c6b1f800fa4fcd419e77ebf9c#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    "https://www.notion.so/Wiki-2f97446c6b1f800fa4fcd419e77ebf9c#aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(link("https://playback.sv.kmvt.net"), "https://playback.sv.kmvt.net");
  assert.equal(link("mailto:a@b.org"), "mailto:a@b.org");
  assert.deepEqual([...targets], [block], "links to pages that aren't on the site don't create anchor targets");
});

test("slugs are unique and never collide with index.html or assets/", () => {
  const entries = assignSlugs([{ id: "a", title: "Sunnyvale" }, { id: "b", title: "sunnyvale" }, { id: "c", title: "Index" },
    { id: "d1234567-0000-0000-0000-000000000000", title: "???" }]);
  assert.deepEqual(entries.map((e) => e.slug), ["sunnyvale", "sunnyvale-2", "index-2", "d1234567"]);
});

test("a paragraph that's only a link becomes a button; anything else stays a paragraph", () => {
  assert.deepEqual(linkButton([rt("Open map", { href: "https://m.example" }), rt(" ")]), { href: "https://m.example", label: "Open map" });
  assert.deepEqual(linkButton([rt("Open ", { href: "https://m.example" }), rt("map", { bold: true, href: "https://m.example" })]), { href: "https://m.example", label: "Open map" });
  assert.equal(linkButton([rt("See "), rt("map", { href: "https://m.example" })]), null, "text around the link");
  assert.equal(linkButton([rt("A", { href: "https://a.example" }), rt("B", { href: "https://b.example" })]), null, "two different links");
  assert.equal(linkButton([rt("https://m.example", { href: "https://m.example" })]), null, "bare URL");
  assert.equal(linkButton([rt("psguser", { code: true, href: "https://m.example" })]), null, "inline code");
  assert.equal(linkButton([]), null);

  const p = (r) => ({ id: "00000000-0000-0000-0000-000000000001", type: "paragraph", paragraph: { rich_text: r, color: "default" } });
  const model = convert([p([rt("Open map", { href: "https://m.example" })]), p([rt("Glossary", { href: "/0947446c6b1f828397de01c9bf2f982a#3f57446c6b1f80dfbee3d81e9d43a9f2" })]), p([rt("after")])], {
    link: createLinker({ pageId: "0947446c-6b1f-8283-97de-01c9bf2f982a", slugById: new Map(), targets: new Set() }),
  });
  assert.equal(render(model), '<p class="buttons"><a class="button" href="https://m.example" target="_blank" rel="noopener">Open map</a> ' +
    '<a class="button" href="#b-3f57446c6b1f80dfbee3d81e9d43a9f2">Glossary</a></p>\n<p>after</p>');
});
