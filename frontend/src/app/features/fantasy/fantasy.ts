import { Component, HostListener, OnInit, inject, signal, computed, effect, WritableSignal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { DragDropModule, CdkDragDrop } from "@angular/cdk/drag-drop";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { EventsService } from "../../core/events.service";
import {
  FantasyPlayerRow,
  FantasyCoachRow,
  FantasyLeaderboardEntry,
  FantasySlotRole,
  League,
  Game,
  GameTeamSummary,
  PlayerGameLogEntry,
} from "../../core/models";
import { PlayerPhotoComponent } from "../../shared/player-photo";
import { TeamBadgeComponent } from "../../shared/team-badge";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SearchInputComponent } from "../../shared/search-input";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { CollectibleCardComponent } from "../store/collectible-card";
import { CourtBackgroundComponent } from "../../shared/court-background";

// Squad shape — mirrors backend/src/services/fantasyScoring.ts's constants
// exactly (kept in sync by hand, same as e.g. analytics-builder.ts keeping
// its own COLUMNS copy in sync with /stats — see that file's comment).
export const FANTASY_STARTER_COUNT = 5;
export const FANTASY_SIXTH_MAN_COUNT = 1;
export const FANTASY_BENCH_COUNT = 4;
export const FANTASY_BUDGET_CAP = 100;
export const FANTASY_POSITION_QUOTA: Record<"Guard" | "Forward" | "Center", number> = {
  Guard: 4,
  Forward: 4,
  Center: 2,
};

const PAGE_SIZE = 40;

// Every popup (player-info, slot-picker, coach-picker) mounts hidden, flips
// to its "shown" CSS state a frame later so the entrance transition
// actually plays, and un-mounts this long after being told to close so the
// exit transition gets to play too instead of the element just vanishing —
// see openPicker/closePicker (and the info/coach equivalents) below. Must
// match the `duration-200` Tailwind class used on these popups in
// fantasy.html.
const POPUP_CLOSE_MS = 200;

type SortKey = "name" | "price" | "pointsPerGame" | "valuation";
type PositionFilter = "Guard" | "Forward" | "Center" | null;
type PositionName = "Guard" | "Forward" | "Center";

interface SquadSlot {
  id: string;
  role: FantasySlotRole;
  playerId: string | null;
}

// Starting-five formation — which of the 5 starter slots (by index;
// squadSlots()[0..4] are always the starters, see initialSquadSlots below)
// requires which real position. Purely a frontend affordance: the backend
// (routes/fantasy.ts) only enforces the *overall* 4G/4F/2C quota across
// all 10 outfield players, never a per-slot position, so changing
// formation never touches the submit contract — it just changes which
// slot a given player is allowed to occupy on this screen.
export type Formation = "2-2-1" | "2-1-2" | "3-1-1" | "1-2-2" | "1-3-1";
const FORMATION_OPTIONS: Formation[] = ["2-2-1", "2-1-2", "3-1-1", "1-2-2", "1-3-1"];
const FORMATION_POSITIONS: Record<Formation, PositionName[]> = {
  "2-2-1": ["Guard", "Guard", "Forward", "Forward", "Center"],
  "2-1-2": ["Guard", "Guard", "Forward", "Center", "Center"],
  "3-1-1": ["Guard", "Guard", "Guard", "Forward", "Center"],
  "1-2-2": ["Guard", "Forward", "Forward", "Center", "Center"],
  "1-3-1": ["Guard", "Forward", "Forward", "Forward", "Center"],
};
// Cosmetic court layout: Centers sit nearest the basket (largest top%),
// Guards furthest out — the real per-formation counts decide how many
// share a row and how they spread horizontally. Recalibrated 2026-09-06
// alongside court-background.ts's taller viewBox (see that file's comment)
// — these are the same absolute on-court positions as before (just past
// the top of the key for Center, around the free-throw line for Forward,
// out past the arc for Guard), re-expressed as percentages of the new
// taller box so they land in the same real spots rather than drifting
// down onto the rim the way the old percentages did once the box grew
// without the court art growing to match.
const ROW_TOP: Record<PositionName, number> = { Guard: 45, Forward: 65, Center: 85 };
function rowXPositions(count: number): number[] {
  if (count === 1) return [50];
  if (count === 2) return [30, 70];
  return [18, 50, 82];
}

function initialSquadSlots(): SquadSlot[] {
  const slots: SquadSlot[] = [];
  for (let i = 0; i < FANTASY_STARTER_COUNT; i++) slots.push({ id: `starter-${i}`, role: "starter", playerId: null });
  for (let i = 0; i < FANTASY_SIXTH_MAN_COUNT; i++) slots.push({ id: `sixthman-${i}`, role: "sixth_man", playerId: null });
  for (let i = 0; i < FANTASY_BENCH_COUNT; i++) slots.push({ id: `bench-${i}`, role: "bench", playerId: null });
  return slots;
}

interface OpponentInfo {
  opponent: GameTeamSummary;
  isHome: boolean;
}

