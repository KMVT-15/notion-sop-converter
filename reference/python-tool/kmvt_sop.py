#!/usr/bin/env python3
"""
kmvt_sop.py - turn a Notion SOP page into a clean, printable, KMVT-branded HTML file.

    python3 kmvt_sop.py "https://www.notion.so/Template-3f47446c6b1f80919be4fdd159092a36"
    python3 kmvt_sop.py <page-url> --pdf --open
    python3 kmvt_sop.py --children-of <parent-page-url> -o ~/Desktop/SOPs

Needs a Notion integration token in NOTION_TOKEN (see README.md).
Standard library only. Optional: `pip3 install pillow pillow-heif` for photo
resizing / HEIC conversion (on a Mac the built-in `sips` tool is used otherwise).
"""
import argparse
import base64
import html
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime

__version__ = "1.1"
NOTION_VERSION = "2022-06-28"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SKIP = ["Change Log", "Changelog"]
EYEBROW = "Standard Operating Procedure"
IMAGE_MAX_PX = 1400


# ============================================================ Notion API

def _ssl_context():
    try:
        import certifi  # python.org builds on macOS often lack system certs
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


SSL_CTX = _ssl_context()


class NotionError(Exception):
    pass


class Notion:
    def __init__(self, token):
        self.token = token

    def req(self, method, path, body=None):
        url = "https://api.notion.com/v1/" + path.lstrip("/")
        data = json.dumps(body).encode() if body is not None else None
        for attempt in range(6):
            r = urllib.request.Request(url, data=data, method=method, headers={
                "Authorization": "Bearer " + self.token,
                "Notion-Version": NOTION_VERSION,
                "Content-Type": "application/json",
            })
            try:
                with urllib.request.urlopen(r, context=SSL_CTX, timeout=60) as resp:
                    return json.loads(resp.read().decode())
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    time.sleep(float(e.headers.get("Retry-After", 1 + attempt)))
                    continue
                try:
                    msg = json.loads(e.read().decode()).get("message", "")
                except Exception:
                    msg = ""
                if e.code == 401:
                    raise NotionError("Notion rejected the token (401). Check NOTION_TOKEN.")
                if e.code == 404:
                    raise NotionError(
                        "Notion says it can't find that page/database (404). Make sure the page (or a parent "
                        "page such as 'City SOP Improvements') is shared with your integration: "
                        "open it in Notion > ••• > Connections > add your integration.\n  " + msg)
                raise NotionError(f"Notion API error {e.code}: {msg}")
            except urllib.error.URLError as e:
                if attempt < 2:
                    time.sleep(1)
                    continue
                raise NotionError(f"Couldn't reach Notion: {e.reason}")
        raise NotionError("Notion kept rate-limiting the request; try again in a minute.")

    def page(self, pid):
        return self.req("GET", f"pages/{pid}")

    def children(self, bid):
        out, cursor = [], None
        while True:
            q = f"blocks/{bid}/children?page_size=100" + (f"&start_cursor={cursor}" if cursor else "")
            r = self.req("GET", q)
            out += r.get("results", [])
            if not r.get("has_more"):
                return out
            cursor = r.get("next_cursor")

    def database(self, did):
        return self.req("GET", f"databases/{did}")

    def query(self, did):
        out, body = [], {"page_size": 100}
        while True:
            r = self.req("POST", f"databases/{did}/query", body)
            out += r.get("results", [])
            if not r.get("has_more"):
                return out
            body["start_cursor"] = r.get("next_cursor")


def page_id_from(s):
    s = s.strip()
    m = re.search(r"([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})(?:[?#]|$)", s)
    if not m:
        m = re.search(r"([0-9a-fA-F]{32})", s)
    if not m:
        raise SystemExit(f"Couldn't find a Notion page id in: {s}")
    h = m.group(1).replace("-", "").lower()
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


# ============================================================ rich text

def fmt_date(iso):
    if not iso:
        return ""
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return f"{d.strftime('%B')} {d.day}, {d.year}"
    except Exception:
        return iso


def rich(rt):
    """Notion rich_text array -> inline HTML."""
    out = []
    for t in rt or []:
        typ = t.get("type")
        text = t.get("plain_text", "")
        if typ == "equation":
            text = t.get("equation", {}).get("expression", text)
        a = t.get("annotations", {}) or {}
        if a.get("code"):
            lead, core, trail = "", text, ""
        else:
            m = re.match(r"^(\s*)(.*?)(\s*)$", text, re.S)
            lead, core, trail = m.group(1), m.group(2), m.group(3)
        if not core:
            out.append(html.escape(text).replace("\n", "<br>"))
            continue
        h = html.escape(core).replace("\n", "<br>")
        if a.get("code"):
            h = f"<code>{h}</code>"
        if typ == "mention":
            h = f'<span class="mention">{h}</span>'
        if a.get("bold"):
            h = f"<strong>{h}</strong>"
        if a.get("italic"):
            h = f"<em>{h}</em>"
        if a.get("strikethrough"):
            h = f"<s>{h}</s>"
        if a.get("underline"):
            h = f'<span class="u">{h}</span>'
        color = a.get("color", "default")
        if color and color != "default":
            h = f'<span class="{color_class(color)}">{h}</span>'
        href = t.get("href")
        if href:
            if href.startswith("/"):
                href = "https://www.notion.so" + href
            h = f'<a href="{html.escape(href, quote=True)}">{h}</a>'
        out.append(html.escape(lead) + h + html.escape(trail))
    return "".join(out).replace("\n", "<br>")


def plain(rt):
    return "".join(t.get("plain_text", "") for t in rt or [])


def color_class(color):
    if color.endswith("_background"):
        return "hl-" + color[: -len("_background")]
    return "c-" + color


# ============================================================ images

def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "kmvt-sop/" + __version__})
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=120) as r:
        return r.read()


def image_data_uri(raw, name):
    """Downscale + convert (HEIC too) to a compact JPEG/PNG data URI."""
    ext = os.path.splitext(name)[1].lower()
    # 1) Pillow (+ pillow-heif) if installed
    try:
        import io
        from PIL import Image, ImageOps
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            pass
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        im.thumbnail((IMAGE_MAX_PX, IMAGE_MAX_PX))
        buf = io.BytesIO()
        if ext == ".png" and im.mode in ("RGBA", "LA", "P"):
            im.save(buf, "PNG", optimize=True)
            return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        im.convert("RGB").save(buf, "JPEG", quality=82, optimize=True, progressive=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        pass
    # 2) macOS sips (handles HEIC natively)
    if shutil.which("sips"):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "in" + (ext or ".img"))
            dst = os.path.join(td, "out.jpg")
            open(src, "wb").write(raw)
            r = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82",
                                "-Z", str(IMAGE_MAX_PX), src, "--out", dst],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if r.returncode == 0 and os.path.exists(dst):
                return "data:image/jpeg;base64," + base64.b64encode(open(dst, "rb").read()).decode()
    # 3) embed as-is (browsers can't show HEIC this way)
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
            ".webp": "image/webp", ".svg": "image/svg+xml", ".heic": "image/heic"}.get(ext, "image/jpeg")
    if ext in (".heic", ".heif"):
        warn(f"can't convert {name} (HEIC) - install Pillow + pillow-heif, or run on a Mac")
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def warn(msg):
    print("  ! " + msg, file=sys.stderr)


# ============================================================ blocks -> model

LIST_KINDS = {"bulleted_list_item": "ul", "numbered_list_item": "ol", "to_do": "todo"}


