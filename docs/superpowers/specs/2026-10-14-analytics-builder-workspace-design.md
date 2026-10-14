# Analytics Builder → live workspace

Date: 2026-10-14 · Status: approved design, awaiting spec review

## Why

The builder (`/analytics-builder`) works, but it reads as a stats picker rather
than a tool:

- Only 12 of the 25 stats the advanced-stats payload carries are exposed —
  no REB/AST/STL/BLK/TOV, no FG%/3P%/FT%. `PTS + REB + AST` is impossible.
- Formulas need internal camelCase names (`pointsPerGame`) and every parse
  error is hardcoded English.
- Nothing shows until you save; editing and viewing are separate screens.
- The chart scales bars against the best of the ~5 selected players, so it
  says nothing about where a player sits in the league.
- Templates ignore what the app already knows (favorite team, fantasy squad,
  favorite players) and have no sample-size floor.
- Bugs: sort is never persisted (always `columns[0]`), column order ignores
  pick order, a failed views load shows "no views", delete errors are
  swallowed, player search is a plain substring match.
- Guests only see a login prompt even though the stats endpoint is public.
- One 535-line component owns three modes.

Goal: one live workspace where every change updates the table/chart
immediately, every stat is usable, formulas use the same short labels as the
column chips, and values carry league context.

Out of scope: shareable view links; moving `stats/advanced-stats.ts` onto
the new catalog (added to `TODO.md`); any backend or schema change.

## User experience

### Layout

Single screen, no separate editor mode:

```
┌ My views: [Guards ▾] [+ New] [⋯] ─┐
│ PLAYERS  [Montero ×] [Hifi ×] [+]  │
│ COLUMNS  [PTS][REB][AST][PRA ƒ][+] │
├────────────────────────────────────┤
│ Player     PTS↓  REB  AST  PRA     │
│ Montero   16.2▓  3.1  6.0  25.3    │
│ Hifi      15.8▓  2.4  3.2  21.4    │
├────────────────────────────────────┤
│ [Table | Chart]        [Save view] │
└────────────────────────────────────┘
```

### View switcher (top bar)

- Dropdown of saved views (max 5, unchanged) plus **+ New**.
- **⋯** menu on a saved view: Rename, Delete (shared confirm dialog).
- **First run** (no saved views) or **+ New**: an unsaved workspace
  prefilled with the "My team" quick set (falls back to Top 5 Guards when
  there's no favorite team) and the default columns `PTS, REB, AST, PIR, TS%`.
- At the 5-view limit, **+ New** is disabled with the reason as its title.

### Players row

Removable pills (team badge + name) and a **+** that opens the player picker
(shared `app-dialog`, bottom sheet on phones):

- **Quick sets** — each *replaces* the current selection:
  - My team — favorite team's top 5 by PIR (`auth.currentUser().favoriteTeamId`).
  - My Fantasy Five — current fantasy lineup's players (`getFantasyLineup`).
  - My favorites — `FavoritePlayersService.favorites()` (cap 10).
  - Top 5 Guards / Forwards / Centers — by PIR, only players with
    `gamesPlayed >= 5` and `minutesPerGame >= 10`.
  - A set the user can't use (guest, no favorite team, no squad, no
    favorites) renders disabled with a one-line reason.
- **Search** — `shared/search-match.ts` `normalize`/`loose` matching (accents,
  Greek). Tapping a result *adds* the player. Max 10 players per view.

### Columns row

Pills in the user's pick order, plus **+** opening the column picker
(same dialog pattern):

- **Stats, grouped**: Scoring · Shooting · Playmaking · Rebounding ·
  Defense · Usage & pace (all 25 catalog entries, toggle on/off).
- **Formula presets**: PRA (`PTS + REB + AST`), Stocks (`STL + BLK`),
  Per 40 (`X / MIN * 40` — choosing it asks which stat X).
- **Custom formula**: label + expression input. Autocomplete on aliases,
  translated errors inline, and a live value for the first selected player
  while typing. Max 3 formula columns (presets count toward it).
- Tapping a column pill opens a small menu: Move left, Move right, Edit
  (formulas only), Remove.

### Table

- Tap a header to sort (desc first, tap again to flip).
- Each numeric cell gets a background tint from the team-primary colour at
  an opacity scaled by that player's **league percentile** for that column.
- The sorted column also shows a small "top X%" under the value.
- Sticky player column with team badge, row → player page (unchanged).

### Chart

One bar list per column. Bar length = league percentile (0–100), not share
of the selection's max. Value printed beside the bar. Sorted by percentile,
high → low. Percentile is already inverted for `lowerIsBetter` stats, so a
longer bar means better everywhere.

### Saving

- **Save view** shows when the workspace is unsaved or differs from the
  saved view. A new view prompts for a name (dialog, max 60 chars).
- Saved: player ids, column keys in pick order, custom/preset formulas,
  current sort key + direction.
- Sort changes on a saved view count as unsaved changes.
- Switching views, **+ New**, or navigating away with unsaved changes shows
  the shared confirm dialog ("Discard changes?").

### Guests

Full workspace. Quick sets limited to the position sets; **Save view**
becomes "Log in to save" linking to `/login`.

## Architecture

All frontend. The backend already stores `columns` and formula
`expression`s as opaque strings and validates only shape, so no API or
schema changes are needed.

### `shared/stat-catalog.ts` (new)

```ts
export type StatGroup = "scoring" | "shooting" | "playmaking" | "rebounding" | "defense" | "usage";
export type StatFormat = "int" | "dec1" | "pct";
export interface StatDef {
  key: keyof PlayerSeasonStats;  // e.g. "reboundsPerGame"
  alias: string;                 // e.g. "REB" — formula identifier + chip text
  labelKey: string;              // i18n, reuses stats.col* where present
  legendKey: string;             // i18n one-line description
  group: StatGroup;
  format: StatFormat;
  lowerIsBetter?: boolean;       // turnoversPerGame, turnoverRatio
}
export const STAT_CATALOG: StatDef[];
export function formatStat(def: StatDef, v: number | null): string;
```

