// Player names come from the feed as "WRIGHT, MOSES". For display: "Moses
// Wright" (first name first, title case, hyphens/apostrophes kept).
export function formatPlayerName(name: string): string {
  const comma = name.indexOf(",");
  const ordered = comma === -1 ? name : `${name.slice(comma + 1).trim()} ${name.slice(0, comma).trim()}`;
  return ordered.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}
