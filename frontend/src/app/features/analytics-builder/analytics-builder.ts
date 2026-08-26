import { Component, OnInit, inject, signal, computed } from "@angular/core";
import { CommonModule } from "@angular/common";
import { RouterLink } from "@angular/router";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { I18nService } from "../../core/i18n.service";
import { AnalyticsView, AnalyticsViewCustomColumn, PlayerAdvancedStatsRow, PlayerSeasonStats } from "../../core/models";
import { FormulaNode, compileFormula, evaluateFormula } from "./formula";
import { RetryImgDirective } from "../../shared/retry-img.directive";
import { ButtonDirective } from "../../shared/button.directive";
import { ChipDirective } from "../../shared/chip.directive";
import { SkeletonComponent } from "../../shared/skeleton";
import { ConfirmDialogComponent } from "../../shared/confirm-dialog";
import { StatLegendComponent, StatLegendEntry } from "../../shared/stat-legend";

interface ColumnDef {
  key: string;
  // Built-in columns translate labelKey; a custom column has no i18n key
  // (the label *is* user-authored text) and sets label instead — colLabel()
  // below picks whichever is present.
  labelKey?: string;
  label?: string;
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

// A plain-English description per built-in column, keyed the same as
// COLUMNS — feeds the "what does this mean" legend next to a saved view's
// name. Custom columns don't need an entry here; their own formula text
// *is* their explanation (see viewerLegendEntries).
const COLUMN_LEGEND_KEYS: Record<string, string> = {
  gamesPlayed: "builder.legendGamesPlayed",
  minutesPerGame: "builder.legendMinutesPerGame",
  pointsPerGame: "builder.legendPointsPerGame",
  valuation: "builder.legendValuation",
  trueShootingPct: "builder.legendTrueShootingPct",
  effectiveFieldGoalPct: "builder.legendEffectiveFieldGoalPct",
  offensiveReboundPct: "builder.legendOffensiveReboundPct",
  defensiveReboundPct: "builder.legendDefensiveReboundPct",
  assistToTurnoverRatio: "builder.legendAssistToTurnoverRatio",
  turnoverRatio: "builder.legendTurnoverRatio",
  possessionsPerGame: "builder.legendPossessionsPerGame",
  usagePercentage: "builder.legendUsagePercentage",
};

const DEFAULT_COLUMN_KEYS = ["pointsPerGame", "valuation", "trueShootingPct", "possessionsPerGame"];
const MAX_VIEWS = 5;
const MAX_CUSTOM_COLUMNS = 3;

// The only field names a custom-column formula can reference — exactly
// COLUMNS' own keys, so the toggle chips a user already sees *are* the
// formula reference (no separate cheat sheet to keep in sync).
const FORMULA_FIELDS = new Set(COLUMNS.map((c) => c.key));

function contextFromStats(stats: PlayerSeasonStats): Record<string, number | null> {
  const ctx: Record<string, number | null> = {};
  for (const col of COLUMNS) ctx[col.key] = (stats as unknown as Record<string, number | null>)[col.key] ?? null;
  return ctx;
}

// The identifier the cursor is currently sitting inside/at the end of, e.g.
// "pointsPerG|ame" or "pointsPerGame + val|" both resolve to a range — used
// to know what to autocomplete and what to replace on selection. Null when
// the cursor sits on an operator, space, or number (nothing to complete).
function currentWordRange(text: string, cursor: number): { start: number; end: number } | null {
  let start = cursor;
  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) start--;
  let end = cursor;
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) end++;
  if (start === end) return null;
  const word = text.slice(start, end);
  if (/^[0-9.]+$/.test(word)) return null; // a number literal, not a field reference
  return { start, end };
}

interface FormulaSuggestions {
  draftId: string;
  options: string[];
  wordStart: number;
  wordEnd: number;
}

// Draft state for one row of the editor's "custom columns" list — id is
// stable across edits (assigned once, on add) so @for can track it and a
// row's focus/cursor isn't lost as its own label/expression change.
interface CustomColumnDraft {
  id: string;
  label: string;
  expression: string;
}

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
  imports: [CommonModule, RouterLink, RetryImgDirective, ButtonDirective, ChipDirective, SkeletonComponent, ConfirmDialogComponent, StatLegendComponent],
  templateUrl: "./analytics-builder.html",
})
export class AnalyticsBuilderComponent implements OnInit {
  private api = inject(ApiService);
  protected auth = inject(AuthService);
  protected i18n = inject(I18nService);

