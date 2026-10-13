# Daily Question Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A once-a-day, 10-second "who had more?" question that pays pack points, weighted toward a daily attendance streak.

**Architecture:**
- **Pure logic** (Athens day, streak, points, pair picking) lives in one module with an assert-based check script, because the repo has no test suite.
- **A DB layer** generates per-user questions from `player_game_stats` and stores one `daily_questions` row per user per day.
- **Payout:** resolving a row is claim-first, then it inserts one `point_adjustments` row with `counts_toward_ranking = false`.
- **Frontend:** a dashboard card opens a play overlay. The server's clock is authoritative.

**Tech Stack:** Express + Drizzle on Neon Postgres (backend, ESM via `tsx`); Angular 20 standalone components with signals and Tailwind (frontend).

**Spec:** `docs/superpowers/specs/2026-10-13-daily-question-design.md`

## Global Constraints

- **No test suite:** "tests" are `tsx` check scripts using `node:assert/strict`. Verification is `npx tsc -p tsconfig.json --noEmit` (backend) and `npx ng build` (frontend).
- **Day:** Europe/Athens calendar day.
- **Timer:** 10 s shown, server accepts answers up to `12_000` ms after `served_at`.
- **Points:**
  - streak bonus `min(3 × streak, 30)`
  - correct +30
  - streak 7 → +75
  - streak 30, 60, 90, … → +300
- **Payout row:** `point_adjustments.reason = 'daily_question'`, `counts_toward_ranking = false`.
- **Spendable lock:** `daily_question` adjustments are excluded from `getUserPoints()` while `users.created_at > now() − interval '7 days'`.
- **Question content:**
  - Stats: `points`, `rebounds`, `assists`, `pir` (`valuation`), `threes` (`field_goals_made_3`).
  - Templates: `last_night`, `last_game`, `last_3`.
  - Eligibility: ≥ 15 minutes in every counted game.
  - Floors per game (×3 for `last_3`): points 6, rebounds 3, assists 2, pir 5, threes 1.
  - Ratio `larger/smaller` in [1.15, 1.25], widened to [1.10, 1.40]; values never equal.
- **Never send values early:** `value_a`/`value_b` are never sent to the client before a row is resolved.
- **Schema changes:** hand-written SQL, applied to **both** production (`EuroleagueProd` / `shy-frost-51618412`) and dev (`EuroleagueDev` / `misty-night-49318785`).
- **Strings:** every UI string in EN and EL in the same edit, in a new `core/i18n/daily-question.ts` dictionary merged in `translations.ts`.
- **Few DB round trips:** latency comes from round trips, so combine statements where practical.
- **Commit trailer:** every commit ends with the repo's usual `Co-Authored-By` / `Claude-Session` trailer.

## Review Focus

1. **Double tap or two devices on Play.** Exactly one row and the same question. The second `/start` returns the existing question and its remaining time (Task 4 check).
2. **Answer arriving after 12 s, or never.** It resolves as a timeout: streak bonus paid, no +30, `correct = false`. A later `/answer` gets the timeout result, not a second payout (Task 4 check).
3. **Question served at 23:59:55 Athens and answered at 00:00:03.** Accepted for the served day, and tomorrow's question is still available (Task 2 check of `athensDay` plus Task 4's use of the row's `day`).
4. **No eligible pair for any template** (pre-season, or before any final game). `/start` returns `status: "unavailable"` and creates no row. The streak isn't charged, because `streakFor` only looks at yesterday's row (Tasks 3 and 4).
5. **Account younger than 7 days.** Points show as earned in the result, are missing from the spendable balance, and appear on day 7 with no write (Task 5 check).

---

### Task 1: `daily_questions` table

**Files:**
- Modify: `backend/src/db/schema.ts` (add the table after `pointAdjustments`)
- Create: `backend/sql/2026-10-13-daily-questions.sql`

**Interfaces:**
- Produces: Drizzle table `dailyQuestions` with the spec's columns.
  - camelCase fields: `userId`, `day` (date as string), `template`, `stat`, `playerAId`, `playerBId`, `valueA`, `valueB`, `servedAt`, `answeredAt`, `choice`, `correct`, `responseMs`, `streak`, `pointsAwarded`, `resolvedAt`.
  - Unique index `daily_questions_user_day_unique` on `(user_id, day)`.

