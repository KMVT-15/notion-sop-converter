import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appleMapsUrl, googleMapsUrl, mapLink, mapTile, MapResolver, parseGoogleMapsUrl } from "../src/maps.js";
import { MAPS_PLACE_URL, MAPS_SEARCH_URL, rt } from "./fixtures/notion.js";

test("coordinates and names come out of full Google Maps URLs", () => {
  assert.deepEqual(parseGoogleMapsUrl(MAPS_SEARCH_URL), { lat: "37.370701", lng: "-122.038075" });
  assert.deepEqual(parseGoogleMapsUrl(MAPS_PLACE_URL), { lat: "37.3688301", lng: "-122.0363496", name: "Example City Hall" });
  assert.deepEqual(parseGoogleMapsUrl("https://maps.google.com/?q=456+W+Olive+Ave,+Sunnyvale"), { query: "456 W Olive Ave, Sunnyvale" });
  assert.deepEqual(parseGoogleMapsUrl("https://www.google.com/maps/@37.37,-122.03,15z"), { lat: "37.37", lng: "-122.03" });
  assert.equal(parseGoogleMapsUrl("https://maps.app.goo.gl/CL5B9bCJKExbhYjh9"), null, "short links need resolving");
});

test("Apple Maps links are built from the coordinates (or the search text)", () => {
  assert.equal(appleMapsUrl({ lat: "37.370701", lng: "-122.038075" }), "https://maps.apple.com/?ll=37.370701,-122.038075&q=37.370701%2C-122.038075");
  assert.equal(appleMapsUrl({ lat: "37.36", lng: "-122.03", name: "Example City Hall" }, "Studio parking"),
    "https://maps.apple.com/?ll=37.36,-122.03&q=Studio%20parking");
  assert.equal(appleMapsUrl({ query: "456 W Olive Ave" }), "https://maps.apple.com/?q=456%20W%20Olive%20Ave");
});

test("the Google button uses Google's cross-platform link, not the short link (phones reject those)", () => {
  const short = "https://maps.app.goo.gl/CL5B9bCJKExbhYjh9";
  assert.equal(googleMapsUrl({ lat: "37.370701", lng: "-122.038075" }, short),
    "https://www.google.com/maps/search/?api=1&query=37.370701%2C-122.038075");
  assert.equal(googleMapsUrl({ query: "456 W Olive Ave" }, short), "https://www.google.com/maps/search/?api=1&query=456%20W%20Olive%20Ave");
  assert.equal(googleMapsUrl(null, short), short, "unresolved: keep the original link");
});

test("only a Google Maps link on its own line becomes a map tile", () => {
  const chip = { type: "mention", mention: { type: "link_mention", link_mention: { title: "37.370701, -122.038075" } }, plain_text: MAPS_SEARCH_URL, href: MAPS_SEARCH_URL };
  assert.deepEqual(mapLink([chip]), { href: MAPS_SEARCH_URL, label: "" }, "coordinates aren't a useful name");
  assert.deepEqual(mapLink([rt("Studio parking", { href: MAPS_PLACE_URL }), rt(" ")]), { href: MAPS_PLACE_URL, label: "Studio parking" });
  assert.equal(mapLink([rt("See "), rt("map", { href: MAPS_PLACE_URL })]), null, "inside a sentence");
  assert.equal(mapLink([rt("Map", { href: "https://maps.example.com/x" })]), null, "not Google Maps");
  assert.deepEqual(mapTile({ href: MAPS_SEARCH_URL, label: "", place: null }), { title: "Location", detail: "", google: MAPS_SEARCH_URL, apple: null });
});

test("short links are resolved by following redirects, then cached", async () => {
  const short = "https://maps.app.goo.gl/abc123";
  let fetches = 0;
  const fetch = async (url) => {
    fetches++;
    assert.equal(url, short);
    return { headers: new Headers({ location: MAPS_SEARCH_URL }), body: null };
  };
  const cacheFile = path.join(mkdtempSync(path.join(os.tmpdir(), "maps-")), "maps.json");
  const maps = new MapResolver({ cacheFile, fetch });
  assert.deepEqual(await maps.resolve(short), { lat: "37.370701", lng: "-122.038075" });
  await maps.save();
  const again = new MapResolver({ cacheFile, fetch });
  assert.deepEqual(await again.resolve(short), { lat: "37.370701", lng: "-122.038075" });
  assert.equal(fetches, 1, "second build used the cache");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(cacheFile, "utf8"))), [short]);

  const offline = new MapResolver({ cacheFile: path.join(path.dirname(cacheFile), "none.json"), fetch: async () => { throw new Error("offline"); } });
  assert.equal(await offline.resolve(short), null);
});
