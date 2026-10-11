"""Mock the Notion API with the Template page (shaped like real API responses) and run kmvt_sop.py.
Usage: python3 tests/mock_test.py kmvt_sop.py <tmp-dir-for-test-images> <out-dir>   (needs Pillow + pillow-heif)"""
import sys, os, json, itertools, importlib.util
MOCK = sys.argv[2]
spec = importlib.util.spec_from_file_location("kmvt_sop", sys.argv[1]); K = importlib.util.module_from_spec(spec); spec.loader.exec_module(K)

# --- test images
from PIL import Image, ImageDraw
import pillow_heif; pillow_heif.register_heif_opener()
def mk(name, size, color, label):
    im = Image.new("RGB", size, color); d = ImageDraw.Draw(im); d.rectangle([20,20,size[0]-20,size[1]-20], outline="white", width=12); d.text((60,60), label, fill="white")
    p = os.path.join(MOCK, name); im.save(p); return "file://" + p
u1 = mk("IMG_1986.heic", (3024, 4032), (60,70,90), "timer control box")
u2 = mk("IMG_1987.heic", (4032, 3024), (120,30,30), "podium timer 0:00")
u3 = mk("57ac21b8.png", (1200, 800), (40,90,80), "CLK-01 port")

ids = (f"{i:08x}-0000-0000-0000-000000000000" for i in itertools.count(1))
def rt(text, **ann):
    href = ann.pop("href", None)
    a = dict(bold=False, italic=False, strikethrough=False, underline=False, code=False, color="default"); a.update(ann)
    return {"type": "text", "plain_text": text, "href": href, "annotations": a, "text": {"content": text}}
CH = {}
def blk(t, data=None, kids=None):
    i = next(ids); b = {"object": "block", "id": i, "type": t, t: data or {}, "has_children": bool(kids)}
    if kids: CH[i] = kids
    return b
P = lambda *r, color="default": blk("paragraph", {"rich_text": list(r), "color": color})
H = lambda n, *r: blk(f"heading_{n}", {"rich_text": list(r), "color": "default", "is_toggleable": False})
TODO = lambda s: blk("to_do", {"rich_text": [rt(s)], "checked": False, "color": "default"})
NUM = lambda *r, kids=None: blk("numbered_list_item", {"rich_text": list(r), "color": "default"}, kids)
def CALL(kids, color="default", icon=None, text=()):
    return blk("callout", {"rich_text": list(text), "color": color, "icon": icon}, kids)
ICON = lambda n: {"type": "external", "external": {"url": f"https://www.notion.so/icons/{n}_gray.svg"}}
IMG = lambda u: blk("image", {"type": "file", "file": {"url": u}, "caption": []})
def COLS(*cols):
    return blk("column_list", {}, [blk("column", {}, c) for c in cols])

trouble = lambda: CALL([P(rt("If needed, add further instructions here in non-bolded, grey text."), color="gray")],
                       color="purple_background", icon=ICON("bug"), text=[rt("If x is doing y, you might want to try z.", bold=True)])
hyper = lambda: CALL([H(3, rt("Step 1: Set up the HyperCaster")),
    NUM(rt("Navigate to "), rt("https://playback.mv.kmvt.net", href="https://playback.mv.kmvt.net"), rt(" and log in using credentials "), rt("psguser / psguser", code=True), rt(" ")),
    NUM(rt("Click "), rt("Scheduling > Classic", underline=True), rt(" and do something else")),
    trouble()])
