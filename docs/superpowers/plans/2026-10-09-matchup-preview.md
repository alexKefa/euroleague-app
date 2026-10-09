# Matchup Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pre-game matchup preview (form + head-to-head, availability, key matchups) on the game page, and a compact form/H2H/injury strip next to each pick in Predictions.

**Architecture:** Pure computation lives in `backend/src/services/matchupPreview/core.ts`, checked by a node-assert script, the same way `services/winProb/model.ts` is checked by `scripts/check-win-prob.ts`. A thin DB layer (`matchupPreview/index.ts`) loads rows in as few statements as possible and feeds the core. Two cached GET routes on the games router serve it. The frontend adds one game-page card component and one presentational strip component used by both the pick list and the Quick pick deck.

**Tech Stack:** Express + Drizzle (Postgres/Neon), `tsx`, Angular 20 standalone components + signals, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-09-matchup-preview-design.md`. One deliberate deviation: the spec's `services/matchupPreview.ts` is split into a `services/matchupPreview/` folder (`core.ts` pure, `index.ts` DB), so the pure logic can be checked without a database, mirroring `services/winProb/`.

## Global Constraints

- No schema changes; no new tables or sync jobs.
- No test suite exists. Pure logic is checked with `npx tsx src/scripts/check-matchup-preview.ts` (node:assert). Everything else is checked with `npx tsc -p tsconfig.json --noEmit` (backend), `npx ng build` (frontend), and `curl` against the local backend (local `.env` points at the **dev** DB; verify before trusting it, and kill stale `tsx watch` on :4000).
- Latency = DB round trips: full preview ≤ 4 statements, round strips = 2 statements. Merge with CTEs/subqueries, don't fan out.
- "Upcoming" everywhere = `status === "scheduled" && tipoffAt > now`.
- Short rest = rest days `<= SHORT_REST_MAX_DAYS` (import from `services/restSplits.ts`); days are counted as Europe/Athens calendar days.
- H2H window = `getRecentSeasons(2)` from `services/refereeStats.ts`. Form season = `getCurrentSeason()` from `services/season.ts`.
- Cache: `CACHE_KEYS.preview = "preview:"`; keys `preview:game:<id>` / `preview:round:<season>:<round>`; TTL 10 min; never cache `{ available: false }` or 404.
- Every UI string goes through i18n, with EN and EL written in the same edit (new `core/i18n/matchup.ts`).
- Frontend rules: `[appButton]` for buttons, `navHistory`-style links unchanged, no `fixed` toasts, `font-display` for headings/numbers, must fit 360px with no horizontal scroll.
- Don't open a browser; ask the user for screenshots at the end.

## Review Focus

1. **Round-1 / no-games-yet team**: form empty, streak `null`, edges fall back to the prior season; a team with no prior season either gets `null` values and `better: null`, with no crash or NaN. → check in Task 1 (`edges with nulls`, `streak empty`).
2. **Status lag**: tipoff has passed but status is still `scheduled`. Both routes must treat it as not upcoming (`{ available: false }` / omitted from strips). → curl check in Task 2.
3. **Zero 3PT attempts / zero games**: a division-by-zero produces `null`, never `NaN`/`Infinity` in JSON. → check in Task 1 (`ratio guards`).
4. **Rest across midnight/DST**: a game at 21:45 Athens followed by one at 18:00 two days later is 2 rest days, not 1 or 3. → check in Task 1 (`rest days Athens`).
5. **Swipe deck link**: tapping "Full preview ›" on a deck card navigates without registering a swipe. → manual note in Task 5's verification (screenshot/user check).

---

### Task 1: Pure preview core + checks

**Files:**
- Create: `backend/src/services/matchupPreview/core.ts`
- Create: `backend/src/scripts/check-matchup-preview.ts`

**Interfaces:**
- Produces (exported from `core.ts`; the response types exactly as in the spec's "Service" block: `FormGame`, `H2HGame`, `InjuredPlayer`, `EdgeRow`, `DuelPlayer`, `MatchupPreview`, `PreviewStrip`, plus `TeamRef = { id: string; code: string; name: string; primaryColor: string | null; logoUrl: string | null }`, `InjuryStatus = "out" | "doubtful" | "questionable" | "probable"`, `TeamForm = { games: FormGame[]; streak: string | null }`):
  - `type FinalGameRow = { id: string; season: string; tipoffAt: Date; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }`
  - `buildTeamForm(teamId: string, seasonGames: FinalGameRow[], teamsById: Map<string, TeamRef>, limit = 5): TeamForm`: newest-first games; streak like `"W3"`/`"L1"` over **all** given games; `null` if none.
  - `buildH2H(homeId: string, awayId: string, games: FinalGameRow[], limit = 5): { games: H2HGame[]; homeWins: number; awayWins: number }`: wins counted over the returned (≤5) meetings, from this game's home/away perspective.
  - `athensDayDiff(from: Date, to: Date): number`: calendar-day difference in Europe/Athens.
  - `restDays(teamId: string, seasonGames: FinalGameRow[], tipoff: Date): number | null`
  - `type TeamStatLine = { offRating: number | null; defRating: number | null; threePct: number | null; rebPg: number | null; astPg: number | null; tovPg: number | null }`
  - `buildEdges(home: TeamStatLine, away: TeamStatLine): EdgeRow[]`: the 6 keys in the order `offRating, defRating, threePct, rebPg, astPg, tovPg`; lower-is-better for `defRating` and `tovPg`; `even` on equal; `better: null` if either side is null.
  - `ratio(n: number, d: number): number | null`: `null` when `d === 0`.
  - `type PlayerAvg = DuelPlayer & { teamId: string; injuryStatus: InjuryStatus | null }`
  - `pickKeyBattle(homeId: string, awayId: string, players: PlayerAvg[]): { position: string; home: DuelPlayer; away: DuelPlayer } | null`: excludes `injuryStatus === "out"` and `games < 2`; best-PIR per team per position (Guard/Forward/Center); picks the position with the highest combined PIR; `null` if none has both sides.
  - `toStrip(form: { home: TeamForm; away: TeamForm }, h2h: { homeWins: number; awayWins: number; games: unknown[] }, injuries: { home: number; away: number }): PreviewStrip`: form as `("W"|"L")[]` **oldest first** (newest last, per spec); `h2h` `null` when no meetings.

- [ ] **Step 1: Write the failing checks** in `check-matchup-preview.ts`, using the `check(name, fn)` helper style from `scripts/check-win-prob.ts`:
  - `form newest-first + streak`: 7 games for team A with results W,W,L,W,W,W,L (oldest→newest). Expect 5 games returned, `games[0]` = newest (L), streak `"L1"`. Same list minus the last game gives streak `"W3"`.
  - `streak empty`: `buildTeamForm("A", [], …)` → `{ games: [], streak: null }`.
  - `h2h perspective`: 3 meetings (A home won, B home won, A away won), called with `homeId = "B"` → `homeWins 1, awayWins 2`, `games.length 3`. Unrelated games are ignored.
  - `rest days Athens`: previous game `2026-10-07T18:45:00Z` (21:45 Athens), tipoff `2026-10-09T15:00:00Z` → `restDays === 2`; DST edge: `2026-10-24T20:00:00Z` → `2026-10-26T17:00:00Z` → `2`. No previous game → `null`.
  - `edges direction`: home `defRating 105` vs away `110` → `better "home"`; `tovPg 12` vs `12` → `"even"`; `offRating 115` vs `null` → `better null`. Output keys in the specified order.
  - `edges with nulls`: all-null lines → 6 rows, every `better === null`, and `JSON.stringify` contains no `NaN`.
  - `ratio guards`: `ratio(3, 0) === null`, `ratio(1, 4) === 0.25`.
  - `key battle`: Guards A:18 PIR / B:15, Centers A:20 / B:19, Forwards only on A → position `"Center"`. If A's center is `out`, it falls back to the next-best A center, or to `"Guard"` if none. A player with `games: 1` is ignored.
  - `strip`: `toStrip` gives oldest-first W/L, injury counts passed through, and `h2h null` when there are no meetings.

- [ ] **Step 2: Run to verify it fails**
  Run: `cd backend && npx tsx src/scripts/check-matchup-preview.ts`
  Expected: fails to import `../services/matchupPreview/core.js`.

- [ ] **Step 3: Implement `core.ts`** with the signatures above. `athensDayDiff`: format both dates with `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" })` to `YYYY-MM-DD`, then diff as UTC dates (same approach as fantasy's `athensDateKey`). Round averages/percentages to 1 decimal (3PT% as a percentage, e.g. `36.4`).

