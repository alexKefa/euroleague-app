import { Component, OnInit, OnDestroy, inject, signal, computed, effect, viewChild, ElementRef } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleBundle, CollectibleBundleCard, CollectibleTier, CollectibleTeamFilter } from "../../core/models";
import { CardStackComponent } from "./card-stack";
import { CardPreviewComponent } from "./card-preview";
import { ChipDirective } from "../../shared/chip.directive";
import { ButtonDirective } from "../../shared/button.directive";
import { LogoSpinnerComponent } from "../../shared/logo-spinner";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { SkeletonComponent } from "../../shared/skeleton";
import { SearchInputComponent } from "../../shared/search-input";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: "app-store",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardStackComponent,
    CardPreviewComponent,
    ChipDirective,
    ButtonDirective,
    LogoSpinnerComponent,
    DropdownComponent,
    SkeletonComponent,
    SearchInputComponent,
  ],
  templateUrl: "./store.html",
})
export class StoreComponent implements OnInit, OnDestroy {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // Bundles fetched so far for the current filter set — grows as loadMore()
  // appends pages; reset to empty whenever a filter changes (see resetAndLoad).
  readonly bundles = signal<CollectibleBundle[]>([]);
  readonly myCollectibleIds = signal<Set<string>>(new Set());
  readonly points = signal(0);
  readonly pointsLoading = signal(true);
  readonly loading = signal(true);
  // True only until the very first fetch resolves, then never again — see
  // fetchPage(). Distinct from `loading` (which flips true on every
  // search/filter refetch too): the search bar and filter row are gated on
  // this instead of `loading`, otherwise every debounced keystroke tore
  // down and rebuilt the whole filter row on refetch, silently dropping
  // focus out of the search input mid-typing.
  readonly initialLoad = signal(true);
  readonly loadingMore = signal(false);
  readonly hasMore = signal(false);
  private offset = 0;
  // Bumped on every filter change so a slow in-flight response from a since-
  // superseded search/filter can't land after a newer one already has.
  private requestToken = 0;
  private searchDebounceHandle?: ReturnType<typeof setTimeout>;

  private readonly sentinel = viewChild<ElementRef<HTMLDivElement>>("scrollSentinel");
  private observer?: IntersectionObserver;

