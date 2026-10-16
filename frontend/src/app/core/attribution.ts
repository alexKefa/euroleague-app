import { API_BASE_URL } from "./api-config";

// Signup tracking (2026-10-16): where a visit came from, read from the
// landing link (utm_source/medium/campaign, ref, promo) and the referring
// site. Each logged-out page load sends it to POST /api/visits (anonymous,
// no device id), and it's kept in localStorage until registration, which
// sends it with the signup (AuthService). The backend cleans and names it
// (services/attribution.ts).

export interface Attribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  ref: string | null;
  promo: string | null;
  referrer: string | null;
  landing: string | null;
}

const KEY = "signupAttribution";

/** Reads the landing URL and document.referrer; a referrer on our own site counts as none. */
export function readAttribution(href: string, referrer: string): Attribution {
  const url = new URL(href);
  const q = url.searchParams;
  let ref: string | null = null;
  try {
    const host = referrer ? new URL(referrer).host : "";
    ref = host && host !== url.host ? host : null;
  } catch {
    ref = null;
  }
  return {
    source: q.get("utm_source"),
    medium: q.get("utm_medium"),
    campaign: q.get("utm_campaign"),
    ref: q.get("ref"),
    promo: q.get("promo"),
    referrer: ref,
    landing: url.pathname,
  };
}

/** Nothing says where the visit came from. */
export function isDirect(a: Attribution): boolean {
  return !a.source && !a.ref && !a.promo && !a.referrer;
}

/**
 * Records this page load as a visit and remembers its source for signup.
 * A direct visit doesn't overwrite a remembered source, so someone who
 * arrives from TikTok and signs up on a later, direct visit counts as TikTok.
 */
export function trackVisit(): void {
  const a = readAttribution(location.href, document.referrer);
  try {
    if (!isDirect(a) || !localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Storage off: the visit still counts, the signup just won't know its source.
  }
  fetch(`${API_BASE_URL}/visits`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) }).catch(
    () => undefined
  );
}

/** The remembered source, for the signup request. */
export function peekAttribution(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

export function clearAttribution(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
