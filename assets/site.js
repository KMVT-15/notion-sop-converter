// Behavior for SOP pages. The HTML works without it (it's the printable document);
// this adds the on-screen extras, and fits photos to the printed pages.

// To-do items can be checked off: click the box or the item's text, or Space/Enter on
// the box. Checks aren't saved; reloading the page starts a fresh list.
(() => {
  const items = [...document.querySelectorAll("ul.checklist > li")];
  if (!items.length) return;
  const boxOf = (li) => li.querySelector(":scope > .box");
  const set = (li, on) => {
    li.classList.toggle("done", on);
    boxOf(li).classList.toggle("checked", on);
    boxOf(li).setAttribute("aria-checked", String(on));
  };
  const toggle = (li) => set(li, !li.classList.contains("done"));

  for (const li of items) {
    const box = boxOf(li);
    if (!box) continue;
    box.removeAttribute("aria-hidden");
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-label", li.textContent.trim() || "To-do");
    box.tabIndex = 0;
    li.dataset.checkable = "";
    set(li, box.classList.contains("checked"));
    li.addEventListener("click", (e) => {
      if (e.target.closest("li") !== li) return; // a nested item handles its own clicks
      if (e.target.closest("a, figure, table, button")) return;
      if (String(window.getSelection())) return; // selecting text, not checking
      toggle(li);
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggle(li);
      }
    });
  }
})();

// Photos open full screen when clicked (or focused + Enter). Esc, a click anywhere,
// or the × button closes the view. Print is unaffected.
(() => {
  const photos = document.querySelectorAll("figure.photo img");
  if (!photos.length || typeof HTMLDialogElement !== "function") return;

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Photo, full screen");
  dialog.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">' +
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
    '<path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>';
  document.body.append(dialog);
  const big = dialog.querySelector("img");
  const caption = dialog.querySelector("figcaption");

  const open = (img, fromKeyboard) => {
    // After closing, the browser returns focus to whatever had it before opening. For a
    // mouse click that would leave a focus ring around the photo, so let go of focus first.
    if (!fromKeyboard) img.blur();
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    const cap = img.closest("figure").querySelector("figcaption");
    caption.textContent = cap ? cap.textContent : "";
    caption.hidden = !cap;
    dialog.showModal();
  };

  for (const img of photos) {
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "View photo full screen");
    img.addEventListener("click", () => open(img, false));
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(img, true);
      }
    });
  }
  dialog.addEventListener("click", () => dialog.close());
})();

