import { Component, Input, OnInit, computed, inject, signal } from "@angular/core";
import { DecimalPipe } from "@angular/common";
import { forkJoin } from "rxjs";
import { ApiService } from "../core/api.service";
import { I18nService } from "../core/i18n.service";
import { GameTeamSummary, InjuryReportEntry, Player, RosterEntry, TopScorerPrediction } from "../core/models";
import { PlayerPhotoComponent } from "./player-photo";
import { LogoSpinnerComponent } from "./logo-spinner";
import { InjuryBadgeComponent } from "./injury-badge";

interface TopScorerCandidate {
  player: Player;
  pointsPerGame: number | null;
}

// A self-contained "pick this match's top scorer" widget — the same free,
// no-stake pick game-detail.ts's live photo strip already offers, but
// usable from anywhere a gameId/home/away team is at hand (the Predictions
// page's own upcoming-games grid, see predictions.html) rather than only
// from that game's own detail page. Deliberately simpler than
// game-detail.ts's version: no live-points sorting/SSE wiring, since every
// caller of this component today only ever has scheduled (pre-tipoff)
// games on screen, so a lock check isn't needed either — a stale open
// modal that outlives tipoff just gets a normal error back from the
// backend's own isTopScorerPickLocked check on submit.
@Component({
  selector: "app-top-scorer-picker",
  standalone: true,
  imports: [PlayerPhotoComponent, LogoSpinnerComponent, InjuryBadgeComponent, DecimalPipe],
  templateUrl: "./top-scorer-picker.html",
})
export class TopScorerPickerComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  @Input({ required: true }) gameId!: string;
  @Input({ required: true }) homeTeam!: GameTeamSummary;
  @Input({ required: true }) awayTeam!: GameTeamSummary;

  readonly loading = signal(true);
  readonly homeRoster = signal<RosterEntry[]>([]);
  readonly awayRoster = signal<RosterEntry[]>([]);
  readonly myPick = signal<TopScorerPrediction | null>(null);
  readonly savingId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  // League-wide injury report, fetched alongside the rosters (2026-09-24,
  // direct ask: "hide injured players. or just add banner over them" on
  // the Predictions page this component is embedded in) — a player who's
  // definitely "out" is excluded outright (recommending someone who can't
  // play as a top-scorer candidate is just wrong, not merely risky), while
  // the other statuses (doubtful/questionable/probable) still show up but
  // get InjuryBadgeComponent's usual corner badge, same "inform, don't
  // hide" treatment Fantasy Five's own squad/pool rows already use for
  // anyone who might still suit up.
  readonly injuries = signal<InjuryReportEntry[]>([]);
  readonly injuriesByPlayerId = computed(() => new Map(this.injuries().map((i) => [i.playerId, i])));

  injuryFor(playerId: string): InjuryReportEntry | null {
    return this.injuriesByPlayerId().get(playerId) ?? null;
  }

  // stats.pointsPerGame first (real "this season" data once games start),
  // baselinePpg second (2026-09-22, "sort by ppg" — live-tested to find
  // every 2026-27 player tied at null/0 this early, making the sort below
  // a no-op in practice; baselinePpg carries the same season-then-career
  // fallback the top-scorer scoring formula itself already uses).
  private candidatesFor(roster: RosterEntry[]): TopScorerCandidate[] {
    const injured = this.injuriesByPlayerId();
    return roster
      .filter((r) => r.player.active && injured.get(r.player.id)?.status !== "out")
      .map((r) => ({ player: r.player, pointsPerGame: r.stats?.pointsPerGame ?? r.baselinePpg ?? null }))
      .sort((a, b) => (b.pointsPerGame ?? 0) - (a.pointsPerGame ?? 0));
  }

  readonly homeCandidates = computed(() => this.candidatesFor(this.homeRoster()));
  readonly awayCandidates = computed(() => this.candidatesFor(this.awayRoster()));

  ngOnInit(): void {
    forkJoin({
      home: this.api.getRoster(this.homeTeam.id),
      away: this.api.getRoster(this.awayTeam.id),
      pick: this.api.getTopScorerPick(this.gameId),
      injuries: this.api.getInjuries(),
    }).subscribe({
      next: ({ home, away, pick, injuries }) => {
        this.homeRoster.set(home);
        this.awayRoster.set(away);
        this.myPick.set(pick);
        this.injuries.set(injuries);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("topScorer.pickFailed"));
        this.loading.set(false);
      },
    });
  }

  pick(playerId: string): void {
    if (this.savingId()) return;
    this.savingId.set(playerId);
    this.error.set(null);
    this.api.submitTopScorerPick(this.gameId, playerId).subscribe({
      next: (pick) => {
        this.myPick.set(pick);
        this.savingId.set(null);
      },
      error: (err) => {
        this.error.set(err?.error?.error ?? this.i18n.t("topScorer.pickFailed"));
        this.savingId.set(null);
      },
    });
  }
}
