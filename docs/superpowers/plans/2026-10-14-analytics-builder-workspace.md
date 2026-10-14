# Analytics Builder Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/analytics-builder` into one live workspace: every stat usable, alias-based formulas, league-percentile context, personal quick sets, saved sort/order, guest access.

**Architecture:** Pure logic (stat catalog, formula compiler, percentiles, view codec) lives in Angular-free `.ts` files checked by one `tsx` script. A component-provided `BuilderStore` owns all signals and actions; five small presentational/dialog components render it; the page shell only lays them out. Frontend-only — the backend stores `columns`/`expression` as opaque strings.

**Tech Stack:** Angular 20 standalone + signals, Tailwind, existing `ApiService`/`I18nService`/`app-dialog`/`app-confirm-dialog`/`[appChip]`/`[appButton]`.

**Spec:** `docs/superpowers/specs/2026-10-14-analytics-builder-workspace-design.md`

## Global Constraints

- No backend, route, or schema change. Existing endpoints only.
- Every new UI string goes into `core/i18n/analytics-builder.ts` with **both** `en` and `el` in the same edit.
- Max 5 saved views, max 3 formula columns, max 10 players per view, view name max 60 chars, formula label max 40 chars.
- Percentile pool: `gamesPlayed >= 5 && minutesPerGame >= 10`; if fewer than 40 rows qualify, pool = rows with `gamesPlayed >= 1`.
- Position quick sets: top 5 by `valuation` among rows with `gamesPlayed >= 5 && minutesPerGame >= 10`.
- Default columns for a new workspace: `pointsPerGame, reboundsPerGame, assistsPerGame, valuation, trueShootingPct`.
- Presets: PRA `PTS + REB + AST`; Stocks `STL + BLK`; Per 40 `<ALIAS> / MIN * 40`.
- Saved `columns` = full display order; formulas encoded as `"f:<id>"`.
- `gamesPlayed` is never percentile-tinted.
- Buttons `[appButton]`, toggles `[appChip]`, back-link `navHistory.previousUrl() ?? '/teams'`, no `ngModel` (signals + `(input)` as the current file does).
- Never read and write the same signal inside one `effect()`; use `untracked()`.
- No test suite exists. Pure-logic checks run with: `cd backend && npx tsx ../frontend/scripts/check-builder-logic.ts` (prints `ALL CHECKS PASSED`, exits 1 on failure). UI checks: `cd frontend && npx ng build --configuration development` with no errors.

## Review Focus

1. **Old saved views** (camelCase formulas like `pointsPerGame / possessionsPerGame`, `columns` without `f:` entries, `sortKey` = a stat key) must load and evaluate identically — Task 2 + Task 4 checks.
2. **Null stats** (a player missing `threePointPct`, formula dividing by zero) render `—`, are excluded from percentile arrays, and sort last — Task 3 + Task 4 checks.
3. **Early-season tiny pool** (< 40 qualifying rows) must fall back instead of producing 0/100 percentiles for everyone — Task 3 check.
4. **Removing the sorted column** must reset sort to the first remaining column, never a dangling id — Task 5 step.
5. **Dirty guard false positives**: opening a saved view and touching nothing must not report dirty (compare encoded bodies, not object identity) — Task 4 check + Task 5 step.

---

### Task 1: Stat catalog

**Files:**
- Create: `frontend/src/app/shared/stat-catalog.ts`
- Create: `frontend/scripts/check-builder-logic.ts`
- Modify: `frontend/src/app/core/i18n/analytics-builder.ts` (labels + legends for new stats, group names)

