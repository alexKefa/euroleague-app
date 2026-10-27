import { Component, HostListener, OnDestroy, OnInit, inject, signal, computed, effect } from "@angular/core";
import { CommonModule, Location } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { NavHistoryService } from "../../core/nav-history.service";
import { AlbumLeaderboardEntry, Collectible, CollectibleFinish, CollectibleTier, League, Team } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { CardPreviewComponent } from "../store/card-preview";
import { PageHintComponent } from "../../shared/page-hint";
import { PrizeBannerComponent } from "../../shared/prize-banner";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ButtonDirective } from "../../shared/button.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { TeamCodePipe } from "../../shared/team-display-code";
import { PageHeaderComponent } from "../../shared/page-header";

interface TierBreakdown {
  tier: CollectibleTier;
  owned: number;
  total: number;
}

// There's no stored "sticker slot number" anywhere in the catalog — this is
// purely a display order so a team's page looks the same across visits:
// commons first, then rares, legendaries and the coach, alphabetical within
// a tier. Coach was missing here until 2026-10-03: the card still showed in
// the grid (sorted first, indexOf -1) but had no row in the tier breakdown,
// although it has always counted toward the album's overall progress.
const TIER_ORDER: CollectibleTier[] = ["common", "rare", "legendary", "coach"];

