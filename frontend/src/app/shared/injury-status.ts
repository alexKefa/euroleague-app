import { InjuryStatus } from "../core/models";
import { I18nService } from "../core/i18n.service";

// Shared between the Injury Report page, the roster page's badge, and
// Profile's admin form — same status vocabulary everywhere, one place to
// keep the label/color mapping in sync.
export function injuryStatusLabel(i18n: I18nService, status: InjuryStatus): string {
  return i18n.t(`injuries.status${status[0].toUpperCase()}${status.slice(1)}`);
}

// The status label was already bilingual (injuries.status* above), but the
// free-text note wasn't — noteEl is an optional admin-entered Greek
// translation of note (2026-09-19). Falls back to the English note when
// no Greek one has been entered yet, rather than showing nothing, since a
// note is more useful in the "wrong" language than missing entirely.
export function injuryNoteFor(i18n: I18nService, note: string | null, noteEl: string | null): string | null {
  return i18n.lang() === "el" ? (noteEl ?? note) : note;
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

// Solid-fill version of the same severity colors, for a small circular
// badge (InjuryBadgeComponent) rather than a text pill — too small at that
// size for the translucent bg/text/border combo above to read clearly.
export function injuryBadgeBgClass(status: InjuryStatus): string {
  switch (status) {
    case "out":
      return "bg-red-500";
    case "doubtful":
      return "bg-orange-500";
    case "questionable":
      return "bg-yellow-500";
    case "probable":
      return "bg-emerald-500";
  }
}

// Plain text-color version (no bg/border) — for recoloring a player's name
// or price directly rather than adding a separate badge, on Fantasy Five's
// court/pool rows (2026-09-19, "i want more visibility... change the style
// of the name or the cr" — the small corner dot alone read as too easy to
// miss). "questionable" uses a brighter yellow-400 here (vs. the pill's
// yellow-600 above) since this renders on dark card/bar backgrounds, not
// inside a pale translucent pill — 600 was tuned for contrast against its
// own light bg-yellow-500/15, not a plain dark background.
export function injuryAccentTextClass(status: InjuryStatus): string {
  switch (status) {
    case "out":
      return "text-red-500";
    case "doubtful":
      return "text-orange-500";
    case "questionable":
      return "text-yellow-400";
    case "probable":
      return "text-emerald-500";
  }
}
