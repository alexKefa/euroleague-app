import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { AnalyticsView, PlayerAdvancedStatsRow } from "../../core/models";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";

interface ColumnDef {
  key: string;
  labelKey: string;
  get: (row: PlayerAdvancedStatsRow) => number | null;
  format: (row: PlayerAdvancedStatsRow) => string;
}

// Same column set/shape as stats/advanced-stats.ts's COLUMNS — kept as its
// own copy rather than imported (compare.ts already established that
// precedent: this is a different context with a different default
// selection, and importing would couple two features' column lists
// together for no real benefit).
const COLUMNS: ColumnDef[] = [
  { key: "gamesPlayed", labelKey: "stats.colGp", get: (r) => r.stats.gamesPlayed, format: (r) => `${r.stats.gamesPlayed ?? "—"}` },
  { key: "minutesPerGame", labelKey: "stats.colMin", get: (r) => r.stats.minutesPerGame, format: (r) => r.stats.minutesPerGame?.toFixed(1) ?? "—" },
  { key: "pointsPerGame", labelKey: "stats.colPts", get: (r) => r.stats.pointsPerGame, format: (r) => r.stats.pointsPerGame?.toFixed(1) ?? "—" },
  { key: "valuation", labelKey: "stats.colPir", get: (r) => r.stats.valuation, format: (r) => r.stats.valuation?.toFixed(1) ?? "—" },
  { key: "trueShootingPct", labelKey: "stats.colTs", get: (r) => r.stats.trueShootingPct, format: (r) => (r.stats.trueShootingPct != null ? `${r.stats.trueShootingPct.toFixed(1)}%` : "—") },
  { key: "effectiveFieldGoalPct", labelKey: "stats.colEfg", get: (r) => r.stats.effectiveFieldGoalPct, format: (r) => (r.stats.effectiveFieldGoalPct != null ? `${r.stats.effectiveFieldGoalPct.toFixed(1)}%` : "—") },
  { key: "offensiveReboundPct", labelKey: "stats.colOreb", get: (r) => r.stats.offensiveReboundPct, format: (r) => (r.stats.offensiveReboundPct != null ? `${r.stats.offensiveReboundPct.toFixed(1)}%` : "—") },
  { key: "defensiveReboundPct", labelKey: "stats.colDreb", get: (r) => r.stats.defensiveReboundPct, format: (r) => (r.stats.defensiveReboundPct != null ? `${r.stats.defensiveReboundPct.toFixed(1)}%` : "—") },
  { key: "assistToTurnoverRatio", labelKey: "stats.colAstTo", get: (r) => r.stats.assistToTurnoverRatio, format: (r) => r.stats.assistToTurnoverRatio?.toFixed(1) ?? "—" },
  { key: "turnoverRatio", labelKey: "stats.colTov", get: (r) => r.stats.turnoverRatio, format: (r) => (r.stats.turnoverRatio != null ? `${r.stats.turnoverRatio.toFixed(1)}%` : "—") },
  { key: "possessionsPerGame", labelKey: "stats.colPace", get: (r) => r.stats.possessionsPerGame, format: (r) => r.stats.possessionsPerGame?.toFixed(1) ?? "—" },
  { key: "usagePercentage", labelKey: "stats.colUsg", get: (r) => r.stats.usagePercentage, format: (r) => (r.stats.usagePercentage != null ? `${r.stats.usagePercentage.toFixed(1)}%` : "—") },
];

const DEFAULT_COLUMN_KEYS = ["pointsPerGame", "valuation", "trueShootingPct", "possessionsPerGame"];
const MAX_VIEWS = 5;

// "Top 5 <position>" quick-picks — position comes from players.position,
// backfilled from EuroLeague's own Guards/Forwards/Centers leaders
// grouping (player_positions_sync.py), ranked here by PIR (valuation),
// the same stat the feed itself ranked those groups by.
const POSITION_TEMPLATES: { position: string; labelKey: string }[] = [
  { position: "Guard", labelKey: "builder.templateGuards" },
  { position: "Forward", labelKey: "builder.templateForwards" },
  { position: "Center", labelKey: "builder.templateCenters" },
];

type Mode = "list" | "editor" | "viewer";
type ViewerDisplay = "table" | "chart";