content = [
  H(1, rt("Overview")),
  CALL([H(2, rt("Quick Checklist")), blk("heading_4", {"rich_text": [rt("Before Meeting", bold=True)], "color": "default"}),
        *[TODO(s) for s in ["Take the wireless lectern mic off the charging dock and test it in the control room and chambers",
          "Test both wireless handheld mics and place one on each side of the dais", "Test every wired mic on the dais and staff tables",
          "Confirm the timer is visible on the TriCaster monitor", "Join the Zoom webinar as an attendee on the Operator PC",
          "Select the graphics folder and preview graphics with DSK 1", "Set up camera presets", "Close the conference room doors"]],
        blk("heading_4", {"rich_text": [rt("After Meeting", bold=True)], "color": "default"}),
        *[TODO(s) for s in ["Return all wireless mics to their chargers", "Turn off the control room lights",
          "Close the control room door", "Return the key to the studio the same night or next day"]]]),
  CALL([H(2, rt("Contact Info")), dict(blk("child_database", {"title": "Contact Info"}), id="db-contacts")]),
  CALL([H(2, rt("Program Scheduling")),
        COLS([P(rt("City Council", bold=True)), P(rt("FRI 19:00:00", code=True), rt(" \n"), rt("WED 10:00:00", code=True))],
             [P(rt("Planning Commission", bold=True)), P(rt("MON 09:30:00", code=True), rt(" \n"), rt("SAT 19:30:00", code=True))])]),
  H(1, rt("Meeting Instructions")),
  H(2, rt("Before Meeting")),
  hyper(),
  CALL([H(3, rt("Step 2: Load graphics")),
        NUM(rt("On the "), rt("Operator PC", italic=True), rt(", open the ATEM Software Control application and click "), rt("File > Restore", underline=True)),
        NUM(rt("Select the most recent "), rt("Switcher Config.atem", code=True), rt(" file and click "), rt("Restore", underline=True)),
        CALL([P(rt("More details can be written underneath in non-bolded, grey text"), color="gray")], color="red_background", icon=ICON("warning"),
             text=[rt("Do not click on the button that breaks things.", bold=True)])]),
  CALL([H(3, rt("Step 3: Check podium timer is operational")),
        NUM(rt("Turn on the timer control box located near the clerk’s seat at the staff table."), kids=[IMG(u1)]),
        NUM(rt("Check that the timer on the podium is powered on. You should see a red 7-segment display reading 0:00 or similar."), kids=[IMG(u2)]),
        NUM(rt("If the timer is not on, it is likely not plugged in or plugged in to the wrong port. Open up the floor panel below the podium and locate the ethernet cable labeled "),
            rt("Timer", italic=True), rt(". Plug it in to the "), rt("CLK-01 ", italic=True), rt("port."), kids=[IMG(u3)])]),
  H(2, rt("After Meeting")),
  hyper(),
  H(1, rt("Change Log")),
  dict(blk("child_database", {"title": "Change Log"}), id="db-changelog"),
]
PAGE_ID = "3f47446c-6b1f-8091-9be4-fdd159092a36"
CH[PAGE_ID] = content
for b in content:
    if b["id"].startswith("db-"): b["has_children"] = False
page = {"object": "page", "id": PAGE_ID, "last_edited_time": "2026-10-09T21:21:21.069Z",
        "properties": {"title": {"type": "title", "title": [rt("Template")]}}}
sel = lambda n, c: {"type": "select", "select": {"name": n, "color": c}}
row = lambda n, d, ph, em, org, c: {"properties": {"Name": {"type": "title", "title": [rt(n)]}, "Description": {"type": "rich_text", "rich_text": [rt(d)]},
        "Phone": {"type": "phone_number", "phone_number": ph}, "Email": {"type": "email", "email": em}, "Organization": sel(org, c)}}
DB = {"db-contacts": ({"title": [rt("Contact Info")], "properties": {"Phone": {"type": "phone_number"}, "Email": {"type": "email"},
        "Description": {"type": "rich_text"}, "Organization": {"type": "select"}, "Name": {"type": "title"}}},
       [row("William Gardner", "Primary KMVT Technical Support", "(408) 797-7416", "wgardner@kmvt15.org", "KMVT", "purple"),
        row("Sydney Bucek", "KMVT Scheduling & Technical Support", "(832) 454-9264", "sydney@kmvt15.org", "KMVT", "purple"),
        row("David Carnahan", "Sunnyvale City Clerk", "(408) 730-7918", "dcarnahan@sunnyvale.ca.gov", "Sunnyvale", "yellow")])}
calls = []
def fake_req(self, method, path, body=None):
    calls.append((method, path))
    import re
    if path.startswith("pages/"): return page
    m = re.match(r"blocks/([^/]+)/children", path)
    if m:
        kids = CH.get(m.group(1), [])
        return {"results": kids, "has_more": False}
    m = re.match(r"databases/([^/]+)(/query)?", path)
    if m:
        if m.group(1) not in DB: raise K.NotionError("db not mocked: " + m.group(1))
        meta, rows = DB[m.group(1)]
        return {"results": rows, "has_more": False} if m.group(2) else meta
    raise AssertionError(path)
K.Notion.req = fake_req
os.environ["NOTION_TOKEN"] = "secret_test"
sys.argv = ["kmvt_sop.py", "https://www.notion.so/kmvt/Template-3f47446c6b1f80919be4fdd159092a36?pvs=4", "-o", sys.argv[3]]
K.main()
print("API calls:", len(calls), "| changelog DB queried:", any("db-changelog" in p for _, p in calls))
