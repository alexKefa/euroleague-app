import { Component, DestroyRef, Input, booleanAttribute, OnInit, computed, effect, inject, signal, untracked } from "@angular/core";
import { NgClass } from "@angular/common";
import { ApiService } from "../core/api.service";
import { AuthService } from "../core/auth.service";
import { EventsService } from "../core/events.service";
import { I18nService } from "../core/i18n.service";
import { GameTeamSummary, QuarterPickState } from "../core/models";
import { NavIconComponent } from "./nav-icon";
import { displayTeamCode } from "./team-display-code";

// While a game can still take picks, re-check this often so a paused feed
// (or the next quarter opening) shows without waiting for a live tick.
const REFRESH_MS = 30_000;

/**
 * Live quarter picks (2026-10-01): pick who wins the next quarter. Only the
 * next quarter is ever open (backend services/quarterPicks.ts). Full panel
 * on the game page; `compact` is the one-line version on Live Center cards.
 */
@Component({
  selector: "app-quarter-picks",
  standalone: true,
  imports: [NgClass, NavIconComponent],
  template: `
    @if (auth.isAuthenticated() && state(); as s) {
      @if (s.openQuarter !== null || s.picks.length > 0 || s.reason === 'stale') {
        @if (compact) {
          <div class="flex items-center gap-1.5 text-[11px]" (click)="$event.stopPropagation()">
            @if (s.openQuarter !== null) {
              <span class="font-bold text-muted uppercase tracking-wide shrink-0">{{ qShort(s.openQuarter) }}</span>
              @for (t of teams(); track t.id) {
                <button
                  type="button"
                  class="h-7 px-2.5 rounded-lg font-bold border transition-colors disabled:opacity-60"
                  [ngClass]="pickFor(s.openQuarter) === t.id ? 'bg-team-primary text-team-secondary border-team-primary' : 'bg-page border-line text-ink hover:border-team-primary'"
                  [disabled]="saving()"
                  (click)="pick(s.openQuarter, t.id)"
                >
                  {{ display(t.code) }}
                </button>
              }
              <span class="text-muted shrink-0">+{{ s.pointsPerCorrect }}</span>
            } @else if (s.reason === 'stale') {
              <span class="text-amber-500 font-semibold">{{ i18n.t('quarterPicks.paused') }}</span>
            }
            @if (record(); as r) {
              <span class="ml-auto font-mono font-bold text-muted shrink-0">{{ r }}</span>
            }
          </div>
        } @else {
          <div class="mt-4 pt-4 border-t border-line">
            <div class="flex items-center justify-between gap-2 mb-1">
              <p class="flex items-center gap-1.5 text-[12px] text-muted font-bold uppercase tracking-wider">
                <app-nav-icon name="zap" [size]="13" />
                {{ i18n.t('quarterPicks.title') }}
              </p>
              <span class="text-[11px] font-bold text-team-primary bg-team-primary/15 rounded-full px-2.5 py-0.5">
                {{ i18n.t('quarterPicks.pts').replace('{n}', '' + s.pointsPerCorrect) }}
              </span>
            </div>

            @if (s.openQuarter !== null) {
              <p class="font-display text-lg leading-tight mb-2">{{ i18n.t('quarterPicks.whoWins').replace('{n}', '' + s.openQuarter) }}</p>
              <div class="grid grid-cols-2 gap-2">
                @for (t of teams(); track t.id) {
                  <button
                    type="button"
                    class="h-14 rounded-2xl border-2 flex items-center justify-center gap-2 font-display text-base transition-all disabled:opacity-60"
                    [ngClass]="pickFor(s.openQuarter) === t.id ? 'border-team-primary bg-team-primary/15 scale-[1.02]' : 'border-line bg-page hover:border-team-primary/60'"
                    [disabled]="saving()"
                    (click)="pick(s.openQuarter, t.id)"
                  >
                    @if (t.logoUrl) {
                      <img [src]="t.logoUrl" alt="" class="w-7 h-7 object-contain" />
                    }
                    {{ display(t.code) }}
                  </button>
                }
              </div>
              <p class="text-[11px] text-muted mt-2">
                {{ i18n.t('quarterPicks.locks').replace('{n}', '' + s.openQuarter) }} · {{ i18n.t('quarterPicks.notRanked') }}
              </p>
            } @else if (s.reason === 'stale') {
              <p class="text-[13px] font-semibold text-amber-500">{{ i18n.t('quarterPicks.paused') }}</p>
            }

            @if (error()) {
              <p class="text-red-500 text-xs font-semibold mt-2">{{ error() }}</p>
            }

            @if (s.picks.length > 0) {
              <div class="flex flex-wrap gap-1.5 mt-3">
                @for (p of s.picks; track p.quarter) {
                  <span
                    class="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[12px] font-bold border"
                    [ngClass]="
                      p.result === 'won'
                        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-500'
                        : p.result === 'lost'
                          ? 'border-red-500/40 bg-red-500/10 text-red-500'
                          : p.result === 'push'
                            ? 'border-line bg-page text-muted'
                            : 'border-team-primary/40 bg-team-primary/10 text-ink'
                    "
                  >
                    {{ qShort(p.quarter) }} · {{ codeOf(p.pickedTeamId) }}
                    @if (p.result === 'won') {
                      <span>+{{ s.pointsPerCorrect }}</span>
                    } @else if (p.result === 'lost') {
                      <span>✗</span>
                    } @else if (p.result === 'push') {
                      <span>{{ i18n.t('quarterPicks.push') }}</span>
                    }
                  </span>
                }
              </div>
            }
          </div>
        }
      }
    }
  `,
})
export class QuarterPicksComponent implements OnInit {
  protected api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);
  private destroyRef = inject(DestroyRef);

  @Input({ required: true }) gameId!: string;
  @Input({ required: true }) homeTeam!: GameTeamSummary;
  @Input({ required: true }) awayTeam!: GameTeamSummary;
  @Input({ transform: booleanAttribute }) compact = false;

  readonly state = signal<QuarterPickState | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly teams = computed(() => [this.homeTeam, this.awayTeam]);
  // "2/3" — correct out of decided picks.
  readonly record = computed(() => {
    const decided = (this.state()?.picks ?? []).filter((p) => p.result === "won" || p.result === "lost");
    return decided.length ? `${decided.filter((p) => p.result === "won").length}/${decided.length}` : null;
  });

  constructor() {
    // A live tick for this game that changes the quarter or status re-reads
    // the open quarter and results.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update || update.gameId !== this.gameId) return;
      const current = untracked(this.state);
      if (!current || current.quarter !== (update.quarter ?? null) || current.status !== update.status) this.load();
    });
  }

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) return;
    this.load();
    const timer = setInterval(() => {
      if (this.state()?.status !== "final") this.load();
    }, REFRESH_MS);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  private load(): void {
    this.api.getQuarterPicks([this.gameId]).subscribe({
      next: ({ games }) => this.state.set(games[0] ?? null),
      error: () => {},
    });
  }

  pickFor(quarter: number): string | null {
    return this.state()?.picks.find((p) => p.quarter === quarter)?.pickedTeamId ?? null;
  }

  codeOf(teamId: string): string {
    return displayTeamCode(teamId === this.homeTeam.id ? this.homeTeam.code : this.awayTeam.code);
  }

  display(code: string): string {
    return displayTeamCode(code);
  }

  qShort(n: number): string {
    return this.i18n.t("quarterPicks.qShort").replace("{n}", String(n));
  }

  pick(quarter: number, teamId: string): void {
    if (this.saving() || this.pickFor(quarter) === teamId) return;
    this.saving.set(true);
    this.error.set(null);
    this.api.saveQuarterPick(this.gameId, quarter, teamId).subscribe({
      next: (s) => {
        this.state.set(s);
        this.saving.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(this.i18n.t(err?.error?.code === "PICKS_PAUSED" ? "quarterPicks.paused" : "quarterPicks.locked"));
        this.load();
      },
    });
  }
}
