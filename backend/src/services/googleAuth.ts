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

/** Verifies a GIS credential; throws if the token itself is invalid. */
export async function verifyGoogleCredential(credential: string, clientId: string): Promise<GoogleIdentity> {
  client ??= new OAuth2Client(clientId);
  const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
  return googleEmailFromPayload(ticket.getPayload());
}