- [ ] **Step 4: Run to verify it passes**
  Run: `cd backend && npx tsx src/scripts/check-matchup-preview.ts`
  Expected: every line prints `ok …`, exit code 0.

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/services/matchupPreview/core.ts backend/src/scripts/check-matchup-preview.ts
  git commit -m "Matchup preview: pure form/H2H/rest/edges/key-battle core with checks"
  ```

---

### Task 2: DB layer, routes, caching

**Files:**
- Create: `backend/src/services/matchupPreview/index.ts`
- Modify: `backend/src/services/responseCache.ts` (`CACHE_KEYS`)
- Modify: `backend/src/routes/games.ts` (two routes; `/previews` registered **before** `gamesRouter.get("/:id"…)` at ~line 254, next to `/win-prob/pregame`)
- Modify: `backend/src/routes/injuries.ts:10` (add `CACHE_KEYS.preview` to `invalidateOnWrite`)
- Modify: `backend/src/index.ts` (add `CACHE_KEYS.preview` to the injury-sync `.finally(() => invalidate(...))` (~line 301) and call `invalidate(CACHE_KEYS.preview)` inside the live-games sync when `wentLive > 0 || wentFinal > 0` (~line 252))

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `getMatchupPreview(gameId: string): Promise<MatchupPreview | { available: false } | null>` (`null` = unknown game)
  - `getRoundPreviewStrips(season: string, round: number): Promise<Record<string, PreviewStrip>>`
  - `GET /api/games/:id/preview` → `MatchupPreview` | `{ available: false }` | 404 `{ error }`
  - `GET /api/games/previews?season=&round=` → `Record<gameId, PreviewStrip>` | 400 `{ error }` when `round` isn't a positive integer or `season` is missing

- [ ] **Step 1: Write the failing check.** Start the backend (`cd backend && npm run dev`, after confirming no stale :4000 process and that `.env` points at dev). Pick an upcoming game id from `curl -s localhost:4000/api/games/schedule`, then:
  ```bash
  curl -s localhost:4000/api/games/<id>/preview
  curl -s "localhost:4000/api/games/previews?season=<season>&round=<round>"
  ```
  Expected now: 404 / "Cannot GET" (routes not defined).

- [ ] **Step 2: Implement `index.ts`.**
  - `getMatchupPreview`, 4 statements:
    1. Load the game (with team refs).
    2. All final games from `getRecentSeasons(2)` involving either team.
    3. Injured players (with `player_injuries.status`, `note`, `noteEl`) whose `players.teamId` is either team, sorted by severity (out, doubtful, questionable, probable), then name.
    4. The stats query.
  - Return `{ available: false }` unless the game is upcoming.
  - Stats query: for the current season **and** the previous one, return `team_season_stats` (off/def rating) plus per-team per-game box-score sums from `player_game_stats` (3PM/3PA, REB, AST, TOV, games), and per-player averages (games, pts, reb, ast, pir, position, photo, name, team), all in one statement. Attribute a player's line to a team with the `player_season_stats`-team-then-current-team rule used in `restSplits.ts`.
  - Choose `statsSeason`: the current season, unless either team has `< 3` final games in it, in which case the previous season (`usingPriorSeason: true`).
  - `getRoundPreviewStrips`, 2 statements:
    1. The round's games plus all current-season final games for every team in the round.
    2. Out/doubtful counts grouped by team.
  - Skip non-upcoming games. Build each strip with `buildTeamForm`, `buildH2H` (H2H needs the two-season window, so statement 1 spans `getRecentSeasons(2)`), and `toStrip`.

- [ ] **Step 3: Add the routes and cache.**
  - Add `preview: "preview:"` to `CACHE_KEYS`.
  - Wrap the loaders with `cached(\`preview:game:${id}\`, 10 * 60_000, …)` and `cached(\`preview:round:${season}:${round}\`, …)`.
  - For the game route, check upcoming first, before reading the cache, so `{ available: false }` and 404 are never cached.
  - Errors: `console.error("GET /api/games/:id/preview failed:", err)` / `"GET /api/games/previews failed:"` → 500 `{ error: "Failed to load matchup preview" }`.
  - Add the invalidation hooks listed under Files.

- [ ] **Step 4: Verify.**
  Run `cd backend && npx tsc -p tsconfig.json --noEmit` (expect no output), then the Step 1 curls. Expected:
  - The preview has all keys from the spec, and `edges.length === 6`.
  - Every `better` is one of `home|away|even|null`.
  - The strips object is keyed only by upcoming game ids.
  - A final game id returns `{"available":false}`.
  - A random UUID returns 404.
  - `?round=abc` returns 400.
  - `curl … | grep -c NaN` → `0`.
  - Count statements: temporarily wrap the dev DB client logger (or add a one-off `console.count` in the loader) and confirm ≤ 4 and 2 respectively, then remove it.

- [ ] **Step 5: Commit**
  ```bash
  git add backend/src/services/matchupPreview/index.ts backend/src/services/responseCache.ts backend/src/routes/games.ts backend/src/routes/injuries.ts backend/src/index.ts
  git commit -m "Matchup preview: cached game and round preview endpoints"
  ```

---

### Task 3: Frontend models, API, i18n

**Files:**
- Modify: `frontend/src/app/core/models.ts` (add types next to `WinProbPreGame`)
- Modify: `frontend/src/app/core/api.service.ts` (next to `getPreGameWinProbs`, ~line 232)
- Create: `frontend/src/app/core/i18n/matchup.ts`
- Modify: `frontend/src/app/core/i18n/translations.ts` (import + spread `matchupTranslations` like `winProbTranslations`)

**Interfaces:**
- Consumes: the Task 2 response shapes.
- Produces:
  - Types `MatchupPreview`, `MatchupFormGame`, `MatchupH2HGame`, `MatchupInjuredPlayer`, `MatchupEdgeRow`, `MatchupDuelPlayer`, `PreviewStrip`, mirroring the backend (team refs use the existing `GameTeamSummary`). Plus `MatchupPreviewResponse = MatchupPreview | { available: false }`.
  - `getMatchupPreview(gameId: string): Observable<MatchupPreviewResponse>` → `GET /games/:id/preview`
  - `getRoundPreviewStrips(season: string, round: number): Observable<Record<string, PreviewStrip>>` → `GET /games/previews` with `params: { season, round }`
  - i18n keys (namespace `matchup.`), EN + EL:
    - Titles: `title` (Matchup preview / Προϊστορία αναμέτρησης), `formH2h`, `availability`, `keyMatchups`, `keyBattle`.
    - H2H: `leads` ("{team} leads {a}-{b}"), `tied` ("Series tied {a}-{b}"), `firstMeeting` ("First meeting in two seasons"), `noGamesYet`.
    - Rest: `restEdge` ("{team} has the rest edge"), `playedDaysAgo` ("played {n} days ago"), `bothShortRest`.
    - Other: `fullStrength` ("Both teams at full strength"), `lastSeason`, `fullPreview` ("Full preview"), `h2h` ("H2H").
    - Stat labels: `stat.offRating`, `stat.defRating`, `stat.threePct`, `stat.rebPg`, `stat.astPg`, `stat.tovPg`.

- [ ] **Step 1: Add the types, API methods and dictionary.**
- [ ] **Step 2: Verify**: `cd frontend && npx ng build` → "Output location" with no `ERROR`. In `matchup.ts`, every key has both `en` and `el`, non-empty: `grep -c 'el: ""' src/app/core/i18n/matchup.ts` → `0`.
- [ ] **Step 3: Commit**
  ```bash
  git add frontend/src/app/core/models.ts frontend/src/app/core/api.service.ts frontend/src/app/core/i18n/matchup.ts frontend/src/app/core/i18n/translations.ts
  git commit -m "Matchup preview: frontend types, API calls, EN/EL strings"
  ```

---

### Task 4: Game page preview card

**Files:**
- Create: `frontend/src/app/features/game/matchup-preview.ts` (template inline or a sibling `.html`; follow `win-prob-card.ts`'s structure)
- Modify: `frontend/src/app/features/game/game-detail.html:389` (render right after `<app-win-prob-card …/>`, only when `d.game.status === 'scheduled'`)
- Modify: `frontend/src/app/features/game/game-detail.ts` (add the component to `imports`)

**Interfaces:**
- Consumes: `getMatchupPreview`, the Task 3 types and `matchup.*` keys; `injuryNoteFor` (`shared/injury-status.ts`); the existing `injuries.status*` keys and status colors.
- Produces: `<app-matchup-preview [gameId]="…" [home]="GameTeamSummary" [away]="GameTeamSummary" />`, selector `app-matchup-preview`.

- [ ] **Step 1: Implement the component** per the spec's "Game page" section:
  - Signals: `data`, `loading`, `failed`. Render nothing when `failed()` or `available: false`. Show a skeleton with the card's height while loading.
  - Three blocks: Form & H2H; Availability (2 columns, `grid-cols-1 sm:grid-cols-2`, short-rest banner above); Key matchups (6 bars + "last season" tag + key battle).
  - Bar fill: the better side's width share. For lower-is-better keys use the inverse share. `even`/`null` draw a neutral bar.
- [ ] **Step 2: Verify**: `npx ng build` passes. With the local backend + `npm start`, `curl -s localhost:4200/api/games/<upcoming id>/preview` returns data (proxy works). Then a code read: every visible string is `i18n.t('matchup.…')`, and nothing has a fixed width over 360px.
- [ ] **Step 3: Commit**
  ```bash
  git add frontend/src/app/features/game/matchup-preview.ts frontend/src/app/features/game/game-detail.html frontend/src/app/features/game/game-detail.ts
  git commit -m "Matchup preview: game page card (form, H2H, availability, key matchups)"
  ```

---

### Task 5: Compact strip in Predictions + Quick pick deck

**Files:**
- Create: `frontend/src/app/shared/matchup-strip.ts`
- Modify: `frontend/src/app/features/predictions/predictions.ts` (~line 214 add `readonly previewStrips = signal<Record<string, PreviewStrip>>({})`; in the schedule load at ~line 674, call `getRoundPreviewStrips(schedule.season, schedule.round)` next to `getPreGameWinProbs`, with `error: () => {}`)
- Modify: `frontend/src/app/features/predictions/predictions.html` (inside each upcoming game card, after the win-prob block at ~line 249 and before the community split at ~line 261; pass `[previews]="previewStrips()"` to `<app-swipe-deck>` at ~line 1206)
- Modify: `frontend/src/app/features/predictions/swipe-deck.ts` (add `readonly previews = input<Record<string, PreviewStrip>>({})`, render the strip on the card face)

**Interfaces:**
- Consumes: `PreviewStrip`, `GameTeamSummary`, `matchup.*` keys.
- Produces: `<app-matchup-strip [strip]="PreviewStrip" [home]="GameTeamSummary" [away]="GameTeamSummary" [gameId]="string" />`, selector `app-matchup-strip`, purely presentational.

- [ ] **Step 1: Implement `matchup-strip.ts`** per the spec's compact-strip layout:
  - Two rows: code, 5 dots (filled team-color = W, hollow = L, newest last), H2H on the leading row (home row when tied, hidden when `h2h` is null), and an injury badge.
  - Then a `routerLink` "Full preview ›" to `/games/:id`. The link stops `pointerdown`/`touchstart`/`click` propagation so the deck never registers a swipe.
- [ ] **Step 2: Wire it into the pick list and the deck.** A missing `previewStrips()[game.id]` renders nothing.
- [ ] **Step 3: Verify**: `npx ng build` passes; `curl -s "localhost:4200/api/games/previews?season=…&round=…"` returns the strips through the proxy. Review Focus #5 is confirmed by the user in Task 6.
- [ ] **Step 4: Commit**
  ```bash
  git add frontend/src/app/shared/matchup-strip.ts frontend/src/app/features/predictions/predictions.ts frontend/src/app/features/predictions/predictions.html frontend/src/app/features/predictions/swipe-deck.ts
  git commit -m "Matchup preview: compact form/H2H/injury strip in Predictions and Quick pick deck"
  ```

---

### Task 6: Ship to dev and hand off for visual check

- [ ] **Step 1:** Run the `ship` skill for **dev** (it does type-check, build, push and `railway up --environment dev`, then verifies the served bundle contains `matchup.fullPreview`).
- [ ] **Step 2:** Spec verification #3: edit an injury on dev's admin Injury Report, then `curl` the dev `/api/games/<id>/preview` and confirm the change shows immediately.
- [ ] **Step 3:** Tell the user what changed and ask for screenshots on phone and desktop:
  - the game page of an upcoming game;
  - the Predictions pick list;
  - the Quick pick deck, including whether tapping "Full preview ›" on a deck card navigates without swiping.
  Suggest a "What's new" announcement (EN + EL) for `/admin/tools`. Production deploy only after the user confirms.
