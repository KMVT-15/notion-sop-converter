# kmvt-sop

Turns a Notion SOP page into a clean, printable, KMVT-branded HTML file (and optionally a PDF).

```bash
python3 kmvt_sop.py "https://www.notion.so/…/Template-3f47446c6b1f80919be4fdd159092a36"
```

The output is a single self-contained `.html` file. The logo, fonts and photos are built in, so you can email it, put it on a shared drive, or open it offline. On screen it shows as a centered page with a **Print / Save PDF** button. When printed, it fills the page with 0.5" margins and adds page numbers.

---

## One-time setup (about 5 minutes)

**1. Python.** Open Terminal and run `python3 --version`. If macOS offers to install the Command Line Tools, say yes. Any Python 3.8+ works.

Optional, but recommended for smaller files and HEIC photo support on non-Macs:
```bash
pip3 install pillow pillow-heif certifi
```

**2. Create a Notion integration.**
1. Go to <https://www.notion.so/profile/integrations> → **New integration**.
2. Name it `KMVT SOP Export`, pick the KMVT workspace, and set the type to **Internal**.
3. Under **Capabilities**, *Read content* is all it needs (uncheck the rest).
4. Copy the **Internal Integration Secret**.

**3. Give it access to your SOPs.** In Notion, open **Endeavors › City SOP Improvements** → `•••` (top right) → **Connections** → add **KMVT SOP Export**. Every page under it, including the inline Contact Info databases, is now readable by the script.

**4. Save the token** (with the secret still on your clipboard):
```bash
mkdir -p ~/.config/kmvt-sop && pbpaste > ~/.config/kmvt-sop/token && chmod 600 ~/.config/kmvt-sop/token
```
(Alternatively `export NOTION_TOKEN=…` in `~/.zshrc`, or pass `--token`.)

---

## Usage

```bash
# one SOP → ./Template.html
python3 kmvt_sop.py "<notion page link>"

# also make a PDF (uses Chrome or Edge) and open it
python3 kmvt_sop.py "<notion page link>" --pdf --open

# every SOP under a parent page, into a folder
python3 kmvt_sop.py --children-of "<City SOP Improvements link>" -o ~/Desktop/SOPs --pdf

# options
  -o PATH          output file, or folder (default: current folder; file is named after the page)
  --skip TITLE     leave out a section or database by title (default: "Change Log"); repeatable
  --no-images      don't download/embed photos
```

Get a page link in Notion with `•••` → **Copy link** (or ⌘L).

---

## How Notion content is styled

| In Notion | In the printout |
|---|---|
| Callout (default/gray color) at the top level | Card |
| Purple-background callout | Troubleshooting box (purple, bug icon) |
| Red-background callout | Warning box (red, warning icon) |
| Other colored callouts | Matching tinted box |
| Heading inside a card starting `Step 3: …` | Blue numbered badge + title |
| Numbered list inside a card | a. b. c. (top level 1. 2. 3., deeper i. ii.), like Notion |
| To-do list | Empty printable checkboxes |
| Columns | Columns (stack on phone screens only) |
| Inline database (e.g. Contact Info) | Small contact-style cards; select tags keep their Notion color |
| Images (incl. iPhone HEIC) | Embedded, resized, capped at about 3.2" × 2.2" |
| `Change Log` heading/database | Left out |
| Inline code, underline, bold/italic, gray text, links | Kept |

Cards stay whole across page breaks. Cards with photos can split *between* steps.

---

## Notes

- **Fonts.** If Brandon Grotesque and Futura PT are installed (e.g. via Adobe Fonts), the browser uses them. Otherwise it uses Jost, a free Futura-style font that's embedded from `fonts/`. Keep the `fonts/` folder next to the script. If it's missing, the file links Google Fonts instead.
- **Column widths.** Notion's API doesn't always report custom column widths, so columns may come out equal (e.g. 50/50 instead of 25/75).
- **Page numbers/footers** print from Chrome and Edge. Safari prints the document fine but without the footer line.
- **Print margins** are set in the script's CSS (`@page{margin:.5in .5in .55in}`). The brand colors and type sizes are the `:root` variables at the top of the `CSS` block.
- Linked databases (views of a database that lives elsewhere) can't be read through the API. Use an inline database, or share the source database with the integration.

## Troubleshooting

- **`404 … can't find that page`**: the page isn't shared with the integration (step 3).
- **`401`**: the token is wrong or was regenerated (step 4).
- **`CERTIFICATE_VERIFY_FAILED`**: run `pip3 install certifi`, or run *Install Certificates.command* in your Python folder in Applications.
- **A photo shows "Photo not available"**: the download failed. The script prints the reason. Run it again, because Notion's photo links expire after an hour.

---
Jost font: © The Jost Project Authors, SIL Open Font License 1.1 (`fonts/OFL-Jost.txt`).
