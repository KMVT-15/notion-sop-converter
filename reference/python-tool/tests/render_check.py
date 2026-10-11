"""Render an SOP HTML for QA: screen screenshots (1200px + 390px) and Letter/A4 print PDFs.
Usage: python3 tests/render_check.py path/to/SOP.html outdir      (needs: pip install playwright && playwright install chromium)
Then inspect pages, e.g. `pdftoppm -r 80 -png outdir/print_letter.pdf outdir/page`."""
import sys, os, asyncio
from playwright.async_api import async_playwright

async def main(html, outdir):
    os.makedirs(outdir, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=1.5)
        await pg.goto("file://" + os.path.abspath(html)); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=os.path.join(outdir, "screen.png"), full_page=True)
        await pg.set_viewport_size({"width": 390, "height": 800})
        await pg.screenshot(path=os.path.join(outdir, "mobile.png"), full_page=True)
        await pg.emulate_media(media="print")
        for fmt in ("Letter", "A4"):
            await pg.pdf(path=os.path.join(outdir, f"print_{fmt.lower()}.pdf"), format=fmt,
                         prefer_css_page_size=True, print_background=True)
        await b.close()

asyncio.run(main(sys.argv[1], sys.argv[2]))