**Interfaces:**
- Produces:
  ```ts
  export type StatKey = Exclude<keyof PlayerSeasonStats, "playerId" | "teamId" | "season">;
  export type StatGroup = "scoring" | "shooting" | "playmaking" | "rebounding" | "defense" | "usage";
  export type StatFormat = "int" | "dec1" | "pct";
  export interface StatDef { key: StatKey; alias: string; labelKey: string; legendKey: string; group: StatGroup; format: StatFormat; lowerIsBetter?: boolean; percentiled: boolean; }
  export const STAT_CATALOG: readonly StatDef[];
  export const STAT_GROUPS: readonly StatGroup[];          // display order above
  export function statByKey(key: string): StatDef | undefined;
  export function statByAlias(alias: string): StatDef | undefined;   // case-insensitive
  export function formatStat(format: StatFormat, v: number | null): string; // null → "—"; int → "12"; dec1 → "12.3"; pct → "45.6%"
  ```
  `import type { PlayerSeasonStats }` only — the file must stay Angular-free.

- [ ] **Step 1: Write the check script with catalog assertions**

`frontend/scripts/check-builder-logic.ts` — a tiny harness: `check(name, fn)` collects failures, prints them, `process.exit(1)` if any, else prints `ALL CHECKS PASSED`. Catalog checks:
```ts
check("catalog has 25 stats", () => eq(STAT_CATALOG.length, 25));
check("aliases unique + identifier-safe", () => {
  const a = STAT_CATALOG.map((s) => s.alias);
  eq(new Set(a).size, a.length);
  ok(a.every((x) => /^[A-Z][A-Z0-9_]*$/.test(x)));
});
check("alias lookup is case-insensitive", () => eq(statByAlias("reb")?.key, "reboundsPerGame"));
check("gamesPlayed not percentiled", () => eq(statByKey("gamesPlayed")?.percentiled, false));
check("turnovers lower is better", () => { ok(statByKey("turnoversPerGame")?.lowerIsBetter); ok(statByKey("turnoverRatio")?.lowerIsBetter); });
check("formatStat", () => { eq(formatStat("pct", 45.61), "45.6%"); eq(formatStat("dec1", 12.34), "12.3"); eq(formatStat("int", 12), "12"); eq(formatStat("dec1", null), "—"); });
```

- [ ] **Step 2: Run it — expect failure (module not found)**

Run: `cd backend && npx tsx ../frontend/scripts/check-builder-logic.ts`
Expected: error resolving `stat-catalog`.

- [ ] **Step 3: Implement `stat-catalog.ts`**

Aliases (fixed, in catalog order): GP, MIN, PTS, REB, AST, STL, BLK, TOV, FG_PCT, TP_PCT, FT_PCT, PIR, EFG_PCT, TS_PCT, OREB_PCT, DREB_PCT, TREB_PCT, AST_TO, AST_RATIO, TOV_RATIO, TWO_PA_RATE, THREE_PA_RATE, FT_RATE, POSS, USG.
Groups: scoring = PTS, PIR, MIN, GP · shooting = FG_PCT, TP_PCT, FT_PCT, EFG_PCT, TS_PCT, TWO_PA_RATE, THREE_PA_RATE, FT_RATE · playmaking = AST, AST_TO, AST_RATIO, TOV, TOV_RATIO · rebounding = REB, OREB_PCT, DREB_PCT, TREB_PCT · defense = STL, BLK · usage = USG, POSS.
Formats: `pct` for every `*Pct`, `*Rate`, `*Ratio` except `assistToTurnoverRatio` (dec1), `usagePercentage` (pct); `int` for GP; `dec1` otherwise.
`labelKey`: reuse existing `stats.colGp/Min/Pts/Pir/Ts/Efg/Oreb/Dreb/AstTo/Tov/Pace/Usg`; new keys `builder.stat.<alias>` for the rest. `legendKey`: existing `builder.legend*` where present, new `builder.legend<Key>` for the rest.

- [ ] **Step 4: Add i18n** — `builder.stat.*` short labels (REB/AST/STL/BLK/TOV/FG%/3P%/FT%/TRB%/AST%/2PAr/3PAr/FTr — EL identical abbreviations except where a Greek one exists in `stats.ts`), `builder.legend*` one-liners for the 13 new stats, and `builder.group.{scoring,shooting,playmaking,rebounding,defense,usage}` (EL: Σκοράρισμα, Σουτ, Δημιουργία, Ριμπάουντ, Άμυνα, Χρήση & ρυθμός).

