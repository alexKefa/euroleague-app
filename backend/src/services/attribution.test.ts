import { test } from "node:test";
import assert from "node:assert/strict";
import { isBot, normalizeAttribution, sourceLabel } from "./attribution.js";

test("attribution is cleaned: trimmed, lowercased, capped, non-strings dropped", () => {
  assert.deepEqual(normalizeAttribution({ source: " TikTok ", campaign: "Round6", landing: "/Games/X", ref: 42, extra: "x" }), {
    source: "tiktok",
    medium: null,
    campaign: "round6",
    ref: null,
    promo: null,
    referrer: null,
    landing: "/Games/X",
  });
  assert.equal(normalizeAttribution({ source: "x".repeat(300) })?.source?.length, 100);
});

test("nothing to record is null", () => {
  assert.equal(normalizeAttribution(null), null);
  assert.equal(normalizeAttribution("tiktok"), null);
  assert.equal(normalizeAttribution({ source: "  ", ref: "" }), null);
});

const a = (o: Record<string, string>) => normalizeAttribution(o);

test("a source is named from the link first, then codes, then the referring site", () => {
  assert.equal(sourceLabel(a({ source: "tiktok", ref: "abc", referrer: "l.instagram.com" })), "tiktok");
  assert.equal(sourceLabel(a({ ref: "ABC123", referrer: "l.instagram.com" })), "referral");
  assert.equal(sourceLabel(a({ promo: "QRFLYER" })), "promo");
  assert.equal(sourceLabel(a({ referrer: "l.instagram.com" })), "instagram");
  assert.equal(sourceLabel(a({ referrer: "m.facebook.com" })), "facebook");
  assert.equal(sourceLabel(a({ referrer: "www.google.gr" })), "google");
  assert.equal(sourceLabel(a({ referrer: "t.co" })), "x");
  assert.equal(sourceLabel(a({ referrer: "www.gazzetta.gr" })), "gazzetta.gr");
  assert.equal(sourceLabel(a({ landing: "/schedule" })), "direct");
  assert.equal(sourceLabel(null), "direct");
});

test("crawlers and link previews aren't visits", () => {
  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBot("facebookexternalhit/1.1"), true);
  assert.equal(isBot("WhatsApp/2.23"), true);
  assert.equal(isBot(undefined), true);
  assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0"), false);
});