- [ ] **Step 1:** Add `dailyQuestions` to `schema.ts`. Include a doc comment naming the spec, and note that `value_a`/`value_b` are server-only until resolved.
- [ ] **Step 2:** Write the equivalent `CREATE TABLE IF NOT EXISTS` plus the unique index in `backend/sql/2026-10-13-daily-questions.sql`.
- [ ] **Step 3:** Apply it to dev, then production. Get each connection string with `neonctl connection-string --project-id <id> --org-id org-dark-hat-10818944` and run the file with `psql -f`. If `psql` isn't installed, use a one-off `tsx` script that runs the file through the backend's `db` client with `DATABASE_URL` overridden.
  - Run: `psql "<url>" -c "\d daily_questions"` on both.
  - Expected: all 17 columns and the unique index on both.
- [ ] **Step 4:** Run `cd backend && npx tsc -p tsconfig.json --noEmit`. Expected: no errors.
- [ ] **Step 5:** Commit `schema.ts` and the SQL file: "Daily question: table".

### Task 2: Pure logic + check script

**Files:**
- Create: `backend/src/services/dailyQuestion/logic.ts`
- Create: `backend/src/scripts/daily-question-check.ts`

**Interfaces (Produces, all pure, exported from `logic.ts`):**
- `type DqStat = "points" | "rebounds" | "assists" | "pir" | "threes"`
- `type DqTemplate = "last_night" | "last_game" | "last_3"`
- `DQ_STATS: DqStat[]`, `DQ_ANSWER_WINDOW_MS = 12_000`, `DQ_SHOWN_SECONDS = 10`
- `STAT_FLOOR: Record<DqStat, number>`, with the values from Global Constraints
- `athensDay(at: Date): string` returns `YYYY-MM-DD` in Europe/Athens. Use `Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens" })`.
- `nextStreak(yesterdayStreak: number | null): number` returns `(yesterdayStreak ?? 0) + 1`
- `pointsFor(streak: number, correct: boolean): { streakBonus: number; correctBonus: number; milestone: number; total: number }`
- `pickPair<T extends { value: number }>(candidates: T[], rand: () => number): [T, T] | null`
  - Tries ratio [1.15, 1.25] first, then [1.10, 1.40].
  - Never returns equal values.
  - Picks uniformly among qualifying pairs using `rand`, then randomises the order.

- [ ] **Step 1: Write the check script** with `node:assert/strict`. Run it through `tsx` and print `OK` at the end.
  ```ts
  assert.equal(athensDay(new Date("2026-10-13T20:59:59Z")), "2026-10-13"); // 23:59:59 Athens (UTC+3)
  assert.equal(athensDay(new Date("2026-10-13T21:00:01Z")), "2026-10-14");
  assert.equal(athensDay(new Date("2026-12-01T22:30:00Z")), "2026-12-02"); // winter UTC+2
  assert.equal(nextStreak(null), 1);
  assert.equal(nextStreak(6), 7);
  assert.deepEqual(pointsFor(1, false), { streakBonus: 3, correctBonus: 0, milestone: 0, total: 3 });
  assert.deepEqual(pointsFor(7, true), { streakBonus: 21, correctBonus: 30, milestone: 75, total: 126 });
  assert.equal(pointsFor(12, true).total, 60);
  assert.equal(pointsFor(30, false).total, 330);
  assert.equal(pointsFor(60, true).milestone, 300);
  assert.equal(pointsFor(31, true).milestone, 0);
  const seq = (xs: number[]) => xs.map((value, i) => ({ id: i, value }));
  const p = pickPair(seq([10, 12, 30]), () => 0)!;
  assert.deepEqual(p.map((x) => x.value).sort((a, b) => a - b), [10, 12]); // 1.2 fits the tight band
  assert.equal(pickPair(seq([10, 10]), Math.random), null);
  assert.deepEqual(pickPair(seq([10, 13.5]), () => 0)!.map((x) => x.value).sort((a, b) => a - b), [10, 13.5]); // 1.35, widened band only
  assert.equal(pickPair(seq([10, 20]), Math.random), null); // 2.0, outside both bands
  ```
- [ ] **Step 2:** Run `cd backend && npx tsx src/scripts/daily-question-check.ts`. Expected: FAIL, because the module isn't found yet.
- [ ] **Step 3:** Implement `logic.ts` to the interfaces above.
- [ ] **Step 4:** Run the same command again. Expected: `OK`.
- [ ] **Step 5:** Commit: "Daily question: pure logic + check script".

### Task 3: Question generation from box scores

