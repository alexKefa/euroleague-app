import { Injectable, computed, effect, inject, signal } from "@angular/core";
import { ApiService } from "../../core/api.service";
import { AuthService } from "../../core/auth.service";
import { FavoritePlayersService } from "../../core/favorite-players.service";
import { I18nService } from "../../core/i18n.service";
import { AnalyticsView, PlayerAdvancedStatsRow } from "../../core/models";
import { formatStat, statByKey, type StatKey } from "../../shared/stat-catalog";
import { FormulaError, compileFormula, evaluateFormula, formulaLowerIsBetter } from "./formula";
import { percentileOf, selectPool, sortedValues } from "./percentiles";
import { positionSet, topByPir } from "./quick-sets";
import {
  ColumnRef,
  DEFAULT_COLUMNS,
  MAX_FORMULAS,
  MAX_PLAYERS,
  ViewBody,
  Workspace,
  columnId,
  decodeView,
  encodeWorkspace,
  parseSnapshot,
  sameWorkspace,
  snapshotWorkspace,
} from "./workspace";

export type QuickSetId = "myTeam" | "fantasy" | "favorites" | "guards" | "forwards" | "centers";

export interface QuickSet {
  id: QuickSetId;
  labelKey: string;
  playerIds: string[];
  disabledReasonKey: string | null;
}

export interface ResolvedColumn {
  id: string;
  ref: ColumnRef;
  label: string;
  legend: string;
  format: (v: number | null) => string;
  get: (r: PlayerAdvancedStatsRow) => number | null;
  lowerIsBetter: boolean;
  percentiled: boolean;
  error: FormulaError | null;
}

type LoadState = "loading" | "ready" | "error";

const FAVORITES_CAP = 10;
const POSITION_SETS: { id: QuickSetId; position: string; labelKey: string }[] = [
  { id: "guards", position: "Guard", labelKey: "builder.templateGuards" },
  { id: "forwards", position: "Forward", labelKey: "builder.templateForwards" },
  { id: "centers", position: "Center", labelKey: "builder.templateCenters" },
];

const SNAPSHOT_KEY = "clutch-builder-workspace";

const EMPTY_WORKSPACE: Workspace = { playerIds: [], columns: [], sort: null };

const statsContext = (r: PlayerAdvancedStatsRow) => r.stats as unknown as Record<string, number | null>;

/**
 * All Analytics Builder state (2026-10-14 workspace redesign): the stats
 * rows, saved views, the live workspace and every action on it. Provided
 * by the page component, so it lives exactly as long as the page.
 */
@Injectable()
export class BuilderStore {
  private api = inject(ApiService);
  private auth = inject(AuthService);
  private favoritesService = inject(FavoritePlayersService);
  private i18n = inject(I18nService);

  private readonly rowsStateSig = signal<LoadState>("loading");
  readonly rowsState = this.rowsStateSig.asReadonly();
  private readonly viewsStateSig = signal<LoadState>("loading");
  readonly viewsState = this.viewsStateSig.asReadonly();
  private readonly rowsSig = signal<PlayerAdvancedStatsRow[]>([]);
  readonly rows = this.rowsSig.asReadonly();
  private readonly viewsSig = signal<AnalyticsView[]>([]);
  readonly views = this.viewsSig.asReadonly();
  private readonly activeViewIdSig = signal<string | null>(null);
  readonly activeViewId = this.activeViewIdSig.asReadonly();
  private readonly workspaceSig = signal<Workspace>(EMPTY_WORKSPACE);
  readonly workspace = this.workspaceSig.asReadonly();
  // What the unsaved workspace started as, so a prefilled-but-untouched
  // one doesn't count as unsaved changes.
  private readonly baselineSig = signal<Workspace>(EMPTY_WORKSPACE);
  private readonly fantasyIds = signal<string[] | null>(null);
  private readonly actionErrorSig = signal<string | null>(null);
  readonly actionError = this.actionErrorSig.asReadonly();
  private readonly savingSig = signal(false);
  readonly saving = this.savingSig.asReadonly();

  private readonly initialized = signal(false);

