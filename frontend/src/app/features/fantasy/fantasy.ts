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
export const FANTASY_TRANSFERS_PER_ROUND = 3;

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

// Which of the 5 supported formations (if any) fits a given Guard/Forward/
// Center count split — used by swapCandidates/performSwap below to figure
// out whether swapping a starting-five player for a different-position
// bench player still lands on one of the 5 shapes this app supports (and
// which one), rather than only ever allowing an exact same-position swap.
// All 5 FORMATION_POSITIONS entries happen to list Guards, then Forwards,
// then Centers as a contiguous block — the count vector alone is enough to
// identify a formation uniquely (no two of the 5 share one).
function formationForPositionCounts(counts: Record<PositionName, number>): Formation | null {
  return (
    FORMATION_OPTIONS.find((f) => {
      const need: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
      for (const p of FORMATION_POSITIONS[f]) need[p]++;
      return need.Guard === counts.Guard && need.Forward === counts.Forward && need.Center === counts.Center;
    }) ?? null
  );
}

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
// Widened 2026-09-07 (from [30,70]/[18,50,82]) — on a narrow mobile court
// column, avatars in the same row sat close enough to visually crowd each
// other. Horizontal-only change: spreading a row wider doesn't touch
// ROW_TOP/the court-background SVG's calibration (see court-background.ts's
// own doc comment on how fragile that vertical alignment has been), it just
// moves same-row slots further apart within a still-symmetric layout.
function rowXPositions(count: number): number[] {
  if (count === 1) return [50];
  if (count === 2) return [20, 80];
  return [10, 50, 90];
}

// Mobile gets smaller slot avatars than desktop (2026-09-07) — same
// motivation as the rowXPositions widening above: the court column's own
// height is a fixed 320/300 aspect ratio off its *width*, so a narrower
// mobile column is also a shorter one in real pixels, while the avatar
// pixel sizes (56/50/44) stayed fixed regardless — on mobile that left
// barely more real vertical gap between rows than the avatar-plus-label
// stack actually needs, reading as cramped. Smaller avatars on mobile free
// up that same real vertical gap without touching ROW_TOP.
const MOBILE_BREAKPOINT_PX = 640; // matches Tailwind's `sm:` breakpoint


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

// One entry in the swap popup — `formation` is null for a sixth-man <->
// bench pairing (neither side has a position requirement, so the swap has
// no formation implication at all); otherwise it's the formation this
// swap would leave the starting five in, which may or may not be the
// current one — see swapCandidates/performSwap.
interface SwapCandidate {
  slotId: string;
  row: FantasyPlayerRow;
  formation: Formation | null;
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

  // See the rowXPositions/MOBILE_BREAKPOINT_PX comment above.
  readonly isMobileViewport = signal(window.innerWidth < MOBILE_BREAKPOINT_PX);
  @HostListener("window:resize")
  onWindowResize(): void {
    this.isMobileViewport.set(window.innerWidth < MOBILE_BREAKPOINT_PX);
  }
  // Bumped again 2026-09-07 (from 46/40/36 mobile, 56/50/44 desktop) by
  // request ("make the slots even bigger") — a bit more of the row-to-row
  // crowding risk the 2026-09-07 mobile-size-down pass above was written to
  // avoid, but a direct, explicit ask outweighs that caution here.
  readonly starterAvatarSize = computed(() => (this.isMobileViewport() ? 50 : 62));
  readonly sixthManAvatarSize = computed(() => (this.isMobileViewport() ? 44 : 54));
  readonly benchAvatarSize = computed(() => (this.isMobileViewport() ? 40 : 48));

  readonly tab = signal<"roster" | "leaderboard">("roster");

