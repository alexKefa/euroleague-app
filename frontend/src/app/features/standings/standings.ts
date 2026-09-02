import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { I18nService } from "../../core/i18n.service";
import { StandingsRow } from "../../core/models";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";
import { TeamCodePipe } from "../../shared/team-display-code";

interface ColumnDef {
  key: string;
  labelKey: string;
  get: (row: StandingsRow) => number | null;
  format: (row: StandingsRow) => string;
}

const COLUMNS: ColumnDef[] = [
  { key: "position", labelKey: "standings.colRank", get: (r) => r.position, format: (r) => `${r.position}` },
  { key: "wins", labelKey: "standings.colW", get: (r) => r.stats.wins, format: (r) => `${r.stats.wins}` },
  { key: "losses", labelKey: "standings.colL", get: (r) => r.stats.losses, format: (r) => `${r.stats.losses}` },
  { key: "ppg", labelKey: "standings.colPpg", get: (r) => r.stats.ppg, format: (r) => r.stats.ppg?.toFixed(1) ?? "—" },
  { key: "papg", labelKey: "standings.colPapg", get: (r) => r.stats.papg, format: (r) => r.stats.papg?.toFixed(1) ?? "—" },
  { key: "offRating", labelKey: "standings.colOff", get: (r) => r.stats.offRating, format: (r) => r.stats.offRating?.toFixed(1) ?? "—" },
  { key: "defRating", labelKey: "standings.colDef", get: (r) => r.stats.defRating, format: (r) => r.stats.defRating?.toFixed(1) ?? "—" },
  // REB%/AST% (team_season_stats.reb_pct/ast_pct — EuroLeague's own
  // reboundsPercentage/assistsRatio, straight through) pulled off the
  // table for now at the user's request, 2026-08-24 — not removed from
  // the schema/API, just not surfaced here.
];

const LEGEND_KEYS: { code: string; key: string }[] = [
  { code: "#", key: "standings.legendRank" },
  { code: "W", key: "standings.legendW" },
  { code: "L", key: "standings.legendL" },
  { code: "PPG", key: "standings.legendPpg" },
  { code: "PAPG", key: "standings.legendPapg" },
  { code: "OFF RTG", key: "standings.legendOff" },
  { code: "DEF RTG", key: "standings.legendDef" },
];

@Component({
  selector: "app-standings",
  standalone: true,
  imports: [CommonModule, RouterLink, StatLegendComponent, TeamCodePipe],
  templateUrl: "./standings.html",
})
export class StandingsComponent implements OnInit {
  private api = inject(ApiService);
  protected i18n = inject(I18nService);

  readonly columns = COLUMNS;
  readonly loading = signal(true);
  readonly allRows = signal<StandingsRow[]>([]);

  readonly legendEntries = computed<StatLegendEntry[]>(() =>
    LEGEND_KEYS.map((k) => ({ code: k.code, label: this.i18n.t(k.key) }))
  );

  // Defaults to the backend's own rank order (ascending position) rather
  // than an arbitrary column — anything else looks broken on first load.
  readonly sortKey = signal("position");
  readonly sortDesc = signal(false);

  readonly rows = computed(() => {
    const col = COLUMNS.find((c) => c.key === this.sortKey()) ?? COLUMNS[0];
    const desc = this.sortDesc();
    return [...this.allRows()].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av - bv;
      return desc ? -cmp : cmp;
    });
  });

  ngOnInit(): void {
    this.api.getStandings().subscribe({
      next: (rows) => {
        this.allRows.set(rows);
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
      // Rank/losses read naturally ascending on first click; every other
      // column (wins, scoring, ratings) reads naturally descending
      // ("best first") — matches advanced-stats.ts's default-desc except
      // for these two.
      this.sortDesc.set(key !== "position" && key !== "losses");
    }
  }
}
