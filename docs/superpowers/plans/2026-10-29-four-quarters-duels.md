# Four Quarters Duels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v5 power battle with Four Quarters. It's an async 5-card duel over 4 categories with simultaneous hidden commits, where total score wins. It comes with a monthly Elo ladder and a capped +15 win prize.

**Architecture:**
- A pure rules module (`services/duelEngine.ts`) holds every number and formula, under `node:test`.
- A DB service (`services/duels.ts`) owns the lifecycle in three new tables (`duels`, `duel_moves`, `duel_ratings`). Each commit is one row-locked transaction, and timeouts are applied lazily on read plus an hourly sweep.
- An Express router at `/api/duels` sits on top. Angular adds a lineup builder and a game screen, and the hub gets three tabs. SSE `duel` events drive refreshes, and push notifications drive turns.

**Tech Stack:** Node/Express/TypeScript (ESM, tsx), Drizzle + raw `sql`, PostgreSQL (Supabase prod, Neon dev), Angular 20 standalone + signals, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-29-four-quarters-duels-design.md`. Read it first. Every number below comes from it.

## Global Constraints

- Every UI string goes into `frontend/src/app/core/i18n/duels.ts` with `en` and `el` in the same pass.
- There's no lint and no general test suite. Pure logic is tested with `npx tsx --test <file>` run from `backend/`.
- Schema changes are hand-written SQL applied to **both** Neon dev (`misty-night-49318785`) and Supabase prod. On Supabase, run `revoke all on <table> from anon, authenticated`.
- Any bulk UPDATE on prod: show the SQL and a SELECT of the affected rows, and get explicit user confirmation first.
- Fewer statements, not `Promise.all`: latency comes from round trips.
- Never read a signal inside an `effect()` that writes it. Use `untracked()`.
- Toasts render inside the shared stack in `app.component.html` (`pointer-events-auto mb-3`).
- Buttons use `[appButton]`, forms use Reactive Forms, back links use `navHistory.previousUrl() ?? '/battles'`.
- No browser verification by the agent. Run `npx tsc -p tsconfig.json --noEmit` (backend) and `ng build` (frontend), then ask the user for screenshots.
- Day boundaries and season keys use `Europe/Athens`.
- Constants:
  - `LINEUP_SIZE = 5`
  - `MAX_ACTIVE_DUELS = 5`
  - `DUEL_WIN_PRIZE = 15`
  - `MAX_PAID_WINS_PER_DAY = 5`
  - `QUARTER_MS = 24h`
  - `CHALLENGE_TTL_MS = 72h`
  - `DEADLINE_WARNING_MS = 2h`
  - `START_RATING = 1000`

## Review Focus

1. **Simultaneous final commits.** Both players commit the last open move within milliseconds. The quarter must resolve exactly once, with scores added once. *Pinned in Task 3, step "concurrent commit".*
2. **Commit lands after the deadline.** The lazy timeout fires first and the quarter advances. The client's commit for the old quarter must return 409 `QUARTER_CHANGED`. It must not be silently applied to the next quarter. *Pinned in Task 3 (the commit body carries `quarter`).*
3. **A challenger's card leaves their collection before accept** (traded or sold back). Accept must re-check ownership. If a card is gone, the duel becomes `cancelled` and accept returns 409 `NOT_AVAILABLE`. *Pinned in Task 3.*
4. **Player with no stats or no recent games** (new signing, injured all season). The card plays with zeros, no form badge, and ×1 form, and nothing crashes. *Pinned in Task 1 (`formFor(0, null, 0)`, `quarterScore` of a zero line).*
5. **Hidden information leaks through a side door.** `GET /mine`, `GET /open`, SSE payloads and push text must not reveal the other side's open-quarter slot, later categories, or the challenger's lineup before accept. *Pinned in Task 3's view assertions and Task 4's `/mine` and `/open` check.*

---

### Task 1: Pure rules engine

**Files:**
- Create: `backend/src/services/duelEngine.ts`
- Test: `backend/src/services/duelEngine.test.ts`

**Interfaces:**
- Consumes: `INJURY_MULTIPLIER`, `InjuryStatus` from `services/statDuel.ts`.
- Produces (all exported):
  - `type DuelCategory = "scoring" | "boards" | "playmaking" | "defense" | "efficiency" | "all_around"`
  - `DUEL_CATEGORIES: readonly DuelCategory[]`
  - `CATEGORY_SCALES: Record<DuelCategory, number>`, initially `{scoring: 1.8, boards: 4.5, playmaking: 6.5, defense: 15, efficiency: 1.7, all_around: 1.1}`
  - `type FormBadge = "ice_cold" | "cold" | "steady" | "hot" | "on_fire"`
  - `interface BaseLine { pts: number; reb: number; ast: number; stl: number; blk: number; pir: number }`
  - `interface DuelCard { collectibleId: string; name: string; teamId: string; imageUrl: string | null; tier: string; isMvp: boolean; isFoil: boolean; base: BaseLine; rarityMult: number; formMult: number; formBadge: FormBadge | null; injury: InjuryStatus | null; injuryMult: number }`
  - `type Division = "rookie" | "starter" | "sixth_man" | "all_star" | "mvp"`
  - `rarityMult(tier: string, isMvp: boolean, isFoil: boolean): number`
  - `formFor(seasonPir: number, recentPir: number | null, recentGames: number): { badge: FormBadge | null; mult: number }`
  - `categoryValue(base: BaseLine, cat: DuelCategory): number`
  - `quarterScore(card: DuelCard, cat: DuelCategory): number` (1 decimal)
  - `drawCategories(rng?: () => number): DuelCategory[]` (4 distinct)
  - `weakestRemaining(lineup: DuelCard[], usedSlots: number[], cat: DuelCategory): number` (slot index)
  - `benchSlot(usedSlots: number[]): number`
  - `validateLineup(cards: { playerKey: string; tier: string }[]): "INVALID_LINEUP" | null`
  - `eloDeltas(ra: number, rb: number, resultA: 1 | 0.5 | 0, kA: number, kB: number): { a: number; b: number }` (integers)
  - `kFactor(lifetimeGames: number, pairRecentGames: number): number`
  - `divisionFor(rating: number): Division`
  - `seasonKey(d: Date): string` (Europe/Athens `YYYY-MM`)
  - `softReset(lastRating: number | null): number`
  - `prizeEligible(o: { result: "win" | "draw" | "loss"; paidWinsToday: number; paidVsOpponentToday: number }): boolean`
  - The constants from Global Constraints.

- [ ] **Step 1: Write the failing tests** in `duelEngine.test.ts`, with the header comment `// Run: npx tsx --test src/services/duelEngine.test.ts`.
  - **Rarity:** `rarityMult("common",false,false)===1`; `("rare",false,false)===1.1`; `("legendary",false,false)===1.2`; `("legendary",true,false)===1.3`; `("legendary",false,true)===1.3`; `("legendary",true,true)===1.4`. Compare after `Math.round(x*100)/100`.
  - **Form:** `formFor(12,17,5)` → `{badge:"on_fire",mult:1.15}`; `(12,16.9,5)` → hot 1.08; `(12,14,5)` → hot; `(12,13.9,5)` → steady 1; `(12,10,5)` → cold 0.93; `(12,7.1,5)` → cold; `(12,7,5)` → ice_cold 0.85; `(12,30,2)` → `{badge:null,mult:1}`; `(0,null,0)` → `{badge:null,mult:1}`.
  - **Scoring:** for a card with `base.pts=18, stl=1.2, blk=0.8`, `rarityMult=1, formMult=1.15, injuryMult=1`: `quarterScore(card,"scoring") === Math.round(18*CATEGORY_SCALES.scoring*1.15*10)/10`, and `categoryValue(base,"defense") === 2`. A zero base line scores 0 in every category.
  - **Categories:** `drawCategories(seededRng)` returns 4 distinct members of `DUEL_CATEGORIES`, checked over 200 seeds.
  - **Weakest remaining:** with slots 0 and 2 used, it returns the unused slot with the lowest `quarterScore`, and ties go to the lower slot index. `benchSlot([0,1,2,3])===4`.
  - **Lineup checks:** 5 distinct `playerKey`s → null. 4 cards, a duplicate key, or a `tier:"coach"` card → `"INVALID_LINEUP"`.
  - **Elo:** `eloDeltas(1000,1000,1,32,32)` → `{a:16,b:-16}`; `eloDeltas(1200,1000,1,32,20)` → `{a:8,b:-5}`; `eloDeltas(1000,1000,0.5,32,32)` → `{a:0,b:0}`.
  - **K:** `kFactor(9,0)===32`, `kFactor(10,0)===20`, `kFactor(10,3)===10`, `kFactor(5,3)===16`.
  - **Divisions:** `divisionFor(949)==="rookie"`, `950→"starter"`, `1099→"starter"`, `1100→"sixth_man"`, `1299→"all_star"`, `1300→"mvp"`.
  - **Season:** `seasonKey(new Date("2026-10-31T22:30:00Z"))==="2026-11"`, `seasonKey(new Date("2026-10-31T21:30:00Z"))==="2026-10"`, `softReset(null)===1000`, `softReset(1200)===1100`, `softReset(901)===951`.
  - **Prize:** `prizeEligible({result:"win",paidWinsToday:4,paidVsOpponentToday:0})===true`; `paidWinsToday:5` → false; `paidVsOpponentToday:1` → false; a `"draw"` → false.
