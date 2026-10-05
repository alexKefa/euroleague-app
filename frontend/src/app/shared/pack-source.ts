import { PackSource } from "../core/models";
import { I18nService } from "../core/i18n.service";
import { NavIconName } from "./nav-icon";

/** One-line "why you got this pack" caption — packs.source.* in i18n/store.ts. */
export function packSourceText(i18n: I18nService, source: PackSource | null): string | null {
  if (!source) return null;
  const text = i18n.t(`packs.source.${source.kind}`);
  if ("round" in source) return text.replace("{n}", String(source.round));
  if ("count" in source) return text.replace("{n}", String(source.count));
  return text;
}

export function packSourceIcon(source: PackSource | null): NavIconName {
  switch (source?.kind) {
    case "perfectRound":
      return "trophy";
    case "greatRound":
      return "flame";
    case "pickMilestone":
    case "coachMilestone":
      return "picks";
    case "wheel":
      return "wheel";
    case "firstPicks":
      return "picks";
    default:
      return "packs";
  }
}
