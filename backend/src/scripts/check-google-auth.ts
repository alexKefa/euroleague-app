// Node checks for Google sign-in payload handling (no test suite in this repo).
// Run from backend/: npx tsx src/scripts/check-google-auth.ts
import assert from "node:assert/strict";
import { googleEmailFromPayload, googleEmailFromTokenInfo } from "../services/googleAuth.js";

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

const CLIENT = "123-abc.apps.googleusercontent.com";

check("token info: issued to our client, verified email", () => {
  assert.deepEqual(
    googleEmailFromTokenInfo({ aud: CLIENT, azp: CLIENT, email: "Fan@Gmail.com", email_verified: "true", expires_in: "3500" }, CLIENT),
    { email: "fan@gmail.com" }
  );
});

check("token info: rejects tokens issued to another app", () => {
  assert.deepEqual(
    googleEmailFromTokenInfo({ aud: "999-other.apps.googleusercontent.com", email: "a@b.com", email_verified: "true", expires_in: "3500" }, CLIENT),
    { error: "WRONG_AUDIENCE" }
  );
});

check("token info: rejects expired, unverified or email-less tokens", () => {
  assert.deepEqual(googleEmailFromTokenInfo({ aud: CLIENT, email: "a@b.com", email_verified: "true", expires_in: "0" }, CLIENT), { error: "EXPIRED" });
  assert.deepEqual(googleEmailFromTokenInfo({ aud: CLIENT, email: "a@b.com", email_verified: "false", expires_in: "3500" }, CLIENT), { error: "EMAIL_NOT_VERIFIED" });
  assert.deepEqual(googleEmailFromTokenInfo({ aud: CLIENT, expires_in: "3500" }, CLIENT), { error: "NO_EMAIL" });
});

console.log("all google-auth checks passed");
