// Node checks for Google sign-in payload handling (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-google-auth.ts
import assert from "node:assert/strict";
import { googleEmailFromPayload } from "../services/googleAuth.js";

function check(name: string, fn: () => void) {
  fn();
  console.log("ok", name);
}

check("verified email is accepted and lower-cased", () => {
  assert.deepEqual(googleEmailFromPayload({ email: "Alex.K@Gmail.com", email_verified: true }), { email: "alex.k@gmail.com" });
});

check("unverified or missing email is rejected", () => {
  assert.deepEqual(googleEmailFromPayload({ email: "a@b.com", email_verified: false }), { error: "EMAIL_NOT_VERIFIED" });
  assert.deepEqual(googleEmailFromPayload({ email: "a@b.com" }), { error: "EMAIL_NOT_VERIFIED" });
  assert.deepEqual(googleEmailFromPayload({ email_verified: true }), { error: "NO_EMAIL" });
  assert.deepEqual(googleEmailFromPayload(undefined), { error: "NO_EMAIL" });
});

console.log("all google-auth checks passed");