class Converter:
    def __init__(self, api, embed_images=True, verbose=True, skip=()):
        self.skip = [x.strip().lower() for x in skip]
        self.api = api
        self.embed_images = embed_images
        self.verbose = verbose
        self.dbs = {}

    def tree(self, block_id):
        return self.convert(self.api.children(block_id))

    def kids(self, b):
        return self.tree(b["id"]) if b.get("has_children") else []

    def convert(self, blocks):
        out, skipping = [], None
        for b in blocks:
            t = b.get("type")
            d = b.get(t, {}) or {}
            # leave out skipped sections (e.g. "Change Log") without fetching their contents
            hm = re.match(r"heading_(\d)$", t or "")
            if hm:
                if skipping is not None and int(hm.group(1)) <= skipping:
                    skipping = None
                if plain(d.get("rich_text")).strip().lower() in self.skip:
                    skipping = int(hm.group(1))
            if skipping is not None:
                continue
            if t == "child_database" and d.get("title", "").strip().lower() in self.skip:
                continue
            if t in LIST_KINDS:
                item = {"html": rich(d.get("rich_text")), "checked": bool(d.get("checked")),
                        "color": d.get("color", "default"), "children": self.kids(b)}
                kind = LIST_KINDS[t]
                if out and out[-1]["type"] == "list" and out[-1]["kind"] == kind:
                    out[-1]["items"].append(item)
                else:
                    out.append({"type": "list", "kind": kind, "items": [item],
                                "format": d.get("list_format"), "start": d.get("list_start_index", 1) or 1})
                continue
            m = re.match(r"heading_(\d)$", t or "")
            if m:
                out.append({"type": "heading", "level": int(m.group(1)), "html": rich(d.get("rich_text")),
                            "plain": plain(d.get("rich_text")), "color": d.get("color", "default")})
                out += self.kids(b)  # toggleable headings: show contents
                continue
            if t == "paragraph":
                h = rich(d.get("rich_text"))
                if h.strip():
                    out.append({"type": "para", "html": h, "color": d.get("color", "default")})
                out += self.kids(b)
            elif t == "callout":
                children = []
                if plain(d.get("rich_text")).strip():
                    children.append({"type": "para", "html": rich(d.get("rich_text")), "color": "default"})
                children += self.kids(b)
                out.append({"type": "callout", "color": d.get("color", "default"),
                            "icon": d.get("icon"), "children": children})
            elif t == "column_list":
                cols = []
                for c in self.api.children(b["id"]):
                    if c.get("type") == "column":
                        cols.append({"ratio": (c.get("column") or {}).get("width_ratio"),
                                     "children": self.tree(c["id"])})
                out.append({"type": "columns", "cols": cols})
            elif t == "toggle":
                out.append({"type": "toggle", "html": rich(d.get("rich_text")), "children": self.kids(b)})
            elif t == "quote":
                out.append({"type": "quote", "html": rich(d.get("rich_text")), "children": self.kids(b)})
            elif t == "divider":
                out.append({"type": "divider"})
            elif t == "code":
                out.append({"type": "code", "text": plain(d.get("rich_text"))})
            elif t == "image":
                out.append(self.image(b, d))
            elif t == "table":
                rows = [[rich(cell) for cell in (r.get("table_row") or {}).get("cells", [])]
                        for r in self.api.children(b["id"]) if r.get("type") == "table_row"]
                out.append({"type": "table", "rows": rows, "header": d.get("has_column_header", False),
                            "row_header": d.get("has_row_header", False)})
            elif t == "child_database":
                out.append(self.database(b["id"], d.get("title", "")))
            elif t == "synced_block":
                src = (d.get("synced_from") or {}).get("block_id")
                out += self.tree(src) if src else self.kids(b)
            elif t in ("bookmark", "embed", "link_preview", "file", "pdf", "video", "audio"):
                url = d.get("url") or (d.get("external") or {}).get("url") or (d.get("file") or {}).get("url", "")
                label = plain(d.get("caption")) or d.get("name") or url.split("?")[0]
                if url:
                    out.append({"type": "para", "color": "default",
                                "html": f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'})
            elif t == "child_page":
                out.append({"type": "para", "color": "default",
                            "html": f'<span class="mention">{html.escape(d.get("title", ""))}</span>'})
            elif t == "equation":
                out.append({"type": "para", "color": "default", "html": html.escape(d.get("expression", ""))})
            # table_of_contents, breadcrumb, link_to_page, unsupported: skipped
        return out

    def image(self, b, d):
        url = (d.get("file") or {}).get("url") or (d.get("external") or {}).get("url", "")
        name = os.path.basename(url.split("?")[0]) or "image"
        cap = rich(d.get("caption"))
        data = None
        if url and self.embed_images:
            try:
                data = image_data_uri(fetch_bytes(url), name)
            except Exception as e:
                warn(f"couldn't download image {name}: {e}")
        return {"type": "image", "src": data or (url if d.get("type") == "external" else ""),
                "name": name, "caption": cap}

    def database(self, did, title):
        try:
            meta = self.api.database(did)
            rows = self.api.query(did)
        except NotionError as e:
            warn(f"couldn't read database '{title}': {e}")
            return {"type": "database", "title": title, "error": True}
        props = meta.get("properties", {})
        title = title or plain(meta.get("title"))
        return {"type": "database", "title": title, "schema": props,
                "rows": [r.get("properties", {}) for r in rows]}


# ============================================================ rendering

ICONS = {
    "bug": '<path d="M8 4.5a4 4 0 0 1 8 0"/><rect x="6.5" y="6.5" width="11" height="13" rx="5.5"/><path d="M12 10v9.5M6.5 12H3m18 0h-3.5M7 8 4.5 5.5M17 8l2.5-2.5M6.6 16 4 18.5m13.4-2.5L20 18.5"/>',
    "warning": '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
    "lightbulb": '<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-.9.7-1.5 1.6-1.5 2.5h-4c0-.9-.6-1.8-1.5-2.5z"/>',
    "checkmark": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9"/>',
}
ICON_ALIASES = {"bug": "bug", "warning": "warning", "error": "warning", "alert": "warning", "info": "info",
                "information": "info", "lightbulb": "lightbulb", "light-bulb": "lightbulb",
                "checkmark": "checkmark", "check": "checkmark"}
TONE_DEFAULT_ICON = {"red": "warning", "purple": "bug", "yellow": "lightbulb", "green": "checkmark"}


def icon_svg(icon, tone):
    name = None
    if icon:
        if icon.get("type") == "emoji":
            return f'<span class="ico emoji">{html.escape(icon.get("emoji", ""))}</span>'
        url = (icon.get("external") or icon.get("file") or {}).get("url", "")
        if "/icons/" in url:
            base = os.path.basename(url.split("?")[0]).split(".")[0]
            base = re.sub(r"_(gray|lightgray|brown|orange|yellow|green|blue|purple|pink|red)$", "", base)
            name = ICON_ALIASES.get(base)
    if not name:
        if not tone:
            return ""
        name = TONE_DEFAULT_ICON.get(tone, "info")
    return ('<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def cls_attr(color):
    return f' class="{color_class(color)}"' if color and color != "default" else ""


class Renderer:
    def __init__(self, skip):
        self.skip = [s.strip().lower() for s in skip]

    def blocks(self, blocks, depth=0):
        out, skipping = [], None
        for b in blocks:
            if b["type"] == "heading":
                if skipping is not None and b["level"] <= skipping:
                    skipping = None
                if b["plain"].strip().lower() in self.skip:
                    skipping = b["level"]
                    continue
            if skipping is not None:
                continue
            if b["type"] == "database" and b["title"].strip().lower() in self.skip:
                continue
            out.append(getattr(self, "r_" + b["type"])(b, depth))
        return "\n".join(o for o in out if o)

    def r_heading(self, b, depth):
        lvl, h = b["level"], b["html"]
        tag = f"h{min(lvl + 1, 6)}"
        cls = f"h{lvl}" + (f" {color_class(b['color'])}" if b.get("color", "default") != "default" else "")
        m = re.match(r"^Step\s+(\d+)\s*[:.\-–—]\s*(.*)$", b["plain"].strip())
        if m and depth > 0:
            return (f'<{tag} class="{cls} step-title"><span class="step-num">{m.group(1)}</span>'
                    f'<span>{html.escape(m.group(2))}</span></{tag}>')
        if depth == 0 and lvl <= 2:
            cls += " section-head"
        return f'<{tag} class="{cls}">{h}</{tag}>'

    def r_para(self, b, depth):
        return f'<p{cls_attr(b.get("color"))}>{b["html"]}</p>'

    def r_quote(self, b, depth):
        return f'<blockquote>{b["html"]}{self.blocks(b.get("children", []), depth + 1)}</blockquote>'

    def r_divider(self, b, depth):
        return "<hr>"

    def r_code(self, b, depth):
        return f'<pre><code>{html.escape(b["text"])}</code></pre>'

    def r_toggle(self, b, depth):
        return (f'<div class="toggle"><p class="toggle-summary">{b["html"]}</p>'
                f'{self.blocks(b["children"], depth + 1)}</div>')

    def r_image(self, b, depth):
        cap = f'<figcaption>{b["caption"]}</figcaption>' if b.get("caption") else ""
        alt = html.escape(re.sub(r"<[^>]+>", "", b.get("caption") or b["name"]), quote=True)
        if b.get("src"):
            return f'<figure class="photo"><img src="{html.escape(b["src"], quote=True)}" alt="{alt}">{cap}</figure>'
        return (f'<figure class="photo missing-photo"><div class="ph"><span>Photo not available<br>'
                f'<small>{html.escape(b["name"])}</small></span></div>{cap}</figure>')

    def r_list(self, b, depth):
        items = []
        for it in b["items"]:
            kids = self.blocks(it["children"], depth + 1) if it["children"] else ""
            c = cls_attr(it.get("color"))
            if b["kind"] == "todo":
                box = '<span class="box checked" aria-hidden="true"></span>' if it["checked"] else \
                      '<span class="box" aria-hidden="true"></span>'
                items.append(f'<li{c}>{box}<span>{it["html"]}{kids}</span></li>')
            else:
                items.append(f'<li{c}>{it["html"]}{kids}</li>')
        if b["kind"] == "todo":
            return '<ul class="checklist">' + "".join(items) + "</ul>"
        if b["kind"] == "ol":
            fmt = {"letters": " alpha", "roman": " roman"}.get(b.get("format") or "")
            if fmt is None:
                fmt = ("", " alpha", " roman")[depth % 3]  # Notion: 1. / a. / i. by nesting level
            start = int(b.get("start") or 1)
            st = f' start="{start}" style="counter-reset:step {start - 1}"' if start != 1 else ""
            return f'<ol class="steps{fmt}"{st}>' + "".join(items) + "</ol>"
        return "<ul>" + "".join(items) + "</ul>"

    def r_callout(self, b, depth):
        color = b.get("color") or "default"
        tone = color[: -len("_background")] if color.endswith("_background") else ""
        inner = self.blocks(b["children"], depth + 1)
        if not tone or tone == "default" or (tone == "gray" and depth == 0):
            if depth == 0:
                cls = "card has-media" if 'class="photo' in inner else "card"
                return f'<section class="{cls}">{inner}</section>'
            tone = "gray"
        ico = icon_svg(b.get("icon"), tone)
        return f'<div class="callout tone-{tone}">{ico}<div class="callout-body">{inner}</div></div>'

    def r_columns(self, b, depth):
        cols = b["cols"]
        if not cols:
            return ""
        ratios = [c["ratio"] if isinstance(c.get("ratio"), (int, float)) and c["ratio"] > 0 else 1 / len(cols)
                  for c in cols]
        tpl = " ".join(f"{r:g}fr" for r in ratios)
        inner = "".join(f'<div class="column">{self.blocks(c["children"], depth)}</div>' for c in cols)
        return f'<div class="columns" style="grid-template-columns:{tpl}">{inner}</div>'

    def r_table(self, b, depth):
        if not b["rows"]:
            return ""
        out = ['<table class="simple">']
        for n, r in enumerate(b["rows"]):
            tag = "th" if b["header"] and n == 0 else "td"
            shade = ' class="shade"'
            out.append("<tr>" + "".join(
                f'<{tag}{shade if k == 0 and b.get("row_header") and tag == "td" else ""}>{c}</{tag}>'
                for k, c in enumerate(r)) + "</tr>")
        return "".join(out) + "</table>"

    # ---- databases: rendered as small cards (like a Notion gallery view)
    PROP_ORDER = ["title", "rich_text", "phone_number", "email", "url", "number", "date",
                  "people", "checkbox", "status", "select", "multi_select", "formula"]

    def r_database(self, b, depth):
        if b.get("error"):
            return f'<p class="missing">[Couldn’t load database “{html.escape(b["title"])}”]</p>'
        schema = b["schema"]
        names = [n for n, p in schema.items() if p.get("type") in self.PROP_ORDER]
        names.sort(key=lambda n: self.PROP_ORDER.index(schema[n]["type"]))
        if not b["rows"]:
            return '<p class="missing">(no entries)</p>'
        cards = []
        for row in b["rows"]:
            parts = []
            for n in names:
                v = row.get(n)
                if not v:
                    continue
                h = prop_html(v)
                if not h:
                    continue
                typ = v.get("type")
                if typ == "title":
                    parts.append(f'<p class="person-name">{h}</p>')
                elif typ in ("select", "multi_select", "status"):
                    parts.append(f'<p class="prop prop-tags">{h}</p>')
                else:
                    c = {"phone_number": "prop-phone", "email": "prop-email", "rich_text": "prop-text"}.get(typ, "prop-other")
                    parts.append(f'<p class="prop {c}">{h}</p>')
            cards.append('<div class="mini-card">' + "".join(parts) + "</div>")
        return '<div class="gallery">' + "".join(cards) + "</div>"


def tag(name, color):
    return f'<span class="tag tag-{html.escape(color or "default")}">{html.escape(name)}</span>'


def prop_html(v):
    t = v.get("type")
    d = v.get(t)
    if d in (None, "", [], False) and t != "checkbox":
        return ""
    if t in ("title", "rich_text"):
        return rich(d)
    if t == "email":
        e = html.escape(d)
        return f'<a href="mailto:{e}">{e}</a>'
    if t == "phone_number":
        return f'<a href="tel:{re.sub(r"[^0-9+]", "", d)}">{html.escape(d)}</a>'
    if t == "url":
        u = html.escape(d, quote=True)
        return f'<a href="{u}">{html.escape(d)}</a>'
    if t == "number":
        return html.escape(str(d))
    if t == "checkbox":
        return "✓" if d else ""
    if t == "date":
        s = fmt_date(d.get("start"))
        return html.escape(s + (" – " + fmt_date(d["end"]) if d.get("end") else ""))
    if t in ("select", "status"):
        return tag(d.get("name", ""), d.get("color"))
    if t == "multi_select":
        return "".join(tag(o.get("name", ""), o.get("color")) for o in d)
    if t == "people":
        return html.escape(", ".join(p.get("name", "") for p in d if p.get("name")))
    if t == "formula":
        ft = d.get("type")
        val = d.get(ft)
        return html.escape(str(val)) if val not in (None, "") else ""
    return ""


# ============================================================ page assembly

CSS = r"""
/* ==== KMVT SOP print stylesheet ======================================== */
:root{
  --purple:#7a257a; --blue:#5275ba; --green:#009d84;
  --ink:#231f2a; --muted:#6f6a76; --rule:#e2dee7;
  --card-bg:#f5f4f2; --card-border:#e4e1e6;
  --font-head:"Brandon Grotesque","brandon-grotesque","Jost","Futura PT",system-ui,sans-serif;
  --font-body:"Futura PT","futura-pt","Jost","Futura",system-ui,sans-serif;
  --font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  /* callout tones: background / accent */
  --gray-bg:#f1f1ef;   --gray-ac:#787774;
  --purple-bg:#f3eaf3; --purple-ac:#7a257a;
  --red-bg:#fceae9;    --red-ac:#c4332b;
  --blue-bg:#e9f0f8;   --blue-ac:#5275ba;
  --green-bg:#e6f4f1;  --green-ac:#00826d;
  --yellow-bg:#fbf3db; --yellow-ac:#b07d14;
  --orange-bg:#fbecdd; --orange-ac:#c86410;
  --brown-bg:#f4eeee;  --brown-ac:#8f5f49;
  --pink-bg:#faf1f5;   --pink-ac:#b8417f;
}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact;-webkit-text-size-adjust:100%}
body{margin:0;background:#e9e6ec;color:var(--ink);font-family:var(--font-body);
  font-size:10.5pt;line-height:1.45;font-weight:400}
.sheet{background:#fff;max-width:8.5in;margin:28px auto;padding:.55in .6in .65in;
  box-shadow:0 1px 3px rgba(35,31,42,.12),0 8px 28px rgba(35,31,42,.10);border-radius:2px}

/* header */
.doc-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16pt;
  padding-bottom:10pt;border-bottom:2.5pt solid var(--purple);margin-bottom:14pt}
.lockup{height:30pt;width:auto;aspect-ratio:710.2/92.9;flex:none;color:var(--purple);display:block;overflow:visible}
.doc-head .site{font-family:var(--font-head);font-weight:700;color:var(--muted);font-size:9pt;white-space:nowrap}
.title-block{margin:0 0 14pt}
.eyebrow{font-family:var(--font-head);font-weight:700;color:var(--muted);font-size:9.5pt;margin:0 0 1pt;letter-spacing:.01em}
h1.doc-title{font-family:var(--font-head);font-weight:800;color:var(--blue);font-size:26pt;line-height:1.05;margin:0}
.doc-meta{color:var(--muted);font-size:9pt;margin:4pt 0 0}

/* headings */
h2,h3,h4,h5,h6{font-family:var(--font-head);line-height:1.15;margin:0;break-after:avoid;page-break-after:avoid}
h2.h1{font-weight:800;color:var(--ink);font-size:19pt;margin:20pt 0 8pt}
h3.h2{font-weight:800;color:var(--ink);font-size:14pt;margin:14pt 0 7pt}
h4.h3{font-weight:700;color:var(--ink);font-size:12pt;margin:10pt 0 5pt}
h5.h4{font-weight:700;color:var(--ink);font-size:10.5pt;margin:9pt 0 3pt}
h3.h2.section-head{font-size:13pt;margin-top:12pt}
.card > :first-child, .callout-body > :first-child, .column > :first-child, .mini-card > :first-child{margin-top:0}
.card > :last-child, .callout-body > :last-child, .column > :last-child{margin-bottom:0}

/* step title badge */
.step-title{display:flex;align-items:center;gap:7pt;font-weight:800;color:var(--ink);font-size:12.5pt}
.step-num{flex:none;display:inline-grid;place-items:center;width:17pt;height:17pt;border-radius:50%;
  background:var(--blue);color:#fff;font-size:9.5pt;font-weight:800;line-height:1}

/* text */
p{margin:0 0 5pt}
strong{font-weight:600}
a{color:var(--blue);text-decoration:underline;text-decoration-thickness:.5pt;text-underline-offset:1.5pt}
code{font-family:var(--font-mono);font-size:.86em;background:#efedf1;color:var(--ink);
  padding:.08em .38em;border-radius:3px;white-space:nowrap;border:.5pt solid #e1dde5}
.u{text-decoration:underline;text-decoration-color:currentColor;text-decoration-thickness:1pt;text-underline-offset:2pt}
.c-gray,.c-gray strong{color:var(--muted)}
.c-purple{color:var(--purple)} .c-blue{color:var(--blue)} .c-green{color:var(--green-ac)} .c-red{color:var(--red-ac)}
.c-yellow{color:var(--yellow-ac)} .c-orange{color:var(--orange-ac)} .c-brown{color:var(--brown-ac)} .c-pink{color:var(--pink-ac)}
.mention{font-weight:600}
.hl-gray{background:#f1f1ef}.hl-brown{background:#f4eeee}.hl-orange{background:#fbecdd}.hl-yellow{background:#fbf3db}
.hl-green{background:#edf3ec}.hl-blue{background:#e7f3f8}.hl-purple{background:#f6f3f9}.hl-pink{background:#faf1f5}.hl-red{background:#fdebec}
hr{border:0;border-top:1pt solid var(--rule);margin:12pt 0}
blockquote{margin:6pt 0;padding-left:9pt;border-left:2.5pt solid var(--ink)}
pre{font-family:var(--font-mono);font-size:8.8pt;background:#f4f3f5;padding:8pt;border-radius:4px;white-space:pre-wrap}
pre code{background:none;border:0;padding:0;white-space:inherit}
figure{margin:6pt 0}
img{max-width:100%}
figure.photo{margin:5pt 0 7pt;break-inside:avoid;page-break-inside:avoid}
figure.photo img{display:block;max-width:min(100%,3.2in);max-height:2.2in;width:auto;height:auto;
  border-radius:4pt;border:.75pt solid var(--card-border);background:#fff}
figure.photo figcaption{font-size:8.5pt;color:var(--muted);margin-top:2pt}
.missing-photo .ph{display:grid;place-items:center;width:2.2in;height:1.4in;border:1pt dashed #c9c4cf;border-radius:4pt;
  background:repeating-linear-gradient(45deg,#fafafa 0 6pt,#f2f1f3 6pt 12pt);color:var(--muted);font-size:9pt;text-align:center;line-height:1.3}
.missing-photo small{font-size:7.5pt}
.missing{color:var(--muted);font-style:italic}

/* lists */
ul,ol{margin:0 0 6pt;padding-left:16pt}
li{margin:0 0 3pt}
li > ul, li > ol{margin-top:3pt}
ol.steps{list-style:none;padding-left:0;counter-reset:step}
ol.steps > li{counter-increment:step;position:relative;padding-left:17pt}
ol.steps > li::before{content:counter(step) ".";position:absolute;left:0;top:0;width:12pt;text-align:right;
  font-weight:600;color:var(--ink)}
ol.steps.alpha > li::before{content:counter(step, lower-alpha) "."}
ol.steps.roman > li::before{content:counter(step, lower-roman) "."}
ul.checklist{list-style:none;padding-left:0}
ul.checklist > li{display:flex;gap:7pt;align-items:flex-start;margin-bottom:3.5pt}
.box{flex:none;width:10pt;height:10pt;margin-top:2.2pt;border:1.1pt solid var(--purple);border-radius:2pt;background:#fff}
.box.checked{background:var(--purple);box-shadow:inset 0 0 0 1.6pt #fff}

/* cards (default Notion callouts) */
.card{background:var(--card-bg);border:.75pt solid var(--card-border);border-radius:7pt;
  padding:11pt 13pt 10pt;margin:0 0 9pt;break-inside:avoid;page-break-inside:avoid}
.card.has-media{break-inside:auto;page-break-inside:auto;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.card.has-media li{break-inside:avoid;page-break-inside:avoid}

/* coloured callouts */
.callout{display:flex;gap:8pt;align-items:flex-start;border-radius:5pt;padding:8pt 11pt 7pt 9pt;margin:8pt 0 4pt;
  background:var(--tone-bg);border-left:3pt solid var(--tone-ac);break-inside:avoid;page-break-inside:avoid}
.callout .ico{flex:none;width:14pt;height:14pt;color:var(--tone-ac);margin-top:.5pt}
.callout .ico.emoji{font-size:12pt;line-height:1}
.callout-body{flex:1;min-width:0}
.callout-body strong{color:var(--ink)}
.callout-body p{margin-bottom:2pt}
.tone-gray{--tone-bg:var(--gray-bg);--tone-ac:var(--gray-ac)}
.tone-purple{--tone-bg:var(--purple-bg);--tone-ac:var(--purple-ac)}
.tone-red{--tone-bg:var(--red-bg);--tone-ac:var(--red-ac)}
.tone-blue{--tone-bg:var(--blue-bg);--tone-ac:var(--blue-ac)}
.tone-green{--tone-bg:var(--green-bg);--tone-ac:var(--green-ac)}
.tone-yellow{--tone-bg:var(--yellow-bg);--tone-ac:var(--yellow-ac)}
.tone-orange{--tone-bg:var(--orange-bg);--tone-ac:var(--orange-ac)}
.tone-brown{--tone-bg:var(--brown-bg);--tone-ac:var(--brown-ac)}
.tone-pink{--tone-bg:var(--pink-bg);--tone-ac:var(--pink-ac)}

/* columns */
.columns{display:grid;gap:14pt;margin:0 0 4pt}
.column{min-width:0}
.column p:has(> code){line-height:1.9}

/* gallery (database cards) */
.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7pt}
.mini-card{background:#fff;border:.75pt solid var(--card-border);border-radius:5pt;padding:7pt 9pt 6pt;break-inside:avoid}
.person-name{font-family:var(--font-head);font-weight:700;font-size:11pt;margin:0 0 1pt;color:var(--ink)}
.prop{margin:0 0 1.5pt;font-size:9pt;overflow-wrap:anywhere}
.prop-text{color:var(--muted)}
.prop-phone a,.prop-email a{color:var(--ink);text-decoration:none}
.prop-tags{margin-top:4pt}
.tag{display:inline-block;font-size:8pt;font-weight:500;padding:.5pt 5pt;border-radius:3pt;margin-right:3pt;
  background:#e3e2e0;color:#32302c}
.tag-purple{background:#efe2ef;color:var(--purple)} .tag-blue{background:#dfe7f4;color:#34548f}
.tag-green{background:#d9efea;color:#00705e} .tag-yellow{background:#fbecc4;color:#7a5512}
.tag-red{background:#fde0dc;color:#9b2a22} .tag-orange{background:#fadec9;color:#8a4310}
.tag-pink{background:#f5e0e9;color:#8c2e5e} .tag-brown{background:#eee0da;color:#5f3a2a}
table.simple{width:auto;max-width:100%;border-collapse:separate;border-spacing:0;font-size:9.5pt;margin:4pt 0 8pt;
  background:#fff;border:.75pt solid var(--card-border);border-radius:4pt;overflow:hidden;break-inside:avoid;page-break-inside:avoid}
table.simple th,table.simple td{text-align:left;padding:3.5pt 7pt;border-bottom:.75pt solid var(--rule);vertical-align:top}
table.simple tr:last-child > *{border-bottom:0}
table.simple th{font-family:var(--font-head);font-weight:700;color:var(--ink);background:#f6f5f3}
table.simple td.shade{background:#f6f5f3;font-weight:500}
table.simple code{white-space:nowrap}
blockquote{color:var(--ink)}
li > blockquote, li > table.simple, li > figure{margin-top:4pt}
.toggle-summary{font-weight:600}

/* screen-only niceties */
.toolbar{position:fixed;top:14px;right:16px;z-index:5}
.toolbar button{font:600 13px/1 var(--font-body);color:#fff;background:var(--purple);border:0;border-radius:6px;
  padding:9px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(122,37,122,.3)}
.toolbar button:hover{background:#651e65}
@media screen and (max-width:900px){.toolbar{display:none}}
@media screen and (max-width:720px){
  body{background:#fff}
  .sheet{margin:0;padding:20px 16px 32px;box-shadow:none;max-width:none}
  .columns,.gallery{grid-template-columns:1fr !important}
  .doc-head .site{display:none}
}

/* print: no sheet chrome; the @page margin is the only margin */
@page{margin:.5in .5in .55in}
@media print{
  body{background:#fff}
  .sheet{max-width:none;margin:0;padding:0;box-shadow:none;border-radius:0}
  .toolbar{display:none}
  a{color:inherit;text-decoration:none}
  code{white-space:normal}
}
"""

LOGO_SVG = r"""<svg class="lockup" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 710.2 92.9" role="img" aria-label="KMVT 15 Silicon Valley Community Media"><path fill="currentColor" d="M 81.9,29.6 L 81.9,2.6 C 81.9,1.1 80.7,0.0 79.2,0.0 L 51.7,0.0 C 50.7,0.0 49.8,0.6 49.3,1.5 L 33.3,37.5 C 33.0,38.3 31.8,38.1 31.8,37.2 L 31.8,2.6 C 31.8,1.1 30.6,0.0 29.2,0.0 L 2.6,0.0 C 1.1,0.0 -0.0,1.1 -0.0,2.6 L -0.0,33.6 C -0.0,34.9 0.9,36.0 2.2,36.2 L 29.0,40.1 C 29.9,40.3 29.9,41.6 29.0,41.7 L 2.2,45.4 C 0.9,45.6 -0.0,46.7 -0.0,48.0 L -0.0,79.3 C -0.0,80.7 1.1,81.9 2.6,81.9 L 29.2,81.9 C 30.6,81.9 31.8,80.7 31.8,79.3 L 31.8,44.6 C 31.8,43.8 33.0,43.6 33.3,44.3 L 49.3,80.3 C 49.8,81.3 50.7,81.9 51.7,81.9 L 79.2,81.9 C 80.7,81.9 81.9,80.7 81.9,79.3 L 81.9,52.3 C 81.9,51.0 81.0,49.9 79.7,49.6 L 36.1,41.7 C 35.3,41.6 35.3,40.3 36.1,40.1 L 79.7,32.2 C 81.0,32.0 81.9,30.9 81.9,29.6 M 106.0,1.6 C 106.0,1.0 106.5,0.4 107.1,0.4 L 112.8,0.4 C 113.5,0.4 114.0,1.0 114.0,1.6 L 114.0,14.3 L 124.7,0.9 C 124.9,0.7 125.3,0.4 125.6,0.4 L 131.7,0.4 C 132.7,0.4 133.1,1.5 132.6,2.2 L 121.3,16.4 L 133.6,32.5 C 134.2,33.2 133.6,34.3 132.7,34.3 L 126.0,34.3 C 125.7,34.3 125.3,34.0 125.2,33.9 L 114.0,18.7 L 114.0,33.2 C 114.0,33.8 113.5,34.3 112.8,34.3 L 107.1,34.3 C 106.5,34.3 106.0,33.8 106.0,33.2 Z M 106.0,1.6 M 141.9,0.7 C 141.9,0.3 142.4,0.0 142.8,0.0 L 143.5,0.0 C 143.8,0.0 144.2,0.1 144.3,0.4 L 155.6,21.4 L 155.6,21.4 L 166.9,0.4 C 167.1,0.1 167.4,0.0 167.7,0.0 L 168.5,0.0 C 168.8,0.0 169.3,0.3 169.3,0.7 L 174.8,33.2 C 174.9,33.9 174.5,34.3 173.9,34.3 L 168.1,34.3 C 167.8,34.3 167.3,33.9 167.3,33.6 L 165.1,18.6 L 165.0,18.6 L 156.9,34.3 C 156.7,34.6 156.3,34.8 156.0,34.8 L 155.2,34.8 C 154.9,34.8 154.5,34.6 154.3,34.3 L 146.2,18.6 L 146.1,18.6 L 143.9,33.6 C 143.9,33.9 143.5,34.3 143.1,34.3 L 137.4,34.3 C 136.7,34.3 136.3,33.9 136.4,33.2 Z M 141.9,0.7 M 176.0,1.7 C 175.7,1.1 176.1,0.4 176.8,0.4 L 183.3,0.4 C 183.6,0.4 184.0,0.7 184.1,1.0 L 192.1,18.6 L 192.4,18.6 L 200.3,1.0 C 200.4,0.7 200.8,0.4 201.1,0.4 L 207.6,0.4 C 208.3,0.4 208.7,1.1 208.4,1.7 L 193.2,34.3 C 193.1,34.6 192.8,34.8 192.4,34.8 L 191.9,34.8 C 191.5,34.8 191.3,34.6 191.1,34.3 Z M 176.0,1.7 M 218.2,7.5 L 211.3,7.5 C 210.7,7.5 210.3,7.1 210.3,6.6 L 210.3,1.4 C 210.3,0.9 210.7,0.4 211.3,0.4 L 232.8,0.4 C 233.3,0.4 233.7,0.9 233.7,1.4 L 233.7,6.6 C 233.7,7.1 233.3,7.5 232.8,7.5 L 225.9,7.5 L 225.9,33.4 C 225.9,33.9 225.4,34.3 224.9,34.3 L 219.2,34.3 C 218.6,34.3 218.2,33.9 218.2,33.4 Z M 218.2,7.5 M 251.7,11.6 L 247.1,11.6 C 246.7,11.6 246.3,11.2 246.3,10.7 L 246.3,7.7 C 246.3,7.5 246.4,7.1 246.5,6.9 L 253.6,1.4 L 258.1,1.4 C 258.5,1.4 258.9,1.8 258.9,2.3 L 258.9,33.4 C 258.9,33.9 258.5,34.3 258.1,34.3 L 252.7,34.3 C 252.1,34.3 251.7,33.9 251.7,33.4 Z M 251.7,11.6 M 265.6,29.1 L 268.5,26.1 C 268.8,25.8 269.3,25.7 269.7,26.0 C 269.7,26.0 273.1,28.3 275.5,28.3 C 278.1,28.3 280.1,26.4 280.1,23.7 C 280.1,21.1 278.2,19.0 275.1,19.0 L 267.7,19.0 C 266.7,19.0 266.1,18.1 266.1,17.3 L 266.1,2.3 C 266.1,1.8 266.6,1.4 267.1,1.4 L 282.7,1.4 C 283.1,1.4 283.5,1.8 283.5,2.3 L 283.5,6.6 C 283.5,7.1 283.1,7.5 282.7,7.5 L 272.7,7.5 L 272.7,12.7 L 276.1,12.7 C 282.8,12.7 287.1,17.4 287.1,23.7 C 287.1,29.7 282.0,34.8 275.2,34.8 C 270.2,34.8 266.8,32.2 265.6,30.7 C 265.0,30.0 264.9,29.7 265.6,29.1 M 120.4,55.8 C 119.9,55.0 119.2,54.0 118.5,53.4 C 117.9,52.9 116.7,52.3 114.9,52.3 C 111.7,52.3 109.5,54.3 109.5,57.3 C 109.5,58.6 109.8,59.3 110.7,60.1 C 111.7,61.1 112.9,61.6 114.1,62.1 L 117.2,63.5 C 119.1,64.3 120.8,65.2 122.1,66.5 C 123.8,68.2 124.5,70.0 124.5,72.4 C 124.5,78.3 120.1,82.3 114.2,82.3 C 112.1,82.3 109.5,81.8 107.3,79.7 C 105.6,78.2 104.7,75.9 104.2,74.0 L 107.8,73.0 C 108.0,74.7 108.8,76.2 109.7,77.1 C 111.1,78.6 112.7,78.9 114.3,78.9 C 118.7,78.9 120.8,75.7 120.8,72.5 C 120.8,71.1 120.3,69.8 119.2,68.8 C 118.3,67.9 117.1,67.3 115.3,66.5 L 112.4,65.2 C 111.2,64.6 109.6,63.9 108.1,62.5 C 106.7,61.2 105.9,59.6 105.9,57.3 C 105.9,52.3 109.7,48.9 114.9,48.9 C 117.0,48.9 118.5,49.3 120.1,50.4 C 121.4,51.3 122.5,52.5 123.3,53.9 Z M 120.4,55.8 M 133.6,81.8 L 130.2,81.8 L 130.2,61.7 L 133.6,61.7 Z M 131.9,51.6 C 133.3,51.6 134.4,52.7 134.4,54.1 C 134.4,55.4 133.3,56.5 131.9,56.5 C 130.6,56.5 129.4,55.4 129.4,54.1 C 129.4,52.7 130.6,51.6 131.9,51.6 M 143.7,81.8 L 140.3,81.8 L 140.3,46.4 L 143.7,46.4 Z M 143.7,81.8 M 153.8,81.8 L 150.3,81.8 L 150.3,61.7 L 153.8,61.7 Z M 152.1,51.6 C 153.4,51.6 154.5,52.7 154.5,54.1 C 154.5,55.4 153.4,56.5 152.1,56.5 C 150.6,56.5 149.6,55.4 149.6,54.1 C 149.6,52.7 150.6,51.6 152.1,51.6 M 176.0,67.3 C 174.2,65.0 171.6,64.3 169.8,64.3 C 166.0,64.3 162.7,66.9 162.7,71.8 C 162.7,76.7 166.2,79.2 169.7,79.2 C 171.8,79.2 174.4,78.3 176.2,76.1 L 176.2,80.2 C 174.0,81.8 171.7,82.3 169.8,82.3 C 163.5,82.3 159.1,77.8 159.1,71.8 C 159.1,65.7 163.6,61.2 169.8,61.2 C 173.0,61.2 175.1,62.5 176.0,63.1 Z M 176.0,67.3 M 183.8,71.8 C 183.8,76.7 187.3,79.2 190.9,79.2 C 194.6,79.2 198.0,76.7 198.0,71.8 C 198.0,66.8 194.6,64.3 190.9,64.3 C 187.2,64.3 183.8,66.9 183.8,71.8 M 180.3,71.8 C 180.3,65.7 184.8,61.2 190.9,61.2 C 197.1,61.2 201.5,65.7 201.5,71.8 C 201.5,77.8 197.0,82.3 190.9,82.3 C 184.8,82.3 180.3,77.8 180.3,71.8 M 206.8,61.7 L 210.3,61.7 L 210.3,64.0 C 211.0,63.2 212.8,61.2 216.1,61.2 C 218.5,61.2 220.6,62.1 221.8,63.9 C 222.8,65.4 223.0,67.1 223.0,69.3 L 223.0,81.8 L 219.6,81.8 L 219.6,69.4 C 219.6,68.2 219.4,66.8 218.6,65.7 C 217.9,64.9 216.9,64.3 215.3,64.3 C 214.1,64.3 212.8,64.6 211.8,65.8 C 210.4,67.4 210.3,69.8 210.3,71.2 L 210.3,81.8 L 206.8,81.8 Z M 206.8,61.7 M 241.9,49.5 L 251.0,74.1 L 260.1,49.5 L 264.0,49.5 L 251.0,83.7 L 237.9,49.5 Z M 241.9,49.5 M 268.1,71.7 C 268.1,76.0 270.5,79.2 274.6,79.2 C 278.8,79.2 281.3,75.7 281.3,71.7 C 281.3,66.5 277.7,64.3 274.6,64.3 C 271.2,64.3 268.1,66.8 268.1,71.7 M 281.1,61.7 L 284.6,61.7 L 284.6,81.8 L 281.1,81.8 L 281.1,78.9 C 279.9,80.4 277.8,82.3 274.2,82.3 C 269.2,82.3 264.5,78.7 264.5,71.7 C 264.5,64.7 269.1,61.2 274.2,61.2 C 278.1,61.2 280.2,63.3 281.1,64.5 Z M 281.1,61.7 M 294.6,81.8 L 291.1,81.8 L 291.1,46.4 L 294.6,46.4 Z M 294.6,81.8 M 304.7,81.8 L 301.2,81.8 L 301.2,46.4 L 304.7,46.4 Z M 304.7,81.8 M 325.6,69.5 C 325.0,66.4 322.7,64.3 319.7,64.3 C 316.7,64.3 314.3,66.5 313.8,69.5 Z M 329.1,76.6 C 328.5,77.7 327.6,78.9 326.6,79.8 C 324.7,81.5 322.4,82.3 319.9,82.3 C 315.1,82.3 310.0,79.3 310.0,71.8 C 310.0,65.8 313.7,61.2 319.7,61.2 C 323.6,61.2 326.1,63.1 327.3,64.9 C 328.5,66.6 329.3,69.7 329.2,72.4 L 313.6,72.4 C 313.6,76.5 316.5,79.3 319.9,79.3 C 321.6,79.3 322.9,78.7 324.1,77.8 C 324.9,77.0 325.7,76.0 326.1,75.0 Z M 329.1,76.6 M 340.8,79.9 L 331.6,61.7 L 335.6,61.7 L 342.7,76.1 L 349.2,61.7 L 353.1,61.7 L 338.3,92.8 L 334.5,92.8 Z M 340.8,79.9 M 393.5,56.6 C 392.5,55.6 391.0,54.3 389.3,53.6 C 387.6,52.8 385.6,52.3 383.8,52.3 C 376.3,52.3 370.8,58.3 370.8,65.7 C 370.8,74.5 377.9,78.9 383.8,78.9 C 386.0,78.9 388.1,78.3 389.8,77.4 C 391.7,76.5 393.0,75.3 393.5,74.7 L 393.5,79.2 C 389.9,81.8 386.3,82.3 383.8,82.3 C 374.2,82.3 367.1,75.0 367.1,65.7 C 367.1,56.1 374.3,48.9 384.0,48.9 C 386.0,48.9 389.6,49.2 393.5,52.1 Z M 393.5,56.6 M 401.6,71.8 C 401.6,76.7 405.0,79.2 408.6,79.2 C 412.2,79.2 415.6,76.7 415.6,71.8 C 415.6,66.8 412.3,64.3 408.6,64.3 C 404.9,64.3 401.6,66.9 401.6,71.8 M 398.0,71.8 C 398.0,65.7 402.4,61.2 408.6,61.2 C 414.7,61.2 419.2,65.7 419.2,71.8 C 419.2,77.8 414.7,82.3 408.6,82.3 C 402.5,82.3 398.0,77.8 398.0,71.8 M 424.6,61.7 L 428.0,61.7 L 428.0,63.8 C 429.2,62.1 430.9,61.2 433.0,61.2 C 436.7,61.2 438.1,63.7 438.5,64.4 C 440.4,61.4 443.1,61.2 444.6,61.2 C 450.5,61.2 451.0,66.1 451.0,69.0 L 451.0,81.8 L 447.6,81.8 L 447.6,69.6 C 447.6,67.3 447.3,64.3 444.0,64.3 C 440.0,64.3 439.6,68.2 439.6,70.6 L 439.6,81.8 L 436.0,81.8 L 436.0,69.8 C 436.0,68.4 436.1,64.3 432.4,64.3 C 428.5,64.3 428.0,68.4 428.0,70.8 L 428.0,81.8 L 424.6,81.8 Z M 424.6,61.7 M 457.7,61.7 L 461.1,61.7 L 461.1,63.8 C 462.3,62.1 464.0,61.2 466.1,61.2 C 469.8,61.2 471.2,63.7 471.6,64.4 C 473.5,61.4 476.3,61.2 477.7,61.2 C 483.6,61.2 484.2,66.1 484.2,69.0 L 484.2,81.8 L 480.7,81.8 L 480.7,69.6 C 480.7,67.3 480.4,64.3 477.1,64.3 C 473.1,64.3 472.7,68.2 472.7,70.6 L 472.7,81.8 L 469.2,81.8 L 469.2,69.8 C 469.2,68.4 469.2,64.3 465.6,64.3 C 461.6,64.3 461.1,68.4 461.1,70.8 L 461.1,81.8 L 457.7,81.8 Z M 457.7,61.7 M 494.2,73.4 C 494.2,74.8 494.2,76.4 495.3,77.7 C 495.7,78.3 496.8,79.3 498.8,79.3 C 500.7,79.3 501.7,78.3 502.3,77.7 C 503.2,76.4 503.2,74.8 503.2,73.4 L 503.2,61.7 L 506.7,61.7 L 506.7,73.7 C 506.7,76.2 506.5,78.1 504.9,79.8 C 503.1,81.7 500.7,82.3 498.8,82.3 C 496.8,82.3 494.4,81.7 492.6,79.8 C 491.0,78.1 490.8,76.2 490.8,73.7 L 490.8,61.7 L 494.2,61.7 Z M 494.2,73.4 M 513.3,61.7 L 516.8,61.7 L 516.8,64.0 C 517.4,63.2 519.2,61.2 522.5,61.2 C 524.9,61.2 527.1,62.1 528.3,63.9 C 529.3,65.4 529.5,67.1 529.5,69.3 L 529.5,81.8 L 526.0,81.8 L 526.0,69.4 C 526.0,68.2 525.9,66.8 525.1,65.7 C 524.4,64.9 523.3,64.3 521.7,64.3 C 520.6,64.3 519.2,64.6 518.2,65.8 C 516.9,67.4 516.8,69.8 516.8,71.2 L 516.8,81.8 L 513.3,81.8 Z M 513.3,61.7 M 539.5,81.8 L 536.0,81.8 L 536.0,61.7 L 539.5,61.7 Z M 537.8,51.6 C 539.1,51.6 540.3,52.7 540.3,54.1 C 540.3,55.4 539.1,56.5 537.8,56.5 C 536.4,56.5 535.3,55.4 535.3,54.1 C 535.3,52.7 536.4,51.6 537.8,51.6 M 549.6,64.9 L 549.6,81.8 L 546.2,81.8 L 546.2,64.9 L 544.0,64.9 L 544.0,61.7 L 546.2,61.7 L 546.2,54.4 L 549.6,54.4 L 549.6,61.7 L 553.1,61.7 L 553.1,64.9 Z M 549.6,64.9 M 564.2,79.9 L 554.9,61.7 L 558.9,61.7 L 566.0,76.1 L 572.6,61.7 L 576.4,61.7 L 561.7,92.8 L 557.8,92.8 Z M 564.2,79.9 M 591.1,81.8 L 596.5,47.7 L 608.8,74.9 L 621.5,47.6 L 626.5,81.8 L 622.8,81.8 L 619.8,59.3 L 608.8,83.1 L 598.0,59.3 L 594.8,81.8 Z M 591.1,81.8 M 647.4,69.5 C 646.9,66.4 644.6,64.3 641.6,64.3 C 638.6,64.3 636.2,66.5 635.6,69.5 Z M 650.9,76.6 C 650.3,77.7 649.5,78.9 648.4,79.8 C 646.6,81.5 644.3,82.3 641.7,82.3 C 636.9,82.3 631.8,79.3 631.8,71.8 C 631.8,65.8 635.5,61.2 641.6,61.2 C 645.5,61.2 647.9,63.1 649.2,64.9 C 650.4,66.6 651.1,69.7 651.0,72.4 L 635.4,72.4 C 635.5,76.5 638.3,79.3 641.8,79.3 C 643.5,79.3 644.7,78.7 645.9,77.8 C 646.8,77.0 647.5,76.0 648.0,75.0 Z M 650.9,76.6 M 658.7,71.7 C 658.7,76.0 661.1,79.2 665.3,79.2 C 669.5,79.2 671.9,75.7 671.9,71.7 C 671.9,66.5 668.3,64.3 665.3,64.3 C 661.8,64.3 658.7,66.8 658.7,71.7 M 671.7,46.4 L 675.2,46.4 L 675.2,81.8 L 671.7,81.8 L 671.7,78.9 C 670.6,80.4 668.4,82.3 664.9,82.3 C 659.8,82.3 655.1,78.7 655.1,71.7 C 655.1,64.7 659.7,61.2 664.9,61.2 C 668.7,61.2 670.8,63.3 671.7,64.5 Z M 671.7,46.4 M 684.8,81.8 L 681.3,81.8 L 681.3,61.7 L 684.8,61.7 Z M 683.1,51.6 C 684.4,51.6 685.5,52.7 685.5,54.1 C 685.5,55.4 684.4,56.5 683.1,56.5 C 681.7,56.5 680.6,55.4 680.6,54.1 C 680.6,52.7 681.7,51.6 683.1,51.6 M 693.7,71.7 C 693.7,76.0 696.1,79.2 700.3,79.2 C 704.5,79.2 706.9,75.7 706.9,71.7 C 706.9,66.5 703.4,64.3 700.3,64.3 C 696.8,64.3 693.7,66.8 693.7,71.7 M 706.7,61.7 L 710.2,61.7 L 710.2,81.8 L 706.7,81.8 L 706.7,78.9 C 705.6,80.4 703.4,82.3 699.9,82.3 C 694.8,82.3 690.1,78.7 690.1,71.7 C 690.1,64.7 694.7,61.2 699.9,61.2 C 703.7,61.2 705.8,63.3 706.7,64.5 Z M 706.7,61.7"/></svg>"""

GOOGLE_FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
                '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
                '<link href="https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">')


def fonts_block(font_dir):
    """Embed Jost (SIL OFL) from ./fonts so the file prints the same offline; else link Google Fonts."""
    faces = []
    for w, st, fn in [(400, "normal", "jost-latin-400-normal.woff2"), (500, "normal", "jost-latin-500-normal.woff2"),
                      (600, "normal", "jost-latin-600-normal.woff2"), (700, "normal", "jost-latin-700-normal.woff2"),
                      (800, "normal", "jost-latin-800-normal.woff2"), (400, "italic", "jost-latin-400-italic.woff2")]:
        p = os.path.join(font_dir, fn)
        if os.path.exists(p):
            b64 = base64.b64encode(open(p, "rb").read()).decode()
            faces.append(f"@font-face{{font-family:'Jost';font-style:{st};font-weight:{w};font-display:swap;"
                         f"src:url(data:font/woff2;base64,{b64}) format('woff2')}}")
    if not faces:
        return "", GOOGLE_FONTS
    return "\n".join(faces) + "\n", ""


def build_html(title, updated_iso, content):
    font_css, font_tags = fonts_block(os.path.join(HERE, "fonts"))
    safe = title.replace('"', "").replace("\\", "")
    page_css = (f'@page{{@bottom-left{{content:"KMVT 15 · {safe} SOP";font:8pt/1 "Futura PT","Jost",sans-serif;color:#6f6a76}}'
                f'@bottom-right{{content:"Page " counter(page) " of " counter(pages);font:8pt/1 "Futura PT","Jost",sans-serif;color:#6f6a76}}}}')
    updated = fmt_date(updated_iso)
    meta = f'<p class="doc-meta">Updated {html.escape(updated)}</p>' if updated else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="kmvt_sop.py {__version__}">
<title>{html.escape(title)} · KMVT SOP</title>
{font_tags}
<style>{font_css}{CSS}
{page_css}
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">Print / Save PDF</button></div>
<main class="sheet">
<header class="doc-head">{LOGO_SVG}<span class="site">kmvt15.org</span></header>
<div class="title-block">
<p class="eyebrow">{html.escape(EYEBROW)}</p>
<h1 class="doc-title">{html.escape(title)}</h1>
{meta}
</div>
{content}
</main>
</body>
</html>
"""


def page_title(page):
    for p in (page.get("properties") or {}).values():
        if p.get("type") == "title":
            return plain(p.get("title")) or "Untitled"
    return "Untitled"


def safe_filename(title):
    s = re.sub(r'[\\/:*?"<>|]+', "-", title).strip().strip(".")
    return (s or "SOP") + ".html"


# ============================================================ PDF (optional)

CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]


def find_chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "chrome"):
        if shutil.which(n):
            return shutil.which(n)
    return None


def make_pdf(html_path):
    chrome = find_chrome()
    if not chrome:
        warn("--pdf: couldn't find Chrome/Edge; open the HTML and use Print > Save as PDF instead")
        return None
    pdf = os.path.splitext(html_path)[0] + ".pdf"
    with tempfile.TemporaryDirectory() as prof:
        r = subprocess.run([chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                            f"--user-data-dir={prof}", f"--print-to-pdf={pdf}",
                            "file://" + os.path.abspath(html_path)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    if r.returncode != 0 or not os.path.exists(pdf):
        warn("--pdf: Chrome couldn't make the PDF; use Print > Save as PDF from the browser instead")
        return None
    return pdf


# ============================================================ main

def render_page(api, page_ref, out, skip, embed_images=True):
    pid = page_id_from(page_ref)
    page = api.page(pid)
    title = page_title(page)
    print(f"• {title}")
    conv = Converter(api, embed_images=embed_images, skip=skip)
    model = conv.tree(pid)
    content = Renderer(skip).blocks(model)
    doc = build_html(title, page.get("last_edited_time"), content)
    if os.path.isdir(out):
        out = os.path.join(out, safe_filename(title))
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    print(f"  → {out}")
    return out


def main():
    ap = argparse.ArgumentParser(description="Turn Notion SOP pages into printable KMVT-branded HTML.")
    ap.add_argument("pages", nargs="*", help="Notion page URL(s) or id(s)")
    ap.add_argument("--children-of", metavar="URL", help="render every sub-page of this Notion page")
    ap.add_argument("-o", "--out", default=".", help="output file (one page) or folder (default: current folder)")
    ap.add_argument("--skip", action="append", metavar="TITLE",
                    help='section/database title to leave out (default: "Change Log"); repeatable')
    ap.add_argument("--no-images", action="store_true", help="don't download/embed photos")
    ap.add_argument("--pdf", action="store_true", help="also save a PDF next to each HTML (needs Chrome or Edge)")
    ap.add_argument("--open", action="store_true", help="open the result when done")
    ap.add_argument("--token", help="Notion integration token (default: $NOTION_TOKEN)")
    a = ap.parse_args()

    token = a.token or os.environ.get("NOTION_TOKEN") or os.environ.get("NOTION_API_KEY")
    if not token:
        tf = os.path.expanduser("~/.config/kmvt-sop/token")
        if os.path.exists(tf):
            token = open(tf).read().strip()
    if not token:
        raise SystemExit("No Notion token. Set NOTION_TOKEN (see README.md).")
    api = Notion(token)

    pages = list(a.pages)
    try:
        if a.children_of:
            for b in api.children(page_id_from(a.children_of)):
                if b.get("type") == "child_page":
                    pages.append(b["id"])
        if not pages:
            ap.error("give a Notion page URL (or --children-of PARENT_URL)")
        out = os.path.expanduser(a.out)
        if len(pages) > 1 and not os.path.isdir(out):
            os.makedirs(out, exist_ok=True)
        skip = a.skip or DEFAULT_SKIP
        written = []
        for p in pages:
            path = render_page(api, p, out, skip, embed_images=not a.no_images)
            written.append(path)
            if a.pdf:
                pdf = make_pdf(path)
                if pdf:
                    print(f"  → {pdf}")
                    written.append(pdf)
    except NotionError as e:
        raise SystemExit(f"Error: {e}")
    if a.open and written and sys.platform == "darwin":
        subprocess.run(["open", written[-1] if a.pdf else written[0]])


if __name__ == "__main__":
    main()