  constructor() {
    // Keeps the open workspace for this tab, so a trip to a player page and
    // back lands on the same view with its unsaved edits.
    effect(() => {
      if (!this.initialized()) return;
      const snapshot = snapshotWorkspace(this.activeViewIdSig(), this.workspaceSig(), this.baselineSig());
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, snapshot);
      } catch {
        // Storage blocked (private mode): the workspace just isn't kept.
      }
    });
  }

  readonly activeView = computed(() => this.viewsSig().find((v) => v.id === this.activeViewIdSig()) ?? null);

  readonly isDirty = computed(() => {
    const view = this.activeView();
    return !sameWorkspace(this.workspaceSig(), view ? decodeView(view) : this.baselineSig());
  });

  readonly canSave = computed(() => this.workspaceSig().playerIds.length > 0 && this.workspaceSig().columns.length > 0 && (this.activeViewIdSig() === null || this.isDirty()));

  readonly columns = computed<ResolvedColumn[]>(() =>
    this.workspaceSig().columns.map((ref): ResolvedColumn => {
      if (ref.kind === "stat") {
        const def = statByKey(ref.key)!;
        return {
          id: columnId(ref),
          ref,
          label: this.i18n.t(def.labelKey),
          legend: this.i18n.t(def.legendKey),
          format: (v) => formatStat(def.format, v),
          get: (r) => r.stats[ref.key] ?? null,
          lowerIsBetter: !!def.lowerIsBetter,
          percentiled: def.percentiled,
          error: null,
        };
      }
      const compiled = compileFormula(ref.expression);
      const node = "node" in compiled ? compiled.node : null;
      return {
        id: columnId(ref),
        ref,
        label: ref.label,
        legend: ref.expression,
        format: (v) => (v == null ? "—" : v.toFixed(2)),
        get: (r) => (node ? evaluateFormula(node, statsContext(r)) : null),
        lowerIsBetter: node ? formulaLowerIsBetter(node) : false,
        percentiled: !!node,
        error: "error" in compiled ? compiled.error : null,
      };
    })
  );

  readonly selectedRows = computed(() => {
    const byId = new Map(this.rowsSig().map((r) => [r.player.id, r]));
    return this.workspaceSig().playerIds.flatMap((id) => byId.get(id) ?? []);
  });

  readonly sortedRows = computed(() => {
    const sort = this.workspaceSig().sort;
    const col = sort && this.columns().find((c) => c.id === sort.columnId);
    const rows = this.selectedRows();
    if (!sort || !col) return rows;
    return [...rows].sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort.desc ? bv - av : av - bv;
    });
  });

  private readonly percentileTable = computed(() => {
    const pool = selectPool(this.rowsSig());
    const table = new Map<string, number[]>();
    for (const col of this.columns()) {
      if (col.percentiled) table.set(col.id, sortedValues(pool, col.get));
    }
    return table;
  });

  readonly quickSets = computed<QuickSet[]>(() => {
    const rows = this.rowsSig();
    const authed = this.auth.isAuthenticated();
    const known = new Set(rows.map((r) => r.player.id));
    const teamId = this.auth.currentUser()?.favoriteTeamId ?? null;
    const fantasy = (this.fantasyIds() ?? []).filter((id) => known.has(id));
    const favorites = this.favoritesService
      .favorites()
      .map((f) => f.id)
      .filter((id) => known.has(id))
      .slice(0, FAVORITES_CAP);
    const reason = (ok: boolean, key: string) => (!authed ? "builder.quick.loginNeeded" : ok ? null : key);
    return [
      { id: "myTeam", labelKey: "builder.quick.myTeam", playerIds: teamId ? topByPir(rows.filter((r) => r.team.id === teamId)) : [], disabledReasonKey: reason(!!teamId, "builder.quick.noTeam") },
      { id: "fantasy", labelKey: "builder.quick.fantasy", playerIds: fantasy, disabledReasonKey: reason(fantasy.length > 0, "builder.quick.noSquad") },
      { id: "favorites", labelKey: "builder.quick.favorites", playerIds: favorites, disabledReasonKey: reason(favorites.length > 0, "builder.quick.noFavorites") },
      ...POSITION_SETS.map((p) => ({ id: p.id, labelKey: p.labelKey, playerIds: positionSet(rows, p.position), disabledReasonKey: null })),
    ];
  });

  // A pending "discard unsaved changes?" question; the page renders the
  // confirm dialog while this is set (view switcher and route guard share it).
  private readonly discardPromptSig = signal<((ok: boolean) => void) | null>(null);
  readonly discardPrompt = computed(() => this.discardPromptSig() !== null);

  confirmDiscardIfDirty(): Promise<boolean> {
    if (!this.isDirty()) return Promise.resolve(true);
    this.discardPromptSig()?.(false);
    return new Promise((resolve) => this.discardPromptSig.set(resolve));
  }

  resolveDiscard(ok: boolean): void {
    const resolve = this.discardPromptSig();
    this.discardPromptSig.set(null);
    resolve?.(ok);
  }

  percentile(colId: string, row: PlayerAdvancedStatsRow): number | null {
    const sorted = this.percentileTable().get(colId);
    const col = this.columns().find((c) => c.id === colId);
    return sorted && col ? percentileOf(sorted, col.get(row), col.lowerIsBetter) : null;
  }

  load(): void {
    this.rowsStateSig.set("loading");
    this.api.getAdvancedStats().subscribe({
      next: (res) => {
        this.rowsSig.set(res.rows);
        this.rowsStateSig.set("ready");
        this.maybeInitialize();
      },
      error: () => this.rowsStateSig.set("error"),
    });
    if (this.initialized()) return;
    // A reload or deep link lands here before the refresh-cookie session is
    // restored, so wait for it before treating the visitor as a guest.
    this.auth.restoreSession().subscribe((loggedIn) => {
      if (loggedIn) {
        this.loadViews();
        this.api.getFantasyLineup().subscribe({
          next: (lineup) => this.fantasyIds.set(lineup.players.map((p) => p.playerId)),
          error: () => this.fantasyIds.set([]),
        });
      } else {
        this.viewsStateSig.set("ready");
        this.maybeInitialize();
      }
    });
  }

  retryViews(): void {
    this.loadViews();
  }

  private loadViews(): void {
    this.viewsStateSig.set("loading");
    this.api.getAnalyticsViews().subscribe({
      next: (views) => {
        this.viewsSig.set(views);
        this.viewsStateSig.set("ready");
        this.maybeInitialize();
      },
      error: () => {
        this.viewsStateSig.set("error");
        this.maybeInitialize();
      },
    });
  }

  // Once both the stats and the views have settled: restores this tab's
  // last workspace, else opens the first saved view or a prefilled one.
  private maybeInitialize(): void {
    if (this.initialized() || this.rowsStateSig() !== "ready" || this.viewsStateSig() === "loading") return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(SNAPSHOT_KEY);
    } catch {
      raw = null;
    }
    const snapshot = parseSnapshot(raw, this.viewsSig());
    this.initialized.set(true);
    if (snapshot) {
      this.activeViewIdSig.set(snapshot.activeViewId);
      this.baselineSig.set(snapshot.baseline);
      this.workspaceSig.set(snapshot.workspace);
      return;
    }
    const first = this.viewsSig()[0];
    if (first) this.openView(first.id);
    else this.newWorkspace();
  }

  newWorkspace(): void {
    const sets = this.quickSets();
    const mine = sets.find((s) => s.id === "myTeam");
    const players = mine && !mine.disabledReasonKey && mine.playerIds.length ? mine.playerIds : (sets.find((s) => s.id === "guards")?.playerIds ?? []);
    const ws: Workspace = {
      playerIds: [...players],
      columns: DEFAULT_COLUMNS.map((key) => ({ kind: "stat", key })),
      sort: { columnId: DEFAULT_COLUMNS[0], desc: true },
    };
    this.activeViewIdSig.set(null);
    this.baselineSig.set(ws);
    this.workspaceSig.set(ws);
    this.actionErrorSig.set(null);
  }

  openView(id: string): void {
    const view = this.viewsSig().find((v) => v.id === id);
    if (!view) return;
    this.activeViewIdSig.set(id);
    this.workspaceSig.set(decodeView(view));
    this.actionErrorSig.set(null);
  }

  applyQuickSet(id: QuickSetId): void {
    const set = this.quickSets().find((s) => s.id === id);
    if (!set || set.disabledReasonKey || !set.playerIds.length) return;
    this.patch({ playerIds: set.playerIds.slice(0, MAX_PLAYERS) });
  }

  addPlayer(id: string): void {
    const ids = this.workspaceSig().playerIds;
    if (ids.includes(id) || ids.length >= MAX_PLAYERS) return;
    this.patch({ playerIds: [...ids, id] });
  }

  removePlayer(id: string): void {
    this.patch({ playerIds: this.workspaceSig().playerIds.filter((p) => p !== id) });
  }

  toggleStat(key: StatKey): void {
    const cols = this.workspaceSig().columns;
    if (cols.some((c) => c.kind === "stat" && c.key === key)) this.removeColumn(key);
    else this.patch({ columns: [...cols, { kind: "stat", key }] });
  }

  formulaCount(): number {
    return this.workspaceSig().columns.filter((c) => c.kind === "formula").length;
  }

  upsertFormula(f: { id?: string; label: string; expression: string }): void {
    const cols = this.workspaceSig().columns;
    const label = f.label.trim();
    const expression = f.expression.trim();
    if (f.id && cols.some((c) => c.kind === "formula" && c.id === f.id)) {
      this.patch({ columns: cols.map((c) => (c.kind === "formula" && c.id === f.id ? { ...c, label, expression } : c)) });
      return;
    }
    if (this.formulaCount() >= MAX_FORMULAS) return;
    this.patch({ columns: [...cols, { kind: "formula", id: crypto.randomUUID(), label, expression }] });
  }

  moveColumn(colId: string, dir: -1 | 1): void {
    const cols = [...this.workspaceSig().columns];
    const i = cols.findIndex((c) => columnId(c) === colId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    this.patch({ columns: cols });
  }

  removeColumn(colId: string): void {
    const ws = this.workspaceSig();
    const columns = ws.columns.filter((c) => columnId(c) !== colId);
    const sort = ws.sort?.columnId === colId ? (columns[0] ? { columnId: columnId(columns[0]), desc: true } : null) : ws.sort;
    this.patch({ columns, sort });
  }

  setSort(colId: string): void {
    const sort = this.workspaceSig().sort;
    this.patch({ sort: sort?.columnId === colId ? { columnId: colId, desc: !sort.desc } : { columnId: colId, desc: true } });
  }

  save(name?: string): void {
    const active = this.activeView();
    const viewName = (active ? active.name : (name ?? "")).trim();
    if (!viewName) return;
    this.persist(encodeWorkspace(this.workspaceSig(), viewName), active?.id ?? null);
  }

  rename(name: string): void {
    const active = this.activeView();
    const trimmed = name.trim();
    if (!active || !trimmed) return;
    // Renames the saved view as saved; unsaved workspace edits stay pending.
    this.persist(encodeWorkspace(decodeView(active), trimmed), active.id, false);
  }

  deleteActive(): void {
    const active = this.activeView();
    if (!active) return;
    this.actionErrorSig.set(null);
    this.api.deleteAnalyticsView(active.id).subscribe({
      next: () => {
        this.viewsSig.update((list) => list.filter((v) => v.id !== active.id));
        const first = this.viewsSig()[0];
        if (first) this.openView(first.id);
        else this.newWorkspace();
      },
      error: (err) => this.actionErrorSig.set(this.errorMessage(err)),
    });
  }

  private persist(body: ViewBody, id: string | null, adoptWorkspace = true): void {
    this.savingSig.set(true);
    this.actionErrorSig.set(null);
    const req = id ? this.api.updateAnalyticsView(id, body) : this.api.createAnalyticsView(body);
    req.subscribe({
      next: (view) => {
        this.savingSig.set(false);
        this.viewsSig.update((list) => (list.some((v) => v.id === view.id) ? list.map((v) => (v.id === view.id ? view : v)) : [...list, view]));
        if (adoptWorkspace) {
          this.activeViewIdSig.set(view.id);
          this.workspaceSig.set(decodeView(view));
        }
      },
      error: (err) => {
        this.savingSig.set(false);
        this.actionErrorSig.set(this.errorMessage(err));
      },
    });
  }

  private errorMessage(err: unknown): string {
    const code = (err as { error?: { code?: string } })?.error?.code;
    const key = code === "VIEW_LIMIT_REACHED" ? "builder.error.viewLimit" : code === "INVALID_VIEW_BODY" ? "builder.error.invalid" : "builder.error.generic";
    return this.i18n.t(key);
  }

  private patch(change: Partial<Workspace>): void {
    this.workspaceSig.update((ws) => ({ ...ws, ...change }));
  }
}
