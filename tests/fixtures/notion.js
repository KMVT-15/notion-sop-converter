// Fake Notion workspace shaped like real API responses (API version 2022-06-28):
//
//   City Operations (root)
//     Template       ported from reference/python-tool/tests/mock_test.py
//     Sunnyvale      rebuilt from the real Notion page as of 2026-10-09
//     Example City   fixture-only; covers blocks the real SOPs don't use yet
//
// Images are generated (no real photos); file URLs carry fake X-Amz signatures
// like Notion's expiring links.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import sharp from "sharp";

export const ROOT_ID = "3f47446c-6b1f-80e4-bb50-f410da1d15b3";
export const TEMPLATE_ID = "3f47446c-6b1f-8091-9be4-fdd159092a36";
export const SUNNYVALE_ID = "0947446c-6b1f-8283-97de-01c9bf2f982a";
export const EXAMPLE_ID = "e0000000-0000-4000-8000-00000000e001";
export const OPERATOR_PC_BLOCK = "3f57446c-6b1f-80df-bee3-d81e9d43a9f2";
export const TEMPLATE_CONTACTS_DB = "3f47446c-6b1f-80c5-be95-c461ce660019";
export const SUNNYVALE_CONTACTS_DB = "cf07446c-6b1f-83cd-9e3b-81f4ba1c188f";
export const CHANGELOG_DB = "c0000000-0000-4000-8000-0000000000c1";
export const EXAMPLE_SKIPPED_PARA = "c0000000-0000-4000-8000-0000000000c2";
const SYDNEY = "2f8d872b-594c-81b0-807b-0002d1f4ab1c";

