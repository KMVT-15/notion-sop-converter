// Small HTML / text helpers shared by the converter, renderer and page templates.

/** Escape text for HTML content and attribute values (same set as Python's html.escape). */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Extra attributes for a link: external (absolute http/https) links open in a new tab.
 * Links within the site are always relative (page.html, #anchor, assets/…), so they stay put.
 */
export const linkTarget = (href) => (/^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener"' : "");

/** Plain text from an HTML fragment (for alt text). */
export function textOf(fragment) {
  return String(fragment ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

/**
 * ISO date or datetime -> "October 9, 2026".
 * Date-only values are shown as written; datetimes are shown in `timeZone`.
 */
export function fmtDate(iso, timeZone) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "long", day: "numeric" }).format(d);
}

/** Date + time, e.g. "October 9, 2026 at 6:42 PM". */
export function fmtDateTime(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long", timeStyle: "short" }).format(date);
}

/** Page title -> URL-safe file name stem: "Los Altos Hills" -> "los-altos-hills". */
export function slugify(title) {
  return String(title)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
