# Lineup Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the team page's analytics section, let fans pick 2–5 players and see their numbers together, the team's numbers otherwise, and the best partners to add.

**Architecture:** One new single-statement service (`services/lineupBuilder.ts`) over `lineup_stints` behind a cached `GET /api/teams/:id/lineup`. Pure helpers (code normalisation; rating/pace maths) are checked with node-assert scripts like `scripts/check-matchup-preview.ts`. The frontend adds one standalone `lineup-builder` component inside `team-analytics.html`, plus a shared `lineup-math.ts` that the existing analytics cards also switch to.

**Tech Stack:** Express + Drizzle raw SQL (Postgres/Neon), `tsx`; Angular 20 standalone components + signals + RxJS interop; Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-09-lineup-builder-design.md`

## Global Constraints

- No schema changes.
- No test suite. Checks are `npx tsx src/scripts/check-*.ts` (node:assert), `npx tsc -p tsconfig.json --noEmit` (backend), `npx ng build` (frontend), and `curl` against a local backend started with `DATABASE_URL` explicitly set to EuroleagueDev (`neonctl connection-string --project-id misty-night-49318785 --org-id org-dark-hat-10818944`) and `DISABLE_BACKGROUND_JOBS=1`. The local `.env` files point at unidentified hosts, so don't trust them.
- The endpoint is **one SQL statement** (latency = DB round trips).
- Thresholds: small sample `< 1200` s; partner minimum `PARTNER_MIN_SECONDS = 600`; `PARTNER_LIMIT = 5`; selection 2–5 players.
- Possessions per stint = `fga − oreb + tov + 0.44·fta` (same as `teamAnalytics.ts`).
- Ratings: ORtg = 100·ptsFor/possFor, DRtg = 100·ptsAgainst/possAgainst, Net = ORtg − DRtg, Pace = ((possFor+possAgainst)/2)/(seconds/2400). Any zero denominator → null → "—".
- Cache: `CACHE_KEYS.lineup = "lineup:"`, key `lineup:<teamId>:<season>:<sorted codes>`, TTL 10 min.
- Every new UI string goes in `core/i18n/team-analytics.ts` with EN + EL in the same edit; reuse `ta.min`, `ta.gp`, `ta.net`, `ta.diff`.
- Frontend rules: buttons `appButton="outline" appButtonSize="sm"`; fits 360px; `formatPlayerName` for names; no browser automation (ask the user for screenshots).

## Review Focus

1. **Rapid taps**: picking/unpicking quickly must show only the latest selection's result, never an older response that arrives late. → Task 4 uses `switchMap`; verified by code read plus the user's check in Task 5.
2. **Player with a null `players` row** (code in stints, no matching player): partners and the pool must render with `name` null and not crash. The left join keeps them. → Task 2 check: the partner query uses `left join`; the Task 4 template falls back to the code when the name is null.
3. **Zero possessions** (a few seconds together, no shots): ratings are null and show "—", never NaN/Infinity. → Task 1 check `rating null on zero possessions`.
4. **Otherwise = team − together** must stay ≥ 0 and add up exactly. → Task 2 curl check: together + otherwise = team totals.
5. **Codes with spaces/duplicates/reordered in the URL** map to the same result and cache key. → Task 1 normalisation checks + Task 2 reordered-curl check.

---

### Task 1: Pure helpers + checks (backend codes, frontend maths)

**Files:**
- Create: `backend/src/services/lineupBuilder.ts` (only `normalizePlayerCodes` + the exported types in this task)
- Create: `backend/src/scripts/check-lineup-builder.ts` (codes only)
- Create: `frontend/src/app/features/team/lineup-math.ts`
- Create: `frontend/scripts/check-lineup-math.ts` (maths only; same pattern as `frontend/scripts/check-share-card.ts`, run from `frontend/` with `../backend/node_modules/.bin/tsx scripts/check-lineup-math.ts`. Backend `rootDir` is `src`, so backend scripts must not import frontend files.)
- Modify: `frontend/src/app/features/team/team-analytics.ts:18-28` (delete local `rating`/`netRating`; import `netRating` from `./lineup-math`)

**Interfaces:**
- Produces (backend):
  - `normalizePlayerCodes(raw: string | undefined): string[] | null`: split on `,`, trim, drop nothing silently (an empty segment → null), dedupe, sort with `localeCompare`; null unless 2–5 codes each matching `/^[A-Za-z0-9]{1,20}$/`. Case preserved.
  - Types: `LineupSums`, `LineupPartner`, `LineupBuilderResult` exactly as in the spec's Service block.
- Produces (frontend, `lineup-math.ts`): `offRating(ptsFor: number, possFor: number): number | null`, `defRating(ptsAgainst: number, possAgainst: number): number | null`, `netRating(ptsFor, possFor, ptsAgainst, possAgainst): number | null` (same semantics as the existing local one), `pace(possFor: number, possAgainst: number, seconds: number): number | null`.

- [ ] **Step 1: Write the failing checks** in `check-lineup-builder.ts` (`check(name, fn)` helper, node:assert/strict):
  - `codes sort + dedupe`: `normalizePlayerCodes(" 2 , 1 ")` → `["1","2"]`; `"1,1,2"` → `["1","2"]`; `"011212,P1"` keeps case/zeros → `["011212","P1"]`.
  - `codes reject`: `undefined`, `""`, `"1"`, `"1,1"` (one after dedupe), `"1,2,3,4,5,6"`, `"1,,2"`, `"1,2;3"`, `"1,a b"` → all `null`.
  - In `frontend/scripts/check-lineup-math.ts`, importing `../src/app/features/team/lineup-math` (pure TS, no Angular imports):
    - `rating null on zero possessions`: `netRating(10, 0, 5, 5) === null`, `offRating(0, 0) === null`, `pace(0, 0, 0) === null`.
    - `net`: `netRating(110, 100, 100, 100) === 10`.
    - `pace`: `pace(50, 50, 2400) === 50` (50 possessions in 40 min).
- [ ] **Step 2: Run to verify both fail**: `cd backend && npx tsx src/scripts/check-lineup-builder.ts` → fails to import `../services/lineupBuilder.js`; `cd frontend && ../backend/node_modules/.bin/tsx scripts/check-lineup-math.ts` → fails to import `lineup-math`.
- [ ] **Step 3: Implement** `normalizePlayerCodes` + types in `lineupBuilder.ts`, and `lineup-math.ts`. Then switch `team-analytics.ts` to import `netRating` from `./lineup-math` and delete its local copies.
- [ ] **Step 4: Verify**:
  - Both check scripts → every line `ok …`, exit 0.
  - `npx tsc -p tsconfig.json --noEmit` → no output.
  - `cd ../frontend && npx ng build` → "Output location", no `ERROR` (proves the analytics card still compiles against the moved helper).
- [ ] **Step 5: Commit**: `git add` the five files → `"Lineup builder: code normalisation and shared rating maths with checks"`.

---

### Task 2: Query, route, cache, invalidation, analytics photo field

**Files:**
- Modify: `backend/src/services/lineupBuilder.ts` (add `getLineupBuilder`)
- Modify: `backend/src/routes/teams.ts` (new route right after `/:id/analytics`, ~line 199)
- Modify: `backend/src/services/responseCache.ts` (`CACHE_KEYS.lineup`)
- Modify: `backend/src/index.ts`:
  - `runGameExtrasSync` (~line 334): after `syncMissingGameExtras`, `if (r.synced > 0) invalidate(CACHE_KEYS.lineup)`;
  - `runLiveGamesSync` (~line 252): add `CACHE_KEYS.lineup` to the existing `invalidate(CACHE_KEYS.preview)` call, since live sync writes stints when a game goes final.
- Modify: `backend/src/services/teamAnalytics.ts:169,174,186,229` (add `'photoUrl', p.photo_url` to each player `json_build_object`) and its `AnalyticsPlayer` type (`photoUrl: string | null`)

**Interfaces:**
- Consumes: Task 1's `normalizePlayerCodes` and types.
- Produces:
  - `getLineupBuilder(teamId: string, season: string, codes: string[]): Promise<LineupBuilderResult>`
  - `GET /api/teams/:id/lineup?players=<codes>[&season=]` → `LineupBuilderResult` | 400 `{ error: "Pick 2 to 5 players" }` | 404 `{ error: "No season" }` | 500 `{ error: "Failed to load lineup" }`
  - `AnalyticsPlayer.photoUrl: string | null` in the analytics response.

- [ ] **Step 1: RED.** Start the local backend on the dev DB (see Global Constraints). Get a team id and two codes from `curl -s localhost:4000/api/teams/<id>/analytics` (`lineups[0].players[*].code`), then `curl -s -w " %{http_code}" "localhost:4000/api/teams/<id>/lineup?players=<c1>,<c2>"`. Expected: 404 (no route).
- [ ] **Step 2: Implement `getLineupBuilder`** as one statement per the spec's Service section:
  - Bind codes as a text array: `${sql.raw("array[" + …)}` is **not** allowed. Use `sql\`array[${sql.join(codes.map((c) => sql\`${c}\`), sql\`, \`)}]::text[]\``.
  - `count(distinct game_id)` for games.
  - Partner identity via `left join players p on p.code = c`, returning `{ id, code, name, photoUrl }`.
  - `otherwise.games` = distinct `game_id` over stints **not** containing the group.
