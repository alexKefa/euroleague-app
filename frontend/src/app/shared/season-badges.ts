import { Component, inject, input } from "@angular/core";
import { I18nService } from "../core/i18n.service";
import { SeasonBadge } from "../core/models";

// Duel season badges ("Top 3 · Oct 2026") as chips. Shared by the Battles
// hub, the Profile page and the league member sheet so they read the same.
@Component({
  selector: "app-season-badges",
  standalone: true,
  template: `
    <div class="flex flex-wrap gap-1.5">
      @for (b of badges(); track b.season + b.kind) {
        <span class="rounded-full px-2.5 py-0.5 text-[11px] font-bold bg-team-secondary text-team-primary">{{ label(b) }}</span>
      }
    </div>
  `,
})
export class SeasonBadgesComponent {
  private i18n = inject(I18nService);
  readonly badges = input.required<SeasonBadge[]>();

  /** "Oct 2026" from a season key like 2026-10, in the current language. */
  label(b: SeasonBadge): string {
    const [y, m] = b.season.split("-").map(Number);
    const month = new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString(this.i18n.lang() === "el" ? "el-GR" : "en-GB", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
    return this.i18n.t("duels.badge." + b.kind).replace("{month}", month);
  }
}
