// Short links (2026-10-16): getclutchapp.com/tiktok forwards to the home page
// tagged ?utm_source=tiktok, so a bio or a video can show a clean address and
// the visit still counts under its channel (signup tracking, routes/visits.ts).
// An optional second segment is the campaign: /tiktok/round6.
//
// To add a channel, add a line below. Never use a path the app itself
// routes (frontend app.routes.ts): those pages would stop opening.

const CHANNELS: Record<string, string> = {
  tiktok: "tiktok",
  tt: "tiktok",
  insta: "instagram",
  instagram: "instagram",
  ig: "instagram",
  fb: "facebook",
  facebook: "facebook",
  yt: "youtube",
  youtube: "youtube",
  x: "x",
  wa: "whatsapp",
  whatsapp: "whatsapp",
  viber: "viber",
  reddit: "reddit",
  qr: "qr",
};

const CAMPAIGN = /^[a-z0-9_-]{1,40}$/;

/** Where a short link goes, or null when the path isn't one (it then opens normally). */
export function shortLinkTarget(slug: string, campaign?: string): string | null {
  const source = CHANNELS[slug.toLowerCase()];
  if (!source) return null;
  const q = new URLSearchParams({ utm_source: source, utm_medium: "social" });
  const c = campaign?.toLowerCase();
  if (c) {
    if (!CAMPAIGN.test(c)) return null;
    q.set("utm_campaign", c);
  }
  return `/?${q.toString()}`;
}

/** Every short path; shortLinks.test.ts checks none is also an app page. */
export const SHORT_LINK_SLUGS = Object.keys(CHANNELS);