- [ ] **Step 2:** From `backend/`, run `npx tsx --test src/services/duelEngine.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `duelEngine.ts`.**
  - **Rarity:** base `{common:1, rare:1.1, legendary:1.2}`, 1.3 when `isMvp`, then +0.1 if foil, rounded to 2 decimals.
  - **Form:** `diff = recentPir − seasonPir`. Apply thresholds only when `recentGames >= 3 && recentPir != null`.
  - **`categoryValue`:**
    - scoring = pts
    - boards = reb
    - playmaking = ast
    - defense = stl + blk
    - efficiency = pir
    - all_around = pts + reb + ast
  - **`seasonKey`:** `Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Athens",year:"numeric",month:"2-digit"})`.
  - **`eloDeltas`:** `Math.round(K * (S − E))` per side with `E = 1/(1+10^((rb−ra)/400))`.
  - **`kFactor`:** `(lifetimeGames < 10 ? 32 : 20)`, halved when `pairRecentGames >= 3`.
- [ ] **Step 4:** Run the test again. Expected: all pass.
- [ ] **Step 5:** `git commit -m "Duels: pure Four Quarters rules engine with checks"`.

### Task 2: Tables and card snapshots

**Files:**
- Modify: `backend/src/db/schema.ts`. Add `duels`, `duelMoves`, `duelRatings` after `battles` (around line 1250), with a comment that points to the spec.
- Create: `backend/src/scripts/sql/2026-10-29-duels.sql`
- Modify: `backend/src/services/statDuel.ts`. Add `season: StatLine` (the unblended season line) to `CardStatLine` and fill it in `getCardStatLines`, where the unblended values are already computed as `base` in `blend`.
- Create: `backend/src/services/duels.ts`. Add `DuelError` and `buildSnapshots` in this task, plus the lifecycle in Task 3.

