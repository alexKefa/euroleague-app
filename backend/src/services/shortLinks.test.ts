import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SHORT_LINK_SLUGS, shortLinkTarget } from "./shortLinks.js";

test("a channel path forwards home tagged with its source", () => {
  assert.equal(shortLinkTarget("tiktok"), "/?utm_source=tiktok&utm_medium=social");
  assert.equal(shortLinkTarget("Insta"), "/?utm_source=instagram&utm_medium=social");
});

test("a second segment is the campaign", () => {
  assert.equal(shortLinkTarget("fb", "Round6"), "/?utm_source=facebook&utm_medium=social&utm_campaign=round6");
  assert.equal(shortLinkTarget("fb", "bad campaign!"), null);
});

test("anything else isn't a short link", () => {
  assert.equal(shortLinkTarget("news"), null);
  assert.equal(shortLinkTarget("games"), null);
});

test("no short link takes over a page of the app", () => {
  const routes = readFileSync(new URL("../../../frontend/src/app/app.routes.ts", import.meta.url), "utf8");
  const pages = new Set([...routes.matchAll(/path: "([^"/:]+)/g)].map((m) => m[1]));
  assert.ok(pages.has("news"), "read the app's routes");
  assert.deepEqual(SHORT_LINK_SLUGS.filter((s) => pages.has(s)), []);
});