const ANN = { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" };

export function rt(text, { href = null, ...ann } = {}) {
  return { type: "text", text: { content: text, link: href ? { url: href } : null }, annotations: { ...ANN, ...ann }, plain_text: text, href };
}
const mentionUser = (name, id) => ({ type: "mention", mention: { type: "user", user: { object: "user", id } }, annotations: { ...ANN }, plain_text: `@${name}`, href: null });
const mentionPage = (title, id) => ({
  type: "mention", mention: { type: "page", page: { id } }, annotations: { ...ANN }, plain_text: title,
  href: `https://www.notion.so/${id.replace(/-/g, "")}`,
});
const mentionLink = (href, title) => ({
  type: "mention", mention: { type: "link_mention", link_mention: { href, title, link_provider: "Google Maps" } },
  annotations: { ...ANN }, plain_text: href, href,
});
export const MAPS_SEARCH_URL = "https://www.google.com/maps/search/37.370701,+-122.038075?entry=tts";
export const MAPS_PLACE_URL = "https://www.google.com/maps/place/Example+City+Hall/@37.3688,-122.0363,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d37.3688301!4d-122.0363496";
const mentionDate = (start) => ({ type: "mention", mention: { type: "date", date: { start, end: null, time_zone: null } }, annotations: { ...ANN }, plain_text: start, href: null });

/** Builds blocks and remembers their children, like Notion's blocks/{id}/children endpoint. */
class Workspace {
  constructor(base) {
    this.base = base;
    this.n = 0;
    this.children = {};
    this.blockIds = new Set();
    this.pages = {};
    this.databases = {};
    this.files = {};
  }

  id() {
    return `${(++this.n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  }

  blk(type, data = {}, kids = null, id = this.id()) {
    this.blockIds.add(id);
    if (kids?.length) this.children[id] = kids;
    return { object: "block", id, type, [type]: data, has_children: Boolean(kids?.length), archived: false };
  }

  fileUrl(name) {
    const sig = randomBytes(16).toString("hex");
    return `${this.base}/files/${encodeURIComponent(name)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=${sig}`;
  }

  page(id, title, { icon = null, edited = "2026-10-09T21:21:21.069Z" } = {}) {
    this.pages[id] = {
      object: "page", id, created_time: "2026-10-01T17:00:00.000Z", last_edited_time: edited, archived: false, icon, cover: null,
      properties: { title: { id: "title", type: "title", title: [rt(title)] } },
    };
  }

  // shorthands
  P = (rich, { color = "default", kids = null, id } = {}) => this.blk("paragraph", { rich_text: rich, color }, kids, id);
  H = (n, rich, { id } = {}) => this.blk(`heading_${n}`, { rich_text: rich, color: "default", is_toggleable: false }, null, id);
  TODO = (text) => this.blk("to_do", { rich_text: text ? [rt(text)] : [], checked: false, color: "default" });
  NUM = (rich, kids = null) => this.blk("numbered_list_item", { rich_text: rich, color: "default" }, kids);
  BUL = (rich, kids = null) => this.blk("bulleted_list_item", { rich_text: rich, color: "default" }, kids);
  QUOTE = (rich) => this.blk("quote", { rich_text: rich, color: "default" });
  CALL = (kids, { color = "default", icon = null, text = [] } = {}) => this.blk("callout", { rich_text: text, color, icon }, kids);
  ICON = (name) => ({ type: "external", external: { url: `https://www.notion.so/icons/${name}_gray.svg` } });
  IMG = (name) => this.blk("image", { type: "file", file: { url: this.fileUrl(name), expiry_time: "2026-10-10T02:00:00.000Z" }, caption: [] });
  COLS = (...cols) => this.blk("column_list", {}, cols.map(([ratio, kids]) => this.blk("column", ratio ? { width_ratio: ratio } : {}, kids)));
  TABLE = (rows, { header = false, rowHeader = false } = {}) => this.blk(
    "table", { table_width: rows[0].length, has_column_header: header, has_row_header: rowHeader },
    rows.map((cells) => this.blk("table_row", { cells: cells.map((c) => (typeof c === "string" ? [rt(c)] : c)) })));
  DB = (id, title) => this.blk("child_database", { title }, null, id);
}

const select = (name, color) => ({ type: "select", select: { id: name, name, color } });
let rowN = 0;
const contactRow = (name, desc, phone, email, org, color) => ({
  object: "page", id: `d0000000-0000-4000-8000-${String(++rowN).padStart(12, "0")}`, last_edited_time: "2026-10-09T20:54:00.000Z",
  properties: {
    Name: { type: "title", title: [rt(name)] },
    Description: { type: "rich_text", rich_text: [rt(desc)] },
    Phone: { type: "phone_number", phone_number: phone },
    Email: { type: "email", email: email },
    Organization: select(org, color),
  },
});
const CONTACTS = {
  object: "database", title: [rt("Contact Info")], is_inline: true,
  properties: { Phone: { type: "phone_number" }, Email: { type: "email" }, Description: { type: "rich_text" }, Organization: { type: "select" }, Name: { type: "title" } },
};
const contactRows = (clerk) => [
  contactRow("William Gardner", "Primary KMVT Technical Support", "(408) 797-7416", "wgardner@kmvt15.org", "KMVT", "purple"),
  contactRow("Sydney Bucek", "KMVT Scheduling & Technical Support", "(832) 454-9264", "sydney@kmvt15.org", "KMVT", "purple"),
  clerk,
].map((row, i) => ({ ...row, created_time: `2026-10-09T19:2${i}:00.000Z` })); // listed oldest first, like Notion

// ---------------------------------------------------------------- Template (from mock_test.py)
function template(w) {
  const { P, H, TODO, NUM, CALL, ICON, IMG, COLS, DB } = w;
  const trouble = () => CALL([P([rt("If needed, add further instructions here in non-bolded, grey text.")], { color: "gray" })],
    { color: "purple_background", icon: ICON("bug"), text: [rt("If x is doing y, you might want to try z.", { bold: true })] });
  const hyper = () => CALL([H(3, [rt("Step 1: Set up the HyperCaster")]),
    NUM([rt("Navigate to "), rt("https://playback.mv.kmvt.net", { href: "https://playback.mv.kmvt.net" }), rt(" and log in using credentials "), rt("psguser / psguser", { code: true }), rt(" ")]),
    NUM([rt("Click "), rt("Scheduling > Classic", { underline: true }), rt(" and do something else")]),
    trouble()]);
  const before = ["Take the wireless lectern mic off the charging dock and test it in the control room and chambers",
    "Test both wireless handheld mics and place one on each side of the dais", "Test every wired mic on the dais and staff tables",
    "Confirm the timer is visible on the TriCaster monitor", "Join the Zoom webinar as an attendee on the Operator PC",
    "Select the graphics folder and preview graphics with DSK 1", "Set up camera presets", "Close the conference room doors"];
  const after = ["Return all wireless mics to their chargers", "Turn off the control room lights",
    "Close the control room door", "Return the key to the studio the same night or next day"];
  w.children[TEMPLATE_ID] = [
    H(1, [rt("Overview")]),
    CALL([H(2, [rt("Quick Checklist")]), w.blk("heading_4", { rich_text: [rt("Before Meeting", { bold: true })], color: "default" }),
      ...before.map(TODO), w.blk("heading_4", { rich_text: [rt("After Meeting", { bold: true })], color: "default" }), ...after.map(TODO)]),
    CALL([H(2, [rt("Contact Info")]), DB(TEMPLATE_CONTACTS_DB, "Contact Info")]),
    CALL([H(2, [rt("Program Scheduling")]),
      COLS([null, [P([rt("City Council", { bold: true })]), P([rt("FRI 19:00:00", { code: true }), rt(" \n"), rt("WED 10:00:00", { code: true })])]],
        [null, [P([rt("Planning Commission", { bold: true })]), P([rt("MON 09:30:00", { code: true }), rt(" \n"), rt("SAT 19:30:00", { code: true })])]])]),
    H(1, [rt("Meeting Instructions")]),
    H(2, [rt("Before Meeting")]),
    hyper(),
    CALL([H(3, [rt("Step 2: Load graphics")]),
      NUM([rt("On the "), rt("Operator PC", { italic: true }), rt(", open the ATEM Software Control application and click "), rt("File > Restore", { underline: true })]),
      NUM([rt("Select the most recent "), rt("Switcher Config.atem", { code: true }), rt(" file and click "), rt("Restore", { underline: true })]),
      CALL([P([rt("More details can be written underneath in non-bolded, grey text")], { color: "gray" })],
        { color: "red_background", icon: ICON("warning"), text: [rt("Do not click on the button that breaks things.", { bold: true })] })]),
    CALL([H(3, [rt("Step 3: Check podium timer is operational")]),
      NUM([rt("Turn on the timer control box located near the clerk’s seat at the staff table.")], [IMG("IMG_1986.heic")]),
      NUM([rt("Check that the timer on the podium is powered on. You should see a red 7-segment display reading 0:00 or similar.")], [IMG("IMG_1987.heic")]),
      NUM([rt("If the timer is not on, it is likely not plugged in or plugged in to the wrong port. Open up the floor panel below the podium and locate the ethernet cable labeled "),
        rt("Timer", { italic: true }), rt(". Plug it in to the "), rt("CLK-01 ", { italic: true }), rt("port.")], [IMG("57ac21b8.png")])]),
    H(2, [rt("After Meeting")]),
    hyper(),
    H(1, [rt("Change Log")]),
    DB(CHANGELOG_DB, "Change Log"),
  ];
  w.databases[TEMPLATE_CONTACTS_DB] = { meta: CONTACTS, rows: contactRows(contactRow("David Carnahan", "Sunnyvale City Clerk", "(408) 730-7918", "dcarnahan@sunnyvale.ca.gov", "Sunnyvale", "yellow")) };
  w.databases[CHANGELOG_DB] = { meta: { object: "database", title: [rt("Change Log")], properties: { Name: { type: "title" } } }, rows: [] };
  w.page(TEMPLATE_ID, "Template");
}

// ---------------------------------------------------------------- Sunnyvale (real content, API-shaped)
function sunnyvale(w) {
  const { P, H, TODO, NUM, QUOTE, CALL, ICON, IMG, COLS, TABLE, DB } = w;
  const opPc = `/0947446c6b1f828397de01c9bf2f982a?pvs=25#${OPERATOR_PC_BLOCK.replace(/-/g, "")}`;
  const u = (text) => rt(text, { underline: true });
  const b = (text) => rt(text, { bold: true });
  const code = (text) => rt(text, { code: true });
  const sched = (rows) => TABLE(rows.map(([day, time]) => [day, time]));
  w.children[SUNNYVALE_ID] = [
    H(1, [rt("Overview")]),
    CALL([H(2, [rt("Quick Checklist")]),
      w.blk("heading_4", { rich_text: [b("Before Meeting")], color: "default" }), TODO(""),
      w.blk("heading_4", { rich_text: [b("After Meeting")], color: "default" }), TODO("")]),
    CALL([H(2, [rt("Contact Info")]), DB(SUNNYVALE_CONTACTS_DB, "Contact Info")]),
    CALL([H(2, [rt("Playback Scheduling")]),
      COLS([0.4375, [P([b("City Council")]), sched([["Wed", "19:00:00"], ["Thurs", "09:00:00"], ["Sat & Sun", "16:00:00"]])]],
        [0.5625, [P([b("Planning Commission")]), sched([["Wed", "09:00:00"], ["Thurs", "19:00:00"], ["Sun", "11:00:00"]])]])]),
    CALL([H(2, [rt("Parking & Access")]),
      // Notion buttons come through the API as "unsupported", with no label or URL
      w.blk("unsupported", { block_type: "button" }), w.blk("unsupported", { block_type: "button" }),
      P([rt("This site requires a Sunnyvale keycard specific to each operator. If you do not have a keycard and are scheduled for a Sunnyvale meeting, please reach out to "),
        mentionUser("Sydney Bucek", SYDNEY), rt(" as soon as possible.")]),
      P([rt("The city hall has plenty of parking on the south side of the building, off Olive Ave and S. Mathilda Ave. See the map below.")]),
      IMG("parking_sunnyvale.jpg")]),
    H(1, [rt("Meeting Instructions")]),
    H(2, [rt("Before Meeting")]),
    CALL([H(3, [rt("Step 1: Arrive and check in")]),
      NUM([rt("Use your keycard to enter the control room. A city employee may already be on site. If not, turn on the lights using the switch to the right of the door.")]),
      NUM([rt("Wake up the "), rt("Operator PC", { italic: true, href: opPc }), rt(" ", { italic: true }), rt("using the keyboard and mouse on the shelf underneath the control desk.")]),
      NUM([rt("Using Microsoft Teams on the "), rt("Operator PC", { italic: true, href: opPc }),
        rt(", find the appropriate group chat (either “Planning Commission” or “Council Meeting”) and let the staff know that you have arrived.")],
      [QUOTE([rt("“Hey, this is <name> from KMVT. I’ve arrived and I am setting up.”")])]),
      NUM([rt("Confirm that the latest agenda is printed out on the desk. You will want to reference this later. If it is not present on arrival, a city employee will likely bring it soon.")]),
      CALL([P([rt("The control room door locks automatically. Wear your keycard around your neck, or keep it in a secure pocket. If you leave it on the control desk or in your backpack, you "),
        b("will"), rt(" lock yourself out eventually.")], { color: "gray" })],
      { color: "red_background", icon: ICON("warning"), text: [b("Keep your keycard on your person at all times.")] })]),
    CALL([H(3, [rt("Step 2: Set up H2R Graphics")]), P([rt("NEW PHOTOS AND INSTRUCTIONS NEEDED FOR THIS SEGMENT")])]),
    CALL([H(3, [rt("Step 3: Schedule record and stream events")]),
      NUM([rt("Using the "), rt("Operator PC", { italic: true }), rt(", open Google Chrome and navigate to "),
        rt("https://playback.sv.kmvt.net", { href: "https://playback.sv.kmvt.net" }), rt(" or use the Hypercaster shortcut.")]),
      NUM([rt("Log in using username "), code("psguser"), rt(" and password "), code("psguser"), rt(" .")], [IMG("Screenshot_2026-10-09_at_5.47.41_PM.png")]),
      NUM([rt("Navigate to the classic programming tab via "), u("Programming > Classic"), rt(".")], [IMG("sv_step_1.png")]),
      NUM([rt("Click on "), u("Add Stream Event"), rt(".")], [IMG("add_stream_event.png")]),
      NUM([rt("Fill out the stream event details as follows, and hit "), u("Save"), rt(". All other fields can be left as is.")],
        [TABLE([[[b("Channel")], "KSUN Sunnyvale 16"], [[b("Feed")], "Council Chambers"], [[b("Duration")], "10:00:00"], [[b("Date")], "Todays date"],
          [[b("Time")], "Two minutes before meeting starts (24 hour time, HH:MM:SS format)"], [[b("Cancel Conflicting Events")], "Yes / Checked"]])]),
      NUM([rt("Return to "), u("Programming > Classic"), rt(" and then "), u("Add Record Event"), rt(".")], [IMG("add_record_event.png")]),
      NUM([rt("Fill out the recording details as follows, and hit "), u("Save"), rt(". All other fields can be left as is.")],
        [TABLE([[[b("Channel")], "Capture 1"], [[b("Feed")], "Council Chambers"],
          [[b("Filename")], [rt("If planning commission: "), code("svpcYYMMDD"), rt("\nIf city council meeting: "), code("svccYYMMDD"),
            rt(" \n\nFor example, for a city council meeting on 07/14/2026, use "), code("svcc260714"), rt(" as the filename.")]],
          [[b("Date")], "Todays date"], [[b("Time")], "Two minutes before meeting starts (24 hour time, HH:MM:SS format)"], [[b("Duration")], "10:00:00"]])]),
      NUM([rt("Return to the "), u("Dashboard"), rt(" and verify that the stream and record events appear with the correct date and time.")], [IMG("up_next.png")])]),
    H(2, [rt("After Meeting")]),
    H(1, [rt("Glossary")]),
    CALL([H(3, [rt("Operator PC")], { id: OPERATOR_PC_BLOCK })]),
    CALL([P([rt("More details can be written underneath in non-bolded, grey text")], { color: "gray" })],
      { color: "red_background", icon: ICON("warning"), text: [b("Do not click on the button that breaks things.")] }),
    CALL([P([rt("If needed, add further instructions here in non-bolded, grey text.")], { color: "gray" })],
      { color: "purple_background", icon: ICON("bug"), text: [b("If x is doing y, you might want to try z.")] }),
  ];
  w.databases[SUNNYVALE_CONTACTS_DB] = { meta: CONTACTS, rows: contactRows(contactRow("David Carnahan", "Sunnyvale City Clerk", "(408) 730-7918", "dcarnahan@sunnyvale.ca.gov", "Sunnyvale", "yellow")) };
  w.page(SUNNYVALE_ID, "Sunnyvale", { icon: { type: "file", file: { url: w.fileUrl("sunnyvale.png"), expiry_time: "2026-10-10T02:00:00.000Z" } }, edited: "2026-10-10T01:26:05.392Z" });
}

// ---------------------------------------------------------------- Example City (fixture-only)
function exampleCity(w) {
  const { P, H, NUM, BUL, CALL, ICON } = w;
  w.children[EXAMPLE_ID] = [
    H(1, [rt("Overview")]),
    CALL([H(2, [rt("About this page")]), P([rt("This page only exists in the test fixtures. It covers blocks the real SOPs don’t use yet.")])]),
    P([rt("See the "), mentionPage("Sunnyvale", SUNNYVALE_ID), rt(" SOP, or jump straight to its "),
      rt("Operator PC", { href: `/Sunnyvale-0947446c6b1f828397de01c9bf2f982a#${OPERATOR_PC_BLOCK.replace(/-/g, "")}` }), rt(" glossary entry.")]),
    P([rt("Older notes live in the "), rt("Wiki", { href: "/Wiki-2f97446c6b1f800fa4fcd419e77ebf9c" }), rt(". Next review: "), mentionDate("2026-11-02"), rt(".")]),
    // link-only paragraphs -> a row of buttons; a bare URL on its own line stays a plain link
    P([rt("Open parking map", { href: "https://maps.example.com/city-hall" })]),
    P([rt("Keycard request form", { bold: true, href: "https://forms.example.com/keycard" }), rt(" ")]),
    P([rt("https://playback.example.kmvt.net", { href: "https://playback.example.kmvt.net" })]),
    // Google Maps links on their own line -> map tiles with an Apple Maps button; inside a sentence -> plain link
    P([mentionLink(MAPS_SEARCH_URL, "37.370701, -122.038075")]),
    P([rt("Studio parking", { href: MAPS_PLACE_URL })]),
    P([rt("Directions are also in "), rt("Google Maps", { href: MAPS_PLACE_URL }), rt(".")]),
    H(2, [rt("Other blocks")]),
    BUL([rt("Bullet, level 1")], [BUL([rt("Bullet, level 2")], [BUL([rt("Bullet, level 3")])])]),
    NUM([rt("Numbered, level 1")], [NUM([rt("Numbered, level 2")], [NUM([rt("Numbered, level 3")])])]),
    w.blk("toggle", { rich_text: [rt("Toggle summary")], color: "default" }, [P([rt("Toggle contents are shown expanded.")])]),
    w.blk("code", { rich_text: [rt("ping 10.0.0.1\nssh operator@10.0.0.1")], language: "shell", caption: [] }),
    w.blk("divider", {}),
    w.blk("pdf", { type: "file", file: { url: w.fileUrl("Wiring diagram.pdf"), expiry_time: "2026-10-10T02:00:00.000Z" }, caption: [] }),
    w.blk("bookmark", { url: "https://kmvt15.org", caption: [] }),
    CALL([P([rt("Label the cable before unplugging it.")])], { color: "yellow_background", icon: ICON("lightbulb"), text: [rt("Tip", { bold: true })] }),
    CALL([], { color: "green_background", text: [rt("Everything is set when the tally light is red.")] }),
    CALL([], { color: "blue_background", icon: { type: "emoji", emoji: "📞" }, text: [rt("Call the studio if the stream drops.")] }),
    H(2, [rt("Change Log")]),
    P([rt("This paragraph is under the Change Log heading and must never appear.")], { id: EXAMPLE_SKIPPED_PARA }),
  ];
  w.page(EXAMPLE_ID, "Example City", { icon: { type: "emoji", emoji: "🏛️" }, edited: "2026-09-30T16:05:00.000Z" });
}

// ---------------------------------------------------------------- images
const svgImage = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);
const screenshot = (label) => sharp(svgImage(1440, 900,
  `<rect width="100%" height="100%" fill="#f4f5f7"/><rect width="100%" height="64" fill="#2d3540"/>` +
  `<rect x="40" y="120" width="560" height="40" rx="6" fill="#dfe3e8"/><rect x="40" y="190" width="900" height="24" rx="4" fill="#e6e9ed"/>` +
  `<rect x="40" y="236" width="760" height="24" rx="4" fill="#e6e9ed"/><rect x="40" y="320" width="220" height="56" rx="8" fill="#5275ba"/>` +
  `<text x="40" y="560" font-family="Helvetica" font-size="56" fill="#2d3540">${label}</text>`)).png().toBuffer();

async function images() {
  const heic = (name) => readFileSync(new URL(`images/${name}`, import.meta.url));
  return {
    "IMG_1986.heic": { type: "image/heic", buf: heic("IMG_1986.heic") },
    "IMG_1987.heic": { type: "image/heic", buf: heic("IMG_1987.heic") },
    "57ac21b8.png": {
      type: "image/png",
      buf: await sharp(svgImage(1200, 800, '<rect width="100%" height="100%" fill="#285a50"/><text x="60" y="420" font-family="Helvetica" font-size="80" fill="#fff">CLK-01 port</text>'))
        .flatten({ background: "#285a50" }).png().toBuffer(),
    },
    "parking_sunnyvale.jpg": {
      type: "image/jpeg",
      buf: await sharp(svgImage(2400, 1600, '<rect width="100%" height="100%" fill="#e8efe3"/><rect x="200" y="300" width="900" height="700" fill="#c9d3c1"/>' +
        '<rect x="1300" y="300" width="900" height="900" fill="#b9c7e0"/><text x="1340" y="780" font-family="Helvetica" font-size="110" fill="#2d3540">City Hall</text>' +
        '<text x="240" y="680" font-family="Helvetica" font-size="110" fill="#2d3540">Parking</text>')).jpeg({ quality: 85 }).toBuffer(),
    },
    "Screenshot_2026-10-09_at_5.47.41_PM.png": { type: "image/png", buf: await screenshot("Log in: psguser") },
    "sv_step_1.png": { type: "image/png", buf: await screenshot("Programming &gt; Classic") },
    "add_stream_event.png": { type: "image/png", buf: await screenshot("Add Stream Event") },
    "add_record_event.png": { type: "image/png", buf: await screenshot("Add Record Event") },
    "up_next.png": { type: "image/png", buf: await screenshot("Dashboard: Up Next") },
    "sunnyvale.png": {
      type: "image/png",
      buf: await sharp(svgImage(256, 256, '<circle cx="128" cy="128" r="120" fill="#1f4e8c"/><circle cx="128" cy="128" r="96" fill="none" stroke="#f2c14e" stroke-width="10"/>' +
        '<text x="128" y="150" text-anchor="middle" font-family="Helvetica" font-weight="bold" font-size="64" fill="#fff">SV</text>')).png().toBuffer(),
    },
    "Wiring diagram.pdf": { type: "application/pdf", buf: Buffer.from("%PDF-1.4\n% fixture\n") },
  };
}

/** @param {string} base  fake server origin, used in file URLs */
export async function buildWorkspace(base) {
  const w = new Workspace(base);
  template(w);
  sunnyvale(w);
  exampleCity(w);
  w.children[ROOT_ID] = [
    w.blk("child_page", { title: "Template" }, null, TEMPLATE_ID),
    w.blk("child_page", { title: "Sunnyvale" }, null, SUNNYVALE_ID),
    w.blk("child_page", { title: "Example City" }, null, EXAMPLE_ID),
  ];
  for (const id of [TEMPLATE_ID, SUNNYVALE_ID, EXAMPLE_ID]) w.children[ROOT_ID].find((b) => b.id === id).has_children = true;
  w.page(ROOT_ID, "City Operations");
  w.files = await images();
  return w;
}