**Files:**
- Create: `backend/src/services/dailyQuestion/generate.ts`
- Modify: `backend/src/scripts/daily-question-check.ts` (add a DB section behind `--db`)

**Interfaces:**
- Consumes: Task 2's types, `STAT_FLOOR` and `pickPair`; `getCurrentSeason()`; `db`.
- Produces:
  ```ts
  interface GeneratedQuestion { template: DqTemplate; stat: DqStat; playerAId: string; playerBId: string; valueA: number; valueB: number }
  generateQuestion(day: string, rand?: () => number): Promise<GeneratedQuestion | null>
  ```

Approach:
- **Candidates:** one SQL statement per template returns `(player_id, stat values…)` for active players.
  - `last_night` uses final games whose `tipoff_at` falls on `day − 1` in Athens time: `(tipoff_at at time zone 'Europe/Athens')::date = $day::date - 1`.
  - `last_game` uses each player's most recent final game this season, picked with `row_number() over (partition by player order by tipoff_at desc)`.
  - `last_3` uses each player's 3 most recent final games this season, summed. It requires exactly 3 games, each with ≥ 15 minutes.
- **Template order:** use `last_night` if it has any rows. Otherwise pick `last_game` or `last_3` 50/50 with `rand`, then fall back to the other.
- **Choosing the stat:** shuffle `DQ_STATS` with `rand`. For each stat, filter out candidates below the floor and try `pickPair`. Return the first hit. Return `null` if nothing qualifies.
- **Single query:** fetch all five stat columns in one query per template, so trying different stats doesn't add round trips.

- [ ] **Step 1:** Add a `--db` section to the check script. It calls `generateQuestion(athensDay(new Date()))` 20 times and asserts:
  - each result is non-null
  - `valueA !== valueB`
  - `max/min` is in [1.10, 1.40]
  - `playerAId !== playerBId`

  It also prints each result with player names, looked up in one query.
- [ ] **Step 2:** Run `npx tsx --env-file=.env src/scripts/daily-question-check.ts --db` against dev. Expected: FAIL, because `generate.ts` doesn't exist yet.
- [ ] **Step 3:** Implement `generate.ts`.
- [ ] **Step 4:** Run the same command again. Expected: `OK`, and 20 printed questions that read sensibly. Eyeball the stat and value pairs.
- [ ] **Step 5:** Commit: "Daily question: generation".

### Task 4: Service + routes (serve, answer, lazy timeout, payout)

**Files:**
- Create: `backend/src/services/dailyQuestion/service.ts`
- Create: `backend/src/routes/dailyQuestion.ts`
- Modify: `backend/src/index.ts`, to add `app.use("/api/daily-question", dailyQuestionRouter)` next to the other routers
- Modify: `backend/src/scripts/daily-question-check.ts` (add a `--flow` section)

