import { InjuryStatus } from "../core/models";
import { I18nService } from "../core/i18n.service";

// Shared between the Injury Report page, the roster page's badge, and
// Profile's admin form — same status vocabulary everywhere, one place to
// keep the label/color mapping in sync.
export function injuryStatusLabel(i18n: I18nService, status: InjuryStatus): string {
  return i18n.t(`injuries.status${status[0].toUpperCase()}${status.slice(1)}`);
}

export function injuryStatusClass(status: InjuryStatus): string {
  switch (status) {
    case "out":
      return "bg-red-500/15 text-red-500 border-red-500/30";
    case "doubtful":
      return "bg-orange-500/15 text-orange-500 border-orange-500/30";
    case "questionable":
      return "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
    case "probable":
      return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  }
}