- [ ] **Step 5: Run checks — expect `ALL CHECKS PASSED`**

- [ ] **Step 6: Commit** — `git add frontend/src/app/shared/stat-catalog.ts frontend/scripts/check-builder-logic.ts frontend/src/app/core/i18n/analytics-builder.ts && git commit -m "Builder: shared stat catalog with all 25 stats"`

---

### Task 2: Formula compiler with aliases and error codes

**Files:**
- Modify: `frontend/src/app/features/analytics-builder/formula.ts`
- Modify: `frontend/scripts/check-builder-logic.ts`
- Modify: `frontend/src/app/core/i18n/analytics-builder.ts`

**Interfaces:**
- Consumes: `statByAlias`, `statByKey`, `StatKey` (Task 1).
- Produces:
  ```ts
  export type FormulaErrorCode = "empty" | "endsEarly" | "missingParen" | "unexpectedChar" | "unexpectedToken" | "trailingText" | "badNumber" | "unknownField";
  export interface FormulaError { code: FormulaErrorCode; params?: Record<string, string>; }
  export type Resolver = (name: string) => StatKey | null;
  export const resolveStatName: Resolver;  // alias (any case) or legacy camelCase key → StatKey
  export function compileFormula(source: string, resolve?: Resolver): { node: FormulaNode } | { error: FormulaError };
  export function evaluateFormula(node: FormulaNode, ctx: Readonly<Record<string, number | null | undefined>>): number | null; // unchanged
  export const FORMULA_PRESETS: readonly { id: "pra" | "stocks" | "per40"; labelKey: string; expression: string }[];
  ```
  `compileFormula` rewrites each `var` node's `name` to the resolved `StatKey`, so evaluation reads `row.stats[key]` directly. `params` for `unexpectedChar`/`unexpectedToken`/`badNumber`/`unknownField` is `{ text }`. Per 40's `expression` is the template `"{X} / MIN * 40"`.

- [ ] **Step 1: Add failing checks**
```ts
const ctx = { pointsPerGame: 16, reboundsPerGame: 3, assistsPerGame: 6, minutesPerGame: 32, stealsPerGame: 1, blocksPerGame: null };
const run = (src: string) => { const c = compileFormula(src); if ("error" in c) throw new Error(c.error.code); return evaluateFormula(c.node, ctx); };
check("alias formula", () => eq(run("PTS + REB + AST"), 25));
check("lowercase alias", () => eq(run("pts / min * 40"), 20));
check("legacy camelCase still works", () => eq(run("pointsPerGame + assistsPerGame"), 22));
check("null propagates", () => eq(run("STL + BLK"), null));
check("divide by zero → null", () => eq(run("PTS / 0"), null));
const err = (src: string) => { const c = compileFormula(src); return "error" in c ? c.error : null; };
check("unknown field code", () => { const e = err("PTS + FOO"); eq(e?.code, "unknownField"); eq(e?.params?.text, "FOO"); });
check("empty", () => eq(err("  ")?.code, "empty"));
check("missing paren", () => eq(err("(PTS + REB")?.code, "missingParen"));
check("ends early", () => eq(err("PTS +")?.code, "endsEarly"));
check("trailing text", () => eq(err("PTS REB")?.code, "trailingText"));
check("bad char", () => eq(err("PTS % 2")?.code, "unexpectedChar"));
```

