import { test } from "node:test";
import assert from "node:assert/strict";
import { isDirect, readAttribution } from "./attribution";

test("a tagged link's utm fields, codes and landing page are read", () => {
  assert.deepEqual(readAttribution("https://getclutchapp.com/games/abc?utm_source=tiktok&utm_medium=video&utm_campaign=round6&ref=ABC12", ""), {
    source: "tiktok",
    medium: "video",
    campaign: "round6",
    ref: "ABC12",
    promo: null,
    referrer: null,
    landing: "/games/abc",
  });
});

test("the referring site is kept unless it's our own", () => {
  assert.equal(readAttribution("https://getclutchapp.com/", "https://l.instagram.com/?u=x").referrer, "l.instagram.com");
  assert.equal(readAttribution("https://getclutchapp.com/schedule", "https://getclutchapp.com/").referrer, null);
  assert.equal(readAttribution("https://getclutchapp.com/", "not a url").referrer, null);
});

test("a visit with no link tag, code or referrer is direct", () => {
  assert.equal(isDirect(readAttribution("https://getclutchapp.com/", "")), true);
  assert.equal(isDirect(readAttribution("https://getclutchapp.com/register?ref=AB", "")), false);
  assert.equal(isDirect(readAttribution("https://getclutchapp.com/", "https://www.google.com/")), false);
});
