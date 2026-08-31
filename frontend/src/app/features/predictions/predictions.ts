import { Component, OnInit, HostListener, computed, effect, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import { Prediction, LeaderboardEntry, PredictionSummary, Game, RewardPack } from "../../core/models";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { PageHintComponent } from "../../shared/page-hint";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { SkeletonComponent } from "../../shared/skeleton";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { newsDateLocale, shortDateFormat as gameShortDateFormat, gameDateTimeFormat } from "../../shared/news-date-format";

// Matches schedule.ts — no season picker here either, and predictions
// should only ever be open for the round a user could actually be watching.
const SEASON = "2026-27";

// Mirrors backend/src/services/points.ts's POINTS_PER_CORRECT/
// pointsForCorrectPick exactly — kept as a separate implementation here
// (not fetched) since it's only used to preview a number the backend will
// compute for real once each pick resolves; keep the two in sync if that
// scoring rule ever changes. See that file's doc comment: a correctly-
// picked favorite is always worth the flat POINTS_PER_CORRECT (never
// reduced), a correctly-picked underdog pays that plus a bonus that grows
// the less likely the market thought it was.
const POINTS_PER_CORRECT = 10;
const UNDERDOG_BOOST = 1.5;
const MIN_FAIR_PROB = 0.05;

function pointsForCorrectPick(fairProb: number | null | undefined): number {
  if (fairProb == null || fairProb > 0.5) return POINTS_PER_CORRECT;
  const p = Math.max(MIN_FAIR_PROB, Math.min(0.5, fairProb));
  const raw = POINTS_PER_CORRECT * (1 + (UNDERDOG_BOOST * (0.5 - p)) / 0.5);
  return Math.max(POINTS_PER_CORRECT, Math.round(raw));
}

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

// The "My picks" list's row shape — same fields as Prediction, plus
// isPendingSubmit for a not-yet-submitted local tap. See
// PredictionsComponent.displayedPicks for how these get built.
interface DisplayedPick {
  id: string;
  gameId: string;
  tipoffAt: string;
  status: string;
  predictedTeam: { id: string; code: string; name: string };
  isCorrect: boolean | null;
  isPendingSubmit: boolean;
}

@Component({
  selector: "app-predictions",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    TeamBadgeComponent,
    RetryImgDirective,
    PageHintComponent,
    NavIconComponent,
    SkeletonComponent,
    ButtonDirective,
    LogoSpinnerComponent,
  ],
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
  // Also separate from `loading` — /me/summary (points/badges/reward
  // banners) is a meaningfully heavier request than /me (the picks list
  // `loading` gates): it triggers several reward-check functions that,
  // against this remote DB, add up to several sequential round trips even
  // when nothing new happened (~1-1.5s vs. ~0.4-0.5s for the picks list
  // alone). Without its own gate, the points/badges block simply popped in
  // late above an already-rendered picks list once `loading` had already
  // flipped — same "no skeleton over the gap" issue upcomingGamesLoading
  // exists to avoid, just for this block instead.
  readonly summaryLoading = signal(true);
  // gameId -> predicted team id *as last confirmed by the server* — see
  // pendingPicks below for the user's not-yet-submitted local changes on
  // top of this.
  readonly myPicks = signal<Map<string, string>>(new Map());
  // gameId -> teamId (or null for "explicitly cleared"), for taps not yet
  // sent to the backend. Tapping a team button no longer fires a request
  // per tap — the old immediate POST/DELETE-per-tap meant picking a full
  // round of ~10 games was up to 10 sequential round trips against the
  // remote DB. Instead taps only update this local diff; effectivePicks
  // below layers it over myPicks for display, and submitPredictions() sends
  // the whole diff in one request when the user taps "Complete
  // predictions". Only ever holds genuine differences from myPicks (see
  // togglePick) so hasPendingChanges() is just "is this non-empty".
  readonly pendingPicks = signal<Map<string, string | null>>(new Map());
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly effectivePicks = computed(() => {
    const merged = new Map(this.myPicks());
    for (const [gameId, teamId] of this.pendingPicks()) {
      if (teamId === null) merged.delete(gameId);
      else merged.set(gameId, teamId);
    }
    return merged;
  });
  readonly hasPendingChanges = computed(() => this.pendingPicks().size > 0);

  // The "My picks" list, layering pendingPicks over myPredictions so a tap
  // shows up there immediately instead of only after "Complete predictions"
  // round-trips and the list gets refetched. A new pick (a game not yet in
  // myPredictions at all) is synthesized from upcomingGames, since that's
  // the only place its team info exists before the backend has a
  // Prediction row for it. A pending *clear* just drops the row from the
  // list — same "gone the moment you untap it" feel as the team buttons
  // above already have, rather than showing a "removing" state for
  // something not actually removed yet.
  readonly displayedPicks = computed<DisplayedPick[]>(() => {
    const pending = this.pendingPicks();
    const upcomingById = new Map(this.upcomingGames().map((g) => [g.id, g]));

    const fromServer: DisplayedPick[] = [];
    for (const p of this.myPredictions()) {
      const pendingValue = pending.get(p.gameId);
      if (pendingValue === undefined) {
        fromServer.push({ ...p, isPendingSubmit: false });
        continue;
      }
      if (pendingValue === null) continue; // pending clear — omit
      const game = upcomingById.get(p.gameId);
      const team = game && (pendingValue === game.homeTeam.id ? game.homeTeam : game.awayTeam);
      fromServer.push({
        ...p,
        predictedTeam: team ? { id: team.id, code: team.code, name: team.name } : p.predictedTeam,
        isPendingSubmit: true,
      });
    }

    const serverGameIds = new Set(this.myPredictions().map((p) => p.gameId));
    const brandNew: DisplayedPick[] = [];
    for (const [gameId, teamId] of pending) {
      if (teamId === null || serverGameIds.has(gameId)) continue;
      const game = upcomingById.get(gameId);
      if (!game) continue;
      const team = teamId === game.homeTeam.id ? game.homeTeam : game.awayTeam;
      brandNew.push({
        id: `pending-${gameId}`,
        gameId,
        tipoffAt: game.tipoffAt,
        status: game.status,
        predictedTeam: { id: team.id, code: team.code, name: team.name },
        isCorrect: null,
        isPendingSubmit: true,
      });
    }

    return [...fromServer, ...brandNew].sort((a, b) => new Date(b.tipoffAt).getTime() - new Date(a.tipoffAt).getTime());
  });
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
  // (see ngOnInit's filter below), so any of them with a pick is necessarily
  // still unresolved. Reads effectivePicks (not myPicks) so this updates
  // the instant a pick is tapped, before it's even been submitted — no
  // extra round trip, no waiting for the backend to confirm. Sums each
  // picked game's real odds-weighted value (pointsForCorrectPick, falling
  // back to the flat rate for a game with no odds snapshot yet) rather
  // than a flat per-pick count — an underdog pick now genuinely previews
  // as worth more.
  readonly potentialPoints = computed(() => {
    const picks = this.effectivePicks();
    return this.upcomingGames().reduce((sum, g) => {
      const teamId = picks.get(g.id);
      return teamId ? sum + this.pointsForPick(g, teamId) : sum;
    }, 0);
  });

  // Points a specific pick on `game` would earn if it resolves correct —
  // used both by potentialPoints above and directly in the template to
  // show a value next to each team button, so the odds actually driving
  // the score are visible *before* picking, not just discovered after.
  pointsForPick(game: Game, teamId: string): number {
    const fairProb = teamId === game.homeTeam.id ? game.homeFairProb : game.awayFairProb;
    return pointsForCorrectPick(fairProb);
  }

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
      this.summaryLoading.set(false);
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
        this.summaryLoading.set(false);
      },
      error: () => this.summaryLoading.set(false), // non-critical
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

  // Reads effectivePicks (saved + not-yet-submitted local changes layered
  // on top), not myPicks directly — see pendingPicks' doc comment.
  myPickFor(game: Game): string | null {
    return this.effectivePicks().get(game.id) ?? null;
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

  // The date pipe's "MMM" token only renders in Greek if a Greek locale is
  // explicitly passed as its 4th argument (registered in main.ts) — see
  // shared/news-date-format.ts for the shared day-first-for-Greek convention.
  dateLocale(): string {
    return newsDateLocale(this.i18n.lang());
  }

  shortDateFormat(): string {
    return gameShortDateFormat(this.i18n.lang());
  }

  pickDateFormat(): string {
    return gameDateTimeFormat(this.i18n.lang());
  }

  // Tapping the already-picked team clears the pick instead of re-submitting
  // it — same "tap it again to clear" pattern as the favorite-team picker
  // on Profile, so a mistaken pick doesn't require picking the other team
  // just to undo it. Purely local — no request fires here at all (see
  // pendingPicks' doc comment); only computes the new desired value and
  // records it as a diff against myPicks (or drops the diff entirely if it
  // now matches myPicks again, e.g. tapping a team, then tapping it back
  // off before ever submitting).
  togglePick(game: Game, teamId: string): void {
    if (this.isLocked(game) || !this.auth.isAuthenticated()) return;
    const current = this.myPickFor(game);
    const newValue = current === teamId ? null : teamId;
    const savedValue = this.myPicks().get(game.id) ?? null;

    const pending = new Map(this.pendingPicks());
    if (newValue === savedValue) {
      pending.delete(game.id);
    } else {
      pending.set(game.id, newValue);
    }
    this.pendingPicks.set(pending);

    // Keeps the live-game nav badge accurate mid-session — see the comment
    // on EventsService.markPredicted(). Optimistic (fires on the tap, not
    // once actually submitted), same trade-off as the rest of this local-
    // first flow: worst case an unsubmitted tap leaves the badge marked
    // until the next full picks refresh.
    if (newValue) this.events.markPredicted(game.id);
    else this.events.unmarkPredicted(game.id);
  }

  // Sends every pending tap/clear in one request instead of one per tap —
  // see pendingPicks' doc comment for why. Only called from the "Complete
  // predictions" button, never automatically.
  submitPredictions(): void {
    if (!this.hasPendingChanges() || this.submitting()) return;
    const picks = [...this.pendingPicks().entries()].map(([gameId, teamId]) => ({ gameId, teamId }));

    this.submitting.set(true);
    this.submitError.set(null);
    this.api.submitPredictionsBatch(picks).subscribe({
      next: (res) => {
        this.submitting.set(false);
        const saved = new Map(this.myPicks());
        // Anything the backend rejected (e.g. a game that started while the
        // page was open) stays in remainingPending rather than being
        // treated as saved — the disabled button on that game will reflect
        // isLocked() on next refresh either way, but this keeps the
        // "unsaved changes" state honest in the meantime.
        const remainingPending = new Map<string, string | null>();
        for (const [gameId, teamId] of this.pendingPicks()) {
          if (res.errors?.[gameId]) {
            remainingPending.set(gameId, teamId);
            continue;
          }
          if (teamId === null) saved.delete(gameId);
          else saved.set(gameId, teamId);
        }
        this.myPicks.set(saved);
        this.pendingPicks.set(remainingPending);
        if (res.errors && Object.keys(res.errors).length > 0) {
          this.submitError.set(Object.values(res.errors)[0]);
        }
      },
      error: (err) => {
        this.submitting.set(false);
        this.submitError.set(err?.error?.error ?? "Failed to save your predictions — try again.");
      },
    });
  }

  // A browser refresh/close/back would otherwise silently discard taps that
  // were never submitted — this only covers leaving the tab/page itself
  // (native browser navigation), not clicking to another route within the
  // app, which Angular's router handles without ever firing this event.
  @HostListener("window:beforeunload", ["$event"])
  warnOnUnsavedPicks(event: BeforeUnloadEvent): void {
    if (this.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
}