- [ ] **Step 2: Run — expect failures**
- [ ] **Step 3: Implement** — throw a `FormulaParseError` (class carrying `FormulaError`) in the tokenizer/parser instead of `Error`; catch it in `compileFormula`. Grammar unchanged.
- [ ] **Step 4: i18n** — `builder.formulaError.<code>` EN+EL, with `{text}` placeholder where params exist; `builder.preset.{pra,stocks,per40}` labels (EL: PRA, Κλεψίματα+Τάπες, Ανά 40').
- [ ] **Step 5: Run — expect `ALL CHECKS PASSED`**
- [ ] **Step 6: Commit** — `"Builder: formulas use stat aliases, errors are codes"`

---

### Task 3: Percentiles

**Files:**
- Create: `frontend/src/app/features/analytics-builder/percentiles.ts`
- Modify: `frontend/scripts/check-builder-logic.ts`

**Interfaces:**
- Consumes: `import type { PlayerAdvancedStatsRow }`.
- Produces:
  ```ts
  export function selectPool(rows: readonly PlayerAdvancedStatsRow[]): PlayerAdvancedStatsRow[]; // Global Constraints rule
  export function sortedValues(pool: readonly PlayerAdvancedStatsRow[], get: (r: PlayerAdvancedStatsRow) => number | null): number[]; // ascending, nulls dropped
  export function percentileOf(sorted: readonly number[], value: number | null, lowerIsBetter: boolean): number | null; // 0–100 integer; null when value null or sorted empty
  export function topPercent(pct: number): number; // max(1, 100 - pct)
  ```
  `raw = (below + 0.5 * equal) / n * 100` using binary search for `below`/`equal`; return `Math.round(lowerIsBetter ? 100 - raw : raw)` (invert before rounding).

- [ ] **Step 1: Add failing checks**
```ts
check("percentile mid", () => eq(percentileOf([1,2,3,4], 3, false), 63));
check("percentile max", () => eq(percentileOf([1,2,3,4], 4, false), 88));
check("lower is better inverts", () => eq(percentileOf([1,2,3,4], 1, true), 88));
check("value outside pool", () => { eq(percentileOf([1,2,3], 10, false), 100); eq(percentileOf([1,2,3], 0, false), 0); });
check("null value", () => eq(percentileOf([1,2], null, false), null));
check("sortedValues drops nulls", () => eq(sortedValues(fakeRows([3, null, 1]), (r) => r.stats.pointsPerGame).join(), "1,3"));
check("pool fallback below 40", () => eq(selectPool(fakeRows(Array(10).fill(10), { gp: 6, min: 20 })).length, 10));
check("pool filters when 40+ qualify", () => {
  const rows = [...fakeRows(Array(40).fill(10), { gp: 6, min: 20 }), ...fakeRows([10], { gp: 2, min: 20 })];
  eq(selectPool(rows).length, 40);
});
check("topPercent floor", () => { eq(topPercent(100), 1); eq(topPercent(92), 8); });
```
`fakeRows(values, opts)` builds minimal `PlayerAdvancedStatsRow`s (cast) with `pointsPerGame` = value, `gamesPlayed` = opts.gp ?? 6, `minutesPerGame` = opts.min ?? 20.

- [ ] **Step 2: Run — expect failures**
- [ ] **Step 3: Implement `percentiles.ts`**
- [ ] **Step 4: Run — expect `ALL CHECKS PASSED`**
- [ ] **Step 5: Commit** — `"Builder: league percentile helpers"`

---

### Task 4: Workspace model + view codec

**Files:**
- Create: `frontend/src/app/features/analytics-builder/workspace.ts`
- Modify: `frontend/scripts/check-builder-logic.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  ```ts
  export type ColumnRef = { kind: "stat"; key: StatKey } | { kind: "formula"; id: string; label: string; expression: string };
  export interface Workspace { playerIds: string[]; columns: ColumnRef[]; sort: { columnId: string; desc: boolean } | null; }
  export interface ViewBody { name: string; playerIds: string[]; columns: string[]; customColumns: AnalyticsViewCustomColumn[]; sortKey: string | null; sortDesc: boolean; }
  export function columnId(c: ColumnRef): string;            // stat → key, formula → "f:" + id
  export function decodeView(view: AnalyticsView): Workspace;
  export function encodeWorkspace(ws: Workspace, name: string): ViewBody;
  export function sameWorkspace(a: Workspace, b: Workspace): boolean; // JSON of encodeWorkspace(_, "") equal
  export const DEFAULT_COLUMNS: StatKey[];                   // Global Constraints
  export const MAX_PLAYERS = 10, MAX_FORMULAS = 3, MAX_VIEWS = 5;
  ```
  `decodeView`: walk `columns`; a known stat key → stat ref; `"f:<id>"` → that custom column; unknown strings dropped. Custom columns not referenced by any `f:` entry are appended in their stored order (legacy views). `sortKey` `"custom:<id>"` (legacy) maps to `"f:<id>"`; a `sortKey` that matches no column → first column's id. `encodeWorkspace`: `sortKey` = `ws.sort?.columnId ?? columnId(columns[0])`.

- [ ] **Step 1: Add failing checks**
```ts
const legacy = { id: "v", userId: "u", name: "Old", playerIds: ["p1"], columns: ["pointsPerGame", "valuation"],
  customColumns: [{ id: "c1", label: "Load", expression: "pointsPerGame / possessionsPerGame" }], sortKey: "pointsPerGame", sortDesc: true, createdAt: "" };
check("legacy view: stats then formulas", () => eq(decodeView(legacy).columns.map(columnId).join(), "pointsPerGame,valuation,f:c1"));
check("legacy sort kept", () => eq(decodeView(legacy).sort?.columnId, "pointsPerGame"));
check("round trip preserves mixed order", () => {
  const ws: Workspace = { playerIds: ["p1"], sort: { columnId: "f:c1", desc: false },
    columns: [{ kind: "formula", id: "c1", label: "PRA", expression: "PTS + REB + AST" }, { kind: "stat", key: "pointsPerGame" }] };
  const back = decodeView({ ...legacy, ...encodeWorkspace(ws, "x") });
  ok(sameWorkspace(ws, back));
  eq(back.columns.map(columnId).join(), "f:c1,pointsPerGame");
});
check("formula-only view has non-empty columns", () => eq(encodeWorkspace({ playerIds: ["p"], sort: null, columns: [{ kind: "formula", id: "a", label: "A", expression: "PTS" }] }, "n").columns.join(), "f:a"));
check("dangling sortKey falls back", () => eq(decodeView({ ...legacy, sortKey: "nope" }).sort?.columnId, "pointsPerGame"));
check("untouched view is not dirty", () => ok(sameWorkspace(decodeView(legacy), decodeView(structuredClone(legacy)))));
```
- [ ] **Step 2: Run — expect failures**
- [ ] **Step 3: Implement `workspace.ts`**
- [ ] **Step 4: Run — expect `ALL CHECKS PASSED`**
- [ ] **Step 5: Commit** — `"Builder: workspace model and saved-view codec"`

---

### Task 5: BuilderStore

**Files:**
- Create: `frontend/src/app/features/analytics-builder/builder-store.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `ApiService` (`getAdvancedStats`, `getAnalyticsViews`, `createAnalyticsView`, `updateAnalyticsView`, `deleteAnalyticsView`, `getFantasyLineup`), `AuthService.currentUser()/isAuthenticated()`, `FavoritePlayersService.favorites()`, `I18nService`.
- Produces (`@Injectable()` — provided in the page component's `providers`):
  ```ts
  export type QuickSetId = "myTeam" | "fantasy" | "favorites" | "guards" | "forwards" | "centers";
  export interface QuickSet { id: QuickSetId; labelKey: string; playerIds: string[]; disabledReasonKey: string | null; }
  export interface ResolvedColumn { id: string; ref: ColumnRef; label: string; legend: string; format: (v: number | null) => string; get: (r: PlayerAdvancedStatsRow) => number | null; lowerIsBetter: boolean; percentiled: boolean; error: FormulaError | null; }
  // state signals (readonly)
  rowsState: Signal<"loading" | "ready" | "error">; viewsState: Signal<"loading" | "ready" | "error">;
  rows: Signal<PlayerAdvancedStatsRow[]>; views: Signal<AnalyticsView[]>; activeViewId: Signal<string | null>;
  workspace: Signal<Workspace>; isDirty: Signal<boolean>; actionError: Signal<string | null>; saving: Signal<boolean>;
  // derived
  columns: Signal<ResolvedColumn[]>; selectedRows: Signal<PlayerAdvancedStatsRow[]>; sortedRows: Signal<PlayerAdvancedStatsRow[]>;
  quickSets: Signal<QuickSet[]>; percentile(columnId: string, row: PlayerAdvancedStatsRow): number | null;
  // actions
  load(): void; retryViews(): void; newWorkspace(): void; openView(id: string): void; applyQuickSet(id: QuickSetId): void;
  addPlayer(id: string): void; removePlayer(id: string): void;
  toggleStat(key: StatKey): void; upsertFormula(f: { id?: string; label: string; expression: string }): void;
  moveColumn(columnId: string, dir: -1 | 1): void; removeColumn(columnId: string): void; setSort(columnId: string): void;
  save(name?: string): void; rename(name: string): void; deleteActive(): void;
  ```
  Behaviour pinned by the spec:
  - `load()` fetches stats always, views only when authenticated; after both settle, if no views → `newWorkspace()`, else `openView(views[0].id)`.
  - `newWorkspace()` → `activeViewId = null`, columns `DEFAULT_COLUMNS`, players = `myTeam` quick set if enabled else `guards`, sort = first column desc.
  - `isDirty` = `activeViewId === null ? workspace has ≥1 player : !sameWorkspace(workspace, decodeView(activeView))`.
  - `myTeam`: favorite team's top 5 by `valuation`; disabled reason `builder.quick.noTeam` (no favorite) / `builder.quick.loginNeeded` (guest). `fantasy`: `getFantasyLineup()` players fetched once in `load()` when authed; reason `builder.quick.noSquad`. `favorites`: first 10 of `favorites()` present in `rows`; reason `builder.quick.noFavorites`. Position sets per Global Constraints.
  - `addPlayer` ignores duplicates and stops at `MAX_PLAYERS`; `upsertFormula` stops at `MAX_FORMULAS` for new ids (new id = `crypto.randomUUID()`).
  - `removeColumn` of the sorted column → sort = first remaining column desc (or null when none).
  - `setSort` same column → flip `desc`; new column → `desc = true`.
  - `percentile`: per-column sorted arrays computed in one `computed()` over `selectPool(rows())` × `columns()` (skip `!percentiled` and errored columns).
  - `sortedRows`: nulls last regardless of direction.
  - `save(name)`: create when `activeViewId` null (requires `name`), else update with active view's name; on success replace/append in `views` and set `activeViewId`. `rename(name)` = update with new name. Errors: map `err.error.code` `VIEW_LIMIT_REACHED` → `builder.error.viewLimit`, `INVALID_VIEW_BODY` → `builder.error.invalid`, else `builder.error.generic`, into `actionError`.
  - `deleteActive()` → on success remove from `views`, then `openView(first)` or `newWorkspace()`.

- [ ] **Step 1: Implement `builder-store.ts`** per the interface and behaviour above.
- [ ] **Step 2: i18n** — `builder.quick.{myTeam,fantasy,favorites,noTeam,noSquad,noFavorites,loginNeeded}`, `builder.error.{viewLimit,invalid,generic,loadStats,loadViews}` EN+EL; reuse existing `builder.templateGuards/Forwards/Centers` labels for the position sets.
- [ ] **Step 3: Build** — `cd frontend && npx ng build --configuration development` → no errors (store is not yet used; it must still type-check, so import it from the page component's `providers` in this task: `providers: [BuilderStore]` on `AnalyticsBuilderComponent`).
- [ ] **Step 4: Commit** — `"Builder: workspace store"`

---

### Task 6: Results table and chart

**Files:**
- Create: `frontend/src/app/features/analytics-builder/results-table.ts`
- Create: `frontend/src/app/features/analytics-builder/results-chart.ts`

**Interfaces:**
- Consumes: `BuilderStore` (inject) — `sortedRows`, `selectedRows`, `columns`, `workspace().sort`, `percentile()`, `setSort()`.
- Produces: `<app-results-table />`, `<app-results-chart />`, no inputs (both read the store).

Table: keep today's markup shape (sticky player column, badge, row `routerLink` to `/players/:id`, `overflow-x-auto` container). Header click → `setSort(col.id)`, arrow on the sorted column. Each `percentiled` cell's background is `color-mix(in srgb, var(--accent-primary) <pct * 0.35>%, transparent)` (inline `[style.background]`); sorted column also shows `builder.topPercent` (EN `"top {n}%"`, EL `"κορυφαίο {n}%"`, n = `topPercent(pct)`) beneath the value in `text-[10px] text-muted`. Errored formula column header shows the label with a red dot and cells `—`.
Chart: per column a card, rows sorted by percentile desc (nulls last), bar width `%` = percentile, `background` = team primary colour, value via `col.format`. Non-percentiled columns (GP) render bars scaled to the selection max as today.

- [ ] **Step 1: Implement both components**
- [ ] **Step 2: i18n** — `builder.topPercent` EN+EL.
- [ ] **Step 3: Build** — no errors.
- [ ] **Step 4: Commit** — `"Builder: percentile table and chart"`

---

### Task 7: Player picker and column picker

**Files:**
- Create: `frontend/src/app/features/analytics-builder/player-picker.ts`
- Create: `frontend/src/app/features/analytics-builder/column-picker.ts`

**Interfaces:**
- Consumes: `BuilderStore`; `app-dialog` (`title`, `closeLabel`, `(closed)`); `normalize`/`loose` from `shared/search-match.ts`; `STAT_CATALOG`, `STAT_GROUPS`, `FORMULA_PRESETS`, `compileFormula`, `evaluateFormula`, `resolveStatName`.
- Produces: `<app-player-picker (closed)>`, `<app-column-picker [editFormulaId]="string | null" (closed)>`.

Player picker: quick-set buttons (`[appButton]="outline"`, disabled + reason line beneath when `disabledReasonKey`), then a search input (reuse `app-search-input`) whose matches use `loose(normalize(name)).includes(loose(normalize(query)))`, top 8, excluding already-selected; tap → `addPlayer`. Shows `count/10`.
Column picker: one `[appChip]` toggle row per `STAT_GROUPS` group (group heading `builder.group.*`), chip text = translated label, `title` = legend. Below: presets (Per 40 opens a stat `<select>` of aliases first, then calls `upsertFormula` with `{X}` replaced), then a formula form (label + expression inputs) carrying over today's autocomplete (`currentWordRange`, mousedown-preventDefault suggestion list) but suggesting **aliases**; live line under the expression: translated error (`builder.formulaError.<code>` with `{text}`) or `"<first selected player>: <value>"`. Submit → `upsertFormula`. With `editFormulaId`, the form is prefilled and submit updates that formula. Formula limit reached → form hidden, `builder.formulaLimit` line shown.

- [ ] **Step 1: Implement both components**
- [ ] **Step 2: i18n** — `builder.addPlayers`, `builder.addColumns`, `builder.searchPlaceholder` (update text), `builder.formulaLabel`, `builder.formulaExpression` (placeholder `e.g. PTS + REB + AST`), `builder.formulaAdd`, `builder.formulaUpdate`, `builder.formulaLimit`, `builder.per40Pick`, `builder.playersMax` EN+EL.
- [ ] **Step 3: Build** — no errors.
- [ ] **Step 4: Commit** — `"Builder: player and column pickers"`

---

### Task 8: View switcher, page shell, guard, cleanup

**Files:**
- Create: `frontend/src/app/features/analytics-builder/view-switcher.ts`
- Create: `frontend/src/app/features/analytics-builder/unsaved-changes.guard.ts`
- Rewrite: `frontend/src/app/features/analytics-builder/analytics-builder.ts`, `analytics-builder.html`
- Modify: `frontend/src/app/app.routes.ts:102-105` (add `canDeactivate`)
- Modify: `frontend/src/app/core/i18n/analytics-builder.ts` (new keys; delete keys no longer referenced)
- Modify: `TODO.md`

**Interfaces:**
- Consumes: everything above; `app-confirm-dialog` (`message`, `confirmLabel`, `cancelLabel`, `danger`, `(confirmed)`, `(cancelled)`).
- Produces:
  ```ts
  // analytics-builder.ts
  export class AnalyticsBuilderComponent { requestLeave(): Promise<boolean>; }  // resolves after the discard confirm
  // unsaved-changes.guard.ts
  export const unsavedBuilderChanges: CanDeactivateFn<AnalyticsBuilderComponent>; // (c) => c.requestLeave()
  ```

View switcher: a `<select>`-styled dropdown button listing views + "Unsaved view" when `activeViewId` null; **+ New** (disabled at `MAX_VIEWS` with `title` = `builder.error.viewLimit`); ⋯ menu with Rename (dialog with name input, max 60) and Delete (confirm). Any switch/new while `isDirty` → confirm `builder.discardPrompt` first. `viewsState === "error"` → inline `builder.error.loadViews` + Retry (`retryViews`).
Shell layout, top to bottom: back link, `app-page-header` (unchanged keys), view switcher, players row (pills with badge + ×, **+** opens player picker), columns row (pills in order with ƒ marker on formulas; tap opens a small menu: Move left / Move right / Edit (formula) / Remove), `[Table | Chart]` chips + `app-stat-legend` fed from `columns().map(c => ({ code: c.label, label: c.legend }))`, results component, footer **Save view** (`[appButton]`, visible when `isDirty`; new view → name dialog; guest → link to `/login` with `builder.loginToSave`), `actionError` line. States: `rowsState` loading → skeleton; error → card with `builder.error.loadStats` + Retry.
`requestLeave()`: not dirty → `true`; dirty → show the discard confirm and resolve with the choice.

- [ ] **Step 1: Implement switcher, guard, shell; wire `canDeactivate: [unsavedBuilderChanges]` on the route**
- [ ] **Step 2: i18n** — `builder.unsavedView`, `builder.rename`, `builder.renameTitle`, `builder.discardPrompt`, `builder.discardYes`, `builder.loginToSave`, `builder.moveLeft`, `builder.moveRight`, `builder.editFormula`, `builder.remove`, `builder.saveTitle` EN+EL. Then delete every `builder.*` key no longer referenced (grep each; keep `builder.navTitle`, used by `teams-hub.html`).
- [ ] **Step 3: TODO.md** — add: "Move `stats/advanced-stats.ts` columns onto `shared/stat-catalog.ts`" and "Analytics Builder: shareable view links".
- [ ] **Step 4: Build** — `npx ng build --configuration development` → no errors; also run the logic checks → `ALL CHECKS PASSED`.
- [ ] **Step 5: Commit** — `"Builder: live workspace page, view switcher, unsaved-changes guard"`

---

### Task 9: End-to-end verification on local servers

**Files:** none (fixes go back into the owning task's files).

- [ ] **Step 1:** Backend on :4000 (dev DB) and `ng serve` on :4200 running. Open `/analytics-builder` and walk the spec's Verification list: first-run prefill; each quick set incl. disabled reasons; Greek/accented search; one stat from every group; PRA/Stocks/Per 40; a custom formula with an error in EN and EL; sort → save → reload keeps sort; reorder survives save; a pre-existing camelCase view evaluates; guest (logged out) workspace; dirty guard on switch and on navigating away.
- [ ] **Step 2:** Production build: `npx ng build` → no errors (existing budget warning only).
- [ ] **Step 3:** Ask the user for phone + desktop screenshots; do not deploy until they approve.