@Component({
  selector: "app-analytics-builder",
  standalone: true,
  imports: [CommonModule, RouterLink, RetryImgDirective, ButtonDirective, ChipDirective, SkeletonComponent, ConfirmDialogComponent],
  templateUrl: "./analytics-builder.html",
})
export class AnalyticsBuilderComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly columns = COLUMNS;
  readonly maxViews = MAX_VIEWS;
  readonly positionTemplates = POSITION_TEMPLATES;

  readonly loading = signal(true);
  readonly allRows = signal<PlayerAdvancedStatsRow[]>([]);
  readonly views = signal<AnalyticsView[]>([]);

  readonly mode = signal<Mode>("list");
  readonly activeView = signal<AnalyticsView | null>(null);
  readonly editingViewId = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly saving = signal(false);

  // --- Editor state ---
  readonly viewName = signal("");
  readonly playerQuery = signal("");
  readonly selectedPlayerIds = signal<string[]>([]);
  readonly selectedColumnKeys = signal<string[]>(DEFAULT_COLUMN_KEYS);

  readonly selectedPlayers = computed(() => {
    const ids = new Set(this.selectedPlayerIds());
    return this.allRows().filter((r) => ids.has(r.player.id));
  });

  readonly playerSuggestions = computed(() => {
    const q = this.playerQuery().trim().toLowerCase();
    if (!q) return [];
    const selected = new Set(this.selectedPlayerIds());
    return this.allRows()
      .filter((r) => !selected.has(r.player.id) && r.player.name.toLowerCase().includes(q))
      .slice(0, 8);
  });

  readonly atViewLimit = computed(() => this.views().length >= MAX_VIEWS);

  // --- Viewer state ---
  readonly viewerSortKey = signal<string | null>(null);
  readonly viewerSortDesc = signal(true);
  readonly viewerDisplay = signal<ViewerDisplay>("table");
  readonly confirmingDelete = signal(false);

  readonly viewerColumns = computed(() => {
    const view = this.activeView();
    if (!view) return [];
    const keySet = new Set(view.columns);
    return COLUMNS.filter((c) => keySet.has(c.key));
  });

  // Selected players for the active view, unsorted — the table sorts this
  // by whichever single column is active; the chart sorts each column's
  // own bar list independently off this same base instead.
  readonly viewerBaseRows = computed(() => {
    const view = this.activeView();
    if (!view) return [];
    const idSet = new Set(view.playerIds);
    return this.allRows().filter((r) => idSet.has(r.player.id));
  });

  readonly viewerRows = computed(() => {
    const view = this.activeView();
    if (!view) return [];
    const rows = this.viewerBaseRows();

    const sortKey = this.viewerSortKey() ?? view.sortKey ?? view.columns[0];
    const col = this.viewerColumns().find((c) => c.key === sortKey);
    if (!col) return rows;
    const desc = this.viewerSortDesc();
    return [...rows].sort((a, b) => {
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
    if (!this.auth.isAuthenticated()) {
      this.loading.set(false);
      return;
    }
    this.api.getAdvancedStats().subscribe({
      next: (res) => {
        this.allRows.set(res.rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
    this.api.getAnalyticsViews().subscribe({
      next: (rows) => this.views.set(rows),
      error: () => {},
    });
  }

  openList(): void {
    this.mode.set("list");
    this.activeView.set(null);
    this.formError.set(null);
  }

  openViewer(view: AnalyticsView): void {
    this.activeView.set(view);
    this.viewerSortKey.set(view.sortKey);
    this.viewerSortDesc.set(view.sortDesc);
    this.viewerDisplay.set("table");
    this.confirmingDelete.set(false);
    this.mode.set("viewer");
  }

  setViewerSort(key: string): void {
    if (this.viewerSortKey() === key) {
      this.viewerSortDesc.update((d) => !d);
    } else {
      this.viewerSortKey.set(key);
      this.viewerSortDesc.set(true);
    }
  }

  startNewView(): void {
    this.editingViewId.set(null);
    this.viewName.set("");
    this.playerQuery.set("");
    this.selectedPlayerIds.set([]);
    this.selectedColumnKeys.set(DEFAULT_COLUMN_KEYS);
    this.formError.set(null);
    this.lastTemplateName = null;
    this.mode.set("editor");
  }

  startEditView(view: AnalyticsView): void {
    this.editingViewId.set(view.id);
    this.viewName.set(view.name);
    this.playerQuery.set("");
    this.selectedPlayerIds.set([...view.playerIds]);
    this.selectedColumnKeys.set([...view.columns]);
    this.formError.set(null);
    this.lastTemplateName = null;
    this.mode.set("editor");
  }

  // Tracks the name a template button last wrote, so switching templates
  // keeps patching the name (Guards -> Forwards should update it, not just
  // fill it once) while a name the user typed themselves — which never
  // matches this — is left alone.
  private lastTemplateName: string | null = null;

  // Replaces the current player selection with the top 5 (by PIR) among
  // players at the given position — a fresh comparison set, not additive,
  // since picking a template means "start over with this group." Columns
  // are left alone.
  applyTemplate(position: string, nameKey: string): void {
    const top5 = this.allRows()
      .filter((r) => r.player.position === position)
      .sort((a, b) => (b.stats.valuation ?? -Infinity) - (a.stats.valuation ?? -Infinity))
      .slice(0, 5)
      .map((r) => r.player.id);
    this.selectedPlayerIds.set(top5);
    this.playerQuery.set("");

    const name = this.i18n.t(nameKey);
    if (!this.viewName().trim() || this.viewName() === this.lastTemplateName) {
      this.viewName.set(name);
    }
    this.lastTemplateName = name;
  }

  addPlayer(row: PlayerAdvancedStatsRow): void {
    this.selectedPlayerIds.update((ids) => [...ids, row.player.id]);
    this.playerQuery.set("");
  }

  removePlayer(playerId: string): void {
    this.selectedPlayerIds.update((ids) => ids.filter((id) => id !== playerId));
  }

  toggleColumn(key: string): void {
    this.selectedColumnKeys.update((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));
  }

  isColumnSelected(key: string): boolean {
    return this.selectedColumnKeys().includes(key);
  }

  save(): void {
    const name = this.viewName().trim();
    const playerIds = this.selectedPlayerIds();
    const columns = this.selectedColumnKeys();
    if (!name || playerIds.length === 0 || columns.length === 0) {
      this.formError.set(this.i18n.t("builder.formErrorIncomplete"));
      return;
    }

    this.saving.set(true);
    this.formError.set(null);
    const body = { name, playerIds, columns, sortKey: columns[0], sortDesc: true };
    const editingId = this.editingViewId();
    const req = editingId ? this.api.updateAnalyticsView(editingId, body) : this.api.createAnalyticsView(body);

    req.subscribe({
      next: (view) => {
        this.saving.set(false);
        this.views.update((list) => (editingId ? list.map((v) => (v.id === view.id ? view : v)) : [...list, view]));
        this.openViewer(view);
      },
      error: (err) => {
        this.saving.set(false);
        this.formError.set(err?.error?.error ?? "Failed to save — is the backend running?");
      },
    });
  }

  confirmDeleteView(view: AnalyticsView): void {
    this.api.deleteAnalyticsView(view.id).subscribe({
      next: () => {
        this.confirmingDelete.set(false);
        this.views.update((list) => list.filter((v) => v.id !== view.id));
        this.openList();
      },
      error: () => {},
    });
  }

  columnLabel(key: string): string {
    const col = COLUMNS.find((c) => c.key === key);
    return col ? this.i18n.t(col.labelKey) : key;
  }

  // One independently-sorted bar list per column, high to low — same
  // absolute-fill-bar-on-a-track technique as the roster page's
  // team-vs-league bars, just one bar per player instead of one per team.
  chartRows(col: ColumnDef): { row: PlayerAdvancedStatsRow; value: number | null }[] {
    return this.viewerBaseRows()
      .map((row) => ({ row, value: col.get(row) }))
      .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  }

  chartPct(value: number | null, col: ColumnDef): number {
    if (value == null) return 0;
    const values = this.viewerBaseRows()
      .map((r) => col.get(r))
      .filter((v): v is number => v != null);
    const max = values.length ? Math.max(...values) : 0;
    return max > 0 ? (value / max) * 100 : 0;
  }
}