  // --- Roster builder state ---
  readonly loading = signal(true);
  readonly allRows = signal<FantasyPlayerRow[]>([]);
  readonly coaches = signal<FantasyCoachRow[]>([]);
  readonly season = signal<string | null>(null);
  // `round` is whichever round is currently being *viewed* — the round
  // navigator (viewRound/viewPreviousRound/viewNextRound below) can point
  // this at any past round, read-only, without disturbing `defaultRound`.
  readonly round = signal<number | null>(null);
  // The season's actual current active round (services/fantasyScoring.ts's
  // getDefaultRound) — 2026-09-07. Editing is only ever allowed while
  // `round() === defaultRound()` (see isCurrentRound/roundLocked below); any
  // other round reached via the navigator is always a locked, read-only
  // history view, regardless of that round's own lock time (it's already
  // guaranteed fully final by construction — getDefaultRound only advances
  // past a round once every one of its games is 'final').
  readonly defaultRound = signal<number | null>(null);
  readonly lockAt = signal<string | null>(null);
  readonly coachLocked = signal(false);
  readonly lockedPlayerIds = signal<Set<string>>(new Set());

  // --- Round review — points/PIR/completion for whichever round is being
  // viewed (2026-09-07). Sourced from GET /fantasy/lineup's own per-round
  // scoring (routes/fantasy.ts), not re-derived client-side, so this reads
  // correctly for a past round immediately on navigation, before any
  // per-game box score has necessarily been fetched this session.
  readonly roundComplete = signal(false);
  readonly totalPoints = signal(0);
  readonly totalPir = signal(0);
  readonly coachPoints = signal(0);

  // --- Transfers (2026-09-07) — see services/fantasyScoring.ts's
  // getBaselineSquad doc comment. transfersUsed/transfersAllowed are the
  // server's own count as of the last load/save; localTransfersUsed below
  // recomputes live off the in-progress squad so the pool can pre-emptively
  // disable a new pick before a save round-trip, same pattern as the
  // position-quota gating.
  readonly transfersUsed = signal(0);
  readonly transfersAllowed = signal<number | null>(null);
  readonly baselinePlayerIds = signal<Set<string> | null>(null);

  readonly isCurrentRound = computed(
    () => this.round() !== null && this.defaultRound() !== null && this.round() === this.defaultRound()
  );

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

  // --- Captain picker — a dialog next to the formation button, replacing
  // the old per-avatar tappable "C" badge on each starter (2026-09-07):
  // that badge doubled as both the captain indicator AND the control to
  // change it, which meant the only way to see who your captain even was
  // required looking at 5 small badges rather than one clear affordance.
  // Same plain centered-modal pattern as showFormationPicker (no
  // entrance-animation dance — that's reserved for the bottom-sheet-style
  // popups, see the popup-choreography comment below).
  readonly showCaptainPicker = signal(false);
  readonly captainRow = computed(() => {
    const id = this.captainId();
    return id ? this.rowById().get(id) ?? null : null;
  });
  readonly hasAnyStarter = computed(() => this.starterSlots().some((s) => s.playerId !== null));

  // --- "What's missing" indicator next to Save (2026-09-07) — canSubmit()
  // was already a single boolean with no way to tell a visitor *which*
  // requirement was unmet short of poking at every part of the screen.
  // Deliberately excludes hasChanges(): "nothing to save" isn't a missing
  // requirement, it's just an idle, already-valid state.
  readonly showMissingInfo = signal(false);
  readonly missingRequirements = computed<string[]>(() => {
    const list: string[] = [];
    // Checked first — once the round's locked, it's the *only* reason Save
    // is disabled for an otherwise-already-valid, already-saved lineup, so
    // it has to surface here too or the "!" badge simply wouldn't appear.
    if (this.roundLocked()) list.push(this.i18n.t("fantasy.missingRoundLocked"));
    if (!this.squadFull()) list.push(this.i18n.t("fantasy.missingSquadFull"));
    if (!this.positionQuotaMet()) list.push(this.i18n.t("fantasy.missingPositionQuota"));
    if (this.captainId() === null) list.push(this.i18n.t("fantasy.missingCaptain"));
    if (this.coachTeamId() === null) list.push(this.i18n.t("fantasy.missingCoach"));
    if (this.overBudget()) list.push(this.i18n.t("fantasy.overBudget"));
    return list;
  });

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

