# Album Series 2: Moments

Date: 2026-10-27 · Status: design approved in conversation; spec awaiting review.

## Goal

Keep album completion, now the app's main progress track and the default
Leaderboard tab, a live chase for the whole 2026-27 season.

Production data on 2026-10-27 (round 7 of 38) showed the #1 collector at 43%
after five weeks. Simulating today's rules forward, the top players reach
96–98% by February and then stall for two months waiting on legendaries,
while a large share of them complete the album around April.

Success means:

- Nobody completes the full album this season.
- Every active player's % keeps rising until April. No plateau.
- Completing Series 1 (today's 700 cards) stays reachable, around late
  March for top players, as the end-of-season milestone.
- Casual players still reach about half the album.

## Decisions made in conversation

- **Approach C2** from the simulation: a January drop plus a per-round drip.
- **Series 2 is "Moments".** A moment card captures one real performance:
  player, round, stat line. A player can have several moment cards in a
  season.
- **The Jan 1 drop is the first half's moments.** Moment cards for every
  round completed by launch (rounds 1–~18), released at once.
- **6 moments per round:** the round MVP as a legendary, plus the next 5
  top performers as rares.
- **Moments come from the normal draws.** They join the existing rare and
  legendary pools. No new pack type, and no change to odds or prices.
- **Predictions bonus (B2):** you get a round's MVP moment if you had a
  great round (8+ correct winner picks) **or** you correctly picked the MVP
  as their game's top scorer. Granted retroactively for the backlog rounds.
- **Series 1 first:** guaranteed-new pulls fill Series 1 gaps before
  Series 2, so Series 2 can't make Series 1 unfinishable.
- **The leaderboard keeps ranking by total %** across both series. The
  album page splits into Series 1 and Series 2. Completing Series 1 earns
  a badge.
- **Data model, approach 1:** a `series` column on `collectibles` plus a
  side table for moment details. Every existing system (ownership, packs,
  trades, battles, sell-back, leaderboard) keeps working on moment cards
  unchanged.
- **Legends** (past EuroLeague greats, "epic" past players) are out of
  scope here; see Out of scope.

## Expected economy

From the simulation (800 runs; behaviour fixed at the last 14 days' rate;
predictions ~10% easier by season end):

| April 16 | #1 | #2 | #3 | Free-only (#4) | Casual new player |
|---|---|---|---|---|---|
| Today's rules | 100% | 100% | 100% | 100% | 65% |
| This design (C2 + B2 + Series 1 first) | 94% | 98% | 96% | 86% | 51% |

- Jan 1 drop: about −11 points for everyone (#1: 86% → 75%).
- Series 1 completion: top and free-only players around late March, in
  about 60% of runs.
- Full album by April 16: 0% of runs.
- Album size by season end: about 914 cards (700 + ~108 backlog + ~6 × 18
  rounds).

The throwaway simulation scripts that produced these numbers are not
committed. The implementation re-runs the economy simulation before launch
(see Verification).

## 1. Data model

All changes are additive. Applied by hand-written SQL to **both** the
production DB (`EuroleagueProd`) and the dev DB (`EuroleagueDev`), and
mirrored in `backend/src/db/schema.ts`.

### `collectibles`: new column

- `series smallint not null default 1`
- All 700 existing rows become Series 1. Moment cards are inserted with
  `series = 2` and `tier` `rare` or `legendary`, so every tier-based rule
  applies to them unchanged.

### New table `collectible_moments`

One row per moment card.

| column | type | notes |
|---|---|---|
| `collectible_id` | uuid, PK, FK → collectibles | the card |
| `player_id` | uuid, FK → players | real player link |
| `game_id` | uuid, FK → games | the game of the performance |
| `season` | varchar(9) | e.g. `2026-27` |
| `round` | integer | |
| `role` | varchar(10) | `mvp` (legendary) or `top` (rare) |
| `points`, `pir`, `rebounds`, `assists` | integer | snapshot at creation |
| `minutes` | real | snapshot at creation |

- Unique index `(season, round, player_id)`: one card per player per round,
  and generation can be re-run safely.
- The stat line is a **fixed snapshot**. A later box-score correction never
  changes an existing card.

### New table `moment_bonuses`

The B2 grant ledger.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → users | |
| `collectible_id` | uuid FK → collectibles | the round's MVP card |
| `reason` | varchar(20) | `great_round` or `backed_mvp` |
| `granted_at` | timestamptz default now() | |
| `seen_at` | timestamptz null | reveal shown |

- Unique index `(user_id, collectible_id)`, used claim-first.
- A separate table because `round_rewards` already allows only one row per
  user per round (`user_round_reward_unique`), and the regular round reward
  uses that slot.

### Unchanged

- Ownership is still rows in `user_collectibles`.
- The Series 1 badge is computed on read, never stored.
- Album totals keep counting `collectibles`, so they grow as moments are
  released.

## 2. Generating moment cards

New service `backend/src/services/moments.ts`, main function
`generateMomentsForReadyRounds()`.

1. **Launch gate.** Does nothing before `MOMENTS_LAUNCH_AT`
   (2027-01-01 00:00 Europe/Athens), a constant in the service. The feature
   ships inactive.
2. **Ready rounds.** Rounds of `getCurrentSeason()` with no
   `collectible_moments` rows yet, where either:
   - every game is `final` and has `player_game_stats` rows, **or**
   - 7 days have passed since the round's last scheduled tipoff and at
     least 8 of its games are final with stats. Performances from a
     postponed game are left out of that round.
3. **Picks.** For each ready round, take every player's line in the round
   and rank by PIR (`valuation`), then points, then minutes, then player id
   (deterministic). A player with two games in the round counts only their
   best line. #1 is the MVP (legendary); #2–#6 are top performers (rares).
   The counts come from a constant `MOMENTS_PER_ROUND = { legendary: 1,
   rare: 5 }`.
4. **Insert.** One transaction per round: a multi-row insert into
   `collectibles` (`series 2`, tier, `name` = player name, `team_id` = the
   player's team in that game, `image_url` = the player's current
   `photo_url`, `points_cost` 2500 for legendary and 250 for rare, matching
   `expand-collectibles.ts`), then a multi-row insert into
   `collectible_moments`. A round is all-or-nothing.
5. **No bonus granting here.** Bonuses are granted lazily per user
   (Section 3).

**Scheduling:**

- Called from `runHourlyJobs` in `src/index.ts`, next to
  `runGameExtrasSync`. Production only (that block is gated on
  `NODE_ENV=production` and `DISABLE_BACKGROUND_JOBS`).
- Script `npm run moments:generate` (`src/scripts/generate-moments.ts`):
  - `--dry-run` prints the six picks per ready round (player, team,
    opponent, stat line) without writing. It ignores the launch gate.
  - `--force-before-launch` bypasses the launch gate for real writes. It is
    for the dev DB only, and the script prints the DB host before writing.

**Failure handling:**

- A failed round rolls back, logs to the existing error reporting, and is
  retried on the next hourly run.
- The unique `(season, round, player_id)` index prevents double generation,
  even if runs overlap.
- A missing player photo falls back to the placeholder current cards use.

## 3. Pull rules and the B2 bonus

### Series 1 first

In `rollPackForUser` (`services/packs.ts`):

- The catalog query also selects `series`.
- The three guaranteed-new paths (`forceNewLegendary`, `forceNewCoach`,
  and the pity force) pick from **missing Series 1 cards of that tier**
  first, and from missing Series 2 cards only once Series 1 for that tier
  is complete. The existing fallback (nothing missing at all: a normal roll
  that reads as a duplicate) is unchanged.
- Normal, non-forced rolls stay uniform across every released card of the
  tier.

`grantGuaranteedNewCollectible` (`services/cards.ts`, milestone rares) gets
the same Series 1 first ordering.

This covers every guaranteed source: wheel legendary and coach packs, the
Final Four pack's legendary slot, milestone packs and milestone rares, and
pity.

### B2 bonus

New `checkAndGrantMomentBonuses(userId)` in `services/moments.ts`, called
wherever `checkAndGrantRoundRewards` is called today (`routes/predictions.ts`,
`routes/packs.ts`). It returns newly claimed bonuses in the same rewards
payload.

1. For each current-season round that has an MVP moment, the user
   qualifies if either holds:
   - **`great_round`**: the user's correct winner picks in that round are
     ≥ `GREAT_ROUND_THRESHOLD` (8). Correctness uses the same rule as
     `checkAndGrantRoundRewards`: final game, non-null scores, no tie,
     predicted team won.
   - **`backed_mvp`**: the user has a `top_scorer_predictions` row for the
     MVP's game whose `predicted_player_id` is the MVP, and the pick was
     correct under the existing top-scorer rule (`services/topScorerPoints.ts`,
     ties included). If the MVP wasn't their game's top scorer, nobody
     qualifies this way for that round.
   - If both hold, `reason` is `backed_mvp`.
2. **Claim first.** Insert into `moment_bonuses` with on-conflict-do-nothing
   and `returning`. Then insert the claimed cards into `user_collectibles`,
   skipping any the user already owns. This is one combined statement for
   all qualifying rounds, per the CLAUDE.md round-trip rule.
3. Deleted users never qualify. Admins can be granted bonuses, but they are
   excluded from leaderboards as today.
4. **Retroactive.** The first call after launch evaluates every backlog
   round at once.
5. **Already owned from a pack.** The bonus row is still recorded, so the
   round is never re-evaluated, but no extra copy is inserted.
6. `markMomentBonusesSeen(userId)` sets `seen_at`, following the
   `mark*Seen` pattern of the other rewards.

## 4. Frontend

### Models and API

- The `Collectible` model (frontend `core/models.ts` and the backend
  catalog response) gains:
  - `series: 1 | 2`
  - `moment?: { round, role, points, pir, rebounds, assists, minutes,
    gameId, opponentTeamId, gameDate }`
- The catalog endpoint adds one left join to `collectible_moments` (and
  `games` for the opponent and date). Same request, more fields.
- `getAlbumLeaderboardEntries` adds `series1Complete: boolean`, computed in
  the same query. Shown on the Leaderboard page's Album tab, the Album
  page's leaderboard, and league album boards.

### Moment card (`features/store/collectible-card.ts`)

- New optional `moment` input. The card stays **the same size**, so it
  works unchanged in album grids, the pack opening, trades, showcases and
  battles.
- The moment variant adds:
  - a round badge in the corner: `R21` / `Γ21`;
  - a stat strip along the bottom: `31 PTS · 38 PIR`;
  - an `MVP` ribbon on the legendary; `Top performer` on the rares.
- Tier styling (rare and legendary colours, foil) is unchanged.
- `card-preview` (tap to flip): the back of a moment card shows the game
  (opponent, date, final score) and the full line (PTS / REB / AST / PIR /
  MIN) instead of season stats.

### Album page (`features/album`)

- A Series switch at the top: **Players** (Series 1, the team pages exactly
  as today) and **Moments** (Series 2).
- The Moments tab is hidden until at least one moment card exists.
- **Moments is organised by round, newest first.** Each round page shows
  the MVP slot large on top and the 5 top-performer slots below.
- Missing moment cards render as silhouettes with the stat line visible.
- The "collected" counter shows the current series' count, with the total
  underneath.

### Bonus reveal

- Uses the existing reward reveal flow.
- Copy:
  - `backed_mvp`: "You called it: Round 21 MVP" / «Το είχες προβλέψει: MVP Αγωνιστικής 21»
  - `great_round`: "Great round: Round 21 MVP moment" / «Μεγάλη αγωνιστική: η στιγμή του MVP της 21ης»
  - Retroactive batch: one summary, "You already earned 3 MVP moments" /
    «Έχεις ήδη κερδίσει 3 στιγμές MVP»

### Conventions

- Every new string goes into the i18n dictionaries in English and Greek in
  the same pass.
- No new mobile tab.
- Buttons use `[appButton]`; toasts go in the shared stack.

### Launch announcement

Published by an admin on `/admin/tools` on Jan 1. Draft:

- **EN:** "Series 2: Moments is here. Every round's best performances are
  now cards: the MVP as a legendary, plus the top 5. Rounds 1–18 are out
  now, with new moments after every round. Called the MVP as top scorer, or
  had a great round? That MVP moment is already in your album. Your
  Series 1 progress still counts: finish it for the Series 1 badge."
- **EL:** «Η Σειρά 2: Στιγμές είναι εδώ. Οι καλύτερες εμφανίσεις κάθε
  αγωνιστικής γίνονται κάρτες: ο MVP ως legendary και οι 5 κορυφαίοι. Οι
  αγωνιστικές 1–18 είναι ήδη διαθέσιμες, με νέες στιγμές μετά από κάθε
  αγωνιστική. Είχες προβλέψει τον MVP ως πρώτο σκόρερ ή έκανες μεγάλη
  αγωνιστική; Η στιγμή του MVP είναι ήδη στο άλμπουμ σου. Η πρόοδός σου στη
  Σειρά 1 μετράει: ολοκλήρωσέ τη για το σήμα της Σειράς 1.»

## 5. Rollout

1. **November.** Build. Apply the schema SQL to dev and production. Deploy
   to dev, then production. The launch gate keeps it inactive.
2. **Mid-December.**
   - Run `npm run moments:generate -- --dry-run` against production data
     and review the first-half lineup with the user.
   - Run it with `--force-before-launch` on **dev only** to check the
     Moments tab, card design and bonus reveal end to end. Screenshots come
     from the user (CLAUDE.md visual-verification rule).
3. **Jan 1.** The hourly job creates the backlog. Publish the announcement.
   Check once that cards exist and bonuses are granted.

## Verification

There is no test suite.

- `npx tsc -p tsconfig.json --noEmit` (backend) and `ng build` (frontend)
  at every step.
- The dry run checks the selection logic against real box scores.
- A check script on dev:
  - generating the same round twice creates no duplicates;
  - calling `checkAndGrantMomentBonuses` twice grants once;
  - a forced pull with Series 1 gaps never yields a Series 2 card.
- **Economy:** update `npm run economy:simulate`
  (`src/scripts/season-simulation.ts`) to the current catalog and rules,
  including Series 2 and the bonus, and re-run it before launch. Update the
  stale "album completable in a season" comment in `services/packs.ts`,
  which still describes a 438-card catalog.

## Risks

| Risk | Handling |
|---|---|
| A postponed game blocks a round for weeks | 7-day rule with ≥ 8 games final (Section 2). |
| Missing or late box scores | A game counts only once it has `player_game_stats`. The next hourly run retries. |
| Mid-season transfers | A moment's team is the player's team in that game. |
| PIR ties | Points, minutes, then player id. |
| The Jan 1 % drop upsets leaders | Presented as a named new series. Series 1 stays separately completable with a badge. The announcement explains it. |
| Economy faster than simulated | `MOMENTS_PER_ROUND` is a constant, so tuning needs no schema change. |
| `collectibles.image_url` goes stale (it is a snapshot) | Same as existing cards. `collectibles:sync-images` can refresh it. |

## Out of scope

- **Legends cards** (past EuroLeague greats, "epic" past-player cards) as
  the Series 1 completion reward or a Final Four drop. They need hand-picked
  content and image sourcing. Tracked in `TODO.md`.
- Any change to wheel odds, pack prices, pity thresholds or sell-back.
- A separate "Moments" leaderboard.
