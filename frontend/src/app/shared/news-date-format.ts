import { Lang } from "../core/i18n/lang";

// Greek reads dates day-first with a 24h clock (no am/pm), not the
// month-first/12h convention English uses — shared by the news list and
// the article preview modal so both switch together with the language toggle.
export function newsDateFormat(lang: Lang, withYear: boolean): string {
  if (lang === "el") return withYear ? "d MMM y, H:mm" : "d MMM, H:mm";
  return withYear ? "MMM d, y, h:mm a" : "MMM d, h:mm a";
}

export function newsDateLocale(lang: Lang): string {
  return lang === "el" ? "el" : "en-US";
}