  // Whole-round lock (2026-09-07, replacing a per-player-only "Turns"
  // lock): once ANY game in this round has tipped off, the entire lineup
  // freezes — every player, formation, captain, and coach — not just
  // whichever specific players' own games have started. Matches the
  // backend's own POST /lineup/batch gate (see that route's doc comment)
  // exactly, just computed reactively here off signals that are already
  // kept live: coachLocked() is the server's own snapshot from load time
  // (covers the very first render, before any SSE tick has arrived), and
  // fixtureGames() is kept current via the SSE stream (see liveUpdatesEffect
  // above) so this flips true mid-session the moment a game actually goes
  // live, with no need to reload the page or re-fetch the lineup.
  // !isCurrentRound() (2026-09-07) additionally locks every past round
  // reached via the round navigator — always read-only history, regardless
  // of the two checks above (which would already independently agree, since
  // a past round is by construction fully final, but this makes the intent
  // explicit rather than relying on that coincidence).
  readonly roundLocked = computed(
    () => !this.isCurrentRound() || this.coachLocked() || this.fixtureGames().some((g) => g.status !== "scheduled")
  );

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
    // A game in the currently-viewed round just finished — re-pull that
    // round's own scoring summary (points/PIR/completion) so "PIR total
    // upon completion" and the completion animation react live instead of
    // needing a manual reload. Deliberately scoped to just those signals
    // (see refreshRoundSummary), not squadSlots/captain/coach, so it can
    // never clobber an in-progress, unsaved edit.
    if (matched && update.status === "final") this.refreshRoundSummary();
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
  // sixth-man group.
  //
  // Position/formation gating only ever applies to the 5 *starter* slots —
  // a sixth-man <-> bench pairing (neither side is one of those 5) stays
  // fully unrestricted, exactly as before, since the sixth-man slot has no
  // position requirement to protect. When one side IS a starter slot,
  // candidates used to be limited to an exact same-position swap
  // (slotAcceptsPlayer both ways). That's needlessly strict: swapping a
  // starter for a different-position bench player is fine as long as the
  // *resulting* 5-starter position mix still matches one of the 5 formations
  // this app supports — just possibly a different one than the current
  // formation (performSwap re-seats the starters into it and flips the
  // `formation` signal when that happens; the template flags any candidate
  // whose `formation` differs from the current one so the user sees the
  // formation is about to change before picking it). A resulting mix that
  // fits none of the 5 shapes (e.g. swapping 2-1-2's only Forward for
  // another Guard, leaving zero Forwards) has no candidate at all — it's
  // dropped from the list rather than offered with a null formation.
  readonly swapCandidates = computed<SwapCandidate[]>(() => {
    const id = this.swapPlayerId();
    if (!id) return [];
    const slots = this.squadSlots();
    const sourceIdx = slots.findIndex((s) => s.playerId === id);
    if (sourceIdx === -1) return [];
    const wantsBench = slots[sourceIdx].role !== "bench";
    const byId = this.rowById();

    const results: SwapCandidate[] = [];
    for (let targetIdx = 0; targetIdx < slots.length; targetIdx++) {
      const target = slots[targetIdx];
      if (!target.playerId || target.playerId === id) continue;
      if (this.isPlayerLocked(target.playerId)) continue;
      if ((target.role === "bench") !== wantsBench) continue;
      const targetRow = byId.get(target.playerId);
      if (!targetRow) continue;
      const result = this.evaluateSwap(slots, sourceIdx, targetIdx);
      if (!result.ok) continue;
      results.push({ slotId: target.id, row: targetRow, formation: result.formation });
    }
    return results;
  });