**Interfaces:**
- Consumes: the Task 1 types and functions, `getCardStatLines`, and `normalizePlayerName` from `services/battles.ts`.
- Produces:
  - Drizzle tables `duels`, `duelMoves`, `duelRatings`, with the columns exactly as spec §3. `duelMoves.quarter` takes 1–5, where 5 is the automatic overtime row.
  - `class DuelError extends Error { constructor(public code: string, public status: number) }`
  - `buildSnapshots(userId: string, collectibleIds: string[]): Promise<DuelCard[]>`. It throws `DuelError("INVALID_LINEUP",400)` on a bad lineup. Cards come back in input order.

- [ ] **Step 1: Write `2026-10-29-duels.sql`.**
  - `create table` for all three tables, with the indexes from spec §3, the uniques `duel_moves (duel_id, quarter, user_id)` and `(duel_id, user_id, slot)`, and `duel_ratings` primary key `(user_id, season)`.
  - A trailing commented-out block: `-- supabase only: revoke all on duels, duel_moves, duel_ratings from anon, authenticated;`
- [ ] **Step 2:** Apply it to **dev only**: `neonctl ... --org-id org-dark-hat-10818944`, or `psql` with the dev connection string. Check that `select count(*) from duels` returns 0. Prod is applied in Task 9.
- [ ] **Step 3: Mirror the tables in `schema.ts`.** The jsonb types: `categories` is `DuelCategory[]`; `challengerLineup` is `string[] | DuelCard[]`; `opponentLineup` is `DuelCard[]`.
- [ ] **Step 4: Implement `buildSnapshots` in one query plus one `getCardStatLines` call.**
  - The query joins `user_collectibles` → `collectibles`, left-joins `collectible_moments` for `role = 'mvp'`, and filters `user_id = userId and collectible_id = any(ids)`.
  - Throw if the row count is not 5, or if `validateLineup` fails with `playerKey = normalizePlayerName(name)`.
  - Map each card:
    - `base` from `line.season`: `pts=points`, `reb=rebounds`, `ast=assists`, `stl=steals`, `blk=blocks`, `pir=pir`
    - `rarityMult` from Task 1
    - `formFor(line.seasonPir, line.recentPir, line.recentGames)`
    - `injuryMult = injury ? INJURY_MULTIPLIER[injury] : 1`
