import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { PlayerAdvancedStatsRow } from "../../core/models";
import { DropdownComponent, DropdownOption } from "../../shared/dropdown";
import { ButtonDirective } from "../../shared/button.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";
import { SearchInputComponent } from "../../shared/search-input";

// One column = one sortable stat. `get` pulls the raw number/string out of a
// row (undefined/null sorts last regardless of direction, see sortedRows);
// `format` is display-only.
interface ColumnDef {
  key: string;
  labelKey: string;
  get: (row: PlayerAdvancedStatsRow) => number | string | null;
  format?: (row: PlayerAdvancedStatsRow) => string;
  numeric: boolean;
}

const COLUMNS: ColumnDef[] = [
  { key: "player", labelKey: "stats.colPlayer", get: (r) => r.player.name, numeric: false },
  { key: "gamesPlayed", labelKey: "stats.colGp", get: (r) => r.stats.gamesPlayed, numeric: true },
  {
    key: "minutesPerGame",
    labelKey: "stats.colMin",
    get: (r) => r.stats.minutesPerGame,
    format: (r) => r.stats.minutesPerGame?.toFixed(1) ?? "—",
    numeric: true,
  },
  {
    key: "pointsPerGame",
    labelKey: "stats.colPts",
    get: (r) => r.stats.pointsPerGame,
    format: (r) => r.stats.pointsPerGame?.toFixed(1) ?? "—",
    numeric: true,
  },
  {
    key: "valuation",
    labelKey: "stats.colPir",
    get: (r) => r.stats.valuation,
    format: (r) => r.stats.valuation?.toFixed(1) ?? "—",
    numeric: true,
  },
  {
    key: "trueShootingPct",
    labelKey: "stats.colTs",
    get: (r) => r.stats.trueShootingPct,
    format: (r) => (r.stats.trueShootingPct != null ? `${r.stats.trueShootingPct.toFixed(1)}%` : "—"),
    numeric: true,
  },
  {
    key: "effectiveFieldGoalPct",
    labelKey: "stats.colEfg",
    get: (r) => r.stats.effectiveFieldGoalPct,
    format: (r) => (r.stats.effectiveFieldGoalPct != null ? `${r.stats.effectiveFieldGoalPct.toFixed(1)}%` : "—"),
    numeric: true,
  },
  {
    key: "offensiveReboundPct",
    labelKey: "stats.colOreb",
    get: (r) => r.stats.offensiveReboundPct,
    format: (r) => (r.stats.offensiveReboundPct != null ? `${r.stats.offensiveReboundPct.toFixed(1)}%` : "—"),
    numeric: true,
  },
  {
    key: "defensiveReboundPct",
    labelKey: "stats.colDreb",
    get: (r) => r.stats.defensiveReboundPct,
    format: (r) => (r.stats.defensiveReboundPct != null ? `${r.stats.defensiveReboundPct.toFixed(1)}%` : "—"),
    numeric: true,
  },
  {
    key: "assistToTurnoverRatio",
    labelKey: "stats.colAstTo",
    get: (r) => r.stats.assistToTurnoverRatio,
    format: (r) => r.stats.assistToTurnoverRatio?.toFixed(1) ?? "—",
    numeric: true,
  },
  {
    key: "turnoverRatio",
    labelKey: "stats.colTov",
    get: (r) => r.stats.turnoverRatio,
    format: (r) => (r.stats.turnoverRatio != null ? `${r.stats.turnoverRatio.toFixed(1)}%` : "—"),
    numeric: true,
  },
  {
    key: "possessionsPerGame",
    labelKey: "stats.colPace",
    get: (r) => r.stats.possessionsPerGame,
    format: (r) => r.stats.possessionsPerGame?.toFixed(1) ?? "—",
    numeric: true,
  },
  {
    key: "usagePercentage",
    labelKey: "stats.colUsg",
    get: (r) => r.stats.usagePercentage,
    format: (r) => (r.stats.usagePercentage != null ? `${r.stats.usagePercentage.toFixed(1)}%` : "—"),
    numeric: true,
  },
];

const DEFAULT_MIN_GAMES = 5;
const DEFAULT_MIN_MINUTES = 0;