  readonly columns = COLUMNS;
  readonly maxViews = MAX_VIEWS;
  readonly maxCustomColumns = MAX_CUSTOM_COLUMNS;
  readonly positionTemplates = POSITION_TEMPLATES;
  // The reference list shown under the formula input — same key/labelKey
  // pairs as the column chips above it, just rendered as plain text.
  readonly formulaFields = COLUMNS;

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
  readonly customColumnDrafts = signal<CustomColumnDraft[]>([]);
  readonly formulaSuggestions = signal<FormulaSuggestions | null>(null);

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
  readonly atCustomColumnLimit = computed(() => this.customColumnDrafts().length >= MAX_CUSTOM_COLUMNS);

  // --- Viewer state ---
  readonly viewerSortKey = signal<string | null>(null);
  readonly viewerSortDesc = signal(true);
  readonly viewerDisplay = signal<ViewerDisplay>("table");
  readonly confirmingDelete = signal(false);

  // Built-in columns the view picked, plus its custom columns compiled into
  // the same ColumnDef shape — table/chart rendering and sorting don't need
  // to know the difference once this is built. A custom column whose
  // formula somehow fails to compile (shouldn't happen — save() validates
  // first) just renders "—" everywhere rather than breaking the view.
  readonly viewerColumns = computed<ColumnDef[]>(() => {
    const view = this.activeView();
    if (!view) return [];
    const keySet = new Set(view.columns);
    const builtIn = COLUMNS.filter((c) => keySet.has(c.key));
    const custom = view.customColumns.map((cc): ColumnDef => {
      const compiled = compileFormula(cc.expression, FORMULA_FIELDS);
      const node: FormulaNode | null = "node" in compiled ? compiled.node : null;
      const get = (row: PlayerAdvancedStatsRow): number | null => (node ? evaluateFormula(node, contextFromStats(row.stats)) : null);
      return {
        key: "custom:" + cc.id,
        label: cc.label,
        get,
        format: (row) => {
          const v = get(row);
          return v == null ? "—" : v.toFixed(2);
        },
      };
    });
    return [...builtIn, ...custom];
  });

