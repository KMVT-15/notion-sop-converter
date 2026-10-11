// Behavior for SOP pages. The HTML works without it (it's the printable document);
// this adds the on-screen extras.

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
  dialog.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">×</button>' +
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
