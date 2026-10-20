// Owner-approved changes to the print design since the Python tool.
// The parity check applies these, in order, to the Python tool's CSS and requires the
// result to equal assets/css/sop.css exactly. Add an entry for every approved change.
export default [
  {
    date: "2026-10-09",
    why: "Owner: make images wider and remove the border/background around them.",
    from: "figure.photo img{display:block;max-width:min(100%,3.2in);max-height:2.2in;width:auto;height:auto;\n" +
      "  border-radius:4pt;border:.75pt solid var(--card-border);background:#fff}",
    to: "figure.photo img{display:block;max-width:100%;max-height:4.5in;width:auto;height:auto;border-radius:4pt}",
  },
  {
    date: "2026-10-09",
    why: "Owner: plain white background on screen instead of a white page on gray (the 'fake page' look).",
    from: "body{margin:0;background:#e9e6ec;",
    to: "body{margin:0;background:#fff;",
  },
  {
    date: "2026-10-09",
    why: "Owner: no page shadow/frame on screen; content stays centered at the same width.",
    from: ".sheet{background:#fff;max-width:8.5in;margin:28px auto;padding:.55in .6in .65in;\n" +
      "  box-shadow:0 1px 3px rgba(35,31,42,.12),0 8px 28px rgba(35,31,42,.10);border-radius:2px}",
    to: ".sheet{max-width:8.5in;margin:0 auto;padding:.55in .6in .65in}",
  },
  {
    date: "2026-10-09",
    why: "Owner: remove the Print / Save PDF button (its styles go with it; browser printing still works).",
    from: ".toolbar{position:fixed;top:14px;right:16px;z-index:5}\n" +
      ".toolbar button{font:600 13px/1 var(--font-body);color:#fff;background:var(--purple);border:0;border-radius:6px;\n" +
      "  padding:9px 14px;cursor:pointer;box-shadow:0 2px 8px rgba(122,37,122,.3)}\n" +
      ".toolbar button:hover{background:#651e65}\n" +
      "@media screen and (max-width:900px){.toolbar{display:none}}\n",
    to: "",
  },
  {
    date: "2026-10-09",
    why: "Owner: remove the Print / Save PDF button (its print-hiding rule).",
    from: "  .toolbar{display:none}\n",
    to: "",
  },
  {
    date: "2026-10-09",
    why: "Owner: remove the kmvt15.org text from the top-right of the header.",
    from: ".doc-head .site{font-family:var(--font-head);font-weight:700;color:var(--muted);font-size:9pt;white-space:nowrap}\n",
    to: "",
  },
  {
    date: "2026-10-09",
    why: "Owner: remove the kmvt15.org text (its phone-width rule).",
    from: "  .doc-head .site{display:none}\n",
    to: "",
  },
  {
    date: "2026-10-20",
    why: "Owner: photos are full width (no 4.5in height cap, small images scale up).",
    from: "figure.photo img{display:block;max-width:100%;max-height:4.5in;width:auto;height:auto;border-radius:4pt}",
    to: "figure.photo img{display:block;width:100%;height:auto;border-radius:4pt}",
  },
];