- [ ] **Step 5:** Run `npx tsc -p tsconfig.json --noEmit`. Expected: no errors.
- [ ] **Step 6:** `git commit -m "Duels: tables and frozen card snapshots"`.

### Task 3: Duel lifecycle service

**Files:**
- Modify: `backend/src/services/duels.ts`
- Create: `backend/src/scripts/check-duels.ts`, and add `"check:duels": "tsx src/scripts/check-duels.ts"` to `backend/package.json`.

**Interfaces:**
- Consumes: Tasks 1–2, `sendToUser` from `realtime/hub.ts`, `sendPushInBackground` from `services/push.ts`, and `pointAdjustments`.
- Produces:
  - `createDuel(userId: string, o: { lineup: string[]; opponentUserId?: string; leagueId?: string }): Promise<{ id: string }>`. Without an opponent it's `status = 'open'`; otherwise it's `'pending'` and requires both users to be league members.
  - `acceptDuel(userId: string, duelId: string, lineup: string[]): Promise<DuelView>`
  - `declineDuel(userId, duelId)`, `cancelDuel(userId, duelId)` → `Promise<void>`
  - `commitMove(userId: string, duelId: string, quarter: number, slot: number): Promise<DuelView>`
  - `applyTimeouts(duelId?: string): Promise<number>`, the number of duels changed
  - `getDuelView(duelId: string, viewerId: string): Promise<DuelView>`
  - `listMyDuels(userId): Promise<DuelSummary[]>`, `listOpenDuels(userId): Promise<OpenDuel[]>`
  - `getLadder(leagueId: string | null): Promise<LadderRow[]>`, cached 60s per key
  - `getMyRating(userId): Promise<MyRating>`
  - Exported types:
    - `DuelView`: `{ id; status; finishReason; leagueId; side: "challenger"|"opponent"; opponent: {id;username}|null; quarter; quarterDeadline; expiresAt; categories: (DuelCategory|null)[]; myLineup: DuelCard[]; theirLineup: DuelCard[]|null; quarters: {quarter; mySlot|null; theirSlot|null; myScore|null; theirScore|null; myAuto; theirAuto}[]; iCommitted: boolean; theyCommitted: boolean; score: {me;them}; overtime: {mySlot;theirSlot;myScore;theirScore}|null; result: "win"|"loss"|"draw"|null; ratingDelta: number|null; prizePaid: boolean }`
    - `DuelSummary`: `{ id; status; opponent; score; quarter; myMove: boolean; deadline; result }`
    - `OpenDuel`: `{ id; challenger: {id; username; rating; division}; expiresAt }`
    - `LadderRow`: `{ userId; username; rating; division; wins; losses; draws }`
    - `MyRating`: `{ rating; division; season; wins; losses; draws; paidWinsLeftToday; seasonBadges: {season; kind:"top3"|"all_star"}[] }`
  - All errors are `DuelError`. Codes: `INVALID_LINEUP` 400, `NOT_A_MEMBER` 400, `TOO_MANY_DUELS` 409, `NOT_AVAILABLE` 409, `QUARTER_CHANGED` 409, `SLOT_USED` 409, `NOT_PARTICIPANT` 403.

