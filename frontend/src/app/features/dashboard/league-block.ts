import { Component, computed, inject, input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { I18nService } from "../../core/i18n.service";
import { NewsArticle, StandingsRow } from "../../core/models";

/**
 * Compact league card (2026-10-07 dashboard redesign): the top news story,
 * the top 4 of the standings (plus the user's team if it sits lower) and
 * links to the full pages. Data comes in from the dashboard; nothing is
 * fetched here.
 */
@Component({
  selector: "app-league-block",
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="rounded-3xl p-4 mb-4 bg-card border border-line shadow-card grid gap-3" [attr.aria-label]="i18n.t('dashboard.league.title')">
      @if (topStory(); as story) {
        <a [href]="story.url" target="_blank" rel="noopener" class="flex items-center gap-3 group">
          @if (story.imageUrl) {
            <img [src]="story.imageUrl" alt="" class="w-[54px] h-10 rounded-xl object-cover shrink-0" loading="lazy" />
          } @else {
            <span class="w-[54px] h-10 rounded-xl shrink-0 bg-gradient-to-br from-team-primary to-team-primary/40" aria-hidden="true"></span>
          }
          <span class="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-team-primary transition-colors">{{ story.title }}</span>
        </a>
      }

      @if (rows().length) {
        <div class="grid gap-1.5" [class.border-t]="topStory()" [class.border-line]="topStory()" [class.pt-3]="topStory()">
          @for (r of rows(); track r.team.id) {
            @if (r.position > 4) {
              <div class="border-t border-dashed border-line my-0.5" aria-hidden="true"></div>
            }
            <div class="grid grid-cols-[18px_22px_1fr_auto] gap-2 items-center text-sm">
              <span class="text-muted tabular-nums">{{ r.position }}</span>
              @if (r.team.logoUrl) {
                <img [src]="r.team.logoUrl" alt="" class="w-[22px] h-[22px] object-contain" loading="lazy" />
              } @else {
                <span class="w-[22px] h-[22px] rounded-full" [style.background]="r.team.primaryColor || 'var(--color-line)'"></span>
              }
              <span class="truncate" [class.font-bold]="r.team.id === myTeamId()">{{ r.team.name }}</span>
              <span class="tabular-nums" [class.text-muted]="r.team.id !== myTeamId()">{{ r.stats.wins }}–{{ r.stats.losses }}</span>
            </div>
          }
        </div>
      }

      <nav class="flex gap-4 border-t border-line pt-3 text-sm font-semibold">
        <a routerLink="/news" class="text-team-primary hover:underline">{{ i18n.t("dashboard.league.news") }}</a>
        <a routerLink="/standings" class="text-team-primary hover:underline">{{ i18n.t("dashboard.league.standings") }}</a>
        <a routerLink="/stats" class="text-team-primary hover:underline">{{ i18n.t("dashboard.league.stats") }}</a>
      </nav>
    </section>
  `,
})
export class LeagueBlockComponent {
  protected i18n = inject(I18nService);

  readonly news = input<NewsArticle[]>([]);
  readonly standings = input<StandingsRow[]>([]);
  readonly myTeamId = input<string | null>(null);

  protected readonly topStory = computed(() => this.news()[0] ?? null);

  protected readonly rows = computed(() => {
    const sorted = [...this.standings()].sort((a, b) => a.position - b.position);
    const top = sorted.slice(0, 4);
    const mine = sorted.find((r) => r.team.id === this.myTeamId());
    return mine && !top.includes(mine) ? [...top, mine] : top;
  });
}
