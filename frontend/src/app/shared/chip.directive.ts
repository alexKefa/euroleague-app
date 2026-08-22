import { Directive, HostBinding, Input } from "@angular/core";

// Shared "filter/toggle chip" styling — small selectable pills used for tier
// filters, category switches, language/stat-view toggles, etc. These were
// each hand-rolled independently (tier filters, leader-category, roster's
// traditional/advanced toggle, the language switch, trades' "list for
// trade" toggle) as a rounded-full mono pill, so none of them picked up
// ButtonDirective's move to Scoreboard's flat-rectangle uppercase-Rajdhani
// language. This is that same language for a selectable chip rather than
// an action button — apply `[appChip]="isActive"` to any two-or-more-state
// toggle button.
const BASE =
  "font-display font-bold uppercase tracking-[0.03em] text-xs px-3 py-1.5 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none";

@Directive({
  selector: "[appChip]",
  standalone: true,
})
export class ChipDirective {
  @Input("appChip") active = false;

  @HostBinding("class")
  get classes(): string {
    return this.active
      ? `${BASE} bg-highlight text-white`
      : `${BASE} text-muted border border-line hover:border-[#3a3a3b] hover:text-ink`;
  }
}
