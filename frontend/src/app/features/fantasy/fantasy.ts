import { Component, HostListener, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { DragDropModule, CdkDragDrop } from "@angular/cdk/drag-drop";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import {
  FantasyPlayerRow,
  FantasyCoachRow,
  FantasyLeaderboardEntry,
  FantasySlotRole,
  League,
  Game,
  GameTeamSummary,
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

type SortKey = "name" | "price" | "pointsPerGame" | "valuation";
type PositionFilter = "Guard" | "Forward" | "Center" | null;

interface SquadSlot {
  id: string;
  role: FantasySlotRole;
  playerId: string | null;
}

const STARTER_SLOT_POSITIONS = [
  { left: 50, top: 19 }, // top of the key
  { left: 22, top: 43 }, // left wing
  { left: 78, top: 43 }, // right wing
  { left: 34, top: 79 }, // left post
  { left: 66, top: 79 }, // right post
];

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
})
export class FantasyComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly starterCount = FANTASY_STARTER_COUNT;
  readonly budgetCap = FANTASY_BUDGET_CAP;
  readonly positionQuota = FANTASY_POSITION_QUOTA;
  readonly starterSlotPositions = STARTER_SLOT_POSITIONS;

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
  readonly sortKey = signal<SortKey>("valuation");
  readonly sortDesc = signal(true);
  readonly visibleCount = signal(PAGE_SIZE);

  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly saved = signal(false);

  // --- Matchup preview ---
  readonly fixtureGames = signal<Game[]>([]);
  readonly opponentByTeamId = signal<Map<string, OpponentInfo>>(new Map());
  readonly showFixtures = signal(false);

  readonly rowById = computed(() => new Map(this.allRows().map((r) => [r.player.id, r])));
  readonly coachByTeamId = computed(() => new Map(this.coaches().map((c) => [c.team.id, c])));

  readonly selectedPlayerIds = computed(
    () => new Set(this.squadSlots().map((s) => s.playerId).filter((id): id is string => id !== null))
  );

  readonly starterSlots = computed(() => this.squadSlots().filter((s) => s.role === "starter"));
  readonly sixthManSlot = computed(() => this.squadSlots().find((s) => s.role === "sixth_man")!);
  readonly benchSlots = computed(() => this.squadSlots().filter((s) => s.role === "bench"));

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
        }
        this.opponentByTeamId.set(map);
      },
      error: () => {},
    });
  }

  opponentFor(teamId: string): OpponentInfo | null {
    return this.opponentByTeamId().get(teamId) ?? null;
  }

  slotByRoleIndex(role: FantasySlotRole, index: number): SquadSlot {
    return this.squadSlots().filter((s) => s.role === role)[index];
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
  // actual pointer move past its drag threshold, so a stationary tap still
  // fires this normally rather than fighting the drag gesture. Tapping a
  // pool player places them in the first empty slot (bench first, since
  // that's the safer default — a starter/sixth-man promotion is a
  // deliberate act); tapping a placed player clears their slot.
  toggle(playerId: string): void {
    if (this.isLocked(playerId)) return;
    const slots = [...this.squadSlots()];
    const idx = slots.findIndex((s) => s.playerId === playerId);
    if (idx !== -1) {
      slots[idx] = { ...slots[idx], playerId: null };
      if (this.captainId() === playerId) this.captainId.set(null);
    } else {
      const emptyIdx =
        slots.findIndex((s) => s.role === "bench" && s.playerId === null) !== -1
          ? slots.findIndex((s) => s.role === "bench" && s.playerId === null)
          : slots.findIndex((s) => s.playerId === null);
      if (emptyIdx === -1) return; // squad already full
      slots[emptyIdx] = { ...slots[emptyIdx], playerId };
    }
    this.squadSlots.set(slots);
    this.saved.set(false);
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

    const slots = [...this.squadSlots()];
    const sourceIdx = slots.findIndex((s) => s.id === sourceId);
    if (sourceIdx !== -1) slots[sourceIdx] = { ...slots[sourceIdx], playerId: null };

    if (targetId !== "pool") {
      const targetIdx = slots.findIndex((s) => s.id === targetId);
      if (targetIdx === -1) return;
      const displaced = slots[targetIdx].playerId;
      if (displaced && this.isLocked(displaced)) return; // can't bump a locked player off their slot
      slots[targetIdx] = { ...slots[targetIdx], playerId: draggedPlayerId };
      if (displaced && sourceIdx !== -1) {
        slots[sourceIdx] = { ...slots[sourceIdx], playerId: displaced };
      }
    }

    this.squadSlots.set(slots);
    if (this.captainId() && !slots.some((s) => s.playerId === this.captainId())) this.captainId.set(null);
    this.saved.set(false);
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
  }
}
