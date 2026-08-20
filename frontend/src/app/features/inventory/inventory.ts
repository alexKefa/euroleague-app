import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleTier } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { CardPreviewComponent } from "../store/card-preview";

@Component({
  selector: "app-inventory",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, CardPreviewComponent],
  templateUrl: "./inventory.html",
})
export class InventoryComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly loading = signal(true);
  private readonly allCollectibles = signal<Collectible[]>([]);
  private readonly ownedIds = signal<Set<string>>(new Set());
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

  readonly myCollectibles = computed(() =>
    this.allCollectibles().filter((c) => this.ownedIds().has(c.id))
  );

  // Only teams you actually own a card from — no point offering a filter
  // option that would always come back empty.
  readonly filterTeams = computed(() => {
    const byId = new Map<string, Collectible["team"]>();
    for (const c of this.myCollectibles()) byId.set(c.team.id, c.team);
    return [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  });

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
      next: (rows) => this.ownedIds.set(new Set(rows.map((r) => r.collectibleId))),
      error: () => {},
    });
  }

  openPreview(collectible: Collectible): void {
    this.previewItemId.set(collectible.id);
  }

  closePreview(): void {
    this.previewItemId.set(null);
  }
}