@Component({
  selector: "app-album",
  standalone: true,
  imports: [PageHeaderComponent, 
    CommonModule,
    RouterLink,
    CollectibleCardComponent,
    CardPreviewComponent,
    PageHintComponent,
    PrizeBannerComponent,
    RetryImgDirective,
    SkeletonComponent,
    ButtonDirective,
    DropdownComponent,
    TeamCodePipe,
  ],
  templateUrl: "./album.html",
  styleUrl: "./album.css",
})
export class AlbumComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected navHistory = inject(NavHistoryService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  readonly tab = signal<"album" | "leaderboard">("album");

  // --- Leaderboard state (a global/my-league toggle, same shape as
  // Fantasy Five's own leaderboard tab) ---
  readonly globalLeaderboard = signal<AlbumLeaderboardEntry[]>([]);
  readonly myLeagues = signal<League[]>([]);
  readonly selectedLeagueId = signal<string | null>(null);
  readonly leagueLeaderboard = signal<AlbumLeaderboardEntry[]>([]);
  readonly leaderboardLoading = signal(false);
  readonly selectedEntry = signal<AlbumLeaderboardEntry | null>(null);

  readonly leagueDropdownOptions = computed<DropdownOption[]>(() =>
    this.myLeagues().map((l) => ({ value: l.id, label: l.name }))
  );

  readonly activeLeaderboard = computed(() =>
    this.selectedLeagueId() ? this.leagueLeaderboard() : this.globalLeaderboard()
  );

  setTab(tab: "album" | "leaderboard"): void {
    this.tab.set(tab);
  }

  selectLeague(id: string | null): void {
    this.selectedLeagueId.set(id || null);
    if (!id) return;
    this.leaderboardLoading.set(true);
    this.api.getLeagueAlbumLeaderboard(id).subscribe({
      next: (rows) => {
        this.leagueLeaderboard.set(rows);
        this.leaderboardLoading.set(false);
      },
      error: () => this.leaderboardLoading.set(false),
    });
  }

  openEntry(entry: AlbumLeaderboardEntry): void {
    this.selectedEntry.set(entry);
  }

  closeEntry(): void {
    this.selectedEntry.set(null);
  }

  @HostListener("document:keydown.escape")
  onLeaderboardEscape(): void {
    this.closeEntry();
  }

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly teams = signal<Team[]>([]);
  private readonly catalog = signal<Collectible[]>([]);
  private readonly ownedIds = signal<Set<string>>(new Set());
  // collectibleId -> finish, same "foil is legendary-only, never gameplay-
  // weighted" flourish as inventory.ts — see CollectibleFinish.
  private readonly finishByCollectibleId = signal<Map<string, CollectibleFinish>>(new Map());
  private readonly routeTeamId = signal<string | null>(null);
  private readonly previewItemId = signal<string | null>(null);

  readonly sortedTeams = computed(() => [...this.teams()].sort((a, b) => a.name.localeCompare(b.name)));

  // Album Series 2 "Moments" (2026-10-27): Players (series 1, the team
  // pages) and Moments (series 2, one page per round). The switch only
  // shows once a moment card exists.
  readonly series = signal<1 | 2>(1);
  private readonly seriesOne = computed(() => this.catalog().filter((c) => (c.series ?? 1) === 1));
  private readonly moments = computed(() => this.catalog().filter((c) => c.series === 2 && c.moment));
  readonly hasMoments = computed(() => this.moments().length > 0);

  /** Moments grouped by round, newest round first: the MVP plus the top performers. */
  readonly momentRounds = computed(() => {
    const owned = this.ownedIds();
    const byRound = new Map<number, { round: number; mvp: Collectible | null; tops: Collectible[]; owned: number; total: number }>();
    for (const c of this.moments()) {
      const round = c.moment!.round;
      const entry = byRound.get(round) ?? { round, mvp: null, tops: [], owned: 0, total: 0 };
      if (c.moment!.role === "mvp") entry.mvp = c;
      else entry.tops.push(c);
      entry.total++;
      if (owned.has(c.id)) entry.owned++;
      byRound.set(round, entry);
    }
    for (const e of byRound.values()) e.tops.sort((a, b) => (b.moment!.pir ?? -1) - (a.moment!.pir ?? -1));
    return [...byRound.values()].sort((a, b) => b.round - a.round);
  });

  setSeries(series: 1 | 2): void {
    this.series.set(series);
  }

  readonly selectedTeamId = computed(() => this.routeTeamId());
  readonly selectedTeam = computed(() => this.sortedTeams().find((t) => t.id === this.selectedTeamId()) ?? null);

  private readonly catalogByTeam = computed(() => {
    const byTeam = new Map<string, Collectible[]>();
    for (const c of this.seriesOne()) {
      const list = byTeam.get(c.team.id) ?? [];
      list.push(c);
      byTeam.set(c.team.id, list);
    }
    for (const list of byTeam.values()) {
      list.sort((a, b) => {
        const tierDiff = TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier);
        return tierDiff !== 0 ? tierDiff : a.name.localeCompare(b.name);
      });
    }
    return byTeam;
  });

  readonly teamSlots = computed(() => this.catalogByTeam().get(this.selectedTeamId() ?? "") ?? []);

  readonly teamOwnedCount = computed(() => {
    const owned = this.ownedIds();
    return this.teamSlots().filter((c) => owned.has(c.id)).length;
  });

  // Clicking a tier row in the breakdown filters the sticker grid down to
  // just that tier — click the same tier again to clear it (no separate
  // "All" affordance here the way Store/Inventory's tier chips have one,
  // so re-clicking the active row is the toggle-off gesture instead).
  readonly tierFilter = signal<CollectibleTier | null>(null);

  /**
   * One slot per player (2026-10-27): the player's best owned version
   * (legendary over rare over common), or a ghost when they own none, plus
   * every version for the dots. With a tier filter on, each player shows
   * that tier's version instead. Completion counts still count every card.
   */
  readonly playerSlots = computed(() => {
    const owned = this.ownedIds();
    const filter = this.tierFilter();
    const rank: Record<CollectibleTier, number> = { common: 0, rare: 1, legendary: 2, coach: 3 };
    const byName = new Map<string, Collectible[]>();
    for (const c of this.teamSlots()) {
      const list = byName.get(c.name) ?? [];
      list.push(c);
      byName.set(c.name, list);
    }
    const slots: { name: string; versions: Collectible[]; shown: Collectible; owned: boolean }[] = [];
    for (const [name, versions] of byName) {
      versions.sort((a, b) => rank[a.tier] - rank[b.tier]);
      let shown: Collectible | undefined;
      if (filter) {
        shown = versions.find((v) => v.tier === filter);
        if (!shown) continue;
      } else {
        const ownedVersions = versions.filter((v) => owned.has(v.id));
        shown = ownedVersions[ownedVersions.length - 1] ?? versions[0];
      }
      slots.push({ name, versions, shown, owned: owned.has(shown.id) });
    }
    const isCoach = (s: { versions: Collectible[] }) => s.versions[0].tier === "coach";
    return slots.sort((a, b) => Number(isCoach(a)) - Number(isCoach(b)) || a.name.localeCompare(b.name));
  });

  /** The previewed player's versions, for the switcher in the preview (series 1 only). */
  readonly previewVersions = computed(() => {
    const item = this.previewItem();
    if (!item || item.moment) return [];
    const rank: Record<CollectibleTier, number> = { common: 0, rare: 1, legendary: 2, coach: 3 };
    return this.teamSlots()
      .filter((c) => c.name === item.name && c.team.id === item.team.id)
      .sort((a, b) => rank[a.tier] - rank[b.tier]);
  });

  versionDotClass(card: Collectible): string {
    return this.isOwned(card) ? this.tierDotClass(card.tier) : "ring-1 ring-inset ring-muted/60";
  }

  versionsAria(versions: Collectible[]): string {
    return versions
      .map((v) => `${this.i18n.t(this.tierLabelKey(v.tier))}: ${this.i18n.t(this.isOwned(v) ? "album.versionOwned" : "album.versionMissing")}`)
      .join(", ");
  }

  toggleTierFilter(tier: CollectibleTier): void {
    this.tierFilter.update((current) => (current === tier ? null : tier));
  }

  readonly teamTierBreakdown = computed<TierBreakdown[]>(() => {
    const owned = this.ownedIds();
    const slots = this.teamSlots();
    return TIER_ORDER.map((tier) => {
      const inTier = slots.filter((c) => c.tier === tier);
      return { tier, owned: inTier.filter((c) => owned.has(c.id)).length, total: inTier.length };
    }).filter((t) => t.total > 0);
  });

  readonly overallOwnedCount = computed(() => {
    const owned = this.ownedIds();
    return this.catalog().filter((c) => owned.has(c.id)).length;
  });
  readonly overallTotalCount = computed(() => this.catalog().length);
  // The hero counts the series on screen; the whole album sits underneath
  // once there is more than one series.
  readonly seriesOwnedCount = computed(() => {
    const owned = this.ownedIds();
    return (this.series() === 1 ? this.seriesOne() : this.moments()).filter((c) => owned.has(c.id)).length;
  });
  readonly seriesTotalCount = computed(() => (this.series() === 1 ? this.seriesOne() : this.moments()).length);
  readonly overallPct = computed(() => {
    const total = this.seriesTotalCount();
    return total > 0 ? Math.round((this.seriesOwnedCount() / total) * 100) : 0;
  });

  // owned/total per team, so every crest in the strip can show its own
  // completion — not just the currently-open team.
  readonly teamCompletionCounts = computed(() => {
    const owned = this.ownedIds();
    const counts = new Map<string, { owned: number; total: number }>();
    for (const [teamId, list] of this.catalogByTeam().entries()) {
      counts.set(teamId, { owned: list.filter((c) => owned.has(c.id)).length, total: list.length });
    }
    return counts;
  });

  readonly adjacentTeamIds = computed(() => {
    const teams = this.sortedTeams();
    const index = teams.findIndex((t) => t.id === this.selectedTeamId());
    if (index === -1 || teams.length === 0) return { prev: null as string | null, next: null as string | null };
    return {
      prev: teams[(index - 1 + teams.length) % teams.length].id,
      next: teams[(index + 1) % teams.length].id,
    };
  });

  readonly previewItem = computed(() => {
    const item = this.catalog().find((c) => c.id === this.previewItemId());
    return item ? { ...item, finish: this.finishFor(item) } : null;
  });

  finishFor(card: { id: string }): CollectibleFinish {
    return this.finishByCollectibleId().get(card.id) ?? "standard";
  }

  // For the peek tabs flanking the leaflet — a dimmed sliver of the
  // previous/next team, teasing that there's another page just off-screen.
  teamById(id: string | null): Team | null {
    if (!id) return null;
    return this.sortedTeams().find((t) => t.id === id) ?? null;
  }

  constructor() {
    // Once teams are loaded, land on a real team page if the URL didn't
    // already name one (a bare "/album") — favorite team first, same
    // fallback used elsewhere in the app, else the first team alphabetically.
    effect(() => {
      if (this.routeTeamId() !== null || this.teams().length === 0) return;
      const favoriteId = this.auth.currentUser()?.favoriteTeamId;
      const teams = this.sortedTeams();
      const defaultId = favoriteId && teams.some((t) => t.id === favoriteId) ? favoriteId : teams[0].id;
      this.router.navigate(["/album", defaultId], { replaceUrl: true });
    });
  }

  // Album team switching (2026-10-27): changing team swaps the page in place
  // instead of a router navigation, which scrolled to the top of the page
  // every time. The URL still follows (replaceState), so links and refresh
  // work, and the view glides to the team's page under the sticky strip.
  readonly stickyTop = signal(64);
  private headerObserver: ResizeObserver | null = null;

  /** `scroll: false` keeps the page exactly where it is (swiping the leaflet). */
  selectTeam(teamId: string | null, opts: { scroll?: boolean } = {}): void {
    if (!teamId || teamId === this.routeTeamId()) return;
    this.routeTeamId.set(teamId);
    this.tierFilter.set(null);
    this.location.replaceState(`/album/${teamId}`);
    if (opts.scroll !== false) requestAnimationFrame(() => this.scrollToLeaf());
  }

  private scrollToLeaf(): void {
    const leaf = document.getElementById("album-leaf");
    if (!leaf) return;
    const strip = document.getElementById("album-strip")?.getBoundingClientRect().height ?? 0;
    const y = leaf.getBoundingClientRect().top + window.scrollY - this.stickyTop() - strip - 8;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }

  private watchHeaderHeight(): void {
    // The app header is sticky too; the team strip sits right under it.
    const header = document.querySelector("nav");
    if (!header || typeof ResizeObserver === "undefined") return;
    const update = () => this.stickyTop.set(Math.round(header.getBoundingClientRect().height));
    update();
    this.headerObserver = new ResizeObserver(update);
    this.headerObserver.observe(header);
  }

  ngOnDestroy(): void {
    this.headerObserver?.disconnect();
  }

  ngOnInit(): void {
    this.watchHeaderHeight();
    this.route.paramMap.subscribe((params) => {
      this.routeTeamId.set(params.get("teamId"));
      // A tier filter from the previous team's page carrying over silently
      // onto a new team (which might have far fewer cards in that tier)
      // would read as a bug, not a feature — reset on every flip.
      this.tierFilter.set(null);
    });

    this.api.getTeams().subscribe({
      next: (rows) => this.teams.set(rows),
      error: () => this.error.set(this.i18n.t("album.loadFailed")),
    });

    this.api.getCollectibles().subscribe({
      next: (rows) => {
        this.catalog.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(this.i18n.t("album.loadFailed"));
        this.loading.set(false);
      },
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyCollectibles().subscribe({
        next: (rows) => {
          this.ownedIds.set(new Set(rows.map((r) => r.collectibleId)));
          this.finishByCollectibleId.set(new Map(rows.map((r) => [r.collectibleId, r.finish])));
        },
        error: () => {},
      });
      this.api.getMyLeagues().subscribe({
        next: (rows) => this.myLeagues.set(rows),
        error: () => {},
      });
    }

    this.api.getAlbumLeaderboard().subscribe({
      next: (rows) => this.globalLeaderboard.set(rows),
      error: () => {},
    });
  }

  isOwned(collectible: Collectible): boolean {
    return this.ownedIds().has(collectible.id);
  }

  openPreview(collectible: Collectible): void {
    this.previewItemId.set(collectible.id);
  }

  closePreview(): void {
    this.previewItemId.set(null);
  }

  tierDotClass(tier: CollectibleTier): string {
    if (tier === "rare") return "bg-gradient-to-br from-[#eef1f3] to-[#9aa3ab]";
    if (tier === "legendary") return "bg-gradient-to-br from-[#f7dd85] to-[#9c7415]";
    if (tier === "coach") return "bg-gradient-to-br from-[#8ff0cb] to-[#1f9c74]";
    return "bg-[#c7ccd1]";
  }

  tierLabelKey(tier: CollectibleTier): string {
    if (tier === "rare") return "inventory.tierRare";
    if (tier === "legendary") return "inventory.tierLegendary";
    if (tier === "coach") return "inventory.tierCoach";
    return "inventory.tierCommon";
  }

  // Swipe-to-flip — pointer events so this covers touch and mouse drag
  // alike. Only reacts on release, past a distance threshold and only when
  // the drag is more horizontal than vertical, so it never fights the
  // page's own vertical scroll or swallows a plain tap on a card underneath
  // (a tap's deltaX is ~0, well under the threshold). [touch-action:pan-y]
  // on the leaflet (album.html) is what keeps native vertical scrolling
  // working during the gesture — without it the browser treats the touch
  // as ambiguous and can block scrolling entirely while it waits to see if
  // this handler calls preventDefault.
  private static readonly SWIPE_THRESHOLD_PX = 60;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;

  onLeafletPointerDown(event: PointerEvent): void {
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
  }

  onLeafletPointerUp(event: PointerEvent): void {
    if (this.dragPointerId !== event.pointerId) return;
    this.dragPointerId = null;

    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    if (Math.abs(deltaX) < AlbumComponent.SWIPE_THRESHOLD_PX || Math.abs(deltaX) < Math.abs(deltaY)) return;

    const targetId = deltaX < 0 ? this.adjacentTeamIds().next : this.adjacentTeamIds().prev;
    // In place, without scrolling: a swipe flips the page where you are.
    this.selectTeam(targetId, { scroll: false });
  }

  onLeafletPointerCancel(event: PointerEvent): void {
    if (this.dragPointerId === event.pointerId) this.dragPointerId = null;
  }
}
