// Run: (backend) npm run test:court
import { test } from "node:test";
import assert from "node:assert/strict";
import { HAIR_STYLES, decodeAvatar, defaultAvatar, encodeAvatar, parseAvatar } from "./avatar.js";

test("avatar: every default look is valid and round-trips the wire form", () => {
  for (let n = 0; n < 100; n++) {
    const a = defaultAvatar(n);
    assert.equal(a.number, n);
    assert.deepEqual(parseAvatar(a), a);
    assert.deepEqual(decodeAvatar(encodeAvatar(a)), a);
  }
});

test("avatar: parse rejects out-of-range or malformed input", () => {
  const ok = { skin: 2, hair: "top", hairColor: 1, beard: true, number: 23 };
  assert.deepEqual(parseAvatar(ok), ok);
  for (const bad of [
    null,
    "x",
    { ...ok, skin: 5 },
    { ...ok, skin: -1 },
    { ...ok, skin: 1.5 },
    { ...ok, hair: "mohawk" },
    { ...ok, hairColor: 6 },
    { ...ok, beard: "yes" },
    { ...ok, number: 100 },
    { ...ok, number: "7" },
  ]) {
    assert.equal(parseAvatar(bad), null, JSON.stringify(bad));
  }
  // Extra keys are dropped, not stored.
  assert.deepEqual(parseAvatar({ ...ok, evil: "<script>" }), ok);
});

test("avatar: decode rejects junk wire strings", () => {
  for (const s of ["", "1.top.2", "9.top.1.1.5", "1.top.1.2.5", "1.mohawk.1.1.5", "a.b.c.d.e"]) assert.equal(decodeAvatar(s), null, s);
  for (const hair of HAIR_STYLES) assert.equal(decodeAvatar(`0.${hair}.0.0.0`)?.hair, hair);
});