  // Whether swapping the two given (already-occupied) slot indices is
  // allowed, and what formation the starting five ends up in — the one
  // place both the tap-driven swap popup (swapCandidates/performSwap) and
  // onDrop's slot-to-slot drag case decide this, so dragging one squad
  // member onto another behaves identically to picking them from the
  // popup. Neither slot being a starter is always allowed with no
  // formation implication (`formation: null` — a sixth-man <-> bench
  // pairing has no position stakes); when at least one side is a starter,
  // it's only allowed if the resulting 5-starter position mix fits one of
  // the 5 supported formations, which may or may not be the current one.
  private evaluateSwap(
    slots: SquadSlot[],
    sourceIdx: number,
    targetIdx: number
  ): { ok: true; formation: Formation | null } | { ok: false } {
    if (sourceIdx >= this.starterCount && targetIdx >= this.starterCount) return { ok: true, formation: null };

    const byId = this.rowById();
    const counts: Record<PositionName, number> = { Guard: 0, Forward: 0, Center: 0 };
    for (let i = 0; i < this.starterCount; i++) {
      let playerId = slots[i].playerId;
      if (i === sourceIdx) playerId = slots[targetIdx].playerId;
      else if (i === targetIdx) playerId = slots[sourceIdx].playerId;
      const position = playerId ? byId.get(playerId)?.player.position : null;
      if (position !== "Guard" && position !== "Forward" && position !== "Center") return { ok: false };
      counts[position]++;
    }
    const formation = formationForPositionCounts(counts);
    return formation ? { ok: true, formation } : { ok: false }; // no supported formation fits this mix
  }

  readonly rowById = computed(() => new Map(this.allRows().map((r) => [r.player.id, r])));
  readonly coachByTeamId = computed(() => new Map(this.coaches().map((c) => [c.team.id, c])));

  readonly selectedCoach = computed(() => {
    const id = this.coachTeamId();
    return id ? this.coachByTeamId().get(id) ?? null : null;
  });

  readonly selectedPlayerIds = computed(
    () => new Set(this.squadSlots().map((s) => s.playerId).filter((id): id is string => id !== null))
  );

  // Recomputed live off the in-progress squad (2026-09-07), not just the
  // server's last-saved count, so the pool can pre-emptively disable a new
  // pick before a save round-trip — same reasoning as positionCounts below.
  // Only a player NOT in the baseline counts: bringing back a baseline
  // player you'd temporarily removed costs nothing, matching how the
  // backend's own transfersUsed is computed (services/fantasyScoring.ts's
  // getBaselineSquad) — a net diff against last round's squad, not a tally
  // of individual add/remove actions taken along the way.
  readonly localTransfersUsed = computed(() => {
    const baseline = this.baselinePlayerIds();
    if (!baseline) return 0;
    let count = 0;
    for (const id of this.selectedPlayerIds()) if (!baseline.has(id)) count++;
    return count;
  });

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
      !this.overBudget() &&
      !this.roundLocked()
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

    const matched = formationForPositionCounts(counts);
    if (!matched) return;

