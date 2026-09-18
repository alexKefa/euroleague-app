import { Directive, HostBinding, Input } from "@angular/core";

// Shared "filter/toggle chip" styling — small selectable pills used for tier
// filters, category switches, language/stat-view toggles, etc. These were
// each hand-rolled independently (tier filters, leader-category, roster's
// traditional/advanced toggle, the language switch, trades' "list for
// trade" toggle) as a rounded-full mono pill, so none of them picked up
// ButtonDirective's move to Scoreboard's flat-rectangle display-font language
// (sentence case, not uppercase — all-caps read as cheap). This is that
// same language for a selectable chip rather than an action button — apply
// `[appChip]="isActive"` to any two-or-more-state toggle button.
//
// Active state is a tinted accent (bg-team-primary/15 + border-team-primary +
// text-team-primary), not a solid fill — it used to be, but that made a
// selected chip visually identical in weight to ButtonDirective's `primary`
// variant (the actual "submit this" CTA), so a page with both a selected
// filter and a real action button had two equally "loud" elements competing
// for attention. This matches the accent language ButtonDirective's own
// `outline` variant already uses for the same reason.
// bg-highlight -> bg-team-primary (2026-09-18, "change everywhere on the
// app the default orange color with the preferred team") — same team-color
// swap as button.directive.ts's own outline variant.
const BASE =
  "font-display font-bold text-xs px-3 py-1.5 rounded-xl border transition-colors disabled:opacity-40 disabled:pointer-events-none";

@Directive({
  selector: "[appChip]",
  standalone: true,
})
export class ChipDirective {
  @Input("appChip") active = false;

  @HostBinding("class")
  get classes(): string {
    return this.active
      ? `${BASE} bg-team-primary/15 text-team-primary border-team-primary`
      : `${BASE} text-muted border-line hover:border-[#3a3a3b] hover:text-ink`;
  }
}