  // "What does this mean" popover next to the view's name — built-in
  // columns get a plain-English description (COLUMN_LEGEND_KEYS); a custom
  // column's own formula *is* its description, so there's nothing extra to
  // author or keep in sync as users invent new ones.
  readonly viewerLegendEntries = computed<StatLegendEntry[]>(() => {
    const view = this.activeView();
    if (!view) return [];
    const keySet = new Set(view.columns);
    const builtIn = COLUMNS.filter((c) => keySet.has(c.key)).map((c) => ({
      code: this.colLabel(c),
      label: c.key in COLUMN_LEGEND_KEYS ? this.i18n.t(COLUMN_LEGEND_KEYS[c.key]) : this.colLabel(c),
    }));
    const custom = view.customColumns.map((cc) => ({ code: cc.label, label: cc.expression }));
    return [...builtIn, ...custom];
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
    this.customColumnDrafts.set([]);
    this.formulaSuggestions.set(null);
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
    this.customColumnDrafts.set(view.customColumns.map((cc) => ({ ...cc })));
    this.formulaSuggestions.set(null);
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

  addCustomColumn(): void {
    if (this.atCustomColumnLimit()) return;
    // crypto.randomUUID(), not a counter — a counter reset on every fresh
    // component instance would collide with ids loaded from an existing
    // view being edited (also "draft0", "draft1", ...) the moment a new
    // row is added on top of them.
    this.customColumnDrafts.update((drafts) => [...drafts, { id: crypto.randomUUID(), label: "", expression: "" }]);
  }

  removeCustomColumn(id: string): void {
    this.customColumnDrafts.update((drafts) => drafts.filter((d) => d.id !== id));
    if (this.formulaSuggestions()?.draftId === id) this.formulaSuggestions.set(null);
  }

  updateCustomColumnLabel(id: string, value: string): void {
    this.customColumnDrafts.update((drafts) => drafts.map((d) => (d.id === id ? { ...d, label: value } : d)));
  }

  updateCustomColumnExpression(id: string, value: string): void {
    this.customColumnDrafts.update((drafts) => drafts.map((d) => (d.id === id ? { ...d, expression: value } : d)));
  }

  // Recomputes the autocomplete dropdown from wherever the cursor actually
  // is — not just "what field names does the whole expression contain" —
  // so completing an earlier field doesn't get confused by a later,
  // already-finished one.
  onExpressionInput(id: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.updateCustomColumnExpression(id, input.value);
    const cursor = input.selectionStart ?? input.value.length;
    const range = currentWordRange(input.value, cursor);
    if (!range) {
      this.formulaSuggestions.set(null);
      return;
    }
    const word = input.value.slice(range.start, range.end).toLowerCase();
    const options = [...FORMULA_FIELDS].filter((f) => f.toLowerCase().startsWith(word));
    this.formulaSuggestions.set(options.length > 0 ? { draftId: id, options, wordStart: range.start, wordEnd: range.end } : null);
  }

  // A plain (blur) would fire before a suggestion's (click) and the
  // dropdown would already be gone by the time the click lands — the
  // template guards against that with (mousedown)="$event.preventDefault()"
  // on each suggestion, which keeps focus on the input and skips blur
  // entirely for that click. This handler only ever runs for a genuine
  // focus-away, so it's safe to always clear.
  onExpressionBlur(): void {
    this.formulaSuggestions.set(null);
  }

  selectSuggestion(field: string): void {
    const state = this.formulaSuggestions();
    if (!state) return;
    const draft = this.customColumnDrafts().find((d) => d.id === state.draftId);
    if (!draft) return;
    const text = draft.expression;
    const newText = text.slice(0, state.wordStart) + field + text.slice(state.wordEnd);
    this.updateCustomColumnExpression(state.draftId, newText);
    this.formulaSuggestions.set(null);

    const cursor = state.wordStart + field.length;
    queueMicrotask(() => {
      const inputEl = document.getElementById(`custom-col-expr-${state.draftId}`) as HTMLInputElement | null;
      inputEl?.focus();
      inputEl?.setSelectionRange(cursor, cursor);
    });
  }

  // null = fine to save as-is (including a still-blank draft row, which
  // save() just drops rather than treating as an error — adding a row and
  // not filling it in shouldn't block saving the rest of the view).
  customColumnError(draft: CustomColumnDraft): string | null {
    const label = draft.label.trim();
    const expression = draft.expression.trim();
    if (!label && !expression) return null;
    if (!label) return this.i18n.t("builder.customColumnErrorLabel");
    if (label.length > 40) return this.i18n.t("builder.customColumnErrorLabelLength");
    if (!expression) return this.i18n.t("builder.customColumnErrorExpression");
    const compiled = compileFormula(expression, FORMULA_FIELDS);
    return "error" in compiled ? compiled.error : null;
  }

  save(): void {
    const name = this.viewName().trim();
    const playerIds = this.selectedPlayerIds();
    const columns = this.selectedColumnKeys();
    if (!name || playerIds.length === 0 || columns.length === 0) {
      this.formError.set(this.i18n.t("builder.formErrorIncomplete"));
      return;
    }

    // Fully-blank rows are silently dropped (never filled in); a
    // partially-filled or invalid row blocks save with its own message,
    // shown inline under that row.
    const filledDrafts = this.customColumnDrafts().filter((d) => d.label.trim() || d.expression.trim());
    for (const draft of filledDrafts) {
      const error = this.customColumnError(draft);
      if (error) {
        this.formError.set(error);
        return;
      }
    }
    const customColumns: AnalyticsViewCustomColumn[] = filledDrafts.map((d) => ({
      id: d.id,
      label: d.label.trim(),
      expression: d.expression.trim(),
    }));

    this.saving.set(true);
    this.formError.set(null);
    const body = { name, playerIds, columns, customColumns, sortKey: columns[0], sortDesc: true };
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

  // labelKey (built-in, translated) or label (custom, literal text) — never
  // both, but TS can't express that as a discriminated union without a lot
  // more ceremony for two optional fields on one small interface.
  colLabel(col: ColumnDef): string {
    return col.labelKey ? this.i18n.t(col.labelKey) : (col.label ?? col.key);
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
