import { Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { EventsService } from "../../core/events.service";
import { I18nService } from "../../core/i18n.service";
import { PredictionHistoryRound, Schedule } from "../../core/models";
import { NavIconComponent } from "../../shared/nav-icon";
import { SkeletonComponent } from "../../shared/skeleton";

const SEASON = "2026-27";

/**
 * "This round" strip (2026-10-02): picks made, points earned this round and
 * leaderboard rank, with a nudge to the games still open to pick. The
 * dashboard otherwise leads with team info, but "do I have picks to make?"
 * is what a returning user opens the app for. Logged-in only.
 */
@Component({
  selector: "app-round-strip",
  standalone: true,
  imports: [RouterLink, NavIconComponent, SkeletonComponent],
  template: `
    @if (scheduleLoading()) {
      <!-- Same shell as the loaded card (title, three tiles, CTA bar), so
           nothing below shifts when the data lands. -->
      <div class="rounded-3xl p-4 mb-4 bg-card border border-line shadow-card" aria-busy="true">
        <app-skeleton class="h-3 w-40 rounded-md mb-3" />
        <div class="grid grid-cols-3 gap-2">
          @for (i of [0, 1, 2]; track i) {
            <div class="status-tile rounded-2xl border border-line px-2 py-2 flex flex-col items-center gap-1.5">
              <app-skeleton class="h-3 w-12 rounded-md" />
              <app-skeleton class="h-5 w-10 rounded-md" />
            </div>
          }
        </div>
        <app-skeleton class="mt-3 h-10 rounded-2xl" />
      </div>
    } @else if (schedule(); as s) {
      <div class="rounded-3xl p-4 mb-4 bg-card border border-line shadow-card">
        <a routerLink="/predictions" class="flex items-center justify-between gap-2 mb-3 group">
          <p class="text-[11px] font-bold text-muted uppercase tracking-wider">
            {{ i18n.t("roundStrip.title").replace("{round}", String(s.round)) }}
          </p>
          <span class="text-muted text-sm font-bold group-hover:translate-x-0.5 transition-transform">&rsaquo;</span>
        </a>
        <div class="grid grid-cols-3 gap-2">
          <a routerLink="/predictions" class="status-tile rounded-2xl border border-line px-2 py-2 text-center min-w-0 hover:border-team-primary/50 transition-colors">
            <p class="text-[11px] font-bold text-muted uppercase tracking-wider truncate">{{ i18n.t("roundStrip.picks") }}</p>
            @if (!picksLoaded()) {
              <app-skeleton class="h-5 w-10 mx-auto mt-1 rounded-md" />
            } @else {
              <p class="font-display text-xl leading-tight tabular-nums">{{ pickedCount() }}/{{ s.games.length }}</p>
            }
          </a>
          <a routerLink="/predictions-history" class="status-tile rounded-2xl border border-line px-2 py-2 text-center min-w-0 hover:border-team-primary/50 transition-colors">
            <p class="text-[11px] font-bold text-muted uppercase tracking-wider truncate">{{ i18n.t("roundStrip.points") }}</p>
            @if (historyLoading()) {
              <app-skeleton class="h-5 w-10 mx-auto mt-1 rounded-md" />
            } @else {
              <p class="font-display text-xl leading-tight tabular-nums" [class.text-emerald-500]="roundPoints() > 0">
                {{ roundPoints() > 0 ? "+" + roundPoints() : 0 }}
              </p>
            }
          </a>
          <a routerLink="/predictions" fragment="leaderboard" class="status-tile rounded-2xl border border-line px-2 py-2 text-center min-w-0 hover:border-team-primary/50 transition-colors">
            <p class="text-[11px] font-bold text-muted uppercase tracking-wider truncate">{{ i18n.t("roundStrip.rank") }}</p>
            @if (rankLoading()) {
              <app-skeleton class="h-5 w-10 mx-auto mt-1 rounded-md" />
            } @else {
              <p class="font-display text-xl leading-tight tabular-nums text-team-primary">{{ rank() ? "#" + rank() : "—" }}</p>
              @if (rankNote(); as note) {
                <p class="text-[10px] font-semibold text-muted leading-tight truncate mt-0.5">{{ note }}</p>
              }
            }
          </a>
        </div>
        @if (!picksLoaded()) {
          <app-skeleton class="mt-3 h-10 rounded-2xl" />
        } @else if (openToPick() > 0) {
          <a routerLink="/predictions" class="mt-3 flex items-center justify-center gap-2 h-10 rounded-2xl bg-team-primary text-team-secondary text-sm font-bold">
            <app-nav-icon name="picks" [size]="16" />
            {{ i18n.t(openToPick() === 1 ? "roundStrip.leftOne" : "roundStrip.leftMany").replace("{n}", String(openToPick())) }}
          </a>
        } @else if (pickedCount() > 0) {
          <p class="mt-3 flex items-center justify-center gap-2 text-[13px] font-semibold text-muted">
            <app-nav-icon name="checkmark-shield" [size]="16" class="text-emerald-500" />
            {{ i18n.t("roundStrip.allIn") }}
          </p>
        }
      </div>
    }
  `,
})
export class RoundStripComponent {
  private api = inject(ApiService);
  private events = inject(EventsService);
  protected i18n = inject(I18nService);
  protected readonly String = String;

  // From the dashboard's own leaderboard fetch, so this doesn't repeat it.
  readonly rank = input<number | null>(null);
  // Points to the rank directly above; null at #1 or unranked.
  readonly behindBy = input<number | null>(null);
  // The dashboard's leaderboard fetch is still in flight.
  readonly rankLoading = input(false);

  // "12 pts to #46" — a concrete target for the next round.
  readonly rankNote = computed(() => {
    const rank = this.rank();
    if (rank === null) return null;
    if (rank === 1) return this.i18n.t("roundStrip.top");
    const gap = this.behindBy();
    if (gap === null) return null;
    const above = String(rank - 1);
    return gap === 0
      ? this.i18n.t("roundStrip.tied").replace("{rank}", above)
      : this.i18n.t("roundStrip.behind").replace("{n}", String(gap)).replace("{rank}", above);
  });

  readonly schedule = signal<Schedule | null>(null);
  // Only the first load shows skeletons; refreshes after a game goes final
  // update the values in place.
  readonly scheduleLoading = signal(true);
  readonly historyLoading = signal(true);
  private readonly history = signal<PredictionHistoryRound[]>([]);

  // Read from EventsService rather than this component's own fetch: it's
  // updated the moment a pick is made (markPredicted), so the count moves
  // without a refetch.
  readonly pickedCount = computed(() => {
    const picked = this.events.predictedGameIds();
    return (this.schedule()?.games ?? []).filter((g) => picked.has(g.id)).length;
  });

  readonly picksLoaded = this.events.predictedGameIdsLoaded;

  readonly openToPick = computed(() => {
    const picked = this.events.predictedGameIds();
    const now = Date.now();
    return (this.schedule()?.games ?? []).filter(
      (g) => g.status === "scheduled" && new Date(g.tipoffAt).getTime() > now && !picked.has(g.id)
    ).length;
  });

  readonly roundPoints = computed(() => {
    const round = this.schedule()?.round;
    return this.history().find((r) => r.round === round)?.points ?? 0;
  });

  constructor() {
    // A game going final settles points — refresh both (schedule too, since
    // the last final can roll the "current round" over to the next one).
    // The first run is the initial load, whatever the last update was.
    let first = true;
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!first && update?.status !== "final") return;
      first = false;
      untracked(() => this.load());
    });
  }

  private load(): void {
    this.api.getSchedule(SEASON).subscribe({
      next: (s) => {
        this.schedule.set(s);
        this.scheduleLoading.set(false);
      },
      error: () => this.scheduleLoading.set(false),
    });
    this.api.getPredictionHistory().subscribe({
      next: (h) => {
        this.history.set(h);
        this.historyLoading.set(false);
      },
      error: () => this.historyLoading.set(false),
    });
  }
}