- [ ] **Step 3: Add the route, cache key, invalidation and analytics `photoUrl`.**
- [ ] **Step 4: Verify** (`npx tsc … --noEmit` clean first), with curl against the local backend:
  - A frequent pair: `together.seconds > 0`, and `together.seconds + otherwise.seconds` and `together.ptsFor + otherwise.ptsFor` equal the team totals from `select sum(seconds), sum(pts_for) from lineup_stints where team_id=… and season=…` (one dev query).
  - `lineups[0]`'s five from `/analytics`: `together.seconds === lineups[0].seconds`; `partners` is `[]`.
  - Two codes from different stints that never overlapped (pick from `/analytics` `onOff` the lowest-minutes pair; confirm with a dev query for `player_codes @> array[a,b]` returning 0 rows): `together.seconds === 0`, `partners: []`.
  - `?players=<c1>` and six codes → 400; `?players=<c2>,<c1>` → byte-identical body to `<c1>,<c2>`.
  - `/analytics` players now include `photoUrl`.
  - `grep -c NaN` on each body → 0.
- [ ] **Step 5: Commit** the 5 backend files → `"Lineup builder: cached together/otherwise/partners endpoint"`.

---

### Task 3: Frontend models, API, i18n

**Files:**
- Modify: `frontend/src/app/core/models.ts:1643` (`AnalyticsPlayer.photoUrl?: string | null`; add `LineupSums`, `LineupPartner`, `LineupBuilderResult`)
- Modify: `frontend/src/app/core/api.service.ts` (next to `getTeamAnalytics`, ~line 102)
- Modify: `frontend/src/app/core/i18n/team-analytics.ts`