25 entries: gamesPlayed, minutesPerGame, pointsPerGame, reboundsPerGame,
assistsPerGame, stealsPerGame, blocksPerGame, turnoversPerGame,
fieldGoalPct, threePointPct, freeThrowPct, valuation,
effectiveFieldGoalPct, trueShootingPct, offensiveReboundPct,
defensiveReboundPct, totalReboundPct, assistToTurnoverRatio, assistRatio,
turnoverRatio, twoPointAttemptRate, threePointAttemptRate, freeThrowRate,
possessionsPerGame, usagePercentage — gamesPlayed is shown but excluded
from percentile tinting (it isn't a quality measure).

Aliases are unique, uppercase, identifier-safe (`FG_PCT`, `TP_PCT`,
`FT_PCT`, `TS_PCT`, `EFG_PCT`, `AST_TO`, …); the chip shows the translated
label (`FG%`), the formula uses the alias.

### `features/analytics-builder/formula.ts` (changed)

- Parser/grammar unchanged.
- `compileFormula(source, resolve)` takes a resolver
  `(name) => statKey | null`; the builder's resolver accepts the alias
  (case-insensitive) **or** the legacy camelCase key, so existing saved
  views evaluate unchanged.
- Errors become `{ code: FormulaErrorCode; params?: Record<string,string> }`
  with codes `empty`, `endsEarly`, `missingParen`, `unexpectedChar`,
  `unexpectedToken`, `trailingText`, `badNumber`, `unknownField`; the
  component maps them to `builder.formulaError.*` i18n keys.

### `features/analytics-builder/percentiles.ts` (new)

- Pool: rows with `gamesPlayed >= 5 && minutesPerGame >= 10`; if fewer than
  40 rows qualify, pool = rows with `gamesPlayed >= 1`.
- `buildPercentiles(poolRows, columns)` → per column a sorted `number[]` of
  pool values; `percentile(column, value)` via binary search → 0–100,
  inverted when `lowerIsBetter`. Formula columns are evaluated over the pool
  once to get their sorted arrays.
- Computed once per (rows, columns) change inside the store.

### Components (`features/analytics-builder/`)

| File | Responsibility |
|---|---|
| `analytics-builder.ts/.html` | Page shell: header, back link, loading/error states, lays out the children. |
| `builder-store.ts` | Component-provided service. Signals: `rows`, `views`, `activeViewId`, `workspace {playerIds, columns: ColumnRef[], sort}`, `isDirty`, derived `columnDefs`, `percentiles`, `sortedRows`. Actions: load, newWorkspace, openView, applyQuickSet, add/removePlayer, add/remove/moveColumn, upsertFormula, setSort, save, rename, delete. |
| `view-switcher.ts` | Dropdown, + New, ⋯ menu (rename/delete), dirty confirm. |
| `player-picker.ts` | Quick sets + search in `app-dialog`. |
| `column-picker.ts` | Grouped stats, presets, formula editor with autocomplete + live value. |
| `results-table.ts` | Table, sorting, percentile tint, top-X%. Inputs only. |
| `results-chart.ts` | Percentile bar lists. Inputs only. |

`ColumnRef = { kind: "stat"; key } | { kind: "formula"; id; label; expression }`.
On save it maps back onto the existing API shape without a backend change:
`customColumns` holds the formula definitions, and `columns` holds the full
display order, with stat keys as-is and formulas as `"f:<id>"` entries
(the backend accepts any strings there). A view made only of formulas still
passes the backend's `columns.length > 0` check. Old views without `f:`
entries load as their stats in stored order followed by their formulas
(today's behaviour).

### Routing

`canDeactivate` guard on the `analytics-builder` route: if the store is
dirty, open the shared confirm dialog and resolve with the answer.

### Data

All existing endpoints: `getAdvancedStats` (public), `getAnalyticsViews` /
`createAnalyticsView` / `updateAnalyticsView` / `deleteAnalyticsView`,
`FavoritePlayersService`, `getFantasyLineup`, `auth.currentUser()`.
Rename = `updateAnalyticsView` with the full body and the new name.

### Errors

- Stats load fails → error card with Retry (replaces the empty skeleton).
- Views load fails → inline "Couldn't load your views" + Retry in the
  switcher; the workspace still works unsaved.
- Save / rename / delete fails → inline message beside the action, using
  the backend's `code` → i18n where one exists (`VIEW_LIMIT_REACHED`,
  `INVALID_VIEW_BODY`), generic otherwise.

### i18n

EN + EL in `core/i18n/analytics-builder.ts` (and `stats.col*` for any
missing column labels): new stat labels + legend lines, group names, quick
sets and their disabled reasons, presets, formula error codes, switcher /
rename / save / discard copy, "top {n}%", guest save prompt. Obsolete
`builder.*` keys from the old editor are removed.

## Verification

No test suite. `ng build` must pass; then exercise on the local servers
(backend :4000 on the dev DB, `ng serve` :4200): first-run prefill, each
quick set, search with a Greek/accented name, adding every stat group,
PRA/Stocks/Per 40 presets, a custom formula with a deliberate error in both
languages, sorting + save + reload keeps sort, column reorder survives
save, an old view with camelCase formulas still evaluates, guest view,
dirty-guard on switch and on navigation. Then user screenshots on phone and
desktop.

## Follow-ups (to `TODO.md`)

- Move `stats/advanced-stats.ts` columns onto `STAT_CATALOG`.
- Shareable view links.
