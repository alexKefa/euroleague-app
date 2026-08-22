import { Component, OnInit, inject, signal, computed, effect } from "@angular/core";
import { CommonModule } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { Collectible, CollectibleTier, Team } from "../../core/models";
import { CollectibleCardComponent } from "../store/collectible-card";
import { CardPreviewComponent } from "../store/card-preview";
import { PageHintComponent } from "../../shared/page-hint";
import { RetryImgDirective } from "../../shared/retry-img.directive";

interface TierBreakdown {
  tier: CollectibleTier;
  owned: number;
  total: number;
}

// There's no stored "sticker slot number" anywhere in the catalog — this is
// purely a display order so a team's page looks the same across visits:
// commons first, then rares, then legendaries, alphabetical within a tier.
const TIER_ORDER: CollectibleTier[] = ["common", "rare", "legendary"];

@Component({
  selector: "app-album",
  standalone: true,
  imports: [CommonModule, RouterLink, CollectibleCardComponent, CardPreviewComponent, PageHintComponent, RetryImgDirective],
  templateUrl: "./album.html",
  styleUrl: "./album.css",
})
export class AlbumComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  private readonly teams = signal<Team[]>([]);
  private readonly catalog = signal<Collectible[]>([]);
  private readonly ownedIds = signal<Set<string>>(new Set());
  private readonly routeTeamId = signal<string | null>(null);
  private readonly previewItemId = signal<string | null>(null);

  readonly sortedTeams = computed(() => [...this.teams()].sort((a, b) => a.name.localeCompare(b.name)));

  readonly selectedTeamId = computed(() => this.routeTeamId());
  readonly selectedTeam = computed(() => this.sortedTeams().find((t) => t.id === this.selectedTeamId()) ?? null);

  private readonly catalogByTeam = computed(() => {
    const byTeam = new Map<string, Collectible[]>();
    for (const c of this.catalog()) {
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

  readonly teamTierBreakdown = computed<TierBreakdown[]>(() => {
    const owned = this.ownedIds();
    const slots = this.teamSlots();
    return TIER_ORDER.map((tier) => {
      const inTier = slots.filter((c) => c.tier === tier);
      return { tier, owned: inTier.filter((c) => owned.has(c.id)).length, total: inTier.length };
    }).filter((t) => t.total > 0);
  });

  readonly overallOwnedCount = computed(() => this.ownedIds().size);
  readonly overallTotalCount = computed(() => this.catalog().length);

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

  readonly previewItem = computed(() => this.teamSlots().find((c) => c.id === this.previewItemId()) ?? null);

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

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => this.routeTeamId.set(params.get("teamId")));

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
        next: (rows) => this.ownedIds.set(new Set(rows.map((r) => r.collectibleId))),
        error: () => {},
      });
    }
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
    return "bg-[#c7ccd1]";
  }

  tierLabelKey(tier: CollectibleTier): string {
    if (tier === "rare") return "inventory.tierRare";
    if (tier === "legendary") return "inventory.tierLegendary";
    return "inventory.tierCommon";
  }
}
