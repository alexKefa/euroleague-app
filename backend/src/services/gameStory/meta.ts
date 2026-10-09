// Game story cards (2026-10-09): link previews. index.html ships generic
// og:/twitter: tags (the site card); for a final game's /games/:id page
// these are rewritten to point at the story card, so a pasted link on X,
// WhatsApp, Facebook or Discord previews it. Crawlers read the first tag of
// each kind, so existing tags are replaced, never duplicated. Pure; checked
// by scripts/check-game-story.ts.

export interface StoryMeta {
  title: string;
  description: string;
  url: string;
  image: string;
}

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function withStoryMeta(html: string, meta: StoryMeta): string {
  const tags: [attr: "property" | "name", key: string, value: string][] = [
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:url", meta.url],
    ["property", "og:image", meta.image],
    ["property", "og:image:width", "1080"],
    ["property", "og:image:height", "1350"],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", meta.image],
  ];
  let out = html;
  const missing: string[] = [];
  for (const [attr, key, value] of tags) {
    const tag = `<meta ${attr}="${key}" content="${escapeAttr(value)}">`;
    const re = new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, "\\$&")}" content="[^"]*"\\s*/?>`);
    if (re.test(out)) out = out.replace(re, () => tag);
    else missing.push(tag);
  }
  if (missing.length) out = out.replace("</head>", () => `${missing.join("\n")}\n</head>`);
  return out.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeAttr(meta.title)}</title>`);
}