@Component({
  selector: "app-fantasy",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DragDropModule,
    PlayerPhotoComponent,
    TeamBadgeComponent,
    DropdownComponent,
    SearchInputComponent,
    ButtonDirective,
    ChipDirective,
    SkeletonComponent,
    CollectibleCardComponent,
    CourtBackgroundComponent,
  ],
  templateUrl: "./fantasy.html",
  styleUrl: "./fantasy.css",
})
export class FantasyComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private events = inject(EventsService);

  readonly starterCount = FANTASY_STARTER_COUNT;
  readonly budgetCap = FANTASY_BUDGET_CAP;
  readonly positionQuota = FANTASY_POSITION_QUOTA;
  readonly formationOptions = FORMATION_OPTIONS;
  readonly formation = signal<Formation>("2-2-1");

  readonly tab = signal<"roster" | "leaderboard">("roster");

  // --- Roster builder state ---
  readonly loading = signal(true);
  readonly allRows = signal<FantasyPlayerRow[]>([]);
  readonly coaches = signal<FantasyCoachRow[]>([]);
  readonly season = signal<string | null>(null);
  readonly round = signal<number | null>(null);
  readonly lockAt = signal<string | null>(null);
  readonly coachLocked = signal(false);
  readonly lockedPlayerIds = signal<Set<string>>(new Set());

  // Last-confirmed-by-server state, so hasChanges can tell a fresh edit
  // apart from re-loading the same squad.
  private serverSlotByPlayerId = signal<Map<string, FantasySlotRole>>(new Map());
  private serverCaptainId = signal<string | null>(null);
  private serverCoachTeamId = signal<string | null>(null);

  readonly squadSlots = signal<SquadSlot[]>(initialSquadSlots());
  readonly captainId = signal<string | null>(null);
  readonly coachTeamId = signal<string | null>(null);

  // Every drop list (the pool + all 10 squad slots) is connected to every
  // other one, by id string — CDK's drop-list registry is global, so this
  // works even though the pool and the slots aren't nested under a common
  // parent in the template.
  readonly dropListIds = ["pool", ...initialSquadSlots().map((s) => s.id)];

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);
  readonly positionFilter = signal<PositionFilter>(null);
  readonly sortKey = signal<SortKey>("price");
  readonly sortDesc = signal(true);
  readonly visibleCount = signal(PAGE_SIZE);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly saved = signal(false);

  // --- Matchup preview ---
  readonly fixtureGames = signal<Game[]>([]);
  readonly opponentByTeamId = signal<Map<string, OpponentInfo>>(new Map());
  readonly showFixtures = signal(false);
  readonly showFormationPicker = signal(false);

  // --- Live/final round-game awareness — "what is my squad doing right
  // now". fixtureGames' own `status`/score fields are kept fresh in place
  // (see the effect below) via EventsService's shared SSE stream — the
  // same one the nav's live-game badge and dashboard already use — rather
  // than this component polling on its own timer. gameForTeam is a plain
  // lookup off fixtureGames (not a separate fetch) so it always agrees
  // with whatever the Fixtures popup is showing.
  readonly gameForTeam = computed(() => {
    const map = new Map<string, Game>();
    for (const g of this.fixtureGames()) {
      map.set(g.homeTeam.id, g);
      map.set(g.awayTeam.id, g);
    }
    return map;
  });
  readonly liveGamesThisRound = computed(() => this.fixtureGames().filter((g) => g.status === "live"));
  readonly hasLiveGameThisRound = computed(() => this.liveGamesThisRound().length > 0);

  // Per-player PIR for this round's live/final games, fetched from the
  // same per-game box score the game-detail page already reads
  // (GET /games/:id — routes/games.ts computes it for status "live" too,
  // not just "final", so this needs no backend change at all). Keyed by
  // player id so any squad member's slot can look theirs up directly.
  readonly roundPirByPlayerId = signal<Map<string, number | null>>(new Map());

  // Keeps fixtureGames' status/score current and refreshes the relevant
  // game's box score whenever the shared SSE stream ticks for a game that
  // belongs to this round — effects run in the injection context a field
  // initializer runs in, so this is safe to declare here rather than in
  // ngOnInit; it just does nothing until fixtureGames has any games in it.
  // Only tracks `lastGameUpdate()` — reading `fixtureGames()` via its
  // tracked getter and writing back to it in the same effect would make the
  // effect depend on its own output, so every write (a new array/object
  // reference each time) schedules another run with no way to settle, an
  // infinite loop for as long as a live game keeps ticking (same pitfall
  // documented on game-detail.ts's equivalent effect). `.update()`'s read
  // of the current value isn't tracked, so it's safe.
  private readonly liveUpdatesEffect = effect(() => {
    const update = this.events.lastGameUpdate();
    if (!update) return;

    let matched = false;
    this.fixtureGames.update((games) => {
      const idx = games.findIndex((g) => g.id === update.gameId);
      if (idx === -1) return games;
      matched = true;
      const next = [...games];
      next[idx] = {
        ...next[idx],
        status: update.status,
        homeScore: update.homeScore,
        awayScore: update.awayScore,
        quarter: update.quarter ?? next[idx].quarter,
        gameClockSeconds: update.gameClockSeconds ?? next[idx].gameClockSeconds,
      };
      return next;
    });
    if (matched && (update.status === "live" || update.status === "final")) this.refreshRoundBoxscore(update.gameId);
  });

  private refreshRoundBoxscore(gameId: string): void {
    this.api.getGame(gameId).subscribe({
      next: (detail) => {
        const lines = [...(detail.boxscore?.home ?? []), ...(detail.boxscore?.away ?? [])];
        this.roundPirByPlayerId.update((map) => {
          const next = new Map(map);
          for (const line of lines) next.set(line.player.id, line.valuation);
          return next;
        });
      },
      error: () => {}, // non-critical — the slot just falls back to showing the opponent instead
    });
  }

  roundPir(playerId: string): number | null | undefined {
    return this.roundPirByPlayerId().get(playerId);
  }

  // --- Player-info popup — tapping a player (in the pool or on the court)
  // shows this instead of navigating away to their full detail page, so
  // building a squad never loses its in-progress state. Reuses the same
  // GET /players/:id/games the real player-detail page already calls
  // (player-detail.ts) — no new backend endpoint needed — trimmed to the
  // 5 most recent rows client-side (the endpoint has no `limit` param,
  // returns the whole season's rows most-recent-first).
  readonly infoPlayerId = signal<string | null>(null);
  readonly infoVisible = signal(false);
  readonly infoLoading = signal(false);
  readonly infoGameLog = signal<PlayerGameLogEntry[]>([]);
  private infoCloseTimer?: ReturnType<typeof setTimeout>;

  readonly infoPlayerRow = computed(() => {
    const id = this.infoPlayerId();
    return id ? this.rowById().get(id) ?? null : null;
  });

  // --- Slot-picker popup — tapping an empty court/bench/sixth-man slot
  // opens this instead of requiring a drag from a pool that isn't always
  // on screen (mobile hides the persistent pool column entirely — see
  // fantasy.html's two-column comment — since there's no way to drag
  // while scrolling, so keeping a pool half-visible would be worse than
  // not showing it at all). Reuses the exact same search/team/position/
  // sort filter state and `rows()`/`visibleRows()` the (still-present,
  // desktop-only) pool column reads — a starter slot additionally pins
  // positionFilter to its own required position for the picker's
  // duration, since only a matching-position player could ever be
  // dropped there anyway (see slotAcceptsPlayer).
  readonly pickerSlotId = signal<string | null>(null);
  readonly pickerVisible = signal(false);
  private pickerCloseTimer?: ReturnType<typeof setTimeout>;

  readonly pickerSlot = computed(() => {
    const id = this.pickerSlotId();
    return id ? this.squadSlots().find((s) => s.id === id) ?? null : null;
  });

  readonly pickerRequiredPosition = computed<PositionName | null>(() => {
    const slot = this.pickerSlot();
    if (!slot) return null;
    const idx = this.squadSlots().findIndex((s) => s.id === slot.id);
    return idx !== -1 && idx < this.starterCount ? this.requiredPositionForStarterSlot(idx) : null;
  });

  // --- Coach-picker popup — the coach equivalent of the slot-picker above.
  // Coaches used to sit in a permanently-visible horizontal strip on the
  // roster page; that's gone now (see the Coach slot in fantasy.html) in
  // favor of a single tappable slot next to the sixth-man/bench block that
  // opens this popup, freeing up the vertical space the strip used to cost
  // on every visit regardless of whether a coach was being changed.
  readonly coachPickerOpen = signal(false);
  readonly coachPickerVisible = signal(false);
  private coachPickerCloseTimer?: ReturnType<typeof setTimeout>;

  // --- Swap popup — a tap-driven alternative to dragging a squad member
  // between the active group (starter + sixth man, both score 100%) and
  // the bench (scores BENCH_SCORE_MULTIPLIER). Dragging one squad slot
  // onto another already does this (see onDrop) and still works — this is
  // just a discoverable, non-drag path to the exact same outcome, reached
  // via a small swap badge on every unlocked squad-slot avatar. Real rules
  // let this happen for any not-yet-"turned" player even after some of the
  // round's other games have started (see getTeamRoundGameTipoff on the
  // backend) — swapCandidates below excludes anyone `isLocked()`, the same
  // guard every other squad-editing action already uses, so this
  // automatically respects that per-player, per-game-day window with no
  // extra date logic needed on the frontend.
  readonly swapPlayerId = signal<string | null>(null);
  readonly swapVisible = signal(false);
  private swapCloseTimer?: ReturnType<typeof setTimeout>;

  readonly swapPlayerRow = computed(() => {
    const id = this.swapPlayerId();
    return id ? this.rowById().get(id) ?? null : null;
  });

  // Swapping always crosses the active/bench line: a starter or sixth-man
  // swaps with a bench occupant, a bench player swaps into the starter/
  // sixth-man group. slotAcceptsPlayer is checked both ways since either
  // side of the swap could be landing in a position-gated starter slot.
  readonly swapCandidates = computed(() => {
    const id = this.swapPlayerId();
    if (!id) return [];
    const slots = this.squadSlots();
    const sourceSlot = slots.find((s) => s.playerId === id);
    if (!sourceSlot) return [];
    const wantsBench = sourceSlot.role !== "bench";
    const byId = this.rowById();
    return slots
      .filter(
        (s) =>
          s.playerId &&
          s.playerId !== id &&
          !this.isLocked(s.playerId) &&
          (s.role === "bench") === wantsBench &&
          this.slotAcceptsPlayer(s.id, id) &&
          this.slotAcceptsPlayer(sourceSlot.id, s.playerId!)
      )
      .map((s) => ({ slotId: s.id, row: byId.get(s.playerId!)! }));
  });

  readonly rowById = computed(() => new Map(this.allRows().map((r) => [r.player.id, r])));
  readonly coachByTeamId = computed(() => new Map(this.coaches().map((c) => [c.team.id, c])));

  readonly selectedCoach = computed(() => {
    const id = this.coachTeamId();
    return id ? this.coachByTeamId().get(id) ?? null : null;
  });

  readonly selectedPlayerIds = computed(
    () => new Set(this.squadSlots().map((s) => s.playerId).filter((id): id is string => id !== null))
  );

  readonly starterSlots = computed(() => this.squadSlots().filter((s) => s.role === "starter"));
  readonly sixthManSlot = computed(() => this.squadSlots().find((s) => s.role === "sixth_man")!);
  readonly benchSlots = computed(() => this.squadSlots().filter((s) => s.role === "bench"));

  // Cosmetic court coordinates for the 5 starter slots, derived from the
  // chosen formation — see FORMATION_POSITIONS/ROW_TOP above.
  readonly starterSlotPositions = computed(() => {
    const positions = FORMATION_POSITIONS[this.formation()];
    const totalByPos: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (const p of positions) totalByPos[p]++;
    const seenByPos: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
    return positions.map((pos) => {
      const xs = rowXPositions(totalByPos[pos]);
      const left = xs[seenByPos[pos]];
      seenByPos[pos]++;
      return { left, top: ROW_TOP[pos] };
    });
  });

  readonly positionCounts = computed(() => {
    const byId = this.rowById();
    const counts: Record<string, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (const id of this.selectedPlayerIds()) {
      const position = byId.get(id)?.player.position;
      if (position && position in counts) counts[position]++;
    }
    return counts as Record<"Guard" | "Forward" | "Center", number>;
  });

  readonly positionQuotaMet = computed(() => {
    const counts = this.positionCounts();
    return (Object.keys(this.positionQuota) as (keyof typeof FANTASY_POSITION_QUOTA)[]).every(
      (pos) => counts[pos] === this.positionQuota[pos]
    );
  });

  readonly totalCost = computed(() => {
    const byId = this.rowById();
    let sum = 0;
    for (const id of this.selectedPlayerIds()) sum += byId.get(id)?.price ?? 0;
    const coachId = this.coachTeamId();
    if (coachId) sum += this.coachByTeamId().get(coachId)?.price ?? 0;
    return sum;
  });

  readonly overBudget = computed(() => this.totalCost() > this.budgetCap);

  readonly squadFull = computed(() => this.squadSlots().every((s) => s.playerId !== null));

  readonly hasChanges = computed(() => {
    const serverSlots = this.serverSlotByPlayerId();
    const currentSlots = this.squadSlots();
    if (currentSlots.filter((s) => s.playerId).length !== serverSlots.size) return true;
    for (const s of currentSlots) {
      if (s.playerId && serverSlots.get(s.playerId) !== s.role) return true;
    }
    if (this.captainId() !== this.serverCaptainId()) return true;
    if (this.coachTeamId() !== this.serverCoachTeamId()) return true;
    return false;
  });

  readonly canSubmit = computed(
    () =>
      this.hasChanges() &&
      this.squadFull() &&
      this.positionQuotaMet() &&
      this.captainId() !== null &&
      this.coachTeamId() !== null &&
      !this.overBudget()
  );

  readonly teamDropdownOptions = computed<DropdownOption[]>(() => {
    const seen = new Map<string, DropdownOption>();
    for (const row of this.allRows()) {
      if (!seen.has(row.team.id)) {
        seen.set(row.team.id, { value: row.team.id, label: row.team.name, logoUrl: row.team.logoUrl });
      }
    }
    return [
      { value: "", label: this.i18n.t("fantasy.allTeams") },
      ...[...seen.values()].sort((a, b) => a.label.localeCompare(b.label)),
    ];
  });

  // The filtered/sorted/searched pool, minus whoever's already placed in
  // the squad — the squad and the pool are two views over the same rows,
  // never overlapping.
  readonly rows = computed<FantasyPlayerRow[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const team = this.teamFilter();
    const position = this.positionFilter();
    const inSquad = this.selectedPlayerIds();
    const key = this.sortKey();
    const desc = this.sortDesc();

    const filtered = this.allRows().filter((row) => {
      if (inSquad.has(row.player.id)) return false;
      if (query && !row.player.name.toLowerCase().includes(query)) return false;
      if (team && row.team.id !== team) return false;
      if (position && row.player.position !== position) return false;
      return true;
    });

    const getVal = (r: FantasyPlayerRow): number | string | null => {
      switch (key) {
        case "name":
          return r.player.name;
        case "price":
          return r.price;
        case "pointsPerGame":
          return r.pointsPerGame;
        case "valuation":
          return r.valuation;
      }
    };

    return [...filtered].sort((a, b) => {
      const av = getVal(a);
      const bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  });

  readonly visibleRows = computed(() => this.rows().slice(0, this.visibleCount()));
  readonly hasMoreRows = computed(() => this.visibleCount() < this.rows().length);

  // --- Leaderboard state ---
  readonly globalLeaderboard = signal<FantasyLeaderboardEntry[]>([]);
  readonly myLeagues = signal<League[]>([]);
  readonly selectedLeagueId = signal<string | null>(null);
  readonly leagueLeaderboard = signal<FantasyLeaderboardEntry[]>([]);
  readonly leaderboardLoading = signal(false);
  readonly selectedEntry = signal<FantasyLeaderboardEntry | null>(null);

  readonly leagueDropdownOptions = computed<DropdownOption[]>(() =>
    this.myLeagues().map((l) => ({ value: l.id, label: l.name }))
  );

  readonly activeLeaderboard = computed(() =>
    this.selectedLeagueId() ? this.leagueLeaderboard() : this.globalLeaderboard()
  );

  ngOnInit(): void {
    this.api.getFantasyPlayers().subscribe({
      next: (res) => {
        this.season.set(res.season);
        this.allRows.set(res.rows);
        this.loading.set(false);
        this.reconcileStarterFormation();
      },
      error: () => this.loading.set(false),
    });

    this.api.getFantasyCoaches().subscribe({
      next: (res) => this.coaches.set(res.rows),
      error: () => {},
    });

    if (this.auth.isAuthenticated()) {
      this.loadLineup();
      this.api.getMyLeagues().subscribe({
        next: (rows) => this.myLeagues.set(rows),
        error: () => {},
      });
    }

    this.api.getFantasyLeaderboard().subscribe({
      next: (rows) => this.globalLeaderboard.set(rows),
      error: () => {},
    });
  }

  // A saved lineup's 5 starters were placed into slots 0..4 in whatever
  // order the DB happened to return them, with no formation recorded
  // anywhere server-side — so right after a load, the formation picker's
  // default and the court's row layout may not match the real position
  // mix that's actually sitting in those slots. Re-derives the formation
  // from the loaded starters' own positions (once player rows are known)
  // and re-seats them into the slot each formation expects for their
  // position, so the picker and the court agree with reality from the
  // first render — not just after the user taps a formation button
  // themselves. A mix that doesn't match any of the 3 known formations
  // (e.g. a lineup saved before this feature existed) is left untouched.
  private reconcileStarterFormation(): void {
    const byId = this.rowById();
    if (byId.size === 0) return;
    const slots = [...this.squadSlots()];
    const starterIds = slots.slice(0, this.starterCount).map((s) => s.playerId);
    if (starterIds.some((id) => id === null)) return;

    const positions: PositionName[] = [];
    for (const id of starterIds) {
      const pos = byId.get(id!)?.player.position;
      if (pos !== "Guard" && pos !== "Forward" && pos !== "Center") return;
      positions.push(pos);
    }

    const counts: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (const p of positions) counts[p]++;

    const matched = FORMATION_OPTIONS.find((f) => {
      const need: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
      for (const p of FORMATION_POSITIONS[f]) need[p]++;
      return need.Guard === counts.Guard && need.Forward === counts.Forward && need.Center === counts.Center;
    });
    if (!matched) return;

    const byPosition: Record<PositionName, string[]> = { Guard: [], Forward: [], Center: [] };
    for (let i = 0; i < this.starterCount; i++) byPosition[positions[i]].push(starterIds[i]!);

    const requiredPositions = FORMATION_POSITIONS[matched];
    for (let i = 0; i < this.starterCount; i++) {
      slots[i] = { ...slots[i], playerId: byPosition[requiredPositions[i]].shift()! };
    }

    this.formation.set(matched);
    this.squadSlots.set(slots);
  }

  private loadLineup(): void {
    this.api.getFantasyLineup().subscribe({
      next: (lineup) => {
        this.season.set(lineup.season);
        this.round.set(lineup.round);
        this.lockAt.set(lineup.lockAt);
        this.coachLocked.set(lineup.coachLocked);
        this.lockedPlayerIds.set(new Set(lineup.players.filter((p) => p.locked).map((p) => p.playerId)));

        const slots = initialSquadSlots();
        const roleCounters: Record<FantasySlotRole, number> = { starter: 0, sixth_man: 0, bench: 0 };
        const serverMap = new Map<string, FantasySlotRole>();
        let captain: string | null = null;
        for (const p of lineup.players) {
          serverMap.set(p.playerId, p.slotRole);
          if (p.isCaptain) captain = p.playerId;
          const idx = slots.findIndex((s) => s.role === p.slotRole && s.playerId === null);
          if (idx !== -1) slots[idx] = { ...slots[idx], playerId: p.playerId };
          roleCounters[p.slotRole]++;
        }
        this.squadSlots.set(slots);
        this.serverSlotByPlayerId.set(serverMap);
        this.captainId.set(captain);
        this.serverCaptainId.set(captain);
        this.coachTeamId.set(lineup.coachTeamId);
        this.serverCoachTeamId.set(lineup.coachTeamId);
        this.reconcileStarterFormation();

        if (lineup.season && lineup.round !== null) {
          this.loadFixtures(lineup.season, lineup.round);
        }
      },
      error: () => {},
    });
  }

  private loadFixtures(season: string, round: number): void {
    this.api.getSchedule(season, round).subscribe({
      next: (schedule) => {
        this.fixtureGames.set(schedule.games);
        const map = new Map<string, OpponentInfo>();
        for (const g of schedule.games) {
          map.set(g.homeTeam.id, { opponent: g.awayTeam, isHome: true });
          map.set(g.awayTeam.id, { opponent: g.homeTeam, isHome: false });
          // Games that were already live or final by the time this page
          // loaded (as opposed to going live while it stays open, which
          // the liveUpdatesEffect above handles) still need their box
          // score fetched at least once — the SSE stream only ticks on
          // the *next* change, it doesn't replay past ones.
          if (g.status === "live" || g.status === "final") this.refreshRoundBoxscore(g.id);
        }
        this.opponentByTeamId.set(map);
      },
      error: () => {},
    });
  }

  opponentFor(teamId: string): OpponentInfo | null {
    return this.opponentByTeamId().get(teamId) ?? null;
  }

  // Which side of a past game log entry was the opponent, from the
  // currently-open info popup's own player's team — mirrors opponentFor's
  // isHome/opponent shape but reads it off a specific finished game
  // instead of this round's upcoming fixture list.
  opponentForLogEntry(entry: PlayerGameLogEntry): OpponentInfo {
    const myTeamId = this.infoPlayerRow()?.team.id;
    return entry.game.homeTeam.id === myTeamId
      ? { opponent: entry.game.awayTeam, isHome: true }
      : { opponent: entry.game.homeTeam, isHome: false };
  }

  slotByRoleIndex(role: FantasySlotRole, index: number): SquadSlot {
    return this.squadSlots().filter((s) => s.role === role)[index];
  }

  requiredPositionForStarterSlot(index: number): PositionName {
    return FORMATION_POSITIONS[this.formation()][index];
  }

  posLabel(pos: PositionName): string {
    switch (pos) {
      case "Guard":
        return this.i18n.t("fantasy.posGuard");
      case "Forward":
        return this.i18n.t("fantasy.posForward");
      case "Center":
        return this.i18n.t("fantasy.posCenter");
    }
  }

  posAbbrev(position: string | null): string {
    switch (position) {
      case "Guard":
        return this.i18n.t("fantasy.posGuardAbbrev");
      case "Forward":
        return this.i18n.t("fantasy.posForwardAbbrev");
      case "Center":
        return this.i18n.t("fantasy.posCenterAbbrev");
      default:
        return "";
    }
  }

  // Bench/sixth-man/pool never gate on position — only a starter slot
  // (squadSlots()[0..4]) requires the player it holds to match that
  // index's formation-assigned position.
  slotAcceptsPlayer(slotId: string, playerId: string): boolean {
    const idx = this.squadSlots().findIndex((s) => s.id === slotId);
    if (idx === -1 || idx >= this.starterCount) return true;
    return this.rowById().get(playerId)?.player.position === this.requiredPositionForStarterSlot(idx);
  }

  // Changing formation can strand a starter whose real position no longer
  // matches their slot's new requirement — never touches a locked player
  // (their round has already started). A stranded starter is parked in
  // the first empty bench/sixth-man slot if one's free, otherwise dropped
  // back to the pool entirely; either way they lose the captain armband
  // if they held it, since only a starter can be captain.
  setFormation(next: Formation): void {
    if (this.formation() === next) return;
    const newPositions = FORMATION_POSITIONS[next];
    const byId = this.rowById();
    const slots = [...this.squadSlots()];
    for (let i = 0; i < this.starterCount; i++) {
      const slot = slots[i];
      if (!slot.playerId || this.isLocked(slot.playerId)) continue;
      if (byId.get(slot.playerId)?.player.position === newPositions[i]) continue;
      const displacedId = slot.playerId;
      slots[i] = { ...slot, playerId: null };
      const parkIdx = slots.findIndex((s, idx) => idx >= this.starterCount && s.playerId === null);
      if (parkIdx !== -1) slots[parkIdx] = { ...slots[parkIdx], playerId: displacedId };
      if (this.captainId() === displacedId) this.captainId.set(null);
    }
    this.formation.set(next);
    this.squadSlots.set(slots);
    this.saved.set(false);
  }

  chooseFormation(next: Formation): void {
    this.setFormation(next);
    this.showFormationPicker.set(false);
  }

  // Infinite-scroll the pool instead of a "show more" button — same
  // pattern as the league-wide advanced-stats table.
  onPoolScroll(event: Event): void {
    if (!this.hasMoreRows()) return;
    const el = event.target as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) this.showMore();
  }

  setTab(tab: "roster" | "leaderboard"): void {
    this.tab.set(tab);
  }

  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDesc.update((d) => !d);
    } else {
      this.sortKey.set(key);
      this.sortDesc.set(true);
    }
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.visibleCount.set(PAGE_SIZE);
  }

  setTeamFilter(value: string | null): void {
    this.teamFilter.set(value || null);
    this.visibleCount.set(PAGE_SIZE);
  }

  setPositionFilter(position: PositionFilter): void {
    this.positionFilter.set(this.positionFilter() === position ? null : position);
    this.visibleCount.set(PAGE_SIZE);
  }

  showMore(): void {
    this.visibleCount.update((n) => n + PAGE_SIZE);
  }

  isLocked(playerId: string): boolean {
    return this.lockedPlayerIds().has(playerId);
  }

  // Tap fallback, alongside dragging — CDK's cdkDrag only intercepts an
  // actual pointer move past its drag threshold, so a stationary tap on the
  // price chip still fires this normally rather than fighting the drag
  // gesture. Tapping a pool player's name/photo instead opens their player
  // page (a plain [routerLink] in the template, no handler needed) — price
  // is the "add" affordance, the rest of the row is "info". Fills the
  // starting five first (matching the chosen formation's per-slot position,
  // same gating as onDrop/the old toggle()), then the sixth-man slot, then
  // the bench — a starter/sixth-man promotion used to require a deliberate
  // drag; now it's the default since tapping price is the primary way to
  // build a squad.
  addToSquad(playerId: string): void {
    const slots = [...this.squadSlots()];
    const starterIdx = slots.findIndex(
      (s, idx) => idx < this.starterCount && s.playerId === null && this.slotAcceptsPlayer(s.id, playerId)
    );
    const sixthManIdx = starterIdx !== -1 ? -1 : slots.findIndex((s) => s.role === "sixth_man" && s.playerId === null);
    const benchIdx =
      starterIdx !== -1 || sixthManIdx !== -1 ? -1 : slots.findIndex((s) => s.role === "bench" && s.playerId === null);
    const targetIdx = starterIdx !== -1 ? starterIdx : sixthManIdx !== -1 ? sixthManIdx : benchIdx;
    if (targetIdx === -1) return; // squad already full, or no formation-matching starter slot left
    slots[targetIdx] = { ...slots[targetIdx], playerId };
    this.squadSlots.set(slots);
    this.saved.set(false);
  }

  // Clears a placed player's slot — the small "x" badge on a squad-slot
  // avatar, now that tapping the avatar itself opens the player page
  // instead of removing them (see addToSquad above).
  removeFromSquad(playerId: string): void {
    if (this.isLocked(playerId)) return;
    const slots = [...this.squadSlots()];
    const idx = slots.findIndex((s) => s.playerId === playerId);
    if (idx === -1) return;
    slots[idx] = { ...slots[idx], playerId: null };
    if (this.captainId() === playerId) this.captainId.set(null);
    this.squadSlots.set(slots);
    this.saved.set(false);
  }

  // Shared entrance choreography for every popup in this component
  // (player-info, slot-picker, coach-picker): each mounts at the "hidden"
  // CSS state, then this flips its `visible` signal to true a couple of
  // frames later so the browser actually paints the hidden state first and
  // the enter transition has something to animate from. Closing is the
  // mirror of this (flip `visible` back to false, then unmount after the
  // CSS transition's duration) but is only 3 lines and reads clearer
  // written out per-popup than factored through a signal shared by name.
  private showPopup(visible: WritableSignal<boolean>): void {
    requestAnimationFrame(() => requestAnimationFrame(() => visible.set(true)));
  }

  // Opens the player-info popup (last-5-games PIR/opponent) instead of
  // navigating to /players/:id — works the same for a pool player or a
  // player already placed in the squad, since it's purely informational.
  openPlayerInfo(playerId: string): void {
    clearTimeout(this.infoCloseTimer);
    this.infoPlayerId.set(playerId);
    this.infoGameLog.set([]);
    this.infoLoading.set(true);
    this.showPopup(this.infoVisible);
    this.api.getPlayerGames(playerId).subscribe({
      next: (log) => {
        this.infoGameLog.set(log.rows.slice(0, 5));
        this.infoLoading.set(false);
      },
      error: () => this.infoLoading.set(false),
    });
  }

  closePlayerInfo(): void {
    if (!this.infoPlayerId()) return;
    this.infoVisible.set(false);
    clearTimeout(this.infoCloseTimer);
    this.infoCloseTimer = setTimeout(() => this.infoPlayerId.set(null), POPUP_CLOSE_MS);
  }

  // Opens the slot-picker popup for one specific empty slot — a starter
  // slot pins the shared positionFilter to its own required position for
  // the picker's duration (see pickerRequiredPosition), since a
  // mismatched player could never be dropped there anyway.
  openPicker(slotId: string): void {
    const idx = this.squadSlots().findIndex((s) => s.id === slotId);
    if (idx !== -1 && idx < this.starterCount) this.positionFilter.set(this.requiredPositionForStarterSlot(idx));
    clearTimeout(this.pickerCloseTimer);
    this.pickerSlotId.set(slotId);
    this.showPopup(this.pickerVisible);
  }

  closePicker(): void {
    if (!this.pickerSlotId()) return;
    this.pickerVisible.set(false);
    clearTimeout(this.pickerCloseTimer);
    this.pickerCloseTimer = setTimeout(() => this.pickerSlotId.set(null), POPUP_CLOSE_MS);
  }

  // Opens the coach-picker popup — see the coachPickerOpen field comment.
  openCoachPicker(): void {
    clearTimeout(this.coachPickerCloseTimer);
    this.coachPickerOpen.set(true);
    this.showPopup(this.coachPickerVisible);
  }

  closeCoachPicker(): void {
    if (!this.coachPickerOpen()) return;
    this.coachPickerVisible.set(false);
    clearTimeout(this.coachPickerCloseTimer);
    this.coachPickerCloseTimer = setTimeout(() => this.coachPickerOpen.set(false), POPUP_CLOSE_MS);
  }

  // Picking a coach from the popup both selects and closes in one tap,
  // same "pick it and you're done" flow as pickPlayerForSlot.
  pickCoach(teamId: string): void {
    this.selectCoach(teamId);
    this.closeCoachPicker();
  }

  // Opens the swap popup for one squad member — see swapPlayerId/
  // swapCandidates above. No-ops for a locked player (their own game's
  // already tipped off this round), same guard as removeFromSquad/onDrop.
  openSwapPicker(playerId: string): void {
    if (this.isLocked(playerId)) return;
    clearTimeout(this.swapCloseTimer);
    this.swapPlayerId.set(playerId);
    this.showPopup(this.swapVisible);
  }

  closeSwapPicker(): void {
    if (!this.swapPlayerId()) return;
    this.swapVisible.set(false);
    clearTimeout(this.swapCloseTimer);
    this.swapCloseTimer = setTimeout(() => this.swapPlayerId.set(null), POPUP_CLOSE_MS);
  }

  // Trades the two players' slots outright — both are already occupied
  // (unlike pickPlayerForSlot, which only ever fills an empty one), so
  // this is a straight swap rather than a displace-and-shift.
  performSwap(targetPlayerId: string): void {
    const sourceId = this.swapPlayerId();
    if (!sourceId || this.isLocked(sourceId) || this.isLocked(targetPlayerId)) return;
    const slots = [...this.squadSlots()];
    const sourceIdx = slots.findIndex((s) => s.playerId === sourceId);
    const targetIdx = slots.findIndex((s) => s.playerId === targetPlayerId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    if (!this.slotAcceptsPlayer(slots[targetIdx].id, sourceId) || !this.slotAcceptsPlayer(slots[sourceIdx].id, targetPlayerId)) {
      return;
    }
    slots[sourceIdx] = { ...slots[sourceIdx], playerId: targetPlayerId };
    slots[targetIdx] = { ...slots[targetIdx], playerId: sourceId };
    this.squadSlots.set(slots);
    this.releaseCaptainIfNotStarter(slots);
    this.saved.set(false);
    this.closeSwapPicker();
  }

  // Assigns a player to the exact slot the picker was opened for — unlike
  // addToSquad's priority search (starter, then sixth man, then bench),
  // the user already chose the slot by tapping it, so this just fills it.
  pickPlayerForSlot(playerId: string): void {
    const slotId = this.pickerSlotId();
    if (!slotId || !this.slotAcceptsPlayer(slotId, playerId)) return;
    const slots = [...this.squadSlots()];
    const idx = slots.findIndex((s) => s.id === slotId);
    if (idx === -1) return;
    slots[idx] = { ...slots[idx], playerId };
    this.squadSlots.set(slots);
    this.saved.set(false);
    this.closePicker();
  }

  setCaptain(playerId: string): void {
    const slot = this.squadSlots().find((s) => s.playerId === playerId);
    if (!slot || slot.role !== "starter" || this.isLocked(playerId)) return;
    this.captainId.set(this.captainId() === playerId ? null : playerId);
    this.saved.set(false);
  }

  selectCoach(teamId: string): void {
    if (this.coachLocked() && this.coachTeamId() !== teamId) return;
    this.coachTeamId.set(this.coachTeamId() === teamId ? null : teamId);
    this.saved.set(false);
  }

  // Shared drop handler for the pool list and every squad-slot list.
  // `targetId` is 'pool' or the destination slot's id; the dragged
  // player's id travels on the CDK drag item via [cdkDragData] (set in the
  // template), and its origin comes off event.previousContainer.id — see
  // fantasy.html for how both are wired.
  onDrop(event: CdkDragDrop<unknown>, targetId: string): void {
    const draggedPlayerId = event.item.data as string;
    if (this.isLocked(draggedPlayerId)) return;
    const sourceId = event.previousContainer.id;
    if (sourceId === targetId) return; // dropped back where it started
    if (!this.slotAcceptsPlayer(targetId, draggedPlayerId)) return; // wrong position for a formation-gated starter slot

    const slots = [...this.squadSlots()];
    const sourceIdx = slots.findIndex((s) => s.id === sourceId);

    if (targetId !== "pool") {
      const targetIdx = slots.findIndex((s) => s.id === targetId);
      if (targetIdx === -1) return;
      const displaced = slots[targetIdx].playerId;
      if (displaced && this.isLocked(displaced)) return; // can't bump a locked player off their slot
      if (displaced && sourceId !== "pool" && !this.slotAcceptsPlayer(sourceId, displaced)) return; // the swap-back would break the source slot's own gating
      if (sourceIdx !== -1) slots[sourceIdx] = { ...slots[sourceIdx], playerId: null };
      slots[targetIdx] = { ...slots[targetIdx], playerId: draggedPlayerId };
      if (displaced && sourceIdx !== -1) {
        slots[sourceIdx] = { ...slots[sourceIdx], playerId: displaced };
      }
    } else if (sourceIdx !== -1) {
      slots[sourceIdx] = { ...slots[sourceIdx], playerId: null };
    }

    this.squadSlots.set(slots);
    this.releaseCaptainIfNotStarter(slots);
    this.saved.set(false);
  }

  // Captain must always be a starter — dragging or swapping them onto the
  // bench (or sixth man) has to release the armband, not just leave
  // captainId pointing at a player who no longer holds a starter slot
  // (which used to be possible via onDrop alone: it only cleared captainId
  // when the captain left the squad entirely, not when they merely moved
  // to a non-starter slot within it).
  private releaseCaptainIfNotStarter(slots: SquadSlot[]): void {
    const captain = this.captainId();
    if (captain && !slots.some((s) => s.playerId === captain && s.role === "starter")) {
      this.captainId.set(null);
    }
  }

  submit(): void {
    const season = this.season();
    const round = this.round();
    const captainPlayerId = this.captainId();
    const coachTeamId = this.coachTeamId();
    if (!season || round === null || !captainPlayerId || !coachTeamId || !this.canSubmit()) return;

    const players = this.squadSlots()
      .filter((s): s is SquadSlot & { playerId: string } => s.playerId !== null)
      .map((s) => ({ playerId: s.playerId, slotRole: s.role, isCaptain: s.playerId === captainPlayerId }));

    this.submitting.set(true);
    this.submitError.set(null);
    this.api.submitFantasyLineupBatch(season, round, players, coachTeamId).subscribe({
      next: () => {
        this.serverSlotByPlayerId.set(new Map(players.map((p) => [p.playerId, p.slotRole])));
        this.serverCaptainId.set(captainPlayerId);
        this.serverCoachTeamId.set(coachTeamId);
        this.submitting.set(false);
        this.saved.set(true);
      },
      error: () => {
        this.submitting.set(false);
        this.submitError.set(this.i18n.t("fantasy.saveFailed"));
      },
    });
  }

  selectLeague(id: string | null): void {
    this.selectedLeagueId.set(id || null);
    if (!id) return;
    this.leaderboardLoading.set(true);
    this.api.getLeagueFantasyLeaderboard(id).subscribe({
      next: (rows) => {
        this.leagueLeaderboard.set(rows);
        this.leaderboardLoading.set(false);
      },
      error: () => this.leaderboardLoading.set(false),
    });
  }

  openEntry(entry: FantasyLeaderboardEntry): void {
    this.selectedEntry.set(entry);
  }

  closeEntry(): void {
    this.selectedEntry.set(null);
  }

  @HostListener("document:keydown.escape")
  onEscape(): void {
    this.closeEntry();
    this.showFixtures.set(false);
    this.showFormationPicker.set(false);
    this.closePlayerInfo();
    this.closePicker();
    this.closeCoachPicker();
    this.closeSwapPicker();
  }
}
