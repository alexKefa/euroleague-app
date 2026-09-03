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

// GP isn't stored anywhere — basketball has no ties, so wins+losses is
// always exactly games played. Used to reconstruct season point totals
// below, since team_season_stats only ever persists the per-game average
// (see standings_sync.py) — but that average is un-rounded float division
// of the feed's own raw totals, so multiplying back by gamesPlayed and
// rounding recovers the exact original PTS+/PTS- rather than an
// approximation.
function gamesPlayed(r: StandingsRow): number {
  return r.stats.wins + r.stats.losses;
}

const COLUMNS: ColumnDef[] = [
  { key: "position", labelKey: "standings.colRank", get: (r) => r.position, format: (r) => `${r.position}` },
  { key: "wins", labelKey: "standings.colW", get: (r) => r.stats.wins, format: (r) => `${r.stats.wins}` },
  { key: "losses", labelKey: "standings.colL", get: (r) => r.stats.losses, format: (r) => `${r.stats.losses}` },
  // Win%/PTS+/PTS- (2026-09-03) match euroleaguebasketball.net's own
  // standings columns, in their exact order, right after W/L. 0 games
  // played reads as "0%" (not "—") — matching the official site's own
  // display for a not-yet-started season rather than "improving" on it.
  {
    key: "winPct",
    labelKey: "standings.colWinPct",
    get: (r) => (gamesPlayed(r) > 0 ? (r.stats.wins / gamesPlayed(r)) * 100 : 0),
    format: (r) => `${gamesPlayed(r) > 0 ? Math.round((r.stats.wins / gamesPlayed(r)) * 100) : 0}%`,
  },
  {
    key: "ptsFor",
    labelKey: "standings.colPtsFor",
    get: (r) => (r.stats.ppg != null ? Math.round(r.stats.ppg * gamesPlayed(r)) : null),
    format: (r) => (r.stats.ppg != null ? `${Math.round(r.stats.ppg * gamesPlayed(r))}` : "—"),
  },
  {
    key: "ptsAgainst",
    labelKey: "standings.colPtsAgainst",
    get: (r) => (r.stats.papg != null ? Math.round(r.stats.papg * gamesPlayed(r)) : null),
    format: (r) => (r.stats.papg != null ? `${Math.round(r.stats.papg * gamesPlayed(r))}` : "—"),
  },
  { key: "ppg", labelKey: "standings.colPpg", get: (r) => r.stats.ppg, format: (r) => r.stats.ppg?.toFixed(1) ?? "—" },
  { key: "papg", labelKey: "standings.colPapg", get: (r) => r.stats.papg, format: (r) => r.stats.papg?.toFixed(1) ?? "—" },
  { key: "offRating", labelKey: "standings.colOff", get: (r) => r.stats.offRating, format: (r) => r.stats.offRating?.toFixed(1) ?? "—" },
  { key: "defRating", labelKey: "standings.colDef", get: (r) => r.stats.defRating, format: (r) => r.stats.defRating?.toFixed(1) ?? "—" },
  // L10 (2026-09-03) — last column, matching euroleaguebasketball.net's own
  // position for it. Sorts by last-10 win count (most recent form first,
  // same "descending by default" convention as every other column here).
  {
    key: "last10",
    labelKey: "standings.colL10",
    get: (r) => r.stats.last10?.wins ?? null,
    format: (r) => (r.stats.last10 ? `${r.stats.last10.wins}-${r.stats.last10.losses}` : "—"),
  },
  // REB%/AST% (team_season_stats.reb_pct/ast_pct — EuroLeague's own
  // reboundsPercentage/assistsRatio, straight through) pulled off the
  // table for now at the user's request, 2026-08-24 — not removed from
  // the schema/API, just not surfaced here.
];

// codeKey reuses each column's own header translation (standings.colX)
// rather than a hardcoded English literal — otherwise the legend's short
// code stayed English even in Greek mode while its description translated
// fine, since only `key`/label ever went through i18n before.
const LEGEND_KEYS: { codeKey: string; key: string }[] = [
  { codeKey: "standings.colRank", key: "standings.legendRank" },
  { codeKey: "standings.colW", key: "standings.legendW" },
  { codeKey: "standings.colL", key: "standings.legendL" },
  { codeKey: "standings.colWinPct", key: "standings.legendWinPct" },
  { codeKey: "standings.colPtsFor", key: "standings.legendPtsFor" },
  { codeKey: "standings.colPtsAgainst", key: "standings.legendPtsAgainst" },
  { codeKey: "standings.colPpg", key: "standings.legendPpg" },
  { codeKey: "standings.colPapg", key: "standings.legendPapg" },
  { codeKey: "standings.colOff", key: "standings.legendOff" },
  { codeKey: "standings.colDef", key: "standings.legendDef" },
  { codeKey: "standings.colL10", key: "standings.legendL10" },
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
    LEGEND_KEYS.map((k) => ({ code: this.i18n.t(k.codeKey), label: this.i18n.t(k.key) }))
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
