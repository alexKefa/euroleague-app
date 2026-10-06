import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { ClutchLeader } from "../../core/models";
import { formatPlayerName } from "../../shared/player-name";
import { TeamCodePipe } from "../../shared/team-display-code";

// League-wide clutch scorers on the Stats page (2026-10-06). Same clutch
// definition as the team page (backend/src/services/teamAnalytics.ts).
// Top 5 by default so it doesn't push the main table down; expands to 15.
const COLLAPSED_COUNT = 5;

@Component({
  selector: "app-clutch-leaders",
  standalone: true,
  imports: [RouterLink, TeamCodePipe],
  template: `
    @if (leaders().length > 0) {
      <div class="bg-card rounded-3xl border border-line shadow-card p-4 mb-4">
        <p class="font-display text-base">{{ i18n.t('ta.clutchLeaders') }}</p>
        <p class="text-[12px] text-muted mb-3">{{ i18n.t('ta.clutchHint') }}</p>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted uppercase tracking-wide">
                <th class="text-left font-bold py-1.5">{{ i18n.t('ta.player') }}</th>
                <th class="text-right font-bold py-1.5 px-1.5">{{ i18n.t('ta.colPTS') }}</th>
                <th class="text-right font-bold py-1.5 px-1.5">{{ i18n.t('ta.colFG') }}</th>
                <th class="text-right font-bold py-1.5 px-1.5">{{ i18n.t('ta.col3P') }}</th>
                <th class="text-right font-bold py-1.5 pl-1.5">{{ i18n.t('ta.colFT') }}</th>
              </tr>
            </thead>
            <tbody>
              @for (l of visible(); track l.player.code; let i = $index) {
                <tr class="border-t border-line">
                  <td class="py-2 min-w-0">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="font-mono text-muted w-4 shrink-0">{{ i + 1 }}</span>
                      @if (l.player.id) {
                        <a [routerLink]="['/players', l.player.id]" class="font-semibold truncate hover:text-team-primary transition-colors">{{ name(l) }}</a>
                      } @else {
                        <span class="font-semibold truncate">{{ name(l) }}</span>
                      }
                      @if (l.team; as t) {
                        <span class="flex items-center gap-1 text-[10px] text-muted font-bold shrink-0">
                          <span class="w-1.5 h-1.5 rounded-full" [style.background]="t.primaryColor ?? '#888'"></span>{{ t.code | teamCode }}
                        </span>
                      }
                    </div>
                  </td>
                  <td class="text-right font-mono font-bold py-2 px-1.5 text-team-primary">{{ l.pts }}</td>
                  <td class="text-right font-mono py-2 px-1.5 whitespace-nowrap">{{ l.fgm }}/{{ l.fga }}</td>
                  <td class="text-right font-mono py-2 px-1.5 whitespace-nowrap">{{ l.tpm }}/{{ l.tpa }}</td>
                  <td class="text-right font-mono py-2 pl-1.5 whitespace-nowrap">{{ l.ftm }}/{{ l.fta }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (leaders().length > collapsedCount) {
          <button type="button" (click)="expanded.set(!expanded())" class="mt-2 text-[12px] font-semibold text-team-primary">
            {{ expanded() ? i18n.t('ta.showLess') : i18n.t('ta.showAll') }}
          </button>
        }
      </div>
    }
  `,
})
export class ClutchLeadersComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly collapsedCount = COLLAPSED_COUNT;
  readonly leaders = signal<ClutchLeader[]>([]);
  readonly expanded = signal(false);
  readonly visible = computed(() => (this.expanded() ? this.leaders() : this.leaders().slice(0, COLLAPSED_COUNT)));

  ngOnInit(): void {
    // Optional extra on the page: a failure just leaves the card hidden.
    this.api.getClutchLeaders().subscribe({ next: (r) => this.leaders.set(r.leaders), error: () => {} });
  }

  name(l: ClutchLeader): string {
    return l.player.name ? formatPlayerName(l.player.name) : l.player.code;
  }
}