// Printing: photos print at 3/4 of the text width (full width in columns), at most 5in tall.
// Where something would then be pushed to the next page and leave a big empty gap, the photos
// on that page are shrunk a little more, all by the same amount, so it fits instead. Screen sizes
// never change: the sizes only apply in print (site.css). Page breaks are estimated for US
// Letter at 100% with the @page margins.
(() => {
  const sheet = document.querySelector(".sheet");
  const photos = [...document.querySelectorAll("figure.photo img")];
  if (!sheet || !photos.length) return;

  const PAGE_H = (11 - 0.5 - 0.55) * 96; // printable height in CSS px (sop.css @page)
  const SLACK = 8; // px left free at the foot of a page, for rounding
  const MIN_GAP = 48; // px; a smaller gap isn't worth resizing photos for
  const MIN_SCALE = 0.6; // a fit never shrinks photos below 60% of their size
  const PRINT_WIDTH = 0.75; // default printed width, as a share of the text width (site.css)
  const PRINT_MAX_H = 5 * 96; // and the tallest a photo prints, in CSS px
  // Side-by-side photos: shrinking one may not shorten its row, so they're left alone.
  const shrinkable = (img) => !img.closest(".column");

  // The page's unsplittable pieces: boxes that avoid breaking inside (photos, cards, steps with
  // photos, tables, ...) and lines of text. Each lists the photos in it, and `deco`: the padding
  // and border that cards around it repeat at the top and bottom of a page when they're split.
  function collect(el, out, deco = { top: 0, bottom: 0 }) {
    const cs = getComputedStyle(el);
    const count = out.length;
    collectIn(el, cs, out, deco);
    // headings: the browser keeps them on the same page as what follows
    if (cs.breakAfter.startsWith("avoid")) for (const p of out.slice(count)) p.keep = true;
  }

  function collectIn(el, cs, out, deco) {
    const r = el.getBoundingClientRect();
    if (el.matches("img, svg, video, canvas, iframe, hr") || (cs.breakInside.startsWith("avoid") && r.height <= PAGE_H)) {
      const inside = el.matches("figure.photo img") ? [el] : [...el.querySelectorAll("figure.photo img")];
      if (r.height) out.push({ top: r.top, bottom: r.bottom, photos: inside.filter(shrinkable), deco });
      return;
    }
    if ((cs.boxDecorationBreak || cs.webkitBoxDecorationBreak) === "clone") {
      const px = (v) => parseFloat(v) || 0;
      deco = { top: deco.top + px(cs.paddingTop) + px(cs.borderTopWidth), bottom: deco.bottom + px(cs.paddingBottom) + px(cs.borderBottomWidth) };
    }
    let run = []; // inline content between block children
    const flush = () => {
      if (!run.length) return;
      const range = document.createRange();
      range.setStartBefore(run[0]);
      range.setEndAfter(run.at(-1));
      const rects = [...range.getClientRects()].filter((q) => q.width && q.height).sort((a, b) => a.top - b.top);
      const lines = [];
      for (const q of rects) {
        const line = lines.at(-1);
        if (line && q.top < line.bottom - 2) line.bottom = Math.max(line.bottom, q.bottom);
        else lines.push({ top: q.top, bottom: q.bottom, photos: [], deco, lines });
      }
      out.push(...lines);
      run = [];
    };
    for (const node of el.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const display = getComputedStyle(node).display;
        if (display === "none") continue;
        if (!display.startsWith("inline")) {
          flush();
          collect(node, out, deco);
          continue;
        }
      } else if (node.nodeType !== Node.TEXT_NODE) continue;
      run.push(node);
    }
    flush();
  }

  function fit() {
    const scale = new Map(photos.map((img) => [img, 1]));
    const apply = () => {
      for (const [img, s] of scale) {
        if (s < 0.999) {
          img.dataset.printScale = "";
          img.style.setProperty("--print-scale", s.toFixed(4));
        } else {
          delete img.dataset.printScale;
          img.style.removeProperty("--print-scale");
        }
      }
    };
    apply();
    // At phone widths the screen-only phone layout would skew the measurements.
    if (matchMedia("screen and (max-width: 720px)").matches) return;
    const root = document.documentElement;
    root.classList.add("print-measure");
    try {
      // Default size: the share of the width set in site.css, but no taller than PRINT_MAX_H.
      for (const img of photos) {
        const r = img.getBoundingClientRect();
        if (!r.width) continue;
        const fullHeight = img.closest("figure").clientWidth * (r.height / r.width);
        const width = img.closest(".column") ? 1 : PRINT_WIDTH;
        scale.set(img, Math.min(width, PRINT_MAX_H / fullHeight));
      }
      apply();

      const pieces = [];
      collect(sheet, pieces);
      pieces.sort((a, b) => a.top - b.top);
      const height = new Map(photos.map((img) => [img, img.getBoundingClientRect().height]));
      const origin = sheet.getBoundingClientRect().top;

      // Lay the pieces out on pages. `shift` is how far shrinking has moved later content up.
      let pageTop = 0, shift = 0, onPage = [];
      const at = (p) => p.top - origin - shift;
      pieces.forEach((p, k) => {
        const bottom = p.bottom - origin - shift;
        const end = pageTop + PAGE_H - p.deco.bottom;
        if (bottom <= end) {
          onPage.push(...p.photos);
          return;
        }
        // Doesn't fit, so the page would end here, or earlier: like the browser, keep at least 2
        // lines of a paragraph on each side of a break, and keep headings with what follows.
        let first = p;
        if (p.lines) {
          let i = Math.min(p.lines.indexOf(p), p.lines.length - 2);
          first = p.lines[i < 2 ? 0 : i];
        }
        let j = pieces.indexOf(first);
        while (j > 0 && pieces[j - 1].keep && at(pieces[j - 1]) > pageTop) j--;
        first = pieces[j];

        // Shrink the photos on this page (and in this piece) if that's enough and worth it:
        // the bigger the gap it would leave, the more shrinking is acceptable.
        const gap = end - at(first), need = bottom - end + SLACK;
        const group = [...onPage, ...p.photos];
        const total = group.reduce((sum, img) => sum + height.get(img), 0);
        const s = total ? 1 - need / total : 0;
        if (gap >= MIN_GAP && s >= Math.max(MIN_SCALE, 1 - gap / PAGE_H)) {
          for (const img of group) {
            height.set(img, height.get(img) * s);
            scale.set(img, scale.get(img) * s);
          }
          shift += need;
          onPage = group;
          return;
        }
        const start = at(first) - first.deco.top;
        pageTop = start > pageTop ? start : pageTop + PAGE_H; // a piece taller than a page fills it
        onPage = pieces.slice(j, k + 1).flatMap((q) => q.photos);
      });
      apply();
    } finally {
      root.classList.remove("print-measure");
    }
  }

  addEventListener("beforeprint", fit);
})();