**Interfaces:**
- Consumes: Task 1's `dailyQuestions`; Task 2's `athensDay`, `nextStreak`, `pointsFor`, `DQ_ANSWER_WINDOW_MS`; Task 3's `generateQuestion`; `pointAdjustments`.
- Produces (the service's exports and the JSON the routes return):
  ```ts
  type DqPlayer = { id: string; name: string; photoUrl: string | null; teamCode: string }
  type DqResult = { choice: "a" | "b" | null; correct: boolean; valueA: number; valueB: number;
                    points: { streakBonus: number; correctBonus: number; milestone: number; total: number } }
  type DqToday = { day: string; template: DqTemplate; stat: DqStat; playerA: DqPlayer; playerB: DqPlayer;
                   remainingMs: number | null; result: DqResult | null }
  type DqState = { status: "ready" | "in_progress" | "done" | "unavailable"; streak: number;
                   nextBonus: number; lockedUntil: string | null; today: DqToday | null }
  getDailyQuestionState(userId: string, now?: Date): Promise<DqState>
  startDailyQuestion(userId: string, now?: Date): Promise<DqState>
  answerDailyQuestion(userId: string, choice: "a" | "b", now?: Date): Promise<DqState | { error: "not_started" }>
  ```

Field rules:
- **`streak`:** today's row streak if a row exists. Otherwise yesterday's streak (0 if none).
- **`nextBonus`:** `pointsFor(nextStreak(...), false).total` for a `ready` user.
- **`lockedUntil`:** `users.created_at + 7 days` as an ISO string while that's in the future, otherwise `null`.
- **`today`:** `null` for `ready`/`unavailable`. Values appear only inside `result`.
- **`unavailable`:** only when `/start` (or `GET` before the first start) finds `generateQuestion` returned `null`. No row is written.

Behaviour:
- **Lazy timeout:** every entry point first runs one statement that resolves this user's expired rows (`answered_at is null and served_at < now − 12 s and resolved_at is null`), then grants their points.
- **Granting is claim-first:**
  ```
  UPDATE daily_questions SET resolved_at = now(), correct = …, points_awarded = …
  WHERE id = … AND resolved_at IS NULL RETURNING …
  ```
  `point_adjustments` is inserted only for returned rows: `reason 'daily_question'`, `counts_toward_ranking false`, `created_by_user_id = user_id`. Do the update and insert in one CTE statement:
  ```
  with claimed as (update … returning user_id, points_awarded)
  insert into point_adjustments … select … from claimed
  ```
- **`/start`:** insert the generated row with `onConflictDoNothing` on `(user_id, day)`, then read back whichever row exists. The streak comes from yesterday's row, read in the same statement as the insert where practical.
- **`/answer`:** accepted only if `now − served_at ≤ 12 000` and the row is unresolved. It sets `answered_at`, `choice` and `response_ms`, then resolves claim-first.
  - Late, or already resolved: return the current state, which carries the stored result.
  - No row for today: return `{ error: "not_started" }`, which the route maps to 409.
- **Routes:** `GET /`, `POST /start`, `POST /answer` with body `{ choice }` validated to `"a" | "b"` (400 otherwise). All use `requireAuth`, follow the `try/catch` + `console.error` pattern from other routes, and return 500 with `{ error }` on failure.

- [ ] **Step 1:** Add a `--flow` section to the check script, run against **dev** with a dev user id from `DQ_USER_ID`. It deletes that user's `daily_questions` rows and `daily_question` adjustments first, then asserts:
  - `getDailyQuestionState(u)` → `status === "ready"`, `today === null`
  - `startDailyQuestion(u)` twice in parallel (`Promise.all`) → exactly one row exists, both returns are the same question, and `today.result === null` with no `valueA` anywhere in `JSON.stringify(state)`
  - `answerDailyQuestion(u, correctChoice)` → `status === "done"`, `result.correct === true`, `result.points.total === 33` (day-1 streak 3 + correct 30)
  - calling `answerDailyQuestion` again → same result, and the sum of `daily_question` adjustments for `u` is still 33
  - **timeout:** delete the rows, `startDailyQuestion(u, t0)`, then `getDailyQuestionState(u, t0 + 13 s)` → `status === "done"`, `result.choice === null`, `result.correct === false`, `result.points.total === 3`
  - **streak:** insert a resolved row for yesterday with `streak = 6`, then start and answer correctly today → `points.total === 21 + 30 + 75`
- [ ] **Step 2:** Run `DQ_USER_ID=<dev uuid> npx tsx --env-file=.env src/scripts/daily-question-check.ts --flow`. Expected: FAIL, because the service doesn't exist yet.
- [ ] **Step 3:** Implement the service, the router and the `index.ts` mount.
- [ ] **Step 4:** Run step 2 again, and also `npx tsc -p tsconfig.json --noEmit`. Expected: `OK` and no type errors.
- [ ] **Step 5:** Commit: "Daily question: service and routes".

### Task 5: 7-day spendable lock

**Files:**
- Modify: `backend/src/services/points.ts` (`getUserPoints`)
- Modify: `backend/src/scripts/daily-question-check.ts` (add a `--lock` section)

**Interfaces:**
- Produces: `getUserPoints` excludes `point_adjustments` rows with `reason = 'daily_question'` while the user's `created_at > now() − interval '7 days'`, inside the existing `bonus` subquery, so there's no extra round trip.
- `getUserPoints` is the only spendable-balance computation. Packs, store, battles and wheel all call it. `services/leaderboard.ts` already ignores `counts_toward_ranking = false` rows.

- [ ] **Step 1:** Add a `--lock` section to the check script, run on dev with `DQ_USER_ID`. It:
  1. records `before = getUserPoints(u)`
  2. inserts a `daily_question` adjustment of 33
  3. sets `users.created_at = now() − 2 days` and asserts `getUserPoints(u) === before`
  4. sets it to `now() − 8 days` and asserts `getUserPoints(u) === before + 33`
  5. restores the original `created_at` and deletes the adjustment
- [ ] **Step 2:** Run it. Expected: FAIL at step 3, before the change.
- [ ] **Step 3:** Implement the exclusion.
- [ ] **Step 4:** Run it again. Expected: `OK`.
- [ ] **Step 5:** Commit: "Daily question: 7-day spend lock for new accounts".

### Task 6: Admin "suspicious" list

**Files:**
- Modify: `backend/src/routes/admin.ts` (add `GET /daily-question/suspicious`, behind `requireAuth` and `requireAdmin` like its neighbours)
- Create: `frontend/src/app/features/admin/admin-daily-question.ts` (standalone component)
- Modify: `frontend/src/app/features/admin/admin-tools.html` (add `<app-admin-daily-question />` next to `<app-admin-errors />`) and `admin-tools.ts` imports
- Modify: `frontend/src/app/core/api.service.ts`, `core/models.ts`, `core/i18n/daily-question.ts` (admin strings)

**Interfaces:**
- Produces: `GET /api/admin/daily-question/suspicious` returns `{ rows: { userId: string; username: string; answers: number; correctPct: number; medianResponseMs: number }[] }`.
  - Filter: rows of the last 30 days with `answered_at is not null`, grouped by user, `having count ≥ 14 and avg(correct::int) ≥ 0.9 and percentile_cont(0.5) within group (order by response_ms) < 1500`.
  - Order: by median response, ascending.
- Client: `ApiService.getDailyQuestionSuspicious(): Observable<{ rows: DailyQuestionSuspect[] }>`.

- [ ] **Step 1:** Implement the endpoint. Run `npx tsc -p tsconfig.json --noEmit`. Expected: no errors.
- [ ] **Step 2:** Verify by querying dev. Insert 14 fast, correct rows for the dev user with `served_at` on 14 different past days, hit the endpoint through the local server with an admin token, and confirm the user appears. Then delete the rows.
- [ ] **Step 3:** Build the admin table component. It shows "No suspicious accounts" when empty. Strings are EN and EL.
- [ ] **Step 4:** Run `cd frontend && npx ng build`. Expected: no errors.
- [ ] **Step 5:** Commit: "Daily question: admin suspicious-account list".

### Task 7: Dashboard card + play overlay

**Files:**
- Create: `frontend/src/app/core/i18n/daily-question.ts`, merged in `core/i18n/translations.ts`
- Modify: `frontend/src/app/core/models.ts` (mirror `DqState`, `DqToday`, `DqResult`, `DqPlayer` as `DailyQuestionState` etc.)
- Modify: `frontend/src/app/core/api.service.ts`:
  - `getDailyQuestion(): Observable<DailyQuestionState>`
  - `startDailyQuestion(): Observable<DailyQuestionState>`
  - `answerDailyQuestion(choice: "a" | "b"): Observable<DailyQuestionState>`
- Create: `frontend/src/app/features/daily-question/daily-question-card.ts` (card plus overlay in one standalone component; split the overlay into its own file only if the component passes ~300 lines)
- Modify: `frontend/src/app/features/dashboard/dashboard.component.html`, to place `<app-daily-question-card class="order-2 block" />` after `<app-round-checklist>`, plus the matching import

**Interfaces:**
- Consumes: Task 4's JSON shapes; existing `PlayerPhotoComponent`, `[appButton]`, `formatPlayerName`, `I18nService`.

Card states:
- `ready`: "Today's question is ready", the streak flame with its count, "+N points", and a Play button.
- `in_progress`: Resume. It reopens the overlay with `remainingMs`.
- `done`: ✓ or ✗, points earned, and "Come back tomorrow".
- `unavailable`: "No question today".
- While `lockedUntil` is set: an extra line "Points unlock on {date}".
- Logged-out users: hidden.

Overlay:
- Two tappable player cards (photo, name, team) and the question text from `dq.q.{template}`, with the `{stat}` placeholder replaced by `dq.stat.{stat}`.
- A countdown bar from `remainingMs` that's display-only and stops at 0.
- When the bar runs out, `getDailyQuestion()` is called once to fetch the timeout result.
- After the answer, both values are revealed, with the higher one highlighted and a points breakdown: streak +X, correct +30, milestone +Y.
- Close returns to the card in its `done` state.

i18n keys (EN / EL, all in this task):

| Key | EN | EL |
|---|---|---|
| `dq.title` | Daily question | Ερώτηση της ημέρας |
| `dq.ready` | Today's question is ready | Η σημερινή ερώτηση σε περιμένει |
| `dq.play` | Play | Παίξε |
| `dq.resume` | Resume | Συνέχεια |
| `dq.streak` | {n}-day streak | Σερί {n} ημερών |
| `dq.next` | +{n} points today | +{n} πόντοι σήμερα |
| `dq.q.last_night` | Who had {stat} last night? | Ποιος είχε {stat} χθες; |
| `dq.q.last_game` | Who had {stat} in his last game? | Ποιος είχε {stat} στον τελευταίο του αγώνα; |
| `dq.q.last_3` | Who had {stat} over his last 3 games? | Ποιος είχε {stat} στους 3 τελευταίους του αγώνες; |
| `dq.stat.points` | more points | περισσότερους πόντους |
| `dq.stat.rebounds` | more rebounds | περισσότερα ριμπάουντ |
| `dq.stat.assists` | more assists | περισσότερες ασίστ |
| `dq.stat.pir` | a higher PIR | μεγαλύτερο PIR |
| `dq.stat.threes` | more threes made | περισσότερα εύστοχα τρίποντα |
| `dq.correct` | Correct! | Σωστό! |
| `dq.wrong` | Not this time | Όχι αυτή τη φορά |
| `dq.timeout` | Time's up | Τέλος χρόνου |
| `dq.pts.streak` | Streak | Σερί |
| `dq.pts.correct` | Correct answer | Σωστή απάντηση |
| `dq.pts.milestone` | Milestone | Ορόσημο |
| `dq.tomorrow` | Come back tomorrow to keep your streak | Έλα αύριο για να κρατήσεις το σερί |
| `dq.unavailable` | No question today | Δεν υπάρχει ερώτηση σήμερα |
| `dq.locked` | Points unlock on {date} | Οι πόντοι ξεκλειδώνουν στις {date} |

"More" lives in the stat strings, so each Greek stat carries its own gender agreement.

- [ ] **Step 1:** Add the models, API methods and i18n dictionary. Run `npx ng build`. Expected: no errors.
- [ ] **Step 2:** Build the card and overlay. Run `npx ng build`. Expected: no errors and no new warnings for the dashboard chunk.
- [ ] **Step 3:** Run it locally against dev (backend `npm run dev`, frontend on 4201).
  - Exercise Play → answer, Play → let it time out (delete today's row between the two with SQL), and a refresh mid-question (Resume shows the remaining time and the clock didn't reset).
  - Ask the user for screenshots of the card and the overlay rather than opening Chrome (CLAUDE.md).
- [ ] **Step 4:** Commit: "Daily question: dashboard card and play overlay".

### Task 8: Economy simulation

**Files:**
- Modify: `backend/src/scripts/season-simulation.ts`

**Interfaces:**
- Consumes: Task 2's `pointsFor`. Import it, rather than duplicating the reward table.

Approach:
- Add `DAILY_QUESTION_ENABLED = process.env.SIM_DAILY_QUESTION !== "0"`, plus `SIM_DQ_ACCURACY` (default `0.62`).
- Inside the existing day loop, the same `Math.random() < spinEngagement` attendance roll decides whether the user plays that day.
  - A played day: `streak++`, `state.points += pointsFor(streak, Math.random() < DQ_ACCURACY).total`, then `spendLoop`.
  - A missed day: `streak = 0`.
- Track and print `dailyQuestionPointsEarned` next to the existing per-mechanic totals.

- [ ] **Step 1:** Run `npm run economy:simulate` with `SIM_DAILY_QUESTION=0`, after the flag exists, and save the output as the baseline.
- [ ] **Step 2:** Implement and run `npm run economy:simulate`. Expected: it runs to completion, and daily-question points appear in every block.
- [ ] **Step 3:** Report to the user, without changing the reward numbers:
  - median album-completion day
  - completion % at 50/85/100% engagement, before and after
  - weekly daily-question points at 100% engagement
- [ ] **Step 4:** Commit: "Economy sim: daily question income".

### Task 9: Ship

- [ ] **Step 1:** Run both checks again. Then use the `ship` skill to deploy to **dev**, and check that `GET /api/daily-question` returns 401 without a token and that the served bundle contains `dq.title`.
- [ ] **Step 2:** After the user confirms on dev, deploy to production the same way. The table already exists there from Task 1.
- [ ] **Step 3:** Suggest a "What's new" announcement (EN + EL) for `/admin/tools`.
