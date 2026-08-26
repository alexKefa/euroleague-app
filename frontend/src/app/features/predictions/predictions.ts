import { Component, OnInit, computed, effect, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { Prediction, LeaderboardEntry, PredictionSummary, Game, RewardPack } from "../../core/models";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { PageHintComponent } from "../../shared/page-hint";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { SkeletonComponent } from "../../shared/skeleton";

// Matches schedule.ts — no season picker here either, and predictions
// should only ever be open for the round a user could actually be watching.
const SEASON = "2026-27";

// Mirrors backend/src/services/points.ts's POINTS_PER_CORRECT — kept as a
// separate constant here (not fetched) since it's only used to preview a
// number the backend will compute for real once each game resolves; keep
// the two in sync if that scoring rule ever changes.
const POINTS_PER_CORRECT = 10;

// Icon glyphs for known badge ids — purely a display concern, the backend
// only sends id/label/description. Unrecognized ids fall back to a medal.
const BADGE_ICONS: Record<string, NavIconName> = {
  "first-call": "sprout",
  "on-a-roll": "flame",
  "perfect-round": "checkmark-shield",
  century: "trophy",
  sharpshooter: "picks",
};

// The full badge catalog (including ones the user hasn't earned yet) for
// the "what do these mean?" legend — hover-only tooltips never reach mobile
// touch, so this is a tap-to-open reference instead, doubling as a preview
// of achievements still to chase. Order matches BADGES in
// backend/src/routes/predictions.ts; ids must match exactly.
const BADGE_CATALOG: { id: string; icon: NavIconName }[] = [
  { id: "first-call", icon: "sprout" },
  { id: "on-a-roll", icon: "flame" },
  { id: "perfect-round", icon: "checkmark-shield" },
  { id: "century", icon: "trophy" },
  { id: "sharpshooter", icon: "picks" },
];

// Appends only the packs not already present (by id) — a summary re-fetch
// while a reward is still unacked server-side would otherwise return the
// same pack again and duplicate it in the shown list.
function mergeById(existing: RewardPack[], incoming: RewardPack[]): RewardPack[] {
  const existingIds = new Set(existing.map((p) => p.id));
  const newOnes = incoming.filter((p) => !existingIds.has(p.id));
  return newOnes.length > 0 ? [...existing, ...newOnes] : existing;
}

@Component({
  selector: "app-predictions",
  standalone: true,
  imports: [CommonModule, RouterLink, TeamBadgeComponent, PageHintComponent, NavIconComponent, SkeletonComponent],
  templateUrl: "./predictions.html",
})
export class PredictionsComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);

  readonly myPredictions = signal<Prediction[]>([]);
  readonly leaderboard = signal<LeaderboardEntry[]>([]);
  readonly mySummary = signal<PredictionSummary | null>(null);
  readonly upcomingGames = signal<Game[]>([]);
  readonly loading = signal(true);
  // Separate from `loading` on purpose — the schedule fetch that populates
  // upcomingGames runs independently of the predictions fetch that gates
  // `loading`, and used to finish later, leaving the Upcoming games card
  // popping in with no skeleton over the gap once `loading` had already
  // flipped false.
  readonly upcomingGamesLoading = signal(true);
  // gameId -> predicted team id, for games the user has already picked
  readonly myPicks = signal<Map<string, string>>(new Map());
  // teamId -> logoUrl — Prediction.predictedTeam doesn't carry a logo (it's
  // a lightweight ref), so it's looked up here for the "My picks" list;
  // upcoming games already have logoUrl on their own team objects.
  readonly teamLogos = signal<Map<string, string | null>>(new Map());
  readonly showBadgeLegend = signal(false);
  readonly badgeCatalog = BADGE_CATALOG;

  // Rewards currently on screen for this page visit — deliberately NOT the
  // same thing as mySummary()!.newRoundRewards/newMilestoneRewards, and
  // only ever added to, never replaced wholesale. refreshMySummary() re-runs
  // on every "a game finished" SSE event, which fires for *any* game, not
  // just ones this user predicted — the live-score simulator ticks games to
  // final every ~96s, so a second summary fetch routinely lands moments
  // after the first. Reading the banner straight off mySummary() meant that
  // second fetch (whose reward had, by then, already been marked seen by
  // the first fetch's own ack call) came back with an empty reward list and
  // wiped a banner the user hadn't even finished reading yet. Accumulating
  // here instead means a shown reward survives for the rest of this visit;
  // a genuinely fresh page load still won't re-show it, since the ack from
  // this visit already landed server-side.
  readonly shownRoundRewards = signal<RewardPack[]>([]);
  readonly shownMilestoneRewards = signal<RewardPack[]>([]);

  // How many points this round's picks are worth if every one of them hits —
  // every game listed in upcomingGames is still "scheduled" by construction
  // (see ngOnInit's filter below), so any of them with a pick in myPicks is
  // necessarily still pending. Recomputes live off the same signals the pick
  // buttons already read, so it updates the instant a pick is toggled —
  // no extra round trip, no waiting for the backend to confirm.
  readonly potentialPoints = computed(() => {
    const picks = this.myPicks();
    const pendingPickCount = this.upcomingGames().filter((g) => picks.has(g.id)).length;
    return pendingPickCount * POINTS_PER_CORRECT;
  });

  constructor() {
    // Live score push, same pattern as schedule.ts: patch the matching
    // game's status/scores in place instead of refetching. This is what
    // actually locks a pick — the moment a game flips off "scheduled" here,
    // isLocked() below disables its buttons, even if the visitor has had
    // this page open since before tipoff and never refreshed.
    effect(() => {
      const update = this.events.lastGameUpdate();
      if (!update) return;
      this.upcomingGames.update((list) =>
        list.map((g) =>
          g.id === update.gameId
            ? { ...g, homeScore: update.homeScore, awayScore: update.awayScore, status: update.status }
            : g
        )
      );

      // A game finishing is what actually changes anything *else* on this
      // page — a pending pick resolves to correct/wrong, badges/points can
      // change, the leaderboard re-ranks. Re-fetching those three here
      // (rather than replicating the backend's badge/point logic
      // client-side) is what makes the rest of the page live too, in this
      // tab or anyone else's — none of it refreshed on its own before,
      // in-tab or across browsers, without a manual reload.
      if (update.status === "final") {
        this.refreshLeaderboard();
        if (this.auth.isAuthenticated()) {
          this.refreshMyPredictions();
          this.refreshMySummary();
        }
      }
    });
  }

  ngOnInit(): void {
    this.api.getTeams().subscribe({
      next: (teams) => this.teamLogos.set(new Map(teams.map((t) => [t.id, t.logoUrl]))),
      error: () => {},
    });

    this.refreshLeaderboard();

    // The current round (backend picks the first round that isn't entirely
    // final yet, same as /schedule) rather than a flat "next 10 scheduled
    // games" — otherwise picks could leak in from a round that hasn't
    // opened yet, or the list could run out mid-round.
    this.api.getSchedule(SEASON).subscribe({
      next: (schedule) => {
        this.upcomingGames.set(schedule.games.filter((g) => g.status === "scheduled"));
        this.upcomingGamesLoading.set(false);
      },
      error: () => this.upcomingGamesLoading.set(false), // non-critical
    });

    if (this.auth.isAuthenticated()) {
      this.refreshMyPredictions(() => this.loading.set(false));
      this.refreshMySummary();
    } else {
      this.loading.set(false);
    }
  }

  private refreshLeaderboard(): void {
    this.api.getLeaderboard().subscribe({
      next: (rows) => this.leaderboard.set(rows),
      error: () => {},
    });
  }

  private refreshMyPredictions(onDone?: () => void): void {
    this.api.getMyPredictions().subscribe({
      next: (rows) => {
        this.myPredictions.set(rows);
        this.myPicks.set(new Map(rows.map((p) => [p.gameId, p.predictedTeam.id])));
        onDone?.();
      },
      error: () => onDone?.(),
    });
  }

  private refreshMySummary(): void {
    this.api.getMyPredictionSummary().subscribe({
      next: (summary) => {
        this.mySummary.set(summary);
        // Merge (by id, keep first-seen) rather than replace — see
        // shownRoundRewards' doc comment for why a later, emptier fetch
        // must not clear what's already being shown.
        if (summary.newRoundRewards.length > 0) {
          this.shownRoundRewards.update((existing) => mergeById(existing, summary.newRoundRewards));
          this.api.ackRoundRewards().subscribe({ error: () => {} });
        }
        if (summary.newMilestoneRewards.length > 0) {
          this.shownMilestoneRewards.update((existing) => mergeById(existing, summary.newMilestoneRewards));
          this.api.ackMilestoneRewards().subscribe({ error: () => {} });
        }
      },
      error: () => {}, // non-critical
    });
  }

  // shownRoundRewards can mix a perfect round's legendary pack with a
  // "great" round's rare pack (see backend/src/services/cards.ts) — split
  // by tier so the template can show each with its own wording instead of
  // assuming every round reward is a legendary.
  perfectRoundRewards(): RewardPack[] {
    return this.shownRoundRewards().filter((p) => p.tier === "legendary");
  }

  greatRoundRewards(): RewardPack[] {
    return this.shownRoundRewards().filter((p) => p.tier === "rare");
  }

  badgeIcon(badgeId: string): NavIconName {
    return BADGE_ICONS[badgeId] ?? "medal";
  }

  isEarned(badgeId: string): boolean {
    return this.mySummary()?.badges.some((b) => b.id === badgeId) ?? false;
  }

  badgeLabel(id: string): string {
    return this.i18n.t(`predictions.badge.${id}.label`);
  }

  badgeDescription(id: string): string {
    return this.i18n.t(`predictions.badge.${id}.description`);
  }

  myPickFor(game: Game): string | null {
    return this.myPicks().get(game.id) ?? null;
  }

  // Once a game leaves "scheduled" (live or final), picks are closed —
  // matches the backend's own validation, but locking the button here too
  // means a visitor sees why immediately instead of tapping a team and
  // having it silently roll back.
  isLocked(game: Game): boolean {
    return game.status !== "scheduled";
  }

  teamLogo(teamId: string): string | null {
    return this.teamLogos().get(teamId) ?? null;
  }

  // Tapping the already-picked team clears the pick instead of re-submitting
  // it — same "tap it again to clear" pattern as the favorite-team picker
  // on Profile, so a mistaken pick doesn't require picking the other team
  // just to undo it.
  togglePick(game: Game, teamId: string): void {
    if (this.isLocked(game)) return;
    if (this.myPickFor(game) === teamId) {
      this.clearPick(game);
    } else {
      this.predict(game, teamId);
    }
  }

  private predict(game: Game, teamId: string): void {
    if (!this.auth.isAuthenticated()) return;
    // Optimistic update — the backend still validates and is the source of truth.
    const map = new Map(this.myPicks());
    map.set(game.id, teamId);
    this.myPicks.set(map);
    // Keeps the live-game nav badge accurate mid-session — see the comment
    // on EventsService.markPredicted().
    this.events.markPredicted(game.id);

    this.api.submitPrediction(game.id, teamId).subscribe({
      error: () => {
        // Roll back on failure (e.g. game started in the meantime).
        const rollback = new Map(this.myPicks());
        rollback.delete(game.id);
        this.myPicks.set(rollback);
        this.events.unmarkPredicted(game.id);
      },
    });
  }

  private clearPick(game: Game): void {
    if (!this.auth.isAuthenticated()) return;
    const previousTeamId = this.myPickFor(game);
    if (!previousTeamId) return;

    // Optimistic update, same pattern as predict() — roll back to the prior
    // pick if the backend rejects it (e.g. the game started in the meantime).
    const map = new Map(this.myPicks());
    map.delete(game.id);
    this.myPicks.set(map);
    this.events.unmarkPredicted(game.id);

    this.api.removePrediction(game.id).subscribe({
      error: () => {
        const rollback = new Map(this.myPicks());
        rollback.set(game.id, previousTeamId);
        this.myPicks.set(rollback);
        this.events.markPredicted(game.id);
      },
    });
  }
}