- [ ] **Step 1: Write `check-duels.ts` against dev.** Guard it: abort unless `DATABASE_URL` contains `misty-night`. It uses two existing dev users who each own 5 or more playable cards. They're found by query; if none exist, the script grants dev-only `user_collectibles` rows for 2 fresh `check-duels-*` users. The script asserts:
  - **Open challenge hiding:** create an open challenge. A third-party `getDuelView` throws 403, and `listOpenDuels` exposes no card ids.
  - **Rejections:** `createDuel` with 4 cards, or with a coach, throws `INVALID_LINEUP`.
  - **After accept:** `quarter===1`, 4 distinct categories, and both lineups show for both sides. `categories[2]` and `categories[3]` are null in the view, and `[0]`/`[1]` are set.
  - **Hidden commit:** after A commits Q1, B's view has `theyCommitted===true` and `quarters[0].theirSlot===null`, and `listMyDuels(B)` shows no slot.
  - **Concurrent commit:** `Promise.all([commitMove(A,…,2,s), commitMove(B,…,2,s)])` advances to quarter 3 exactly once, and the totals equal the sum of the two move scores.
  - **Double commit:** committing the same quarter twice throws `QUARTER_CHANGED` or `SLOT_USED`, and the moves count doesn't change.
  - **Stale quarter:** set `quarter_deadline = now() - 1s` and call `applyTimeouts(id)`. The missing side gets an `auto` move with `slot === weakestRemaining(...)` and `miss_streak = 1`. A commit that names the old quarter throws `QUARTER_CHANGED`.
  - **Forfeit:** two auto misses in a row by A gives `status = 'finished'`, `finish_reason = 'forfeit'`, and B as winner.
  - **Ratings:** after a normal finish, both `duel_ratings` rows exist for `seasonKey(now)`, the deltas match `eloDeltas`, and one `point_adjustments` row with `reason = 'Duel win'` and 15 points exists for the winner. A second `finishDuel` path pays nothing more.
  - **Prize cap:** a 2nd win by the same winner vs the same opponent today has `prize_paid = false`.
  - **Overtime:** force tied totals by updating scores before Q4 resolves. A quarter-5 row exists, and the winner is decided by the bench cards' efficiency scores.
  - **Card gone before accept:** create a challenge, delete one of the challenger's `user_collectibles` rows, then `acceptDuel` throws `NOT_AVAILABLE` and the duel is `cancelled`.
  - **Active cap:** a 6th open/pending/active duel throws `TOO_MANY_DUELS`.
  - **Cleanup:** the script deletes everything it created at the end.