    this.formation.set(matched);
    this.squadSlots.set(this.reseatStartersForFormation(slots, matched));
  }

  // Re-seats the 5 starters into the block order every FORMATION_POSITIONS
  // entry itself uses (Guards, then Forwards, then Centers) for the given
  // `formation` — the caller must already know the 5 starters' real
  // positions match that formation's count vector (see
  // formationForPositionCounts), this only decides *which* of the 5 slots
  // each one lands in. Needed because a plain 1-for-1 index swap (see
  // performSwap) can leave a starter's real position mismatched against
  // their own slot's requirement even when the *overall* mix is valid for
  // a different arrangement of the same formation — e.g. swapping out the
  // second of 2-1-2's two Centers (slot index 4) for a bench Forward still
  // adds up to 2-2-1's count vector, but slot 4 is 2-2-1's Center slot and
  // slot 3 (unchanged, still a real Center) is 2-2-1's Forward slot — both
  // wrong until the 5 are re-bucketed by position and re-seated in order.
  private reseatStartersForFormation(slots: SquadSlot[], formation: Formation): SquadSlot[] {
    const byId = this.rowById();
    const byPosition: Record<PositionName, string[]> = { Guard: [], Forward: [], Center: [] };
    for (let i = 0; i < this.starterCount; i++) {
      const playerId = slots[i].playerId!;
      byPosition[byId.get(playerId)!.player.position as PositionName].push(playerId);
    }
    const requiredPositions = FORMATION_POSITIONS[formation];
    const next = [...slots];
    for (let i = 0; i < this.starterCount; i++) {
      next[i] = { ...next[i], playerId: byPosition[requiredPositions[i]].shift()! };
    }
    return next;
  }

  // `round` selects which round to view — omit for the current active one.
  // Shared by ngOnInit's initial load and the round navigator below.
  private loadLineup(round?: number): void {
    this.api.getFantasyLineup(round).subscribe({
      next: (lineup) => {
        this.season.set(lineup.season);
        this.round.set(lineup.round);
        this.defaultRound.set(lineup.defaultRound);
        this.lockAt.set(lineup.lockAt);
        this.coachLocked.set(lineup.coachLocked);
        this.lockedPlayerIds.set(new Set(lineup.players.filter((p) => p.locked).map((p) => p.playerId)));
        this.roundComplete.set(lineup.roundComplete);
        this.totalPoints.set(lineup.totalPoints);
        this.totalPir.set(lineup.totalPir);
        this.coachPoints.set(lineup.coachPoints);
        this.transfersUsed.set(lineup.transfersUsed);
        this.transfersAllowed.set(lineup.transfersAllowed);
        this.baselinePlayerIds.set(lineup.baselinePlayerIds ? new Set(lineup.baselinePlayerIds) : null);

        const slots = initialSquadSlots();
        const serverMap = new Map<string, FantasySlotRole>();
        let captain: string | null = null;
        for (const p of lineup.players) {
          serverMap.set(p.playerId, p.slotRole);
          if (p.isCaptain) captain = p.playerId;
          const idx = slots.findIndex((s) => s.role === p.slotRole && s.playerId === null);
          if (idx !== -1) slots[idx] = { ...slots[idx], playerId: p.playerId };
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
        this.maybeCelebrateRoundComplete(lineup.round, lineup.roundComplete);
      },
      error: () => {},
    });
  }

  // Lightweight re-pull of just a round's scoring summary (points/PIR/
  // completion), triggered when a game in the currently-viewed round goes
  // final mid-session (see liveUpdatesEffect) — deliberately never touches
  // squadSlots/captainId/coachTeamId, so it can't clobber an in-progress,
  // unsaved edit the way a full loadLineup() reload would.
  private refreshRoundSummary(): void {
    const round = this.round();
    if (round === null) return;
    this.api.getFantasyLineup(round).subscribe({
      next: (lineup) => {
        this.roundComplete.set(lineup.roundComplete);
        this.totalPoints.set(lineup.totalPoints);
        this.totalPir.set(lineup.totalPir);
        this.coachPoints.set(lineup.coachPoints);
        this.maybeCelebrateRoundComplete(lineup.round, lineup.roundComplete);
      },
      error: () => {},
    });
  }

  // --- Round navigator (2026-09-07) — browse any past round read-only
  // (isCurrentRound/roundLocked above enforce the read-only part), clamped
  // to [1, defaultRound] since nothing exists before round 1 and nothing
  // meaningful exists past the season's actual current round yet.
  viewRound(round: number): void {
    const max = this.defaultRound();
    if (round < 1 || (max !== null && round > max) || round === this.round()) return;
    this.closeAllPopups();
    this.loadLineup(round);
  }

  viewPreviousRound(): void {
    const r = this.round();
    if (r !== null) this.viewRound(r - 1);
  }

  viewNextRound(): void {
    const r = this.round();
    if (r !== null) this.viewRound(r + 1);
  }

  // --- Round-complete celebration (2026-09-07) — fires once per round per
  // session (celebratedRounds), the first time that round is seen to be
  // fully complete (both EuroLeague match-days, not just the first —
  // roundComplete already requires every one of the round's games to be
  // 'final'). Re-visiting an already-celebrated round via the navigator
  // doesn't replay it.
  private readonly celebratedRounds = new Set<number>();
  readonly showRoundComplete = signal(false);

  private maybeCelebrateRoundComplete(round: number | null, complete: boolean): void {
    if (!complete || round === null || this.celebratedRounds.has(round)) return;
    this.celebratedRounds.add(round);
    this.showRoundComplete.set(true);
  }

  closeRoundComplete(): void {
    this.showRoundComplete.set(false);
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

  // Player names sync from the feed as "SURNAME, First" — on the court's
  // cramped avatar labels (a fixed, narrow max-width, see fantasy.html's
  // squadSlot template) that truncated mid-first-name (e.g.
  // "BALCEROWSKI, A…"), burying the one part (the surname) that actually
  // identifies the player. Showing just the surname there instead means
  // truncation, when it still happens on a genuinely long name, only ever
  // eats into the surname itself — never the more identifying part. Falls
  // back to the name as-is for anything not in that "X, Y" shape (there's
  // no comma to split on).
  courtDisplayName(name: string): string {
    const commaIdx = name.indexOf(",");
    return commaIdx === -1 ? name : name.slice(0, commaIdx).trim();
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
    if (this.formation() === next || this.roundLocked()) return;
    const newPositions = FORMATION_POSITIONS[next];
    const byId = this.rowById();
    const slots = [...this.squadSlots()];
    for (let i = 0; i < this.starterCount; i++) {
      const slot = slots[i];
      if (!slot.playerId || this.isPlayerLocked(slot.playerId)) continue;
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

  // The real "can this player still be edited" check (2026-09-07) —
  // isLocked() alone only reflects lockedPlayerIds, a snapshot taken once
  // at page load (GET /fantasy/lineup's own `locked` flag). It never
  // updates for a game that goes live *while this page stays open*, since
  // nothing re-fetches the lineup mid-session — gameForTeam() is the piece
  // that does stay live (see liveUpdatesEffect above), so this combines
  // both: locked either because the server already said so, or because
  // this round's schedule (kept fresh via SSE) shows that player's team
  // has tipped off. Used everywhere a squad edit needs to be blocked once
  // a player's game has actually started, not just once the server's own
  // stale-by-design snapshot caught up. roundLocked() short-circuits this
  // to true for every player at once, per the whole-round lock above.
  isPlayerLocked(playerId: string): boolean {
    if (this.roundLocked()) return true;
    if (this.isLocked(playerId)) return true;
    const teamId = this.rowById().get(playerId)?.team.id;
    const game = teamId ? this.gameForTeam().get(teamId) : undefined;
    return !!game && game.status !== "scheduled";
  }

  // Blocks adding a *new* player of a position whose quota is already met
  // (2026-09-07) — positionQuotaMet() already caught this at submit time,
  // but nothing stopped the selection itself: a non-starter (sixth-man/
  // bench) slot was never position-gated, so a user could stack a 3rd
  // Center there and only discover the quota violation once Save stayed
  // disabled. Checked wherever a player is newly added from the pool
  // (addToSquad, pickPlayerForSlot, a pool-sourced onDrop) — never for
  // moving an already-selected player between two of their own squad
  // slots, which doesn't change any position's total count.
  canAddPosition(position: string | null | undefined): boolean {
    if (position !== "Guard" && position !== "Forward" && position !== "Center") return true;
    return this.positionCounts()[position] < this.positionQuota[position];
  }

  // Blocks bringing in a player who'd exceed the round's transfer budget
  // (2026-09-07) — free (no baseline, e.g. round 1) or already part of the
  // baseline squad always passes; otherwise only allowed while
  // localTransfersUsed hasn't already reached transfersAllowed.
  canUseTransfer(playerId: string): boolean {
    const baseline = this.baselinePlayerIds();
    const allowed = this.transfersAllowed();
    if (!baseline || allowed === null || baseline.has(playerId)) return true;
    return this.localTransfersUsed() < allowed;
  }

  // Combines the round-wide freeze, the position-quota gate, and the
  // transfer-budget gate above for the pool/picker row lists' disabled
  // state — the persistent desktop pool column isn't reached through
  // openPicker (that guard only covers mobile's tap-to-open-picker flow),
  // so it needs its own roundLocked() check here rather than relying on
  // that method never having been callable in the first place.
  poolRowDisabled(playerId: string, position: string | null | undefined): boolean {
    return this.roundLocked() || !this.canAddPosition(position) || !this.canUseTransfer(playerId);
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
    if (this.roundLocked() || !this.canAddPosition(this.rowById().get(playerId)?.player.position) || !this.canUseTransfer(playerId))
      return;
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
    if (this.isPlayerLocked(playerId)) return;
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
    if (this.roundLocked()) return;
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
    if (this.roundLocked()) return;
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
    if (this.isPlayerLocked(playerId)) return;
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
  // this is a straight swap rather than a displace-and-shift. Validity
  // (including whether it involves a starter slot at all, and whether the
  // resulting position mix fits a supported formation) is fully decided by
  // swapCandidates already — re-deriving it here would just duplicate that
  // logic, so this only ever acts on an id that's actually in the list.
  performSwap(targetPlayerId: string): void {
    const sourceId = this.swapPlayerId();
    if (!sourceId || this.isPlayerLocked(sourceId) || this.isPlayerLocked(targetPlayerId)) return;
    const candidate = this.swapCandidates().find((c) => c.row.player.id === targetPlayerId);
    if (!candidate) return;
    let slots = [...this.squadSlots()];
    const sourceIdx = slots.findIndex((s) => s.playerId === sourceId);
    const targetIdx = slots.findIndex((s) => s.playerId === targetPlayerId);
    if (sourceIdx === -1 || targetIdx === -1) return;
    slots[sourceIdx] = { ...slots[sourceIdx], playerId: targetPlayerId };
    slots[targetIdx] = { ...slots[targetIdx], playerId: sourceId };
    if (candidate.formation && candidate.formation !== this.formation()) {
      slots = this.reseatStartersForFormation(slots, candidate.formation);
      this.formation.set(candidate.formation);
    }
    this.squadSlots.set(slots);
    this.releaseCaptainIfNotStarter(slots);
    this.saved.set(false);
    this.closeSwapPicker();
  }

  // Assigns a player to the exact slot the picker was opened for — unlike
  // addToSquad's priority search (starter, then sixth man, then bench),
  // the user already chose the slot by tapping it, so this just fills it.
  pickPlayerForSlot(playerId: string): void {
    if (this.roundLocked()) return;
    const slotId = this.pickerSlotId();
    if (!slotId || !this.slotAcceptsPlayer(slotId, playerId)) return;
    if (!this.canAddPosition(this.rowById().get(playerId)?.player.position) || !this.canUseTransfer(playerId)) return;
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
    if (!slot || slot.role !== "starter" || this.isPlayerLocked(playerId)) return;
    this.captainId.set(this.captainId() === playerId ? null : playerId);
    this.saved.set(false);
  }

  // Called from the captain-picker dialog (see showCaptainPicker) —
  // selects and closes in one tap, same "pick it and you're done" flow as
  // pickCoach below.
  chooseCaptain(playerId: string): void {
    this.setCaptain(playerId);
    this.showCaptainPicker.set(false);
  }

  selectCoach(teamId: string): void {
    if (this.roundLocked()) return;
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
    if (this.isPlayerLocked(draggedPlayerId)) return;
    const sourceId = event.previousContainer.id;
    if (sourceId === targetId) return; // dropped back where it started

    const slots = [...this.squadSlots()];
    const sourceIdx = slots.findIndex((s) => s.id === sourceId);

    if (targetId === "pool") {
      if (sourceIdx !== -1) {
        slots[sourceIdx] = { ...slots[sourceIdx], playerId: null };
        this.squadSlots.set(slots);
        this.releaseCaptainIfNotStarter(slots);
        this.saved.set(false);
      }
      return;
    }

    const targetIdx = slots.findIndex((s) => s.id === targetId);
    if (targetIdx === -1) return;
    const displaced = slots[targetIdx].playerId;

    if (sourceId === "pool") {
      // Adding a brand-new player — nobody returns to the pool, so this
      // isn't a swap and keeps the original strict same-position gating;
      // the flexible formation logic below only ever applies to trading
      // two squad members' places with each other (see evaluateSwap).
      if (!this.slotAcceptsPlayer(targetId, draggedPlayerId)) return;
      if (displaced && this.isPlayerLocked(displaced)) return;
      if (
        !this.canAddPosition(this.rowById().get(draggedPlayerId)?.player.position) ||
        !this.canUseTransfer(draggedPlayerId)
      )
        return;
      slots[targetIdx] = { ...slots[targetIdx], playerId: draggedPlayerId };
      this.squadSlots.set(slots);
      this.releaseCaptainIfNotStarter(slots);
      this.saved.set(false);
      return;
    }

    if (!displaced) {
      // Moving into an empty slot — not a swap, same strict gating the
      // slot-picker itself uses for filling an empty starter slot.
      if (!this.slotAcceptsPlayer(targetId, draggedPlayerId)) return;
      slots[sourceIdx] = { ...slots[sourceIdx], playerId: null };
      slots[targetIdx] = { ...slots[targetIdx], playerId: draggedPlayerId };
      this.squadSlots.set(slots);
      this.releaseCaptainIfNotStarter(slots);
      this.saved.set(false);
      return;
    }

    // A genuine two-player swap. Only the same shape the swap popup itself
    // offers (one side bench-role, the other starter/sixth-man) gets the
    // popup's position/formation-aware treatment (evaluateSwap) — dragging
    // one squad member onto another now behaves identically to picking
    // them from the ⇄ popup. Any other pairing (starter <-> starter,
    // bench <-> bench, or a starter dragged straight onto the sixth man)
    // is outside that shape and keeps the original same-required-position
    // rule, unchanged.
    if (this.isPlayerLocked(displaced)) return;
    const sourceSlot = slots[sourceIdx];
    const targetSlot = slots[targetIdx];
    const crossesActiveBenchLine = (sourceSlot.role === "bench") !== (targetSlot.role === "bench");
    let formation: Formation | null = null;
    if (crossesActiveBenchLine) {
      const result = this.evaluateSwap(slots, sourceIdx, targetIdx);
      if (!result.ok) return;
      formation = result.formation;
    } else if (!this.slotAcceptsPlayer(targetId, draggedPlayerId) || !this.slotAcceptsPlayer(sourceId, displaced)) {
      return;
    }

    slots[sourceIdx] = { ...slots[sourceIdx], playerId: displaced };
    slots[targetIdx] = { ...slots[targetIdx], playerId: draggedPlayerId };
    const finalSlots = formation ? this.reseatStartersForFormation(slots, formation) : slots;
    if (formation) this.formation.set(formation);
    this.squadSlots.set(finalSlots);
    this.releaseCaptainIfNotStarter(finalSlots);
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
    this.closeAllPopups();
    this.closeRoundComplete();
  }

  private closeAllPopups(): void {
    this.showFixtures.set(false);
    this.showFormationPicker.set(false);
    this.showCaptainPicker.set(false);
    this.showMissingInfo.set(false);
    this.closePlayerInfo();
    this.closePicker();
    this.closeCoachPicker();
    this.closeSwapPicker();
  }
}
