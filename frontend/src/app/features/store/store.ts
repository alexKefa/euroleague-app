import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleTier } from "../../core/models";
import { CollectibleCardComponent } from "./collectible-card";
import { CardPreviewComponent } from "./card-preview";
import { RetryImgDirective } from "../../shared/retry-img.directive";

@Component({
  selector: "app-store",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, CardPreviewComponent, RetryImgDirective],
  templateUrl: "./store.html",
})
export class StoreComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly collectibles = signal<Collectible[]>([]);
  readonly myCollectibleIds = signal<Set<string>>(new Set());
  readonly points = signal(0);
  readonly pointsLoading = signal(true);
  readonly loading = signal(true);
  private readonly previewItemId = signal<string | null>(null);
  readonly previewItem = computed(
    () => this.collectibles().find((c) => c.id === this.previewItemId()) ?? null
  );

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);
  readonly tierFilter = signal<CollectibleTier | null>(null);
  readonly tierOptions: { value: CollectibleTier | null; key: string }[] = [
    { value: null, key: "store.tierAll" },
    { value: "common", key: "store.tierCommon" },
    { value: "rare", key: "store.tierRare" },
    { value: "legendary", key: "store.tierLegendary" },
  ];

  readonly filterTeams = computed(() => {
    const byId = new Map<string, Collectible["team"]>();
    for (const c of this.collectibles()) byId.set(c.team.id, c.team);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly selectedTeamLogo = computed(
    () => this.filterTeams().find((t) => t.id === this.teamFilter())?.logoUrl ?? null
  );

  readonly filteredCollectibles = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const team = this.teamFilter();
    const tier = this.tierFilter();
    const ownedIds = this.myCollectibleIds();
    return this.collectibles()
      .filter((c) => {
        if (team && c.team.id !== team) return false;
        if (tier && c.tier !== tier) return false;
        if (query && !c.name.toLowerCase().includes(query)) return false;
        return true;
      })
      .sort((a, b) => Number(ownedIds.has(b.id)) - Number(ownedIds.has(a.id)));
  });

  readonly imageSavingId = signal<string | null>(null);
  readonly imageErrors = signal<Record<string, string>>({});

  ngOnInit(): void {
    this.loadCollectibles();

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

  private loadCollectibles(): void {
    this.api.getCollectibles().subscribe({
      next: (rows) => {
        this.collectibles.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  openPreview(collectible: Collectible): void {
    this.previewItemId.set(collectible.id);
  }

  closePreview(): void {
    this.previewItemId.set(null);
  }

  isUnlocked(collectible: Collectible): boolean {
    return this.myCollectibleIds().has(collectible.id);
  }

  setImage(collectible: Collectible, imageUrl: string): void {
    if (!imageUrl.trim() || this.imageSavingId()) return;
    this.imageSavingId.set(collectible.id);
    this.clearImageError(collectible.id);

    this.api.updateCollectibleImage(collectible.id, imageUrl.trim()).subscribe({
      next: () => {
        this.imageSavingId.set(null);
        this.loadCollectibles();
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
}
