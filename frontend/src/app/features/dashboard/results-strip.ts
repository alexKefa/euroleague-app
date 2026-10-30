import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Game, PredictionHistoryPick, Schedule } from "../../core/models";
import { TeamCodePipe } from "../../shared/team-display-code";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { RoundStatusService } from "./round-status.service";
import { roundLabel } from "../../shared/round-label";

const SEASON = "2026-27";
// The loser had at least this implied win probability before tip-off.
const UPSET_PROB = 0.6;

interface ResultChip {
  game: Game;
  homeWon: boolean;
  upset: boolean;
  pickCorrect: boolean | null;
  topScorerCorrect: boolean;
  // Set on the first chip of the second (or later) day of the round.
  dayBreak: boolean;
}

/**
 * Results strip (2026-10-14): a row of compact score chips under the round
 * header, one per finished game, with the user's own ✓/✗ and top-scorer hit.
 * Fills in as games go final; once the whole round is final the schedule
 * endpoint rolls forward, so it shows the previous round until the next
 * round's first game is final.
 */
@Component({
  selector: "app-results-strip",
  standalone: true,
  imports: [RouterLink, TeamCodePipe, RetryImgDirective],
  styles: [
    `
      .strip {
        scrollbar-width: none;
      }
      .strip::-webkit-scrollbar {
        display: none;
      }
    `,
  ],
  template: `
    @if (chips().length) {
      <section class="rounded-3xl py-3 mb-4 bg-card border border-line shadow-card" [attr.aria-label]="title()">
        <div class="flex items-baseline justify-between gap-3 px-4 mb-2">
          <p class="text-[11px] font-bold text-muted uppercase tracking-wider">{{ title() }}</p>
          @if (summary(); as s) {
            <p class="text-[13px] font-semibold tabular-nums">
              {{ fill("dashboard.results.summary", { correct: s.correct, total: s.total }) }}
              @if (s.points > 0) {
                <span class="text-emerald-500"> · +{{ s.points }}</span>
              }
            </p>
          }
        </div>
        <div class="strip flex items-stretch gap-2 overflow-x-auto px-4">
          @for (c of chips(); track c.game.id) {
            @if (c.dayBreak) {
              <span class="shrink-0 self-center text-[10px] font-bold text-muted uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">
                {{ i18n.t("dashboard.results.day2") }}
              </span>
            }
            <a
              [routerLink]="['/games', c.game.id]"
              class="shrink-0 rounded-2xl border border-line px-3 py-2.5 flex flex-col gap-1.5 min-w-[132px]"
              [class.border-emerald-500]="c.pickCorrect === true"
              [class.border-red-500]="c.pickCorrect === false"
            >
              @for (side of [{ team: c.game.homeTeam, score: c.game.homeScore, won: c.homeWon }, { team: c.game.awayTeam, score: c.game.awayScore, won: !c.homeWon }]; track side.team.id) {
                <div class="flex items-center gap-2 font-display text-[15px] leading-none tabular-nums" [class.text-muted]="!side.won">
                  @if (side.team.logoUrl) {
                    <img [src]="side.team.logoUrl" [alt]="side.team.name" loading="lazy" decoding="async" appRetryImg class="w-6 h-6 object-contain shrink-0 team-logo" [class.opacity-60]="!side.won" />
                  } @else {
                    <span class="w-6 h-6 shrink-0"></span>
                  }
                  <span>{{ side.team.code | teamCode }}</span>
                  <span class="ml-auto pl-3">{{ side.score }}</span>
                </div>
              }
              <div class="flex items-center gap-1.5 h-4 text-[10px] font-bold">
                @if (c.pickCorrect === true) {
                  <span class="text-emerald-500" [attr.aria-label]="i18n.t('dashboard.results.correct')">✓</span>
                } @else if (c.pickCorrect === false) {
                  <span class="text-red-500" [attr.aria-label]="i18n.t('dashboard.results.wrong')">✗</span>
                }
                @if (c.topScorerCorrect) {
                  <span [attr.aria-label]="i18n.t('dashboard.results.topScorer')" [attr.title]="i18n.t('dashboard.results.topScorer')">🎯</span>
                }
                @if (c.upset) {
                  <span class="ml-auto rounded px-1 bg-amber-400 text-neutral-950 tracking-wider">{{ i18n.t("dashboard.results.upset") }}</span>
                }
              </div>
            </a>
          }
        </div>
      </section>
    }
  `,
})
export class ResultsStripComponent {
  private api = inject(ApiService);
  private rs = inject(RoundStatusService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly myTeamId = input<string | null>(null);

  // Only fetched when the current round has no finished game yet.
  private readonly previous = signal<Schedule | null>(null);
  private previousRound: number | null = null;

  private readonly source = computed<Schedule | null>(() => {
    const schedule = this.rs.schedule();
    if (!schedule) return null;
    if (schedule.games.some(isFinal)) return schedule;
    const prev = this.previous();
    return prev && prev.round === schedule.round - 1 ? prev : null;
  });

  constructor() {
    effect(() => {
      const schedule = this.rs.schedule();
      if (!schedule || schedule.round <= 1 || schedule.games.some(isFinal)) return;
      const round = schedule.round - 1;
      if (round === this.previousRound) return;
      this.previousRound = round;
      untracked(() =>
        this.api.getSchedule(SEASON, round).subscribe({
          next: (s) => this.previous.set(s),
          error: () => (this.previousRound = null),
        })
      );
    });
  }

  private readonly picks = computed(() => {
    const round = this.source()?.round;
    const history = this.rs.predictionHistory();
    const map = new Map<string, PredictionHistoryPick>();
    if (round == null || !history || !this.auth.isAuthenticated()) return map;
    for (const pick of history.find((r) => r.round === round)?.picks ?? []) map.set(pick.gameId, pick);
    return map;
  });

  protected readonly chips = computed<ResultChip[]>(() => {
    const schedule = this.source();
    if (!schedule) return [];
    const myTeamId = this.myTeamId();
    const finals = schedule.games.filter(isFinal).sort((a, b) => Date.parse(a.tipoffAt) - Date.parse(b.tipoffAt));
    const firstDay = finals.length ? new Date(finals[0].tipoffAt).toDateString() : "";
    const isMine = (g: Game) => !!myTeamId && (g.homeTeam.id === myTeamId || g.awayTeam.id === myTeamId);
    const ordered = [...finals.filter(isMine), ...finals.filter((g) => !isMine(g))];

    let brokeDay = false;
    return ordered.map((game, i) => {
      const homeWon = (game.homeScore ?? 0) > (game.awayScore ?? 0);
      const loserProb = homeWon ? game.awayFairProb : game.homeFairProb;
      const pick = this.picks().get(game.id);
      // The favourite team's chip leads, so it never starts the day-2 group.
      const laterDay = new Date(game.tipoffAt).toDateString() !== firstDay;
      const dayBreak = laterDay && !brokeDay && !(i === 0 && isMine(game));
      if (dayBreak) brokeDay = true;
      return {
        game,
        homeWon,
        upset: loserProb != null && loserProb >= UPSET_PROB,
        pickCorrect: pick?.predictedTeam ? pick.winLossCorrect : null,
        topScorerCorrect: pick?.topScorerCorrect === true,
        dayBreak,
      };
    });
  });

  protected readonly title = computed(() => this.fill("dashboard.results.title", { label: roundLabel(this.i18n, this.source()?.round) }));

  protected readonly summary = computed(() => {
    const schedule = this.source();
    const history = this.rs.predictionHistory();
    if (!schedule || !history || !this.auth.isAuthenticated()) return null;
    const resolved = [...this.picks().values()].filter((p) => p.predictedTeam && p.winLossCorrect !== null);
    if (!resolved.length) return null;
    return {
      correct: resolved.filter((p) => p.winLossCorrect).length,
      total: resolved.length,
      points: history.find((r) => r.round === schedule.round)?.points ?? 0,
    };
  });

  protected fill(key: string, values: Record<string, string | number>): string {
    return Object.entries(values).reduce((text, [k, v]) => text.replace(`{${k}}`, String(v)), this.i18n.t(key));
  }
}

function isFinal(game: Game): boolean {
  return game.status === "final" && game.homeScore !== null && game.awayScore !== null;
}
