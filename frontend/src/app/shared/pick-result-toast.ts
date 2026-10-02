import { Component, DestroyRef, computed, effect, inject, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { EventsService } from "../core/events.service";
import { I18nService } from "../core/i18n.service";
import { PredictionHistoryPick } from "../core/models";
import { NavIconComponent } from "./nav-icon";
import { formatPlayerName } from "./player-name";

const SEEN_KEY = "clutch-pick-results-seen";
const SEEN_CAP = 200;
// On app open, also report picks decided while the app was closed — but
// only recent ones, so a returning user isn't shown last week's results.
const CATCH_UP_WINDOW_MS = 36 * 60 * 60 * 1000;
// A round's games often finish minutes apart; wait a moment after a
// "final" so near-simultaneous results land in one toast, not three.
const FINAL_DEBOUNCE_MS = 3000;

interface PickResult {
  gameId: string;
  correct: boolean;
  points: number;
  // The team that actually won — the user's pick if correct, else the other side.
  winnerName: string;
  pickedName: string | null;
  topScorer: { name: string; correct: boolean } | null;
}

/**
 * "Your pick was decided" toast (2026-10-02): fires when a game the user
 * picked goes final (SSE game-update, see EventsService), plus a one-time
 * catch-up on app open for games that ended while the app was closed.
 * Points come from GET /predictions/history, the same per-pick numbers the
 * Predictions page shows. Each game is reported once (localStorage).
 */
@Component({
  selector: "app-pick-result-toast",
  standalone: true,
  imports: [NavIconComponent],
  template: `
    @if (results().length > 0) {
      <div class="toast-pop toast-pill pointer-events-auto mb-2" role="status">
        <div class="flex items-center gap-2.5">
          <span class="toast-pill-icon" [class.text-emerald-500]="anyCorrect()">
            <app-nav-icon [name]="anyCorrect() ? 'checkmark-shield' : 'picks'" [size]="18" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[13px] font-semibold leading-snug line-clamp-2">{{ title() }}</p>
            @if (detail(); as d) {
              <p class="text-[12px] text-muted leading-snug line-clamp-2">{{ d }}</p>
            }
          </div>
          @if (totalPoints() > 0) {
            <span class="shrink-0 font-display text-base tabular-nums text-emerald-500">+{{ totalPoints() }}</span>
          }
          <button type="button" (click)="go()" class="toast-action">{{ i18n.t("pickResult.cta") }}</button>
          <button type="button" (click)="dismiss()" class="toast-x" [attr.aria-label]="i18n.t('hint.dismiss')">&times;</button>
        </div>
      </div>
    }
  `,
})
export class PickResultToastComponent {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private events = inject(EventsService);
  protected i18n = inject(I18nService);
  private router = inject(Router);

  readonly results = signal<PickResult[]>([]);
  readonly totalPoints = computed(() => this.results().reduce((sum, r) => sum + r.points, 0));
  readonly anyCorrect = computed(() => this.results().some((r) => r.correct || r.topScorer?.correct));

  readonly title = computed(() => {
    const rs = this.results();
    if (rs.length === 1) {
      const r = rs[0];
      // Top-scorer-only pick: its outcome is the headline, not a detail line.
      if (r.pickedName === null && r.topScorer) return this.topScorerText(r.topScorer);
      return r.correct
        ? this.i18n.t("pickResult.won").replace("{team}", r.winnerName)
        : this.i18n.t("pickResult.missed").replace("{team}", r.winnerName);
    }
    return this.i18n
      .t("pickResult.many")
      .replace("{n}", String(rs.length))
      .replace("{correct}", String(rs.filter((r) => r.correct).length));
  });

  // Top-scorer outcome — only spelled out for a single game; the grouped
  // toast's points total already includes it.
  readonly detail = computed(() => {
    const rs = this.results();
    if (rs.length !== 1 || !rs[0].topScorer || rs[0].pickedName === null) return null;
    return this.topScorerText(rs[0].topScorer);
  });

  private topScorerText(ts: { name: string; correct: boolean }): string {
    return this.i18n.t(ts.correct ? "pickResult.topScorerHit" : "pickResult.topScorerMiss").replace("{player}", ts.name);
  }

  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Catch-up check once per login — reacting to the token, not ngOnInit,
    // since the session restores after this mounts (same as reminders-banner).
    effect(() => {
      const token = this.auth.accessToken();
      untracked(() => {
        if (!token) {
          this.results.set([]);
          return;
        }
        this.check(Date.now() - CATCH_UP_WINDOW_MS);
      });
    });

    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update || update.status !== "final") return;
      untracked(() => {
        if (!this.auth.isAuthenticated()) return;
        if (this.pendingTimer) clearTimeout(this.pendingTimer);
        // Any recently tipped-off game: the backend writes the final score
        // and box score before broadcasting, so history is already settled.
        this.pendingTimer = setTimeout(() => this.check(Date.now() - CATCH_UP_WINDOW_MS), FINAL_DEBOUNCE_MS);
      });
    });

    inject(DestroyRef).onDestroy(() => this.pendingTimer && clearTimeout(this.pendingTimer));
  }

  private check(sinceMs: number): void {
    this.api.getPredictionHistory().subscribe({
      next: (rounds) => {
        const seen = this.readSeen();
        const fresh = rounds
          .flatMap((r) => r.picks)
          .filter((p) => new Date(p.tipoffAt).getTime() >= sinceMs && !seen.has(p.gameId) && this.isDecided(p))
          .map((p) => this.toResult(p));
        if (fresh.length === 0) return;
        this.writeSeen([...seen, ...fresh.map((r) => r.gameId)]);
        this.results.update((current) => [...current, ...fresh.filter((f) => !current.some((c) => c.gameId === f.gameId))]);
      },
      error: () => {}, // non-critical — results still show on the Predictions page
    });
  }

  // A winner pick is always decided once the game is final (no ties). A
  // top-scorer-only pick can stay null on a tie for top scorer; skip it.
  private isDecided(p: PredictionHistoryPick): boolean {
    return p.predictedTeam ? p.winLossCorrect !== null : p.topScorerCorrect !== null;
  }

  private toResult(p: PredictionHistoryPick): PickResult {
    const picked = p.predictedTeam;
    const winner = picked
      ? p.winLossCorrect
        ? picked
        : picked.id === p.homeTeam.id
          ? p.awayTeam
          : p.homeTeam
      : null;
    return {
      gameId: p.gameId,
      correct: p.winLossCorrect === true,
      points: p.winLossPoints + p.topScorerPoints,
      winnerName: winner?.name ?? `${p.homeTeam.name} – ${p.awayTeam.name}`,
      pickedName: picked?.name ?? null,
      topScorer:
        p.topScorerPlayer && p.topScorerCorrect !== null
          ? { name: formatPlayerName(p.topScorerPlayer.name), correct: p.topScorerCorrect }
          : null,
    };
  }

  go(): void {
    this.dismiss();
    this.router.navigateByUrl("/predictions");
  }

  dismiss(): void {
    this.results.set([]);
  }

  private readSeen(): Set<string> {
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  }

  private writeSeen(ids: string[]): void {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_CAP)));
    } catch {
      // No persistence — a result may show again next load.
    }
  }
}