  private readonly previewBundle = signal<CollectibleBundle | null>(null);
  readonly previewTierIndex = signal(0);
  // The modal (CardPreviewComponent) only knows how to show one Collectible
  // at a time — this merges whichever tier is selected with the bundle's
  // shared team into that shape, so the modal itself needed zero changes.
  readonly previewItem = computed<Collectible | null>(() => {
    const bundle = this.previewBundle();
    if (!bundle) return null;
    const card = bundle.cards[this.previewTierIndex()] ?? bundle.cards[0];
    return { ...card, team: bundle.team };
  });
  readonly previewCards = computed<CollectibleBundleCard[]>(() => this.previewBundle()?.cards ?? []);

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);
  readonly tierFilter = signal<CollectibleTier | null>(null);
  readonly hasActiveFilters = computed(
    () => this.searchQuery().trim().length > 0 || this.teamFilter() !== null || this.tierFilter() !== null
  );
  readonly tierOptions: { value: CollectibleTier | null; key: string }[] = [
    { value: null, key: "store.tierAll" },
    { value: "common", key: "store.tierCommon" },
    { value: "rare", key: "store.tierRare" },
    { value: "legendary", key: "store.tierLegendary" },
    { value: "coach", key: "store.tierCoach" },
  ];
  private readonly tierLabelKeys: Record<CollectibleTier, string> = {
    common: "store.tierCommon",
    rare: "store.tierRare",
    legendary: "store.tierLegendary",
    coach: "store.tierCoach",
  };
  tierLabel(tier: CollectibleTier): string {
    return this.i18n.t(this.tierLabelKeys[tier]);
  }

  // Independent of whatever page(s) have loaded so far — derived from a
  // dedicated endpoint rather than the loaded `bundles`, otherwise the
  // dropdown would only ever list teams the user happened to scroll to.
  readonly filterTeams = signal<CollectibleTeamFilter[]>([]);

  readonly teamDropdownOptions = computed<DropdownOption[]>(() => [
    { value: "", label: this.i18n.t("store.allTeams") },
    ...this.filterTeams().map((t) => ({ value: t.id, label: t.name, logoUrl: t.logoUrl })),
  ]);

  // Mobile-only stand-in for the tierOptions chip row below — five chips
  // (All/Common/Rare/Legendary/Coach, since the coach tier was added) no
  // longer fit a narrow screen without cramming or wrapping, same problem
  // the dropdown already solves for the team filter.
  readonly tierDropdownOptions = computed<DropdownOption[]>(() =>
    this.tierOptions.map((opt) => ({ value: opt.value ?? "", label: this.i18n.t(opt.key) })),
  );

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

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
    this.searchDebounceHandle = setTimeout(() => this.resetAndLoad(), SEARCH_DEBOUNCE_MS);
  }

  setTeamFilter(team: string | null): void {
    this.teamFilter.set(team);
    this.resetAndLoad();
  }

  setTierFilter(tier: CollectibleTier | null): void {
    this.tierFilter.set(tier);
    this.resetAndLoad();
  }

  // app-dropdown emits a plain string ("" for "All", same convention as
  // the team filter) — narrow it back to CollectibleTier before delegating,
  // since it only ever carries a value this component itself put in
  // tierDropdownOptions.
  setTierFilterFromDropdown(value: string | null): void {
    this.setTierFilter((value || null) as CollectibleTier | null);
  }

  clearFilters(): void {
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
    this.searchQuery.set("");
    this.teamFilter.set(null);
    this.tierFilter.set(null);
    this.resetAndLoad();
  }

  private resetAndLoad(): void {
    this.offset = 0;
    this.hasMore.set(false);
    this.bundles.set([]);
    this.loading.set(true);
    this.fetchPage();
  }

  loadMore(): void {
    if (this.loading() || this.loadingMore() || !this.hasMore()) return;
    this.fetchPage();
  }

  private fetchPage(): void {
    const token = ++this.requestToken;
    const isFirstPage = this.offset === 0;
    if (!isFirstPage) this.loadingMore.set(true);

    this.api
      .browseCollectibles({
        limit: PAGE_SIZE,
        offset: this.offset,
        search: this.searchQuery().trim() || undefined,
        team: this.teamFilter(),
        tier: this.tierFilter(),
      })
      .subscribe({
        next: (page) => {
          if (token !== this.requestToken) return;
          this.bundles.update((existing) => (isFirstPage ? page.items : [...existing, ...page.items]));
          this.offset += page.items.length;
          this.hasMore.set(page.hasMore);
          this.loading.set(false);
          this.loadingMore.set(false);
          this.initialLoad.set(false);
        },
        error: () => {
          if (token !== this.requestToken) return;
          this.loading.set(false);
          this.loadingMore.set(false);
          this.initialLoad.set(false);
        },
      });
  }

  readonly imageSavingId = signal<string | null>(null);
  readonly imageErrors = signal<Record<string, string>>({});
  // Pinned to the preview modal's always-visible top bar (not the
  // scrollable content column) since the admin image-set form used to sit
  // at the very bottom of that column, below the buy button — on a
  // shorter viewport the column already overflows before reaching it, so
  // it was effectively unreachable. Collapsed by default so it doesn't
  // compete for space with the card for the vast majority of viewers who
  // aren't admins.
  readonly showAdminEdit = signal(false);

  readonly purchasingId = signal<string | null>(null);
  readonly purchaseErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.fetchPage();

    this.api.getCollectibleTeams().subscribe({
      next: (teams) => this.filterTeams.set(teams),
      error: () => {},
    });

    if (this.auth.isAuthenticated()) {
      this.api.getMyCollectibles().subscribe({
        next: (rows) => this.myCollectibleIds.set(new Set(rows.map((r) => r.collectibleId))),
        error: () => {},
      });

      this.api.getMyPredictionSummary().subscribe({
        next: (summary) => {
          this.points.set(summary.points);
          this.pointsLoading.set(false);
        },
        error: () => this.pointsLoading.set(false),
      });
    } else {
      this.pointsLoading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.searchDebounceHandle) clearTimeout(this.searchDebounceHandle);
  }

  // An active tier filter wins first — the tier chips include a bundle if
  // it has *any* card of that tier (see routes/collectibles.ts's /browse
  // comment), but still showing a different tier's face made filtering
  // "Legendary" look broken when the front face was some other tier the
  // user happened to own. With no filter: whichever tier the user owns
  // highest (most satisfying thing to show off), falling back to the
  // lowest/cheapest tier — showing a locked legendary front when the user
  // actually owns the common would read as "you don't have this" for a
  // bundle they're 1/3 into.
  frontCard(bundle: CollectibleBundle): CollectibleBundleCard {
    const filterTier = this.tierFilter();
    const filterMatch = filterTier && bundle.cards.find((c) => c.tier === filterTier);
    if (filterMatch) return filterMatch;
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

  openPreview(bundle: CollectibleBundle): void {
    this.previewBundle.set(bundle);
    this.previewTierIndex.set(this.defaultTierIndexFor(bundle));
    this.showAdminEdit.set(false);
  }

  selectPreviewTier(index: number): void {
    this.previewTierIndex.set(index);
  }

  closePreview(): void {
    this.previewBundle.set(null);
    this.showAdminEdit.set(false);
  }

  private defaultTierIndexFor(bundle: CollectibleBundle): number {
    const filterTier = this.tierFilter();
    if (filterTier) {
      const idx = bundle.cards.findIndex((c) => c.tier === filterTier);
      if (idx >= 0) return idx;
    }
    for (let i = bundle.cards.length - 1; i >= 0; i--) {
      if (this.myCollectibleIds().has(bundle.cards[i].id)) return i;
    }
    return 0;
  }

  isUnlocked(card: { id: string }): boolean {
    return this.myCollectibleIds().has(card.id);
  }

  setImage(collectible: Collectible, imageUrl: string): void {
    if (!imageUrl.trim() || this.imageSavingId()) return;
    this.imageSavingId.set(collectible.id);
    this.clearImageError(collectible.id);

    this.api.updateCollectibleImage(collectible.id, imageUrl.trim()).subscribe({
      next: (updated) => {
        this.imageSavingId.set(null);
        const applyUpdate = (bundle: CollectibleBundle): CollectibleBundle =>
          bundle.team.id === collectible.team.id && bundle.name === collectible.name
            ? { ...bundle, cards: bundle.cards.map((c) => (c.id === collectible.id ? { ...c, imageUrl: updated.imageUrl } : c)) }
            : bundle;
        this.bundles.update((list) => list.map(applyUpdate));
        this.previewBundle.update((bundle) => (bundle ? applyUpdate(bundle) : bundle));
      },
      error: (err) => {
        this.imageSavingId.set(null);
        this.imageErrors.update((errors) => ({
          ...errors,
          [collectible.id]: err?.error?.error ?? "Failed to save — is the backend running?",
        }));
      },
    });
  }

  private clearImageError(id: string): void {
    this.imageErrors.update((errors) => {
      const { [id]: _removed, ...rest } = errors;
      return rest;
    });
  }

  canAfford(collectible: Collectible): boolean {
    return collectible.buyPrice !== null && this.points() >= collectible.buyPrice;
  }

  buy(collectible: Collectible): void {
    if (this.purchasingId() || collectible.buyPrice === null) return;
    this.purchasingId.set(collectible.id);
    this.purchaseErrors.update((errors) => {
      const { [collectible.id]: _removed, ...rest } = errors;
      return rest;
    });

    this.api.purchaseCollectible(collectible.id).subscribe({
      next: ({ pointsSpent }) => {
        this.purchasingId.set(null);
        this.myCollectibleIds.update((ids) => new Set(ids).add(collectible.id));
        this.points.update((p) => p - pointsSpent);
      },
      error: (err) => {
        this.purchasingId.set(null);
        this.purchaseErrors.update((errors) => ({
          ...errors,
          [collectible.id]: err?.error?.error ?? "Failed to buy — is the backend running?",
        }));
      },
    });
  }
}
