# Daily Question (Higher or Lower)

Date: 2026-10-13 · Status: design approved in conversation; spec awaiting review.

## Goal

A once-a-day, 10-second "who had more?" question that gives people a reason to
open the app every day, including days without games. Its purpose is earning
points for packs. The reward is weighted toward **coming back daily** (an
attendance streak) rather than toward being right, so the part a cheater could
gain is the smaller part.

## Decisions made in conversation

- One question per day per user. Days are Europe/Athens calendar days.
- Reward level "B": roughly a 250-point pack per week for a loyal daily player.
- Questions mix yesterday's box scores with recent-form questions. They are
  never a plain season average (the easiest thing to look up on another
  device), and never complicated.
- Timer: 10 seconds, enforced server-side.
- Each user gets a different question, so answers can't be shared.
- Daily-question points can't be spent during an account's first 7 days.

## Question types

Each user's question is one of these, generated when they tap Play:

| When | Template (EN) | Values compared |
|---|---|---|
| A final game was played yesterday (Athens day) | "Who had more {stat} last night?" | That game's box score |
| Otherwise | "Who had more {stat} in his last game?" | Each player's most recent game this season |
| Otherwise | "Who had more {stat} over his last 3 games?" | Sum of each player's 3 most recent games this season |

On no-game days the two "otherwise" templates are picked 50/50.

- Stats: points, rebounds, assists, PIR (`valuation`), threes made
  (`field_goals_made_3`). Picked at random.
- Source: `player_game_stats` joined to final `games` of the current season
  (`getCurrentSeason()`).
- Eligible players: active, with at least 15 minutes in every counted game.
  The stat must also clear a floor, so 1-vs-0 questions never appear:

  | Stat | Floor (per game; ×3 for last-3 questions) |
  |---|---|
  | Points | 6 |
  | Rebounds | 3 |
  | Assists | 2 |
  | PIR | 5 |
  | Threes made | 1 |

- Pairing: two different players whose values differ, with
  `larger / smaller` between 1.15 and 1.25. If no pair fits, widen to 1.10–1.40.
  If none fits after that, try another stat, then another template.
- Players A and B appear in random order.
- Copy is in both EN and EL in the same pass. Player names use the existing
  `formatPlayerName`.

## How a day plays

1. **Dashboard card.** It shows "Today's question is ready" plus the current
   streak, or the finished result. It never shows player names or the stat
   before Play.
2. **Play.** `POST /start` creates today's row, stores the two players, the
   stat, the template and the real values, sets `served_at = now()`, and
   returns the names, photos and question text. The values are not returned.
   If the row already exists, it returns the same question with the time
   remaining (or the result, if it has already resolved).
3. **Answer.** `POST /answer {choice: "a" | "b"}` is accepted only if
   `now() − served_at ≤ 12 s` (10 s shown plus 2 s for network). It returns
   both values, whether the answer was right, the points earned and the new
   streak.
4. **Timeout.** A served row without an answer after 12 s counts as wrong.
   Rows are resolved lazily: any `GET` for the user resolves their own expired
   rows, including rows from earlier days.
5. Closing or refreshing the app never resets the clock.

## Points

| Part | Amount | Condition |
|---|---|---|
| Streak bonus | `min(3 × streak, 30)` | Any resolved question (right, wrong or timeout) |
| Correct answer | +30 | Right answer within the time limit |
| Milestone | +75 | On reaching a streak of 7 |
| Milestone | +300 | On reaching a streak of 30, 60, 90, … |

- **Streak:** the number of consecutive Athens days with a served question,
  ending today. It is fixed on the row at serve time: 1 + yesterday's row's
  streak if yesterday has a row, otherwise 1. Only a day with no question
  served breaks the streak.
- **Granting:** on resolve, a conditional
  `UPDATE daily_questions SET resolved_at = now() … WHERE resolved_at IS NULL RETURNING`
  claims the row first. Only then is one `point_adjustments` row inserted with
  `reason = 'daily_question'` and `counts_toward_ranking = false`.
  - This is the existing claim-first idempotency pattern, so a row can never
    pay twice.
  - Prediction leaderboards are unaffected. Like pack spending, this is
    currency, not prediction score.
