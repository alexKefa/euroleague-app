import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleTier } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { CardPreviewComponent } from "../store/card-preview";
import { NavIconComponent, NavIconName } from "../../shared/nav-icon";
import { PageHintComponent } from "../../shared/page-hint";
import { ChipDirective } from "../../shared/chip.directive";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";

@Component({
  selector: "app-inventory",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CollectibleCardComponent,
    CardPreviewComponent,
    NavIconComponent,
    PageHintComponent,
    ChipDirective,
    DropdownComponent,
  ],
  templateUrl: "./inventory.html",
})
export class InventoryComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  // Colors are grounded in hues already meaningful elsewhere: highlight is
  // the brand default, gold matches the wheel's own legendary wedge,
  // emerald matches the app's existing "unlocked"/"correct" green.
  protected readonly hubTiles: { path: string; icon: NavIconName; iconClass: string; labelKey: string }[] = [
    { path: "/store", icon: "store", iconClass: "text-highlight", labelKey: "store.title" },
    { path: "/wheel", icon: "wheel", iconClass: "text-[#E8B23C]", labelKey: "store.jumpBall" },
    { path: "/packs", icon: "packs", iconClass: "text-sky-400", labelKey: "store.packs" },
    { path: "/trades", icon: "trade", iconClass: "text-emerald-500", labelKey: "store.trades" },
  ];

  readonly loading = signal(true);
  readonly points = signal(0);
  readonly pointsLoading = signal(true);
  private readonly allCollectibles = signal<Collectible[]>([]);
  // collectibleId -> unlockedAt (ISO string) — a Map instead of a Set so the
  // default sort (most recently acquired first) has a timestamp to sort by.
  private readonly ownedAt = signal<Map<string, string>>(new Map());
  private readonly previewItemId = signal<string | null>(null);

  readonly tierFilter = signal<CollectibleTier | null>(null);
  readonly tierOptions: { value: CollectibleTier | null; labelKey: string }[] = [
    { value: null, labelKey: "inventory.tierAll" },
    { value: "common", labelKey: "inventory.tierCommon" },
    { value: "rare", labelKey: "inventory.tierRare" },
    { value: "legendary", labelKey: "inventory.tierLegendary" },
  ];

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);

  // Most recently acquired first — landing here after a pack/wheel pull
  // should show you what you just got, not bury it in catalog order.
  readonly myCollectibles = computed(() => {
    const ownedAt = this.ownedAt();
    return this.allCollectibles()
      .filter((c) => ownedAt.has(c.id))
      .sort((a, b) => new Date(ownedAt.get(b.id)!).getTime() - new Date(ownedAt.get(a.id)!).getTime());
  });

  // Only teams you actually own a card from — no point offering a filter
  // option that would always come back empty.
  readonly filterTeams = computed(() => {
    const byId = new Map<string, Collectible["team"]>();
    for (const c of this.myCollectibles()) byId.set(c.team.id, c.team);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly teamDropdownOptions = computed<DropdownOption[]>(() => [
    { value: "", label: this.i18n.t("store.allTeams") },
    ...this.filterTeams().map((t) => ({ value: t.id, label: t.name, logoUrl: t.logoUrl })),
  ]);

  readonly filteredCollectibles = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const team = this.teamFilter();
    const tier = this.tierFilter();
    return this.myCollectibles().filter((c) => {
      if (team && c.team.id !== team) return false;
      if (tier && c.tier !== tier) return false;
      if (query && !c.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });
  readonly previewItem = computed(
    () => this.myCollectibles().find((c) => c.id === this.previewItemId()) ?? null
  );

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

  openPreview(collectible: Collectible): void {
    this.previewItemId.set(collectible.id);
  }

  closePreview(): void {
    this.previewItemId.set(null);
  }
}
