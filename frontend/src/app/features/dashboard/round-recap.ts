import { Component, computed, effect, inject, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { forkJoin } from "rxjs";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { PredictionHistoryPick, RoundRecap } from "../../core/models";
import { DialogComponent } from "../../shared/dialog";
import { CountUpComponent } from "../../shared/count-up";
import { NavIconComponent } from "../../shared/nav-icon";
import { ButtonDirective } from "../../shared/button.directive";
import { formatPlayerName } from "../../shared/player-name";

const SEEN_KEY_PREFIX = "clutch-recap-seen-";
// Only recap a round that finished recently; a user returning weeks later
// doesn't need a recap of a round long gone.
const MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000;

interface BestPick {
  label: string;
  points: number;
  logoUrl: string | null;
}

/**
 * Round recap (2026-10-02): once a round's last game is final, the next
 * dashboard visit opens a one-time summary of it: round points and rank,
 * overall rank movement, correct picks, best pick, and league positions.
 * Shown once per round per device.
 */
@Component({
  selector: "app-round-recap",
  standalone: true,
  imports: [DialogComponent, NavIconComponent, ButtonDirective, CountUpComponent],
  template: `
    @if (recap(); as r) {
      <app-dialog [title]="i18n.t('recap.title').replace('{round}', '' + r.round)" icon="medal" [closeLabel]="i18n.t('hint.dismiss')" (closed)="close()">
        <div class="relative overflow-hidden rounded-3xl p-5 mb-4 text-center border border-line">
          <div class="pointer-events-none absolute inset-0" style="background: radial-gradient(120% 120% at 50% 0%, color-mix(in srgb, var(--accent-primary) 26%, transparent) 0%, transparent 70%)" aria-hidden="true"></div>
          <p class="relative text-[11px] font-bold text-muted uppercase tracking-wider">{{ i18n.t('recap.points') }}</p>
          <p class="relative font-display text-5xl leading-none tabular-nums mt-2" [class.text-emerald-500]="r.roundPoints > 0">
            @if (r.roundPoints > 0) {+}<app-count-up [value]="r.roundPoints > 0 ? r.roundPoints : 0" [duration]="1.2" />
          </p>
          @if (r.roundRank) {
            <p class="relative text-[13px] font-semibold text-muted mt-2">
              {{ i18n.t('recap.roundRank').replace('{rank}', '' + r.roundRank).replace('{n}', '' + r.roundPlayers) }}
            </p>
          }
        </div>

        <div class="grid grid-cols-2 gap-2 mb-4">
          <div class="status-tile rounded-2xl border border-line px-3 py-3 text-center">
            <p class="text-[11px] font-bold text-muted uppercase tracking-wider">{{ i18n.t('recap.overall') }}</p>
            <p class="font-display text-2xl tabular-nums text-team-primary">@if (r.rank) {#<app-count-up [value]="r.rank" [from]="r.rank + 20" />} @else {—}</p>
            @if (movement(); as m) {
              <p class="text-[12px] font-bold mt-0.5" [class]="m.cls">{{ m.text }}</p>
            }
          </div>
          <div class="status-tile rounded-2xl border border-line px-3 py-3 text-center">
            <p class="text-[11px] font-bold text-muted uppercase tracking-wider">{{ i18n.t('recap.correct') }}</p>
            <p class="font-display text-2xl tabular-nums"><app-count-up [value]="correct().right" />/{{ correct().of }}</p>
          </div>
        </div>

        @if (best(); as b) {
          <p class="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">{{ i18n.t('recap.best') }}</p>
          <div class="flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5 mb-4">
            <span class="w-9 h-9 rounded-xl bg-page flex items-center justify-center shrink-0">
              @if (b.logoUrl) {
                <img [src]="b.logoUrl" alt="" class="w-6 h-6 object-contain team-logo" />
              } @else {
                <app-nav-icon name="flame" [size]="18" class="text-team-primary" />
              }
            </span>
            <span class="min-w-0 flex-1 text-sm font-semibold truncate">{{ b.label }}</span>
            <span class="font-display text-lg tabular-nums text-emerald-500">+{{ b.points }}</span>
          </div>
        }

        @if (r.leagues.length > 0) {
          <p class="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">{{ i18n.t('recap.leagues') }}</p>
          <div class="space-y-1.5 mb-4">
            @for (l of r.leagues; track l.id) {
              <div class="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                <app-nav-icon name="bracket" [size]="16" class="text-team-primary shrink-0" />
                <span class="min-w-0 flex-1 text-sm font-semibold truncate">{{ l.name }}</span>
                <span class="font-mono text-[12px] font-bold" [class.text-team-primary]="l.rank === 1">
                  {{ i18n.t('recap.leagueRank').replace('{rank}', '' + l.rank).replace('{n}', '' + l.members) }}
                </span>
              </div>
            }
          </div>
        }

        <button type="button" appButton class="w-full" (click)="goToLeaderboard()">{{ i18n.t('recap.cta') }}</button>
      </app-dialog>
    }
  `,
})
export class RoundRecapComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  readonly recap = signal<RoundRecap | null>(null);
  private readonly picks = signal<PredictionHistoryPick[]>([]);

  readonly correct = computed(() => {
    const winnerPicks = this.picks().filter((p) => p.predictedTeam);
    return { right: winnerPicks.filter((p) => p.winLossCorrect).length, of: winnerPicks.length };
  });

  // The single pick worth the most this round, winner or top scorer.
  readonly best = computed<BestPick | null>(() => {
    let best: BestPick | null = null;
    for (const p of this.picks()) {
      if (p.winLossCorrect && p.predictedTeam && p.winLossPoints > (best?.points ?? 0)) {
        const team = p.predictedTeam.id === p.homeTeam.id ? p.homeTeam : p.awayTeam;
        best = { label: this.i18n.t("recap.bestWinner").replace("{team}", team.name), points: p.winLossPoints, logoUrl: team.logoUrl };
      }
      if (p.topScorerCorrect && p.topScorerPlayer && p.topScorerPoints > (best?.points ?? 0)) {
        best = {
          label: this.i18n.t("recap.bestTopScorer").replace("{player}", formatPlayerName(p.topScorerPlayer.name)),
          points: p.topScorerPoints,
          logoUrl: null,
        };
      }
    }
    return best;
  });

  readonly movement = computed(() => {
    const r = this.recap();
    if (!r?.rank || !r.rankBefore) return null;
    const diff = r.rankBefore - r.rank;
    if (diff > 0) return { text: "▲ " + this.i18n.t("recap.up").replace("{n}", String(diff)), cls: "text-emerald-500" };
    if (diff < 0) return { text: "▼ " + this.i18n.t("recap.down").replace("{n}", String(-diff)), cls: "text-red-500" };
    return { text: this.i18n.t("recap.same"), cls: "text-muted" };
  });

  constructor() {
    // React to the token, not ngOnInit — the session restores after mount.
    effect(() => {
      const token = this.auth.accessToken();
      untracked(() => (token ? this.check() : this.recap.set(null)));
    });
  }

  private check(): void {
    forkJoin([this.api.getRoundRecap(), this.api.getPredictionHistory()]).subscribe({
      next: ([recap, history]) => {
        if (!recap) return;
        if (Date.now() - new Date(recap.finishedAt).getTime() > MAX_AGE_MS) return;
        if (this.seen(recap)) return;
        this.picks.set(history.find((h) => h.round === recap.round)?.picks ?? []);
        this.recap.set(recap);
      },
      error: () => {}, // non-critical
    });
  }

  close(): void {
    const r = this.recap();
    if (r) {
      try {
        localStorage.setItem(`${SEEN_KEY_PREFIX}${r.season}-${r.round}`, "1");
      } catch {
        // No persistence — it may show once more.
      }
    }
    this.recap.set(null);
  }

  goToLeaderboard(): void {
    this.close();
    this.router.navigateByUrl("/leaderboard");
  }

  private seen(r: RoundRecap): boolean {
    try {
      return localStorage.getItem(`${SEEN_KEY_PREFIX}${r.season}-${r.round}`) === "1";
    } catch {
      return false;
    }
  }
}