- **New-account lock:** `getUserPoints()` (the spendable balance) excludes
  `daily_question` adjustments while `users.created_at > now() − 7 days`.
  - The points unlock automatically on day 7, since the balance is computed
    on read.
  - The dashboard card shows "unlocks in N days" during that period.
  - Anything else that computes a spendable balance must apply the same
    exclusion. Check `services/cards.ts`, `routes/packs.ts` and the other
    `getUserPoints` consumers.

## Data model

New table `daily_questions`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk users | |
| `day` | date | Athens calendar day; unique with `user_id` |
| `template` | varchar(16) | `last_night`, `last_game`, `last_3` |
| `stat` | varchar(16) | `points`, `rebounds`, `assists`, `pir`, `threes` |
| `player_a_id`, `player_b_id` | uuid fk players | |
| `value_a`, `value_b` | integer | Never sent to the client before the answer |
| `served_at` | timestamptz | Start of the 10 s clock |
| `answered_at` | timestamptz null | |
| `choice` | char(1) null | `a` / `b`; null = timeout |
| `correct` | boolean null | |
| `response_ms` | integer null | `answered_at − served_at` |
| `streak` | integer | Fixed at serve time |
| `points_awarded` | integer null | Set on resolve |
| `resolved_at` | timestamptz null | Claim-first guard |

- Index on `(user_id, day)`. The unique constraint covers it.
- Rows are created on `/start` with `onConflictDoNothing` on `(user_id, day)`,
  so a double tap can't create two questions.
- Apply by hand-written SQL to both production and the dev Neon project,
  as CLAUDE.md requires.

## API (`backend/src/routes/dailyQuestion.ts`, mounted at `/api/daily-question`, `requireAuth`)

- `GET /` returns the state for the dashboard card. It resolves any expired
  rows first.
  - Shape: `{ status: "ready" | "in_progress" | "done", streak, nextBonus, lockedUntil, today? }`.
  - `today` includes the question only when `in_progress`, and the result only
    when `done`.
- `POST /start` serves or returns today's question (see "How a day plays").
- `POST /answer` returns the result, or `409` if the row is already resolved or
  expired. An expired row returns its timeout result instead.

Keep each request to as few statements as possible. Latency is DB round
trips: combine the resolve and read into single statements where practical.

## Bots and suspicious accounts

These can't be prevented, only detected. The stats are public, including
through our own API.

- `response_ms` is stored for every answer.
- Admin endpoint `GET /api/admin/daily-question/suspicious` lists users with at
  least 14 answers in the last 30 days, ≥ 90% correct and a median
  `response_ms` < 1500.
- It is shown as a table on `/admin/tools`. There is no automatic ban; an admin
  decides.

## Frontend

- `features/daily-question/`:
  - a dashboard card component, placed in the dashboard near the round
    checklist
  - a play overlay with two player photo cards, a 10 s countdown bar, and a
    reveal of both values with the points breakdown
- The countdown is display-only. The server's clock decides.
- Points and streak update the visible balance after answering, the same way
  other reward grants do.
- New strings go in an i18n `dailyQuestion` dictionary, EN + EL together.
- Buttons use `[appButton]`. Any toast uses the shared stack in
  `app.component.html`.

## Economy check (before shipping)

- Add daily-question income to `scripts/season-simulation.ts`, run through
  `npm run economy:simulate`:
  - per-engagement-level probability of playing each day
  - about 60–65% correctness
  - the streak and milestone schedule above
- Report how much earlier albums complete, and trim the amounts before shipping
  if completion falls well before the season's end.

## Out of scope (v1)

- Streak freeze or missed-day protection
- Push reminders
- A daily leaderboard (questions differ per user, so there is no common
  ranking)
- Question history page

## Rollout

- Ship to dev first, then production.
- Suggest a "What's new" announcement (EN + EL) on production.
