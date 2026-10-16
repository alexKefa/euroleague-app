// Signup tracking (2026-10-16): where visits and signups come from. The
// frontend (core/attribution.ts) reads the landing link and referrer and
// sends them with each visit and with registration; this cleans them and
// names the source. No DB here, so it runs under `npx tsx --test`.

export interface Attribution {
  source: string | null; // utm_source
  medium: string | null; // utm_medium
  campaign: string | null; // utm_campaign
  ref: string | null; // referral code
  promo: string | null;
  referrer: string | null; // the referring site's host, never our own
  landing: string | null; // path the visit started on
}

const FIELDS = ["source", "medium", "campaign", "ref", "promo", "referrer", "landing"] as const;

/** Trims, caps at 100 characters, lowercases (except the landing path); anything else is null. */
function clean(value: unknown, keepCase = false): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().slice(0, 100);
  if (!s) return null;
  return keepCase ? s : s.toLowerCase();
}

/** The request body's attribution, cleaned; null when it isn't an object or carries nothing. */
export function normalizeAttribution(input: unknown): Attribution | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const a = Object.fromEntries(FIELDS.map((f) => [f, clean(o[f], f === "landing")])) as unknown as Attribution;
  return FIELDS.some((f) => a[f] !== null) ? a : null;
}

// Referring hosts named the way people say them. Matched on the host or any
// parent domain ("l.instagram.com" is instagram).
const HOSTS: [string, string][] = [
  ["instagram.com", "instagram"],
  ["tiktok.com", "tiktok"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["messenger.com", "facebook"],
  ["t.co", "x"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["reddit.com", "reddit"],
  ["whatsapp.com", "whatsapp"],
  ["viber.com", "viber"],
  ["t.me", "telegram"],
  ["youtube.com", "youtube"],
];

function hostLabel(host: string): string {
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)bing\.com$/.test(host)) return "bing";
  const hit = HOSTS.find(([h]) => host === h || host.endsWith(`.${h}`));
  return hit ? hit[1] : host.replace(/^www\./, "");
}

/**
 * One label per visit or signup, most specific first: the link's utm_source,
 * then a referral or promo code, then the referring site, else "direct".
 */
export function sourceLabel(a: Attribution | null): string {
  if (!a) return "direct";
  if (a.source) return a.source;
  if (a.ref) return "referral";
  if (a.promo) return "promo";
  if (a.referrer) return hostLabel(a.referrer);
  return "direct";
}

/** Crawlers and link-preview fetchers, which aren't visits. */
export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|headless|lighthouse/i.test(userAgent);
}
