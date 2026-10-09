// Sign in with Google (2026-10-09). The frontend's Google Identity Services
// button hands us a signed ID token; google-auth-library checks its
// signature against Google's keys, the audience (our client ID), issuer and
// expiry. Accounts are matched by the Google-verified email, so no schema
// change: an existing email/password account simply gains Google sign-in.
// Off (button hidden, route 503) when GOOGLE_CLIENT_ID is unset.
import { OAuth2Client } from "google-auth-library";

export function googleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID?.trim() || null;
}

let client: OAuth2Client | null = null;

export type GoogleIdentity = { email: string } | { error: "NO_EMAIL" | "EMAIL_NOT_VERIFIED" };

/** Pure: the account email from a verified token payload, or why it can't sign in. */
export function googleEmailFromPayload(payload: { email?: string; email_verified?: boolean } | undefined): GoogleIdentity {
  if (!payload?.email) return { error: "NO_EMAIL" };
  if (payload.email_verified !== true) return { error: "EMAIL_NOT_VERIFIED" };
  return { email: payload.email.trim().toLowerCase() };
}

// Custom button (2026-10-09, "make it fully custom like our buttons"): the
// app's own button opens Google's OAuth popup, which returns an *access*
// token. Google's tokeninfo endpoint reports who it was issued to; the
// audience check is what stops a token minted for some other app from
// signing in here.
export type GoogleTokenInfo = { aud?: string; azp?: string; email?: string; email_verified?: string | boolean; expires_in?: string | number };
export type GoogleTokenIdentity = { email: string } | { error: "NO_EMAIL" | "EMAIL_NOT_VERIFIED" | "WRONG_AUDIENCE" | "EXPIRED" };

/** Pure: the account email from tokeninfo, or why it can't sign in. */
export function googleEmailFromTokenInfo(info: GoogleTokenInfo, clientId: string): GoogleTokenIdentity {
  if (info.aud !== clientId) return { error: "WRONG_AUDIENCE" };
  if (!(Number(info.expires_in) > 0)) return { error: "EXPIRED" };
  if (!info.email) return { error: "NO_EMAIL" };
  if (info.email_verified !== true && info.email_verified !== "true") return { error: "EMAIL_NOT_VERIFIED" };
  return { email: info.email.trim().toLowerCase() };
}

/** Checks an OAuth access token with Google; throws if Google rejects it. */
export async function verifyGoogleAccessToken(accessToken: string, clientId: string): Promise<GoogleTokenIdentity> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
  return googleEmailFromTokenInfo((await res.json()) as GoogleTokenInfo, clientId);
}

/** Verifies a GIS credential; throws if the token itself is invalid. */
export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleIdentity> {
  client ??= new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  return googleEmailFromPayload(ticket.getPayload());
}