- [ ] **Step 2:** Run `npm run check:duels`. Expected: FAIL (functions not exported).
- [ ] **Step 3: Implement the lifecycle.** The rules that the tests and signatures leave open:
  - **Create:**
    - validate with `buildSnapshots`, but store only the id array
    - `expires_at = now() + CHALLENGE_TTL_MS`
    - count the creator's open/pending/active duels in the same statement as the insert (an `insert … select … where (select count(*) …) < 5`)
  - **Accept:**
    - inside a transaction, lock with `select … for update`
    - `status` must be `open` (any non-challenger may take it) or `pending` (only `opponent_user_id`)
    - rebuild both snapshots; if the challenger's fails, set `cancelled` and throw `NOT_AVAILABLE`
    - apply the same `MAX_ACTIVE_DUELS` check to the accepter, giving `TOO_MANY_DUELS`
    - set `categories = drawCategories()`, `quarter = 1`, `quarter_deadline = now() + QUARTER_MS`, `accepted_at`
  - **`listOpenDuels`:** excludes the viewer's own posts and orders by `abs(posterRating − viewerRating)`, where a missing current-month row counts as `softReset` of the latest one.
  - **Commit and timeout:** both go through one internal `withLockedDuel(duelId, fn)` path.
    - Insert the move with `score = quarterScore(card, categories[q-1])`.
    - When both moves exist: add both scores to the totals.
      - If `q < 4`: `quarter = q + 1` and a fresh deadline.
      - Otherwise: if tied, insert the two quarter-5 bench rows using `efficiency`, then call the internal `finishDuel(tx, row)`.
  - **Miss streaks:** an auto move increments that side's streak and a manual move resets it to 0. A streak of 2 leads to a forfeit finish.
  - **Lazy timeouts:** `applyTimeouts` also expires `open`/`pending` rows past `expires_at`. `getDuelView` and `commitMove` call `applyTimeouts(duelId)` first.
  - **`finishDuel`:**
    - create or fetch both `duel_ratings` rows for `seasonKey(now)`, using `softReset` of the user's latest earlier row
    - `lifetimeGames` = sum of the user's `games`; `pairRecentGames` = finished duels between the pair with `finished_at > now() - 7 days`
    - apply `eloDeltas`
    - work out prize eligibility from today's `duels` rows (Athens date of `finished_at`, `winner_user_id = me and prize_paid`)
    - claim the prize with `update duels set prize_paid = true where id = $1 and prize_paid = false returning id` before inserting the `point_adjustments` row (`createdByUserId` = the winner)
  - **Notify on each state change:**
    - SSE: `sendToUser(otherUserId, "duel", { id, status, quarter })`. Send this to both sides on finish.
    - Push via `sendPushInBackground`: new direct challenge, accepted, opponent committed (only to the side that hasn't), quarter revealed, finish.
    - Push text is i18n'd by `lang`, following `services/pushJobs.ts`, and never names the card played.
  - **`getMyRating.seasonBadges`:** from earlier months' rows. "top3" = rank ≤ 3 in that month; "all_star" = rating ≥ 1200 at month end.
- [ ] **Step 4:** Run `npm run check:duels`. Expected: every assertion passes and ends with `OK`.
- [ ] **Step 5:** Run `npx tsc -p tsconfig.json --noEmit`, then `git commit -m "Duels: lifecycle service with locked commits, timeouts, Elo and prize"`.

### Task 4: Routes, jobs, retiring v5, account lifecycle

**Files:**
- Create: `backend/src/routes/duels.ts`
- Modify:
  - `backend/src/index.ts`: mount at `/api/duels` near line 169, and add `runDuelJobs` to `runHourlyJobs`.
  - `backend/src/routes/battles.ts`: remove the create and accept POST routes, keep the GET routes.
  - `backend/src/services/pushJobs.ts`: add `runDuelDeadlineWarnings`.
  - `backend/src/services/accountDeletion.ts`, `backend/src/services/accountExport.ts`

**Interfaces:**
- Consumes: Task 3's service functions.
- Produces these HTTP routes, all under `requireAuth`, mapping `DuelError` to `res.status(e.status).json({ error, code })`:

| Method and path | Body or query |
|---|---|
| `POST /api/duels` | `{ lineup: string[]; opponentUserId?; leagueId? }` |
| `GET /api/duels/open` | |
| `GET /api/duels/mine` | |
| `GET /api/duels/ladder` | `?leagueId=` |
| `GET /api/duels/me/rating` | |
| `GET /api/duels/:id` | |
| `POST /api/duels/:id/accept` | `{ lineup }` |
| `POST /api/duels/:id/decline` | |
| `POST /api/duels/:id/cancel` | |
| `POST /api/duels/:id/commit` | `{ quarter: number; slot: number }` |

  Register `/open`, `/mine`, `/ladder` and `/me/rating` before `/:id`.
- `runDuelDeadlineWarnings(): Promise<number>`

- [ ] **Step 1: Write the routes.** Validate bodies the way `routes/battles.ts` does (typeof checks, 400 on a bad shape).
- [ ] **Step 2: Hourly job.** `runDuelJobs` calls `applyTimeouts()` and then `runDuelDeadlineWarnings()`. The warnings use `sendPushOnce` keyed `duel:${id}:q${quarter}:${userId}` for players who haven't committed and whose deadline is under `DEADLINE_WARNING_MS` away.
- [ ] **Step 3: Account lifecycle.**
  - **Deletion:** cancel the user's `open` and `pending` duels. Forfeit their `active` duels so the opponent wins, with no rating change for the deleted side (set the delta to null), then send the SSE event to the opponent. Delete their `duel_ratings` rows.
  - **Export:** add `duels` and `duelRatings` arrays alongside `battles`.
- [ ] **Step 4:** Run `npx tsc -p tsconfig.json --noEmit`. Start `npm run dev` with `DATABASE_URL` pointed at dev (**check it's dev first**, see CLAUDE.md, and kill stale processes on :4000). Then `curl` `GET /api/duels/mine` and `GET /api/duels/open` with a dev token. Expected: 200 with JSON arrays, and no `slot` or lineup fields on other people's entries.
- [ ] **Step 5:** `git commit -m "Duels: API, hourly timeouts and warnings, retire v5 create/accept"`.

### Task 5: Calibrate category scales and the economy check

**Files:**
- Create: `backend/src/scripts/calibrate-duel-scales.ts`, and add `"duels:calibrate"` to `package.json`.
- Modify: `backend/src/services/duelEngine.ts` (`CATEGORY_SCALES`), `backend/src/scripts/season-simulation.ts`

**Interfaces:**
- Consumes: `categoryValue` and `DUEL_CATEGORIES`.
- Produces: final `CATEGORY_SCALES` values.

- [ ] **Step 1: Write the calibration script.** It's read-only and may run against prod (reads only). It loads every current-season `player_season_stats` row with `games_played >= 5`, maps each to a `BaseLine`, and prints `scale = round(20 / median(categoryValue), 2)` per category.
- [ ] **Step 2:** Run it, paste the six values into `CATEGORY_SCALES`, and re-run `npx tsx --test src/services/duelEngine.test.ts`. Expected: pass (the tests reference the constant).
- [ ] **Step 3: Add the duel income stream to `season-simulation.ts`**, next to the daily question stream around line 641.
  - Wins per day come from the env var `SIM_DUEL_WINS_PER_DAY`, default 1, capped at 5. Each pays `DUEL_WIN_PRIZE`.
  - Report `avgDuelPoints` beside `avgDailyQuestionPoints`.
- [ ] **Step 4:** Run `npm run economy:simulate`, then again with `SIM_DUEL_WINS_PER_DAY=5`. Record the album-completion figures from both runs in the commit message. If perfect-grinder completion goes above 20% (the accepted level is 14–17%), stop and report to the user before going further.
- [ ] **Step 5:** `git commit -m "Duels: calibrated category scales; duel prize in economy simulation"`.

### Task 6: Frontend data layer, i18n, hub

**Files:**
- Modify:
  - `frontend/src/app/core/models.ts`: mirror `DuelView`, `DuelSummary`, `OpenDuel`, `LadderRow`, `MyRating`, `DuelCard`, `DuelCategory`, `FormBadge`, `Division`.
  - `frontend/src/app/core/api.service.ts`: one method per Task 4 route.
  - `frontend/src/app/core/events.service.ts`: `lastDuelUpdate = signal<{ id: string; status: string; quarter: number } | null>(null)` for the `"duel"` SSE event.
  - `frontend/src/app/core/battles-notification.service.ts`
  - `frontend/src/app/features/battles/battles-hub.ts` and `.html`
  - `frontend/src/app/core/i18n/translations.ts`
  - `frontend/src/app/features/battles/battles-info.ts`
- Create: `frontend/src/app/core/i18n/duels.ts`

**Interfaces:**
- Produces:
  - `ApiService`: `createDuel`, `getOpenDuels`, `getMyDuels`, `getDuelLadder(leagueId?)`, `getMyDuelRating`, `getDuel(id)`, `acceptDuel(id, lineup)`, `declineDuel`, `cancelDuel`, `commitDuelMove(id, quarter, slot)`, each returning `Observable<…>` of the Task 3 types.
  - `BattlesNotificationService.actionCount: Signal<number>`: duels where `myMove` is true, plus incoming `pending` challenges.
  - i18n keys `duels.*`. Categories: `duels.cat.<key>`. Divisions: `duels.div.<key>`. Form badges: `duels.form.<badge>`. Also `duels.tab.games|open|ladder`, `duels.yourMove`, `duels.waitingFor`, `duels.paidWinsLeft`, `duels.error.<CODE>`, and the four `battles.howItWorksStep1..4` texts rewritten.
  - The labels come from the spec's category table, for example `Scoring / Σκοράρισμα`.

- [ ] **Step 1:** Add the models, API methods, SSE signal and `duels.ts` dictionary (EN and EL), and merge it in `translations.ts`.
- [ ] **Step 2: Rewrite the hub.**
  - A header strip from `getMyDuelRating`.
  - Tabs: Games ("Your move", then "Waiting", then "Finished", with v3–v5 battles from the existing `getBattles` appended to Finished as read-only links to `battles/:id`), Open (with a "Post open challenge" button to `battles/duel/new`), and Ladder (a Global/league switch, with my row pinned).
  - Refetch on `lastDuelUpdate`, reading it inside the effect and wrapping the fetch call in `untracked()`.
- [ ] **Step 3: Notification service.** Point `BattlesNotificationService` at `getMyDuels` and keep its public names so `battle-challenge-toast` and the badge keep working. The toast text switches to the `duels.yourMove` / new-challenge strings.
- [ ] **Step 4:** Run `ng build`. Expected: success.
- [ ] **Step 5:** `git commit -m "Duels: frontend data layer, i18n, hub tabs"`.

### Task 7: Lineup builder

**Files:**
- Create: `frontend/src/app/features/battles/duel-lineup-builder.ts`, `.html`
- Modify: `frontend/src/app/app.routes.ts`. Add `battles/duel/new` and `battles/duel/:id/accept`, both loading this component, **before** `battles/:id`.

**Interfaces:**
- Consumes: the user's cards from the existing inventory endpoint the old `battle-detail.ts` picker uses. Its card-power data is not used. The per-category scores come from a new `GET /api/duels/preview?ids=…`, which returns `DuelCard[]` via `buildSnapshots` and is added to `routes/duels.ts` in this task.
- Query params: `opponent`, `league`, `rematch` (a duel id whose lineup is preselected).

- [ ] **Step 1: Add `GET /api/duels/preview`.** Read the `ids` query param as a comma-separated list of up to 60. This path checks ownership but not lineup validity, so call an internal `buildSnapshots` variant with `{ validate: false }`.
- [ ] **Step 2: Build the component.**
  - A grid of playable cards (coaches filtered out). Each shows a rarity chip `×1.20`, a form badge, an injury tag, and the 6 category scores computed client-side with the same formula, using `CATEGORY_SCALES` returned in the preview response (`{ scales, cards }`).
  - Sort by category.
  - 5 slots, with the same-player rule enforced on a normalized name.
  - "Auto-fill best 5" takes the highest sum of the 6 scores across distinct players.
  - "Lock lineup" calls `createDuel` or `acceptDuel`, then navigates to `battles/duel/:id`.
  - Errors show `duels.error.<code>`.
  - It's a Reactive Form with a `FormArray` of 5 ids, and the buttons use `[appButton]`.
- [ ] **Step 3:** Run `ng build`. Expected: success.
- [ ] **Step 4:** `git commit -m "Duels: lineup builder with form, rarity and category scores"`.

### Task 8: Game screen

**Files:**
- Create: `frontend/src/app/features/battles/duel-game.ts`, `.html`, `.css`
- Modify: `frontend/src/app/app.routes.ts` (`battles/duel/:id`, before `battles/:id`), `frontend/src/app/features/leagues/league-detail.ts` and `.html`

**Interfaces:**
- Consumes: `getDuel`, `commitDuelMove`, `lastDuelUpdate`, `getDuelLadder(leagueId)`.

- [ ] **Step 1: Game screen.**
  - Scoreboard: team colors from `ThemeService`, a Q1–Q4 line with an OT column when `overtime` is set, current and next category banners, and a deadline countdown.
  - My 5 cards: used ones faded, each showing its `quarterScore` for the current category. The opponent's remaining cards are face up.
  - Selecting a card, then Commit, sends `{ quarter: view.quarter, slot }`. A 409 `QUARTER_CHANGED` refetches and shows a toast-free inline note.
- [ ] **Step 2: Reveal.** When a refetch shows a quarter newly resolved, play a flip and count-up, reusing the keyframes from `battle-detail.css` (copied into `duel-game.css`).
  - **Full time:** the result, the rating delta, the prize or `duels.prizeLimit`, and Rematch, which goes to `battles/duel/new?opponent=…&league=…&rematch=<id>`.
  - **Pending, before accept:** the opponent sees Accept (to the builder) and Decline, and the challenger sees Cancel.
- [ ] **Step 3: League Battles tab.** Replace its body with `getDuelLadder(league.id)` rows (rating, division, W–L–D). Keep the lazy first-switch load.
- [ ] **Step 4:** Run `ng build`. Expected: success. Then ask the user for screenshots of the hub, builder and a game in progress on dev.
- [ ] **Step 5:** `git commit -m "Duels: game screen with reveals; league tab shows the duel ladder"`.

### Task 9: Rollout

**Files:** none new.

- [ ] **Step 1:** Deploy to Railway dev (`railway up --service euroleague-app --environment dev`, started detached). Play one full duel between two dev accounts by hand, or have the user do it.
- [ ] **Step 2: Prod schema.**
  - Show the user `2026-10-29-duels.sql` plus the Supabase revoke lines.
  - Run `scripts/backup-db.ts`.
  - On confirmation, apply it to Supabase prod.
- [ ] **Step 3: Cancel pending v5 battles.**
  - Show `select id, challenger_user_id, opponent_user_id, created_at from battles where status = 'pending'` from prod.
  - On explicit confirmation, run `update battles set status = 'cancelled', responded_at = now() where status = 'pending'`.
- [ ] **Step 4:** Merge `dev` → `main` and deploy production. Check the served bundle contains `duel-game` once, without polling.
- [ ] **Step 5:** Propose the EN and EL "What's new" text for the admin to post on `/admin/tools`.
