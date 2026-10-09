import { Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { I18nService } from "../core/i18n.service";
import { GameTeamSummary, PreviewStrip } from "../core/models";
import { NavIconComponent } from "./nav-icon";
import { TeamCodePipe } from "./team-display-code";

/**
 * Compact matchup preview (2026-10-09): last-5 form dots, the head-to-head
 * record on the leading team's row, and an out/doubtful count, with a link
 * to the full preview on the game page. Display only; Predictions passes
 * the strip in (one /games/previews call per round).
 */
@Component({
  selector: "app-matchup-strip",
  standalone: true,
  imports: [RouterLink, TeamCodePipe, NavIconComponent],
  template: `
    <div class="px-3 py-2 border-t border-line text-[11px]">
      @for (row of rows(); track row.team.id) {
        <div class="flex items-center gap-2 h-5">
          <span class="font-display text-[12px] w-9 shrink-0">{{ row.team.code | teamCode }}</span>
          <span class="flex gap-1" [attr.aria-label]="row.form.join(' ')">
            @for (r of row.form; track $index) {
              <span
                class="w-2 h-2 rounded-full border"
                [style.background]="r === 'W' ? row.color : 'transparent'"
                [style.border-color]="row.color"
              ></span>
            }
          </span>
          @if (row.h2h) {
            <span class="font-semibold text-muted tabular-nums">{{ i18n.t('matchup.h2h') }} {{ row.h2h }}</span>
          }
          <span
            class="ml-auto flex items-center gap-1 tabular-nums"
            [class.text-red-500]="row.injuries > 0"
            [class.text-muted]="row.injuries === 0"
            [attr.title]="i18n.t('matchup.injuredCount')"
          >
            <app-nav-icon name="injury" [size]="12" />
            {{ row.injuries }}
          </span>
        </div>
      }
      <a
        [routerLink]="['/games', gameId()]"
        class="mt-1 flex justify-end text-[11px] font-semibold text-team-primary hover:underline"
        (pointerdown)="$event.stopPropagation()"
        (touchstart)="$event.stopPropagation()"
        (click)="$event.stopPropagation()"
      >
        {{ i18n.t('matchup.fullPreview') }} ›
      </a>
    </div>
  `,
})
export class MatchupStripComponent {
  protected readonly i18n = inject(I18nService);

  readonly strip = input.required<PreviewStrip>();
  readonly home = input.required<GameTeamSummary>();
  readonly away = input.required<GameTeamSummary>();
  readonly gameId = input.required<string>();

  protected readonly rows = computed(() => {
    const s = this.strip();
    const h2h = s.h2h;
    // H2H once, on the leading team's row (home row when tied).
    const homeLeads = !!h2h && h2h.homeWins >= h2h.awayWins;
    const record = h2h ? `${Math.max(h2h.homeWins, h2h.awayWins)}-${Math.min(h2h.homeWins, h2h.awayWins)}` : null;
    return [
      { team: this.home(), color: this.home().primaryColor || "#2563eb", form: s.home.form, injuries: s.home.injuries, h2h: homeLeads ? record : null },
      { team: this.away(), color: this.away().primaryColor || "#dc2626", form: s.away.form, injuries: s.away.injuries, h2h: h2h && !homeLeads ? record : null },
    ];
  });
}
