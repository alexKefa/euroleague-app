// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIME_MODES, indoorLighting, lightingFor, nextTimeMode, resolveHour } from "./lighting";

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11;
};

test("lighting: noon is full daylight, the sun is high, floodlights off", () => {
  const l = lightingFor(13);
  assert.ok(l.day > 0.95, `day ${l.day}`);
  assert.ok(l.sunDir.y > 0.7, `sun height ${l.sunDir.y}`);
  assert.equal(l.floodlights, false);
});

test("lighting: midnight is night, the sun is down, floodlights on, the sky is dark", () => {
  const l = lightingFor(0);
  assert.ok(l.day < 0.05, `day ${l.day}`);
  assert.ok(l.sunDir.y <= 0.15, `sun height ${l.sunDir.y}`);
  assert.equal(l.floodlights, true);
  assert.ok(lum(l.skyTop) < 40, `sky ${l.skyTop}`);
});

test("lighting: sunset is in between, with a warm low sun", () => {
  const l = lightingFor(19.4);
  assert.ok(l.day > 0.2 && l.day < 0.8, `day ${l.day}`);
  const n = parseInt(l.sunColor.slice(1), 16);
  assert.ok(((n >> 16) & 255) > (n & 255) + 40, `sun ${l.sunColor} should be warm`);
  assert.ok(l.sunDir.y < 0.4, `sun height ${l.sunDir.y}`);
});

test("lighting: no jump at midnight (23:59 ~ 00:00)", () => {
  const a = lightingFor(23.99);
  const b = lightingFor(0);
  assert.ok(Math.abs(a.day - b.day) < 0.01);
  assert.equal(a.skyTop, b.skyTop);
});

test("lighting: changes smoothly through the day (no step bigger than 0.12 per 15 min)", () => {
  for (let h = 0; h < 24; h += 0.25) {
    const d = Math.abs(lightingFor(h + 0.25).day - lightingFor(h).day);
    assert.ok(d <= 0.12, `jump of ${d.toFixed(2)} at ${h}h`);
  }
});

test("time modes: auto follows the clock, the others are fixed; the button cycles through all", () => {
  const at = new Date(2026, 10, 10, 21, 30);
  assert.equal(resolveHour("auto", at), 21.5);
  assert.equal(resolveHour("day", at), 13);
  assert.ok(lightingFor(resolveHour("night", at)).floodlights);
  assert.ok(!lightingFor(resolveHour("day", at)).floodlights);
  let m = TIME_MODES[0]!;
  const seen = new Set([m]);
  for (let i = 0; i < TIME_MODES.length; i++) seen.add((m = nextTimeMode(m)));
  assert.equal(seen.size, TIME_MODES.length);
  assert.equal(nextTimeMode(TIME_MODES[TIME_MODES.length - 1]!), TIME_MODES[0]);
});

test("indoor lighting: the gym stays lit at night, the windows go dark", () => {
  const night = indoorLighting(lightingFor(0));
  const noon = indoorLighting(lightingFor(13));
  assert.ok(night.hemiIntensity >= 1.2, `night hemi ${night.hemiIntensity}`);
  assert.ok(night.keyIntensity >= 1, `night key ${night.keyIntensity}`);
  assert.ok(night.keyDir.y > 0.9, `night key should come from overhead, y=${night.keyDir.y}`);
  assert.ok(lum(night.windowColor) < 40, `night window ${night.windowColor}`);
  assert.ok(lum(noon.windowColor) > 150, `noon window ${noon.windowColor}`);
  assert.ok(night.lamps > noon.lamps, "lamp halos read stronger at night");
  assert.ok(Math.abs(Math.hypot(noon.keyDir.x, noon.keyDir.y, noon.keyDir.z) - 1) < 1e-9);
});
