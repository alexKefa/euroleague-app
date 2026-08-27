import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink, ActivatedRoute } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { PlayerAdvancedStatsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { SearchInputComponent } from "../../shared/search-input";

type Side = "a" | "b";

interface CompareCategory {
  key: string;
  labelKey: string;
  get: (row: PlayerAdvancedStatsRow) => number | null;
  format: (value: number) => string;
  higherIsBetter: boolean;
}

// Curated head-to-head set — scoring, rebounding, playmaking, defense,
// efficiency, ball security. Not the same list as advanced-stats.ts's
// COLUMNS (that's a leaderboard-sort context; this is "who's better at
// this one thing"), so it's its own definition rather than a shared const.
const CATEGORIES: CompareCategory[] = [
  { key: "pts", labelKey: "stats.compare.statPts", get: (r) => r.stats.pointsPerGame, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "reb", labelKey: "stats.compare.statReb", get: (r) => r.stats.reboundsPerGame, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "ast", labelKey: "stats.compare.statAst", get: (r) => r.stats.assistsPerGame, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "stl", labelKey: "stats.compare.statStl", get: (r) => r.stats.stealsPerGame, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "blk", labelKey: "stats.compare.statBlk", get: (r) => r.stats.blocksPerGame, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "tov", labelKey: "stats.compare.statTov", get: (r) => r.stats.turnoversPerGame, format: (v) => v.toFixed(1), higherIsBetter: false },
  { key: "fg", labelKey: "stats.compare.statFg", get: (r) => r.stats.fieldGoalPct, format: (v) => `${v.toFixed(1)}%`, higherIsBetter: true },
  { key: "pir", labelKey: "stats.compare.statPir", get: (r) => r.stats.valuation, format: (v) => v.toFixed(1), higherIsBetter: true },
  { key: "ts", labelKey: "stats.compare.statTs", get: (r) => r.stats.trueShootingPct, format: (v) => `${v.toFixed(1)}%`, higherIsBetter: true },
  { key: "astTo", labelKey: "stats.compare.statAstTo", get: (r) => r.stats.assistToTurnoverRatio, format: (v) => v.toFixed(1), higherIsBetter: true },
];

const MAX_SUGGESTIONS = 8;

@Component({
  selector: "app-player-compare",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, SkeletonComponent, SearchInputComponent],
  templateUrl: "./player-compare.html",
  styles: [
    `
      @keyframes compareRise {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .compare-rise {
        animation: compareRise 0.35s ease-out both;
      }
    `,
  ],
})
export class PlayerCompareComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  protected i18n = inject(I18nService);

  readonly categories = CATEGORIES;
  readonly loading = signal(true);
  readonly allRows = signal<PlayerAdvancedStatsRow[]>([]);

  readonly queryA = signal("");
  readonly queryB = signal("");
  readonly selectedAId = signal<string | null>(null);
  readonly selectedBId = signal<string | null>(null);

  readonly rowA = computed(() => this.allRows().find((r) => r.player.id === this.selectedAId()) ?? null);
  readonly rowB = computed(() => this.allRows().find((r) => r.player.id === this.selectedBId()) ?? null);

  readonly suggestionsA = computed(() => this.suggestionsFor(this.queryA(), this.selectedBId()));
  readonly suggestionsB = computed(() => this.suggestionsFor(this.queryB(), this.selectedAId()));

  readonly tally = computed(() => {
    const a = this.rowA();
    const b = this.rowB();
    let winsA = 0;
    let winsB = 0;
    if (a && b) {
      for (const cat of CATEGORIES) {
        const winner = this.winnerFor(cat, a, b);
        if (winner === "a") winsA++;
        else if (winner === "b") winsB++;
      }
    }
    return { winsA, winsB };
  });

  ngOnInit(): void {
    this.api.getAdvancedStats().subscribe({
      next: (res) => {
        this.allRows.set(res.rows);
        this.loading.set(false);

        const params = this.route.snapshot.queryParamMap;
        const prefillA = params.get("a");
        const prefillB = params.get("b");
        if (prefillA && res.rows.some((r) => r.player.id === prefillA)) this.selectedAId.set(prefillA);
        if (prefillB && res.rows.some((r) => r.player.id === prefillB)) this.selectedBId.set(prefillB);
      },
      error: () => this.loading.set(false),
    });
  }

  private suggestionsFor(query: string, excludeId: string | null): PlayerAdvancedStatsRow[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.allRows()
      .filter((r) => r.player.id !== excludeId && r.player.name.toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS);
  }

  pick(side: Side, row: PlayerAdvancedStatsRow): void {
    if (side === "a") {
      this.selectedAId.set(row.player.id);
      this.queryA.set("");
    } else {
      this.selectedBId.set(row.player.id);
      this.queryB.set("");
    }
  }

  clear(side: Side): void {
    if (side === "a") {
      this.selectedAId.set(null);
      this.queryA.set("");
    } else {
      this.selectedBId.set(null);
      this.queryB.set("");
    }
  }

  private winnerFor(cat: CompareCategory, a: PlayerAdvancedStatsRow, b: PlayerAdvancedStatsRow): Side | "tie" | null {
    const va = cat.get(a);
    const vb = cat.get(b);
    if (va == null || vb == null || va === vb) return va == null || vb == null ? null : "tie";
    const aWins = cat.higherIsBetter ? va > vb : va < vb;
    return aWins ? "a" : "b";
  }

  isWinner(cat: CompareCategory, side: Side): boolean {
    const a = this.rowA();
    const b = this.rowB();
    if (!a || !b) return false;
    return this.winnerFor(cat, a, b) === side;
  }

  // Proportional split (0-100 each side) for the divergent bar — magnitude
  // only, not a value judgment; isWinner() drives which side gets the
  // "winning" highlight color.
  barPct(cat: CompareCategory, side: Side): number {
    const a = this.rowA();
    const b = this.rowB();
    if (!a || !b) return 50;
    const va = cat.get(a);
    const vb = cat.get(b);
    if (va == null || vb == null) return 50;
    const total = Math.abs(va) + Math.abs(vb);
    if (total === 0) return 50;
    const share = side === "a" ? Math.abs(va) : Math.abs(vb);
    return (share / total) * 100;
  }

  formatValue(cat: CompareCategory, side: Side): string {
    const row = side === "a" ? this.rowA() : this.rowB();
    if (!row) return "—";
    const v = cat.get(row);
    return v == null ? "—" : cat.format(v);
  }
}
