import { Component, OnInit, OnDestroy, inject, signal, computed, effect, viewChild, ElementRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleTier, CollectibleBundle, CollectibleBundleCard } from "../../core/models";
import { TradesNotificationService } from "../../core/trades-notification.service";
import { CardStackComponent } from "../store/card-stack";
import { CardPreviewComponent } from "../store/card-preview";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { PageHintComponent } from "../../shared/page-hint";
import { ChipDirective } from "../../shared/chip.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SkeletonComponent } from "../../shared/skeleton";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { SearchInputComponent } from "../../shared/search-input";

// Matches store.ts's PAGE_SIZE — same "reveal a page at a time" convention,
// even though this page's data (already fully fetched client-side) doesn't
// need server-side pagination the way the full catalog does.
const PAGE_SIZE = 20;

@Component({
  selector: "app-inventory",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardStackComponent,
    CardPreviewComponent,
    NavIconComponent,
    PageHintComponent,
    ChipDirective,
    DropdownComponent,
    SkeletonComponent,
    ButtonDirective,
    LogoSpinnerComponent,
    SearchInputComponent,
  ],
  templateUrl: "./inventory.html",
})
export class InventoryComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  protected trades = inject(TradesNotificationService);

  // Colors are grounded in hues already meaningful elsewhere: highlight is
  // the brand default, gold matches the wheel's own legendary wedge,
  // emerald matches the app's existing "unlocked"/"correct" green.
  protected readonly hubTiles: { path: string; icon: NavIconName; iconClass: string; labelKey: string }[] = [
    { path: "/store", icon: "store", iconClass: "text-highlight", labelKey: "store.title" },
    { path: "/wheel", icon: "wheel", iconClass: "text-[#E8B23C]", labelKey: "store.jumpBall" },
    { path: "/packs", icon: "packs", iconClass: "text-sky-400", labelKey: "store.packs" },
    { path: "/trades", icon: "trade", iconClass: "text-emerald-500", labelKey: "store.trades" },
    { path: "/album", icon: "album", iconClass: "text-accent2", labelKey: "album.hubTile" },
  ];

  readonly loading = signal(true);
  readonly points = signal(0);
  readonly pointsLoading = signal(true);
  private readonly allCollectibles = signal<Collectible[]>([]);
  // collectibleId -> unlockedAt (ISO string) — used both to know what's
  // owned and to sort bundles by most-recent acquisition.
  private readonly ownedAt = signal<Map<string, string>>(new Map());
  private readonly myCollectibleIds = computed(() => new Set(this.ownedAt().keys()));

  readonly tierFilter = signal<CollectibleTier | null>(null);
  readonly tierOptions: { value: CollectibleTier | null; labelKey: string }[] = [
    { value: null, labelKey: "inventory.tierAll" },
    { value: "common", labelKey: "inventory.tierCommon" },
    { value: "rare", labelKey: "inventory.tierRare" },
    { value: "legendary", labelKey: "inventory.tierLegendary" },
  ];
  private readonly tierLabelKeys: Record<CollectibleTier, string> = {
    common: "store.tierCommon",
    rare: "store.tierRare",
    legendary: "store.tierLegendary",
  };
  tierLabel(tier: CollectibleTier): string {
    return this.i18n.t(this.tierLabelKeys[tier]);
  }

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);

  // Same bundling as the Store page (backend/src/routes/collectibles.ts's
  // GET /browse): every tier a player has (common/rare/legendary share the
  // same name+team, generated together — see expand-collectibles.ts) reads
  // as one stacked tile instead of separate flat rows. Built client-side
  // here rather than reusing /browse, since this page already fetches the
  // full flat catalog in one shot (inventory/profile/album need every card
  // at once to compute ownership) and /browse's pagination is over the
  // whole catalog, not "cards I own" — filtering that down to owned bundles
  // after the fact would need an unpredictable number of pages just to fill
  // one screen once a player owns a small fraction of the catalog.
  private readonly allBundles = computed<CollectibleBundle[]>(() => {
    const byKey = new Map<string, CollectibleBundle>();
    const order: string[] = [];
    const tierRank: Record<CollectibleTier, number> = { common: 0, rare: 1, legendary: 2 };
    for (const c of this.allCollectibles()) {
      const key = `${c.team.id}|${c.name}`;
      let bundle = byKey.get(key);
      if (!bundle) {
        bundle = { name: c.name, team: c.team, cards: [] };
        byKey.set(key, bundle);
        order.push(key);
      }
      bundle.cards.push(c as CollectibleBundleCard);
    }
    for (const bundle of byKey.values()) {
      bundle.cards.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);
    }
    return order
      .map((key) => byKey.get(key)!)
      .sort((a, b) => a.team.name.localeCompare(b.team.name) || a.name.localeCompare(b.name));
  });

  // Only bundles with at least one owned card — this page is "my cards",
  // not the full catalog. Most-recently-acquired first: landing here after
  // a pack/wheel pull should show you what you just got, not bury it in
  // catalog order — a bundle's sort key is the newest unlockedAt among its
  // owned cards, so completing a tier you were missing jumps it back to
  // the top even if you already owned another tier of it long ago.
  readonly myBundles = computed(() => {
    const ownedAt = this.ownedAt();
    return this.allBundles()
      .filter((b) => b.cards.some((c) => ownedAt.has(c.id)))
      .map((b) => ({
        bundle: b,
        newestAcquired: Math.max(...b.cards.filter((c) => ownedAt.has(c.id)).map((c) => new Date(ownedAt.get(c.id)!).getTime())),
      }))
      .sort((a, b) => b.newestAcquired - a.newestAcquired)
      .map(({ bundle }) => bundle);
  });

  // Only teams you actually own a card from — no point offering a filter
  // option that would always come back empty.
  readonly filterTeams = computed(() => {
    const byId = new Map<string, CollectibleBundle["team"]>();
    for (const b of this.myBundles()) byId.set(b.team.id, b.team);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly teamDropdownOptions = computed<DropdownOption[]>(() => [
    { value: "", label: this.i18n.t("store.allTeams") },
    ...this.filterTeams().map((t) => ({ value: t.id, label: t.name, logoUrl: t.logoUrl })),
  ]);

  // Same "which bundles show up" semantics as store.ts's tier chips, but
  // scoped to *owned* cards — a "Legendary" filter here means "bundles
  // where I own the legendary," not "bundles that have one," since this
  // page is about what you've actually unlocked.
  readonly filteredBundles = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const team = this.teamFilter();
    const tier = this.tierFilter();
    const ownedAt = this.ownedAt();
    return this.myBundles().filter((b) => {
      if (team && b.team.id !== team) return false;
      if (tier && !b.cards.some((c) => c.tier === tier && ownedAt.has(c.id))) return false;
      if (query && !b.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  // Same "reveal a page at a time" UX as store.ts's infinite scroll, but
  // windowing an already-fully-fetched array instead of paginating a
  // server request — this data is one user's owned bundles, not the full
  // catalog, so there's nothing to page over the network. The fix is for
  // DOM size, not fetch size: rendering every owned bundle's stack tile at
  // once got laggy once a player owned a few hundred cards, not the
  // initial fetch itself.
  readonly visibleCount = signal(PAGE_SIZE);
  readonly loadingMore = signal(false);
  readonly visibleBundles = computed(() => this.filteredBundles().slice(0, this.visibleCount()));
  readonly hasMore = computed(() => this.visibleCount() < this.filteredBundles().length);

  private readonly sentinel = viewChild<ElementRef<HTMLDivElement>>("scrollSentinel");
  private observer?: IntersectionObserver;

  constructor() {
    effect(() => {
      const el = this.sentinel()?.nativeElement;
      if (!el) return;
      this.observer?.disconnect();
      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) this.loadMore();
        },
        { rootMargin: "600px" }
      );
      this.observer.observe(el);
    });
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    // Deferred a tick so the loader actually gets to paint before the (the
    // whole point of this page) comparatively expensive DOM work of
    // revealing the next page of bundles runs.
    setTimeout(() => {
      this.visibleCount.update((n) => n + PAGE_SIZE);
      this.loadingMore.set(false);
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  clearFilters(): void {
    this.searchQuery.set("");
    this.teamFilter.set(null);
    this.tierFilter.set(null);
    this.visibleCount.set(PAGE_SIZE);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    this.visibleCount.set(PAGE_SIZE);
  }

  setTeamFilter(team: string | null): void {
    this.teamFilter.set(team);
    this.visibleCount.set(PAGE_SIZE);
  }

  setTierFilter(tier: CollectibleTier | null): void {
    this.tierFilter.set(tier);
    this.visibleCount.set(PAGE_SIZE);
  }

  // Same as store.ts's identically-named helpers — the stack tile's front
  // face is whichever tier the user owns highest (most satisfying thing to
  // show off), falling back to the lowest/cheapest tier.
  frontCard(bundle: CollectibleBundle): CollectibleBundleCard {
    for (let i = bundle.cards.length - 1; i >= 0; i--) {
      if (this.myCollectibleIds().has(bundle.cards[i].id)) return bundle.cards[i];
    }
    return bundle.cards[0];
  }

  unlockedCount(bundle: CollectibleBundle): number {
    return bundle.cards.filter((c) => this.myCollectibleIds().has(c.id)).length;
  }

  bundleKey(bundle: CollectibleBundle): string {
    return `${bundle.team.id}|${bundle.name}`;
  }

  isUnlocked(card: { id: string }): boolean {
    return this.myCollectibleIds().has(card.id);
  }

  private readonly previewBundle = signal<CollectibleBundle | null>(null);
  readonly previewTierIndex = signal(0);
  readonly previewItem = computed<Collectible | null>(() => {
    const bundle = this.previewBundle();
    if (!bundle) return null;
    const card = bundle.cards[this.previewTierIndex()] ?? bundle.cards[0];
    return { ...card, team: bundle.team };
  });
  readonly previewCards = computed<CollectibleBundleCard[]>(() => this.previewBundle()?.cards ?? []);

  openPreview(bundle: CollectibleBundle): void {
    this.previewBundle.set(bundle);
    this.previewTierIndex.set(this.defaultTierIndexFor(bundle));
  }

  selectPreviewTier(index: number): void {
    this.previewTierIndex.set(index);
  }

  closePreview(): void {
    this.previewBundle.set(null);
  }

  private defaultTierIndexFor(bundle: CollectibleBundle): number {
    for (let i = bundle.cards.length - 1; i >= 0; i--) {
      if (this.myCollectibleIds().has(bundle.cards[i].id)) return i;
    }
    return 0;
  }

  ngOnInit(): void {
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      this.pointsLoading.set(false);
      return;
    }

    this.api.getCollectibles().subscribe({
      next: (rows) => {
        this.allCollectibles.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.api.getMyCollectibles().subscribe({
      next: (rows) => this.ownedAt.set(new Map(rows.map((r) => [r.collectibleId, r.unlockedAt]))),
      error: () => {},
    });

    this.api.getMyPredictionSummary().subscribe({
      next: (summary) => {
        this.points.set(summary.points);
        this.pointsLoading.set(false);
      },
      error: () => this.pointsLoading.set(false),
    });
  }
}