// {code, key} pairs, not translated strings — label text is resolved inside
// the computed() below so it stays reactive to i18n.lang. Reuses roster.ts's
// legend keys where the stat is identical (GP, MIN, PIR, TS%, eFG%, TOV%,
// POSS) rather than duplicating the copy; only the columns roster doesn't
// have (PTS as a bare code, split OREB%/DREB%, AST/TO) get their own keys.
// codeKey reuses this page's own COLUMNS header translations (stats.colX,
// the same keys the visible table headers use — see COLUMNS above) rather
// than a hardcoded English literal — otherwise the legend's short code
// stayed English even in Greek mode while its description translated fine,
// since only `key`/label ever went through i18n before.
const LEGEND_KEYS: { codeKey: string; key: string }[] = [
  { codeKey: "stats.colGp", key: "roster.legendGP" },
  { codeKey: "stats.colMin", key: "roster.legendMIN" },
  { codeKey: "stats.colPts", key: "roster.legendPPG" },
  { codeKey: "stats.colPir", key: "roster.legendPIR" },
  { codeKey: "stats.colTs", key: "roster.legendTS" },
  { codeKey: "stats.colEfg", key: "roster.legendEFG" },
  { codeKey: "stats.colOreb", key: "stats.legendOreb" },
  { codeKey: "stats.colDreb", key: "stats.legendDreb" },
  { codeKey: "stats.colAstTo", key: "stats.legendAstTo" },
  { codeKey: "stats.colTov", key: "roster.legendTOV" },
  { codeKey: "stats.colPace", key: "roster.legendPOSS" },
  { codeKey: "stats.colUsg", key: "stats.legendUsg" },
];

@Component({
  selector: "app-advanced-stats",
  standalone: true,
  imports: [CommonModule, RouterLink, DropdownComponent, ButtonDirective, SkeletonComponent, RetryImgDirective, StatLegendComponent, SearchInputComponent],
  templateUrl: "./advanced-stats.html",
})
export class AdvancedStatsComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly columns = COLUMNS;

  readonly legendEntries = computed<StatLegendEntry[]>(() =>
    LEGEND_KEYS.map((k) => ({ code: this.i18n.t(k.codeKey), label: this.i18n.t(k.key) }))
  );

  readonly loading = signal(true);
  readonly season = signal<string | null>(null);
  readonly allRows = signal<PlayerAdvancedStatsRow[]>([]);

  readonly searchQuery = signal("");
  readonly teamFilter = signal<string | null>(null);
  readonly minGames = signal(DEFAULT_MIN_GAMES);
  readonly minMinutes = signal(DEFAULT_MIN_MINUTES);
  readonly sortKey = signal("valuation");
  readonly sortDesc = signal(true);

  readonly hasActiveFilters = computed(
    () =>
      this.searchQuery().trim().length > 0 ||
      this.teamFilter() !== null ||
      this.minGames() !== DEFAULT_MIN_GAMES ||
      this.minMinutes() !== DEFAULT_MIN_MINUTES
  );

  readonly teamDropdownOptions = computed<DropdownOption[]>(() => {
    const seen = new Map<string, DropdownOption>();
    for (const row of this.allRows()) {
      if (!seen.has(row.team.id)) {
        seen.set(row.team.id, { value: row.team.id, label: row.team.name, logoUrl: row.team.logoUrl });
      }
    }
    return [{ value: "", label: this.i18n.t("stats.allTeams") }, ...[...seen.values()].sort((a, b) => a.label.localeCompare(b.label))];
  });

  readonly rows = computed<PlayerAdvancedStatsRow[]>(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const team = this.teamFilter();
    const minGp = this.minGames();
    const minMin = this.minMinutes();

    const filtered = this.allRows().filter((row) => {
      if (query && !row.player.name.toLowerCase().includes(query)) return false;
      if (team && row.team.id !== team) return false;
      if ((row.stats.gamesPlayed ?? 0) < minGp) return false;
      if ((row.stats.minutesPerGame ?? 0) < minMin) return false;
      return true;
    });

    const col = COLUMNS.find((c) => c.key === this.sortKey()) ?? COLUMNS[0];
    const desc = this.sortDesc();
    return [...filtered].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return desc ? -cmp : cmp;
    });
  });

  ngOnInit(): void {
    this.api.getAdvancedStats().subscribe({
      next: (res) => {
        this.season.set(res.season);
        this.allRows.set(res.rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setSort(key: string): void {
    if (this.sortKey() === key) {
      this.sortDesc.update((d) => !d);
    } else {
      this.sortKey.set(key);
      this.sortDesc.set(true);
    }
  }

  setTeamFilter(value: string | null): void {
    this.teamFilter.set(value || null);
  }

  setMinGames(value: string): void {
    const n = Number(value);
    this.minGames.set(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  setMinMinutes(value: string): void {
    const n = Number(value);
    this.minMinutes.set(Number.isFinite(n) && n >= 0 ? n : 0);
  }

  isFavoriteTeam(teamId: string): boolean {
    return teamId === this.auth.currentUser()?.favoriteTeamId;
  }

  clearFilters(): void {
    this.searchQuery.set("");
    this.teamFilter.set(null);
    this.minGames.set(DEFAULT_MIN_GAMES);
    this.minMinutes.set(DEFAULT_MIN_MINUTES);
  }
}
