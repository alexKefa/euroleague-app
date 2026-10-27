# Album Series 2: Moments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Series 2 "Moments": a card for each round's best performances (Jan 1 backlog + 6 per round), an MVP-moment bonus for good predictions, and Series 1 first guaranteed pulls. The feature ships inactive until 2027-01-01.

**Architecture:** Moment cards are ordinary `collectibles` rows (`series = 2`) with a `collectible_moments` side table. Every existing system (ownership, packs, trades, battles, sell-back, leaderboard) keeps working unchanged. A production-only hourly job generates cards for ready rounds behind a launch gate. Bonuses are granted lazily per user, claim-first, like round rewards. Pure decision logic lives in `momentsLogic.ts` and is unit-tested with `node:test`. DB behaviour is checked by a dev-only script.

**Tech Stack:** Express + TypeScript (ESM, tsx), Drizzle ORM on Neon Postgres, Angular 20 standalone components + signals, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-27-album-series-2-moments-design.md`

## Global Constraints

- Launch gate `MOMENTS_LAUNCH_AT` = 2027-01-01 00:00 Europe/Athens = `2026-12-31T22:00:00Z`.
- `MOMENTS_PER_ROUND = { legendary: 1, rare: 5 }`.
- `points_cost`: 2500 for a moment legendary, 250 for a moment rare.
- Ranking: PIR (`valuation`) desc, then points desc, then minutes desc, then player id asc. One card per player per round, using their best line.
- Round ready: every game `final` with `player_game_stats`, **or** ≥ 7 days after the round's last scheduled tipoff with ≥ 8 games final with stats.
- Bonus: `great_round` = correct winner picks ≥ `GREAT_ROUND_THRESHOLD` (8). `backed_mvp` = a correct top-scorer pick (ties count) on the MVP in the MVP's game. If both hold, reason = `backed_mvp`.
- Schema changes are hand-written SQL applied to **both** the dev DB (`EuroleagueDev`, host contains `ep-sparkling-pond`) and the production DB (`EuroleagueProd`, host contains `ep-divine-truth`), mirrored in `schema.ts`. Local `backend/.env` points at dev; `backend/.env.prod` points at production.
- This machine has Node 18. Run anything that loads the backend through Node 22: `npx -y node@22 node_modules/tsx/dist/cli.mjs <file>`. Angular: `npx -y node@22 node_modules/@angular/cli/bin/ng.js build`.
- Fewer DB round trips, not `Promise.all` (CLAUDE.md): use multi-row inserts and combined statements.
- Every new UI string goes into **both** EN and EL dictionaries in the same task.
- Frontend: standalone components, signals, `[appButton]`. Never read and write the same signal inside an `effect()`. No new mobile tab.
- No test suite exists. Pure logic is tested with `node:test` via `tsx --test`. DB behaviour is tested by `src/scripts/check-moments.ts`, which refuses to run unless `DATABASE_URL` contains `ep-sparkling-pond`.
- Commit after each task on branch `dev`. Don't deploy until Task 10.

## Review Focus

1. **Catalog cache:** `GET /api/collectibles` is cached for 10 minutes (`CACHE_KEYS.collectibles`). Without invalidation, new moments wouldn't appear in the album for up to 10 minutes after generation. Task 3 invalidates it and its check asserts it.
2. **Double-round weeks:** a player with two games in one round must get exactly one card, from their best line. Task 2 test.
3. **Postponed games:** a round with 9/10 games final and 7+ days old is ready, without the missing game's lines. With 7/10 final it is not ready. A round whose games are all final but missing stats is not ready. Task 2 tests.
4. **Bonus for an already-owned MVP card:** a user who pulled the MVP moment from a pack before claiming the bonus gets a recorded bonus row, no second `user_collectibles` row, and is never re-evaluated. Task 5 check.
5. **Top-scorer ties and a non-top-scoring MVP:** a tie for top scorer still counts as `backed_mvp`. If the MVP wasn't their game's top scorer, nobody gets `backed_mvp` that round, though `great_round` still can. Task 5 check.

---

### Task 1: Schema

**Files:**
- Modify: `backend/src/db/schema.ts` (`collectibles` at ~677; add the two new tables after `userCollectibles`)
- Create: `backend/src/db/sql/2026-10-27-series-2-moments.sql`

**Interfaces:**
- Produces: `collectibles.series` (smallint, not null, default 1). `collectibleMoments` table: `collectibleId` PK→collectibles, `playerId`→players, `gameId`→games, `season` varchar(9), `round` int, `role` varchar(10) (`'mvp' | 'top'`), `points`, `pir`, `rebounds`, `assists` int, `minutes` real; unique `(season, round, player_id)`. `momentBonuses` table: `id` uuid PK, `userId`→users, `collectibleId`→collectibles, `reason` varchar(20) (`'great_round' | 'backed_mvp'`), `grantedAt` timestamptz default now(), `seenAt` timestamptz null; unique `(user_id, collectible_id)`.

- [ ] **Step 1: Write the SQL file** with `alter table collectibles add column if not exists series smallint not null default 1;` plus `create table if not exists` for both tables and their unique indexes. Name the indexes `collectible_moments_round_player_unique` and `moment_bonuses_user_collectible_unique`. Everything idempotent.
- [ ] **Step 2: Mirror it in `schema.ts`.** Use the same names, add doc comments in the file's style, and export `type MomentRole = "mvp" | "top"` and `type MomentBonusReason = "great_round" | "backed_mvp"`.
- [ ] **Step 3: Type-check.** Run `cd backend && npx tsc -p tsconfig.json --noEmit`. Expected: exit 0.
- [ ] **Step 4: Apply to dev.** Run the SQL against `backend/.env`'s `DATABASE_URL` with a one-off `postgres` script via Node 22. Verify with `select count(*) filter (where series = 1), count(*) from collectibles;`. Expected: both counts are equal (700 on prod; whatever dev has).
- [ ] **Step 5: Apply to production.** Show the user the SQL and confirm before running it. It is additive DDL, but it touches production. Then run it with `--env-file=.env.prod` and verify with the same query. Expected: `700 | 700`.
- [ ] **Step 6: Commit.** `git commit -m "Series 2 moments: schema (collectibles.series, collectible_moments, moment_bonuses)"`

### Task 2: Pure moment logic

**Files:**
- Create: `backend/src/services/momentsLogic.ts`
- Test: `backend/src/services/momentsLogic.test.ts`

**Interfaces:**
- Produces:
  - `type PlayerLine = { playerId: string; teamId: string; gameId: string; pir: number | null; points: number | null; rebounds: number | null; assists: number | null; minutes: number | null }`
  - `type RoundGame = { gameId: string; tipoffAt: Date; status: string; hasStats: boolean }`
  - `pickRoundMoments(lines: PlayerLine[], perRound: { legendary: number; rare: number }): { line: PlayerLine; role: "mvp" | "top" }[]`, ordered MVP first.
  - `isRoundReady(games: RoundGame[], now: Date): { ready: boolean; gameIds: string[] }`. `gameIds` = the final games with stats that count.
  - `pickSeriesFirst<T extends { series: number }>(missing: T[]): T[]` returns the Series 1 subset if non-empty, else the input.
  - `MOMENTS_PER_ROUND`, `MOMENTS_LAUNCH_AT: Date`, `isMomentsLaunched(now: Date): boolean`.

- [ ] **Step 1: Write the failing tests** (`node:test` + `node:assert/strict`):
  - `pickRoundMoments ranks by PIR then points then minutes then playerId`. With lines (pir, pts, min): A(30,20,30), B(30,22,25), C(30,22,28), D(25,…), E(40,…), F(10,…), G(12,…), it returns E as `mvp`, then C, B, A, D, G as `top`. F is excluded.
  - `pickRoundMoments keeps one line per player (best)`: player P with lines pir 35 and pir 20 in two games appears once, with the pir 35 line's `gameId`.
  - `pickRoundMoments treats null pir as lowest`.
  - `pickRoundMoments returns fewer than 6 when fewer players exist` (3 lines → 1 mvp + 2 top).
  - `isRoundReady true when all games final with stats`. The result's `gameIds` has all 10.
  - `isRoundReady false when a game is final without stats and under 7 days`.
  - `isRoundReady true after 7 days with 9 of 10 final+stats`. `gameIds` has 9 and excludes the scheduled game.
  - `isRoundReady false after 7 days with 7 of 10`.
  - `isRoundReady false at 6.9 days with 9 of 10`.
  - `pickSeriesFirst returns only series 1 when any exist`, and `returns all when none are series 1`.
  - `isMomentsLaunched false at 2026-12-31T21:59:59Z, true at 2026-12-31T22:00:00Z`.
- [ ] **Step 2: Run the tests to see them fail.** Run `cd backend && npx tsx --test src/services/momentsLogic.test.ts`. Expected: FAIL, cannot find module `./momentsLogic.js`.
- [ ] **Step 3: Implement `momentsLogic.ts`.** It has no imports from the db layer, so it stays runnable under plain tsx.
- [ ] **Step 4: Run the tests to see them pass.** Same command. Expected: all pass.
- [ ] **Step 5: Commit.** `git commit -m "Series 2 moments: pure selection, readiness and series-first logic with tests"`

### Task 3: Generation service, script and hourly job

**Files:**
- Create: `backend/src/services/moments.ts`
- Create: `backend/src/scripts/generate-moments.ts`
- Create: `backend/src/scripts/check-moments.ts`
- Modify: `backend/src/index.ts` (`runHourlyJobs`, ~458)
- Modify: `backend/package.json` (scripts `moments:generate`, `check:moments`)

**Interfaces:**
- Consumes: Task 2 (`pickRoundMoments`, `isRoundReady`, `isMomentsLaunched`, `MOMENTS_PER_ROUND`). `getCurrentSeason()` from `services/season.ts`. `invalidate`, `CACHE_KEYS` from `services/responseCache.ts`.
- Produces:
  - `findReadyRounds(season: string, now: Date): Promise<{ round: number; gameIds: string[] }[]>`: rounds with no `collectible_moments` rows, judged by `isRoundReady`.
  - `planRoundMoments(season: string, round: number, gameIds: string[]): Promise<PlannedMoment[]>`, where `PlannedMoment = { line: PlayerLine; role: MomentRole; playerName: string; photoUrl: string | null; opponentTeamId: string }`.
  - `generateMomentsForReadyRounds(opts?: { now?: Date; force?: boolean; dryRun?: boolean }): Promise<{ round: number; created: number }[]>`.

- [ ] **Step 1: Write the failing check** in `check-moments.ts`, following `check-account-deletion.ts`: the dev-host guard, then `node:assert` cases.
  - `generate twice is idempotent`: call `generateMomentsForReadyRounds({ force: true })` twice. The second returns `[]`, and `count(*) from collectible_moments` is unchanged.
  - `each generated round has ≤1 mvp and ≤5 top, all series 2`.
  - `catalog cache is invalidated`: prime with `cached(CACHE_KEYS.collectibles, …)`, generate, then assert that `buildCatalogPayload` reloads (export it from `routes/collectibles.ts` if needed) and includes a series-2 id. (Review Focus 1.)
  - `launch gate`: `generateMomentsForReadyRounds({ now: new Date("2026-12-01") })` returns `[]` without `force`.
  - Cleanup at the end: delete the generated `collectible_moments`, `collectibles where series = 2`, and the related `user_collectibles`.
- [ ] **Step 2: Run the check to see it fail.** Run `cd backend && npx -y node@22 node_modules/tsx/dist/cli.mjs src/scripts/check-moments.ts`. Expected: FAIL, missing export from `../services/moments.js`.
- [ ] **Step 3: Implement `services/moments.ts`.**
  - Read lines for a round in one query: `player_game_stats` join `games` and `players`.
  - Write per round in one transaction: a multi-row insert into `collectibles` with `returning id`, then a multi-row insert into `collectible_moments` with `on conflict do nothing`.
  - Field values: `name` = player name, `team_id` = the line's `teamId`, `image_url` = `players.photo_url`, `series` = 2, and tier/`points_cost` from the role.
  - Call `invalidate(CACHE_KEYS.collectibles)` after any round is created.
  - Log failures with `console.error("[moments] …")` and move to the next round.
- [ ] **Step 4: Implement `generate-moments.ts`.**
  - `--dry-run` prints per round: `R{n}  MVP  Name (TEAM vs OPP)  PIR x · PTS y` followed by the 5 tops. It writes nothing and ignores the gate.
  - `--force-before-launch` prints the DB host and refuses unless it contains `ep-sparkling-pond`.
  - Add the package scripts `"moments:generate": "tsx src/scripts/generate-moments.ts"` and `"check:moments": "tsx src/scripts/check-moments.ts"`.
- [ ] **Step 5: Hook into `runHourlyJobs`.** Add `runMomentsGeneration()`, wrapping `generateMomentsForReadyRounds()` with a `.catch` that logs, next to `runGameExtrasSync()`.
- [ ] **Step 6: Run the check and the type-check.**
  - The check command from Step 2. Expected: `ok` for every case.
  - `npx tsc -p tsconfig.json --noEmit`. Expected: exit 0.
  - `npm run moments:generate -- --dry-run` (dev). Expected: a lineup per completed round, 6 lines each.
- [ ] **Step 7: Commit.** `git commit -m "Series 2 moments: generation service, dry-run script, hourly job (gated to 2027-01-01)"`

### Task 4: Series 1 first for guaranteed-new pulls

**Files:**
- Modify: `backend/src/services/packs.ts` (`rollPackForUser`, the forced branch at ~450)
- Modify: `backend/src/services/cards.ts` (`grantGuaranteedNewCollectible`, ~468)
- Modify: `backend/src/scripts/check-moments.ts`

**Interfaces:**
- Consumes: `pickSeriesFirst` (Task 2). `collectibles.series` (Task 1). Generated series-2 cards (Task 3).

- [ ] **Step 1: Add the failing check case** `forced pulls prefer series 1`:
  - Create a dev test user who owns every Series 1 legendary except one. Series 2 legendaries exist from a forced generation.
  - Run `rollPackForUser(user, "wheelLegendary")` 20 times, deleting the granted row between runs.
  - Assert that every pick is the one missing Series 1 legendary.
  - Then give the user that card too, and assert the next forced pick is series 2.
- [ ] **Step 2: Run it to see it fail.** Expected: FAIL, a series-2 legendary was picked.
- [ ] **Step 3: Implement.**
  - In the forced branch, use `rollCard(pickSeriesFirst(missing))`. `missing` rows expose `collectible.series` because the select already uses the whole `collectibles` row.
  - In `grantGuaranteedNewCollectible`, select `series` and pick from `pickSeriesFirst` over missing.
  - Non-forced rolls stay unchanged.
- [ ] **Step 4: Run the check and `tsc`.** Expected: all `ok`; exit 0.
- [ ] **Step 5: Commit.** `git commit -m "Series 2 moments: guaranteed-new pulls fill Series 1 gaps first"`

### Task 5: B2 bonus

**Files:**
- Modify: `backend/src/services/moments.ts`
- Modify: `backend/src/routes/predictions.ts` (summary at ~611–625; the seen endpoint near ~687)
- Modify: `backend/src/routes/packs.ts` (~229, alongside `checkAndGrantRoundRewards`)
- Modify: `backend/src/scripts/check-moments.ts`

**Interfaces:**
- Consumes: `computeTopScorerPlayerIdsForGames(gameIds): Promise<Map<string, string[]>>` (`services/topScorerPoints.ts`). `GREAT_ROUND_THRESHOLD` (`services/cards.ts`).
- Produces:
  - `type MomentBonusReward = { collectibleId: string; round: number; reason: MomentBonusReason; name: string; imageUrl: string | null; teamCode: string }`.
  - `checkAndGrantMomentBonuses(userId: string): Promise<MomentBonusReward[]>`.
  - `markMomentBonusesSeen(userId: string): Promise<void>`.
  - The summary response gains `newMomentBonuses: MomentBonusReward[]`.
  - New route `POST /api/predictions/moment-bonuses/ack` (requireAuth) calls `markMomentBonusesSeen`, modelled on the existing `POST /rare-milestone-rewards/ack`.

- [ ] **Step 1: Add the failing check cases.** Insert the fixture games, stats and picks directly on dev, then clean up.
  - `great_round grants the round MVP once`: 8 correct picks in a round → one bonus. A second call → `[]`.
  - `backed_mvp on a tied top scorer qualifies` (Review Focus 5).
  - `MVP not top scorer → no backed_mvp; great_round still works` (Review Focus 5).
  - `already-owned MVP card → bonus row recorded, no second user_collectibles row, next call []` (Review Focus 4).
  - `both conditions → one bonus, reason backed_mvp`.
  - `deleted user never qualifies`.
- [ ] **Step 2: Run them to see them fail.** Expected: FAIL, `checkAndGrantMomentBonuses` is not exported.
- [ ] **Step 3: Implement `checkAndGrantMomentBonuses`.**
  - One query computes qualifying (round, MVP collectible, reason) for the user across all MVP moments of the current season. Reuse round-rewards' correctness `case`, and use `computeTopScorerPlayerIdsForGames` over the MVP games for the tie-aware top scorer.
  - Then one combined statement: a CTE inserts into `moment_bonuses … on conflict do nothing returning`, then inserts into `user_collectibles` the returned cards the user doesn't own.
  - Return the rows joined to the card and team for display.
  - Implement `markMomentBonusesSeen` like `markRareMilestonesSeen`.
- [ ] **Step 4: Wire the routes.** Add it to the summary's grant list and response, and to the packs route's grant list. Add the `moment-bonuses/ack` route.
- [ ] **Step 5: Run the check and `tsc`.** Expected: all `ok`; exit 0.
- [ ] **Step 6: Commit.** `git commit -m "Series 2 moments: MVP-moment bonus for great rounds and backing the MVP"`

### Task 6: Catalog and leaderboard API

**Files:**
- Modify: `backend/src/routes/collectibles.ts` (`buildCatalogPayload`, ~155)
- Modify: `backend/src/services/albumLeaderboard.ts`
- Modify: `backend/src/scripts/check-moments.ts`

**Interfaces:**
- Produces:
  - Each catalog item gains `series: 1 | 2` and `moment: { round, role, points, pir, rebounds, assists, minutes, gameId, gameDate, opponent: { id, code, name } } | null`.
  - `AlbumLeaderboardEntry` gains `series1Complete: boolean`.
  - `serialNumber`/`serialTotal` stay per tier **within Series 1**. Series 2 cards get `null` (moments are identified by round).

- [ ] **Step 1: Add failing check cases.**
  - `catalog item for a moment has series 2 and moment.round`.
  - `series1Complete true for a user owning all series-1 cards, false with one missing`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - `buildCatalogPayload` gets one `leftJoin` on `collectible_moments`, plus `games` and the opponent team via alias.
  - In `getAlbumLeaderboardEntries`, add `count(distinct uc.collectible_id) filter (where c.series = 1)` and compare it to a series-1 total from `getCollectibleCatalogTotal`'s query. Extend that query to return both totals in one statement.
- [ ] **Step 4: Run the check and `tsc`.** Expected: all `ok`; exit 0.
- [ ] **Step 5: Commit.** `git commit -m "Series 2 moments: catalog fields and Series 1 complete flag"`

### Task 7: Moment card and card preview

**Files:**
- Modify: `frontend/src/app/core/models.ts` (`Collectible` ~717, `AlbumLeaderboardEntry` ~1362, `PredictionSummary` ~653)
- Modify: `frontend/src/app/features/store/collectible-card.ts`
- Modify: `frontend/src/app/features/store/card-preview.ts`
- Modify: `frontend/src/app/core/i18n/album.ts`

**Interfaces:**
- Consumes: the Task 6 API shape and Task 5's `MomentBonusReward`.
- Produces:
  - `CollectibleMoment` interface and `Collectible.series` / `Collectible.moment?`.
  - `AlbumLeaderboardEntry.series1Complete`.
  - `PredictionSummary.newMomentBonuses: MomentBonusReward[]`.
  - On `app-collectible-card`, primitive inputs to preserve its existing OnPush/primitive-input rule: `@Input() momentRound: number | null = null`, `@Input() momentRole: "mvp" | "top" | null = null`, `@Input() momentPoints: number | null = null`, `@Input() momentPir: number | null = null`.

- [ ] **Step 1: Add the models.**
- [ ] **Step 2: Add the moment variant to `collectible-card`** when `momentRound !== null`:
  - a corner badge `i18n.t('album.moment.roundBadge')` + round;
  - a bottom stat strip `{points} PTS · {pir} PIR`;
  - a ribbon `album.moment.mvp` or `album.moment.top`.
  - Same dimensions and tier styling. Display headings use `font-display`.
- [ ] **Step 3: Update `card-preview`.** When the collectible has `moment`, the back shows the opponent, date, and PTS / REB / AST / PIR / MIN instead of season stats.
- [ ] **Step 4: Add i18n keys (EN / EL):**
  - `album.moment.roundBadge`: `R` / `Γ`
  - `album.moment.mvp`: `MVP` / `MVP`
  - `album.moment.top`: `Top performer` / `Κορυφαίος`
  - `album.moment.vs`: `vs` / `vs`
  - `album.moment.backTitle`: `The game` / `Ο αγώνας`
- [ ] **Step 5: Build.** Run the Angular build via Node 22 (Global Constraints). Expected: "Application bundle generation complete", no errors.
- [ ] **Step 6: Commit.** `git commit -m "Series 2 moments: moment card variant and game-line card back"`

### Task 8: Album page Series switch

**Files:**
- Modify: `frontend/src/app/features/album/album.ts`, `album.html`
- Modify: `frontend/src/app/core/i18n/album.ts`

**Interfaces:**
- Consumes: `Collectible.series` and `Collectible.moment` (Task 7), and the moment inputs on `app-collectible-card`.

- [ ] **Step 1: Add series state to `album.ts`.**
  - `readonly series = signal<1 | 2>(1)`.
  - `readonly hasMoments = computed(() => catalog().some(c => c.series === 2))`.
  - `readonly momentRounds = computed(...)`: series-2 cards grouped by `moment.round`, rounds descending, each `{ round, mvp: Collectible | null, tops: Collectible[] }` with tops in catalog order.
  - Series 1 views (team pages, search, tier filter, counters) filter to `series === 1`.
- [ ] **Step 2: Update `album.html`.**
  - A two-button switch above the team strip, shown only when `hasMoments()`, using the same tab classes as the album/leaderboard switch.
  - Moments view: per round, a heading `album.moments.round` + n, the MVP card at `maxWidth` 260, then 5 tops in a responsive grid.
  - Locked cards render through `unlocked=false` with the stat strip still visible.
  - The counter shows `{owned}/{total}` for the current series, with `album.totalLabel` and the overall count below.
- [ ] **Step 3: Add i18n keys (EN / EL):**
  - `album.series.players`: `Players` / `Παίκτες`
  - `album.series.moments`: `Moments` / `Στιγμές`
  - `album.moments.round`: `Round` / `Αγωνιστική`
  - `album.totalLabel`: `Total album` / `Σύνολο άλμπουμ`
- [ ] **Step 4: Build.** Expected: success.
- [ ] **Step 5: Verify on dev data.** With Task 3's forced generation on dev, run local servers (backend `.env` = dev, frontend on 4201). Ask the user for screenshots of Players, Moments, and a moment card preview, at desktop and phone width.
- [ ] **Step 6: Commit.** `git commit -m "Series 2 moments: album Players/Moments switch, moments by round"`

### Task 9: Bonus reveal and Series 1 badge

**Files:**
- Modify: `frontend/src/app/features/predictions/predictions.ts` (~897, next to `shownRareMilestoneRewards`) and `predictions.html`
- Modify: `frontend/src/app/features/leaderboard/leaderboard.ts` / `.html`
- Modify: `frontend/src/app/features/album/album.html` (leaderboard rows)
- Modify: `frontend/src/app/features/leagues/league-detail.html` (album board rows, if present)
- Modify: `frontend/src/app/core/api.service.ts` (`ackMomentBonuses()`)
- Modify: `frontend/src/app/core/i18n/predictions.ts`, `album.ts`

**Interfaces:**
- Consumes: `PredictionSummary.newMomentBonuses` and `AlbumLeaderboardEntry.series1Complete`.

- [ ] **Step 1: Add the bonus reveal.**
  - `shownMomentBonuses` mirrors `shownRareMilestoneRewards`: same merge-by-collectible-id; dismissing calls a new `ApiService.ackMomentBonuses()` → `POST /api/predictions/moment-bonuses/ack`.
  - One bonus renders as a card with its title. More than one renders one summary line plus the cards.
- [ ] **Step 2: Add the badge.**
  - `BoardRow` gains an optional `series1Complete`, set only on the Album tab.
  - A small "✓ S1" chip renders next to the name, with the tooltip `album.series1Badge`. Same on the album and league boards.
- [ ] **Step 3: Add i18n keys (EN / EL), exact copy from the spec:**
  - `predictions.momentBonus.backedMvp`: `You called it: Round {round} MVP` / `Το είχες προβλέψει: MVP Αγωνιστικής {round}`
  - `predictions.momentBonus.greatRound`: `Great round: Round {round} MVP moment` / `Μεγάλη αγωνιστική: η στιγμή του MVP της {round}ης`
  - `predictions.momentBonus.summary`: `You already earned {n} MVP moments` / `Έχεις ήδη κερδίσει {n} στιγμές MVP`
  - `album.series1Badge`: `Series 1 complete` / `Η Σειρά 1 ολοκληρώθηκε`
  - Use whatever interpolation helper the existing dictionaries use for numbers. If there is none, use `.replace('{round}', …)` as other features do.
- [ ] **Step 4: Build.** Expected: success.
- [ ] **Step 5: Verify on dev.** Grant a bonus with Task 5's fixture, load Predictions locally, and ask the user for a screenshot of the reveal and the badge.
- [ ] **Step 6: Commit.** `git commit -m "Series 2 moments: MVP-moment reveal and Series 1 badge"`

### Task 10: Economy re-check and ship (inactive)

**Files:**
- Modify: `backend/src/scripts/season-simulation.ts`
- Modify: `backend/src/services/packs.ts` (the "album completable in a season" comment block at ~43)

- [ ] **Step 1: Update `season-simulation.ts`** to today's rules:
  - catalog 320/320/40/20;
  - wheel `SPIN_ODDS` 0.48/0.28/0.12/0.12 with 2 packs per common or rare spin;
  - 4-slot store packs at 100/250/600;
  - sell-back 30%;
  - Series 2 (backlog of `MOMENTS_PER_ROUND` × completed rounds on day of `MOMENTS_LAUNCH_AT`, then per round);
  - Series 1 first;
  - the bonus at a configurable per-round probability (default 0.25).
- [ ] **Step 2: Run it.** `npm run economy:simulate` (Node 22). Expected: top-collector profiles at about 94–98% at season end with 0% full-album completion, Series 1 completion around late March, casual about 50%. If it deviates by more than 5 points, report to the user before shipping.
- [ ] **Step 3: Rewrite the stale comment in `packs.ts`.** Replace the 438-card numbers with the current catalog and a pointer to the spec.
- [ ] **Step 4: Run the full verification.**
  - `npx tsc -p tsconfig.json --noEmit` (backend).
  - Angular build.
  - `npx tsx --test src/services/momentsLogic.test.ts`.
  - `check:moments` on dev.
  - Expected: all pass.
- [ ] **Step 5: Commit and ship with the `ship` skill.** Deploy to dev, then merge to `main` and deploy to production, both detached. Check once that each deployment logs `listening`. Before launch, the production album must show no Moments tab, because there are no series-2 rows.
- [ ] **Step 6: Note the December follow-ups in `TODO.md`:**
  - mid-December: production dry run reviewed with the user;
  - Jan 1: publish the announcement (EN/EL text in the spec) and check once that cards and bonuses exist.