**Interfaces:**
- Produces: `getTeamLineup(teamId: string, codes: string[]): Observable<LineupBuilderResult>` → `GET /teams/:id/lineup`, `params: { players: codes.join(",") }`. i18n keys exactly as listed in the spec's i18n section, EN + EL.

- [ ] **Step 1: Add** the types, API method and keys.
- [ ] **Step 2: Verify**: `npx ng build` passes; `grep -c 'el: ""' src/app/core/i18n/team-analytics.ts` → `0`.
- [ ] **Step 3: Commit** → `"Lineup builder: frontend types, API call, EN/EL strings"`.

---

### Task 4: Lineup builder component + analytics integration

**Files:**
- Create: `frontend/src/app/features/team/lineup-builder.ts`
- Modify: `frontend/src/app/features/team/team-analytics.html` (insert after the "Most-used lineups" card, ~line 92; add an "Open in builder" action to each lineup row)
- Modify: `frontend/src/app/features/team/team-analytics.ts` (import the component; `viewChild(LineupBuilderComponent)`; `openInBuilder(codes: string[])`; a `builderPool` computed = `onOff` players sorted by `secondsOn` desc)

**Interfaces:**
- Consumes: `getTeamLineup`, `LineupBuilderResult`, `lineup-math.ts`, `ta.*` keys, `AnalyticsPlayer`.
- Produces: `<app-lineup-builder [teamId] [pool] [teamColor] />`, selector `app-lineup-builder`, with public `load(codes: string[]): void` (replaces the selection, then the host scrolls it into view via `ElementRef.nativeElement.scrollIntoView({ behavior: "smooth", block: "start" })`).

- [ ] **Step 1: Implement the component** per the spec's Behaviour and Frontend sections:
  - `selection = signal<string[]>([])`;
  - result via `toObservable(computed(() => sorted selection))` → `switchMap` (fewer than 2 → `of(null)`) → `toSignal`, plus `loading`/`error` signals;
  - toggle refuses a 6th pick; non-selected chips are disabled at 5;
  - Clear;
  - headline net + "otherwise" line;
  - grid (MIN, GP, PTS ±, ORtg, DRtg, Pace);
  - small-sample dimming under 1200 s;
  - "Never on court together" at 0 s;
  - best partners (2–4 picked, together > 0, empty-state text), row tap adds;
  - error + retry.
  Names: `formatPlayerName(name ?? code)`.
- [ ] **Step 2: Integrate** into `team-analytics.html`/`.ts` as listed under Files.
- [ ] **Step 3: Verify**:
  - `npx ng build` passes with no warnings mentioning `lineup-builder`.
  - Code read: every visible string is `i18n.t('ta.…')`; no fixed width over 360px; the `switchMap` cancels in-flight requests (Review Focus #1); a null `name` falls back to the code (Review Focus #2).
- [ ] **Step 4: Commit** → `"Lineup builder: team analytics card with partners and otherwise comparison"`.

---

### Task 5: Ship to dev and hand off

- [ ] **Step 1:** Run the `ship` skill for **dev** (it verifies the served bundle contains `ta.builderTitle`).
- [ ] **Step 2:** Against the dev URL, `curl` `/api/teams/<id>/lineup?players=<c1>,<c2>` → 200 with `together.seconds > 0`.
- [ ] **Step 3:** Tell the user what changed and ask for phone + desktop screenshots of a team's analytics section:
  - picking 2–5 players;
  - a partner tap;
  - "Open in builder";
  - rapid taps settling on the right result.
  Production waits for their OK.
