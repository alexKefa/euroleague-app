# Four Quarters duels (Battles v6) — design

Date: 2026-10-29. Status: approved in brainstorming, awaiting spec review.

## Why

Card Battles have been rebuilt five times (v1 turn-based ATK/DEF/HP, v2 tied
to a real round, v3 weighted coin flip, v4 hidden stat duel, v5 rarity + PIR
power with a weighted draw). The live v5 has four problems, all confirmed by
the user: there are no decisions to make, rarity decides the result, there's
nothing to watch, and few people play it.

Goal: a short, async, competitive mini game played with cards from your
collection. You make a real decision every quarter, rarity and current form
both visibly matter but don't decide the game alone, the reveals build
tension, and a rating ladder gives a reason to keep playing.

Success: players make real choices, a weaker collection can beat a stronger
one, and there are more duels per week than under v5.

## Decisions taken

| Topic | Decision |
|---|---|
| Timing | Async turns. Each player commits whenever they like within a deadline. Push notifications say "your move". |
| Role of the collection | Each player builds a 5-card lineup from their own cards. |
| Game | Four Quarters: a category each quarter, simultaneous hidden commits, total score wins. |
| Stakes | Elo rating ladder plus a small minted win prize. The loser loses nothing. |
| Rarity | Common < rare < legendary < MVP Moment. Foil is a +0.10 bump on top of the tier. |
| Form | A separate, visible multiplier based on recent PIR against season PIR. |

## 1. Game rules

### Lineups

- The challenger picks 5 cards they own. The opponent picks 5 when they accept.
- No coaches (tier `coach`).
- 5 different players per lineup. "Same player" means the same
  `normalizePlayerName(name)`, so an MVP Moment and the same player's
  Series 1 legendary can't both be in one lineup.
- Neither lineup is visible to the other side until both are locked. After
  accept, both lineups are fully visible.
- At accept time the server freezes a **snapshot** of all 10 cards. Later
  trades, injuries or stat syncs don't change a running game. A card traded
  away mid-game keeps playing from its snapshot.

### Card strength

The **base stat line** is the player's season line, per game: this season
and last, weighted by games played, with a career fallback. This is the same
query as `getCardStatLines`, but unblended. Form is applied separately below
so it isn't counted twice. `getCardStatLines` is extended to also return the
unblended season line.

**Rarity multiplier** (`rarityMult`):

| Card | Multiplier |
|---|---|
| common | 1.00 |
| rare (includes Series 2 "top" Moments) | 1.10 |
| legendary | 1.20 |
| MVP Moment (series 2, `collectible_moments.role = 'mvp'`) | 1.30 |
| foil (`user_collectibles.finish = 'foil'`) | +0.10 on top of the above |

A foil legendary is 1.30 and a foil MVP is 1.40, the maximum.

**Form multiplier** (`formMult`): `diff = recentPir − seasonPir`, where
`recentPir` is the average over the last `RECENT_GAMES` (5) games. It
applies only when the player has at least 3 recent games. Otherwise the card
is Steady with no badge shown.

| Badge | diff | Multiplier |
|---|---|---|
| ice_cold | ≤ −5 | 0.85 |
| cold | −5 < diff ≤ −2 | 0.93 |
| steady | −2 < diff < 2 | 1.00 |
| hot | 2 ≤ diff < 5 | 1.08 |
| on_fire | ≥ 5 | 1.15 |

Absolute PIR points are used, not a ratio, so a low-PIR player doesn't swing
wildly.

**Injury multiplier** (`injuryMult`): the existing `INJURY_MULTIPLIER`
(out 0.75, doubtful 0.85, questionable 0.90, probable 1.00, none 1.00).

`cardMult = rarityMult × formMult × injuryMult`.

### Categories

The pool has 6 categories, each with a base value and a scale:

| key | Label EN / EL | Base value | Initial scale |
|---|---|---|---|
| scoring | Scoring / Σκοράρισμα | PTS | 1.8 |
| boards | Boards / Ριμπάουντ | REB | 4.5 |
| playmaking | Playmaking / Δημιουργία | AST | 6.5 |
| defense | Defense / Άμυνα | STL + BLK | 15 |
| efficiency | Efficiency / Αξιολόγηση | PIR | 1.7 |
| all_around | All-around / Ολοκληρωμένος | PTS + REB + AST | 1.1 |

The scales are tuned so a median rotation player scores about 20 in any
category. Before shipping, `scripts/calibrate-duel-scales.ts` sets
`scale = 20 / median(base value)` over players with 5 or more games this
season and hard-codes the results.

**Quarter score** for a card = `base value × scale × cardMult`, rounded to 1
decimal.

### Flow

1. On accept, 4 different categories are drawn at random for Q1–Q4 and
   stored. The client always sees the current quarter's category and the next
   one. Later categories stay hidden: the API omits them.
2. Each quarter, each player commits one unused card from their lineup.
   Commits can arrive in either order. The server never exposes the other
   side's commit for the open quarter.
3. When both have committed, the quarter resolves. Both quarter scores are
   added to the running totals, and the next quarter opens with a fresh
   deadline.
4. After Q4, each side's one unused card is its **bench**. If the totals are
   tied, overtime resolves automatically: bench card vs bench card on
   `efficiency`. If overtime also ties, the game is a draw.
5. **Total score wins**, not quarters won.

### Clock

- A direct challenge expires after 72h if it isn't accepted (`expired`). An
  open challenge also expires after 72h.
- Each quarter has a 24h deadline from when it opens. A player who hasn't
  committed at the deadline is auto-committed their **weakest** remaining
  card for that quarter (lowest quarter score, ties broken by lineup order),
  with `auto = true`.
- Two auto-commits in a row by the same player is a **forfeit**. The other
  player wins with `finishReason = 'forfeit'`, and ratings and the prize
  apply as for a normal result. A manual commit resets that player's miss
  streak.

## 2. Rating ladder and rewards

### Elo

- Each duel season is a calendar month in Europe/Athens, key `'YYYY-MM'`.
- A player's first duel in a month creates their row lazily:
  `rating = round(1000 + (lastRating − 1000) / 2)`, where `lastRating` is
  from their most recent earlier row. A brand-new player starts at 1000.
- Expected score is `E = 1 / (1 + 10^((Rb − Ra) / 400))`. A win scores 1, a
  draw 0.5, a loss 0.
- K = 32 while the player has fewer than 10 lifetime finished duels, and 20
  after that. Each side uses its own K.
- **Anti-farm:** if the pair already finished 3 or more duels in the trailing
  7 days, K is halved for both sides.
- Rating changes are applied at finish, from the month of `finishedAt`, and
  stored on the duel row as `challengerRatingDelta` / `opponentRatingDelta`.

### Divisions

Divisions are derived from rating and never stored.

| Division | Rating |
|---|---|
| rookie | < 950 |
| starter | 950–1099 |
| sixth_man | 1100–1199 |
| all_star | 1200–1299 |
| mvp | ≥ 1300 |

### Leaderboards

- **Global ladder:** the current month, ordered by rating, ties broken by
  more wins. Cached in memory for 60s.
- **League ladder:** the same, filtered to league members. It replaces what
  the league leaderboard's "Battles" tab shows today.

### Season badges

Badges are computed on read, like the existing `earnedBadges`, from finished
months' `duel_ratings` rows:
- "Duel Season Top 3" for finishing in the top 3 of a month.
- "All-Star Season" for finishing a month at 1200 or higher.

No grant job.

### Win prize

- +15 points to the winner as a `point_adjustments` row with reason
  `"Duel win"`. The points are minted and not taken from the loser.
- It's paid only if both:
  - the winner has fewer than 5 paid duel wins on that Europe/Athens day
  - the winner has had no paid duel win against this opponent that day
- Draws pay nothing.
- `duels.prizePaid` records the payout. The insert is claim-first, so the
  prize can't be paid twice.
- `npm run economy:simulate` must be re-run with this points source before
  shipping.

### Limits and access

- No points are needed to start a duel.
- Direct challenges go to a league-mate. `leagueId` is required and the
  opponent must be a member.
- Open challenges have `leagueId` and `opponentUserId` both null, and anyone
  else can take them. The list is sorted by how close the poster's rating is
  to the viewer's.
- A player can have at most 5 duels in `open | pending | active` at once,
  checked at create and at accept.
- Rematch creates a new direct challenge to the same opponent, in the same
  league if there was one, with the previous lineup preselected.

### Retiring v5

- `battles` becomes read-only history. Its GET routes stay and its
  create/accept routes are removed.
- At launch, battles still in `pending` are set to `cancelled`. No points
  moved for them, so there's nothing to refund.

## 3. Data model and backend

### Tables

Created with hand-written SQL on **both** prod (Supabase) and dev (Neon
EuroleagueDev), mirrored in `schema.ts`. On Supabase, revoke all on the new
tables from `anon` and `authenticated`.

`duels`
- `id uuid pk`
- `league_id uuid null → leagues`
- `challenger_user_id uuid → users`, `opponent_user_id uuid null → users`
- `status varchar(20)`: `open | pending | active | finished | declined | cancelled | expired`
- `finish_reason varchar(20) null`: `normal | forfeit`
- `categories jsonb null`: `DuelCategory[4]`, set at accept
- `challenger_lineup jsonb`: the collectible ids (5) picked at create, replaced by full snapshots at accept
- `opponent_lineup jsonb null`: full snapshots, set at accept
- `quarter smallint default 0`: 0 before accept, 1–4 while active, 5 after overtime
- `quarter_deadline timestamptz null`
- `challenger_score real default 0`, `opponent_score real default 0`
- `challenger_miss_streak smallint default 0`, `opponent_miss_streak smallint default 0`
- `winner_user_id uuid null`: null on a draw
- `challenger_rating_delta int null`, `opponent_rating_delta int null`
- `prize_paid boolean default false`
- `created_at`, `accepted_at`, `finished_at`, `expires_at` (create + 72h)
- Indexes: `(challenger_user_id, status)`, `(opponent_user_id, status)`,
  `(status, quarter_deadline)`, `(status, expires_at)`

A card snapshot (`DuelCard`) holds: `collectibleId`, `name`, `teamId`,
`imageUrl`, `tier`, `isMvp`, `isFoil`, `base: { pts, reb, ast, stl, blk, pir }`,
`rarityMult`, `formMult`, `formBadge`, `injury`, `injuryMult`.

`duel_moves`
- `duel_id uuid → duels`, `quarter smallint` (1–4), `user_id uuid → users`
- `slot smallint` (0–4), `score real`, `auto boolean default false`, `created_at`
- Unique `(duel_id, quarter, user_id)`, and unique `(duel_id, user_id, slot)` so a card is played only once.

`duel_ratings`
- `user_id uuid → users`, `season varchar(7)`, `rating int`, `games int`,
  `wins int`, `losses int`, `draws int`
- Primary key `(user_id, season)`, index `(season, rating desc)`

### Units

- `services/duelEngine.ts`: pure functions with no DB. Covers multipliers
  (`rarityMult`, `formFor`, `cardMult`), `CATEGORIES` and their scales,
  `quarterScore`, `drawCategories(rng)`, `weakestRemaining`, `resolveOvertime`,
  `eloDeltas(ra, rb, result, kA, kB)`, `kFactor(lifetimeGames, pairRecentGames)`,
  `divisionFor`, `seasonKey(date)`, `softReset`, `prizeEligible(...)`.
  Covered by `services/duelEngine.test.ts` (`node:test`, like
  `momentsLogic.test.ts`).
- `services/duels.ts`: the DB layer.
  - `buildSnapshots(userId, collectibleIds)` checks ownership and validity and
    reuses `getCardStatLines` with one round trip.
  - Also `createDuel`, `acceptDuel`, `commitMove`, `applyTimeouts(duelId?)`,
    `finishDuel` (ratings, prize and SSE in one transaction), and
    `getDuelView(duelId, viewerId)`, which applies the hidden-information
    rules.
- `routes/duels.ts`, mounted at `/api/duels`, all behind `requireAuth`:
  - `POST /` creates a challenge: `{ lineup, opponentUserId?, leagueId? }`, open when no opponent is given.
  - `GET /open` lists open challenges.
  - `GET /mine` lists my duels, grouped by state.
  - `GET /:id` returns the view.
  - `POST /:id/accept` takes `{ lineup }`.
  - `POST /:id/decline`, and `POST /:id/cancel` (challenger only, before accept).
  - `POST /:id/commit` takes `{ slot }`.
  - `GET /ladder?leagueId=` returns the ladder.
  - `GET /me/rating` returns my rating, division, month W–L/D and paid wins left today.

### Concurrency and idempotency

- **Commit:** a single transaction with a per-duel row lock
  (`SELECT … FOR UPDATE` on `duels`). It checks that the duel is active, the
  quarter matches, the slot is unused and the deadline hasn't passed. It
  inserts the move with `onConflictDoNothing`. If the other move exists, it
  resolves the quarter: it updates the scores and advances the `quarter` with
  `WHERE quarter = n`, or finishes the duel.
- **Timeouts:** `applyTimeouts` runs in two places:
  - lazily at the start of `GET /:id` and `POST /:id/commit` for that duel
  - for all due duels in `runHourlyJobs`
  
  It uses the same locked path as a commit. Lazy resolution is needed because
  Railway dev runs with `DISABLE_BACKGROUND_JOBS=1`. Expired challenges are
  handled the same way.
- **Prize:** the `point_adjustments` insert is conditional on
  `UPDATE duels SET prize_paid = true WHERE id = ? AND prize_paid = false`.

### Realtime and egress

- Every state change calls `sendToUser(otherUserId, "duel", { id, status, quarter })`.
  The client refetches the one duel and never polls.
- The view payload is a few KB.
- The ladder is cached in memory for 60s. The rating header comes from one
  query.

### Account lifecycle

- `accountDeletion.ts`: the user's active and pending duels are forfeited or
  cancelled, their open challenges are cancelled, and their `duel_ratings`
  rows are deleted. Duel rows stay for the opponent's history, with the user
  anonymised the same way battles are today.
- `accountExport.ts`: includes the user's duels and ratings.

## 4. Frontend

### Battles hub (`/battles`, same route and nav entry)

- The header strip shows rating, division badge, month W–L–D and
  "N/5 paid wins left today".
- **Games** tab: "Your move" first, then "Waiting", then "Finished". Each row
  shows the opponent, the score, and "Q3 · your move" or a countdown.
- **Open** tab: open challenges, sorted by rating closeness, with a "Post
  open challenge" button.
- **Ladder** tab: a Global / per-league switch, with your row pinned.
- Old v3–v5 battles appear under Finished as read-only, using their existing
  display.

### Lineup builder

Used to create a challenge, post an open one, or accept.

- A grid of the user's playable cards, with coaches excluded.
- Each card shows a rarity chip (×1.20 etc.), a form badge (🧊 / cold /
  steady / hot / 🔥), an injury tag, and all 6 category scores with
  multipliers applied.
- Sort by category. "Auto-fill best 5" picks the highest total over the 6
  categories.
- 5 slots. The same-player rule is enforced in the UI and on the server.
  "Lock lineup" is enabled once all 5 slots are filled.
- The last used lineup is preselected for Rematch.

### Game screen (`/battles/duel/:id`)

- Scoreboard with team colors, the Q1–Q4 (and OT) line, the current and next
  category banners, and the deadline countdown.
- My 5 cards: used cards faded, each showing its score for the current
  category. The opponent's remaining cards are face up.
- Tap a card, then "Commit". Afterwards: "Waiting for {name}…", or the reveal
  plays at once if they had already committed.
- **Reveal:** both cards flip, the numbers count up, and the scoreboard
  updates. This reuses the card art and the `battle-detail.css` animations.
- **Full time:** the final score, OT if played, the rating change, the prize
  (or "daily prize limit reached"), and Rematch.
- Forms use Reactive Forms and buttons use `[appButton]`. The back link is
  `navHistory.previousUrl() ?? '/battles'`.

### Notifications

- **Push** via `sendPushInBackground`:
  - a new direct challenge
  - a challenge accepted ("your move")
  - the opponent committed and you haven't
  - a quarter revealed
  - 2h before your deadline (from the hourly job, sent with `sendPushOnce`
    per duel and quarter)
  - the final result
  
  At most one "your move" push per player per quarter.
- **In-app:** `battle-challenge-toast` and the pending badge count duels where
  it's the viewer's move or where they have a pending challenge to answer.
  The toast renders in the shared toast stack.
- **SSE:** the `duel` event refreshes an open game screen and the hub.

### i18n and copy

- `core/i18n/duels.ts` has EN and EL together: categories, divisions, form
  badges, states, errors and push text. It's merged in `translations.ts`.
- `battles-info.ts` is rewritten for the new rules.
- After shipping, propose an EN + EL "What's new" announcement for the admin
  to post on `/admin/tools`.

## Errors

| Case | Response |
|---|---|
| Lineup not 5 cards, a card not owned, a coach, a duplicate player | 400 `INVALID_LINEUP` |
| Opponent not a league-mate, yourself, or your own open challenge | 400 |
| More than 5 open/pending/active duels | 409 `TOO_MANY_DUELS` |
| Commit on a non-active duel, the wrong quarter, a used slot, or not a participant | 409 or 403; client refetches |
| Accept on an expired or already-taken challenge | 409 `NOT_AVAILABLE` |

## Testing and verification

- `duelEngine.test.ts` covers:
  - the multiplier ladder, including foil MVP = 1.40
  - form thresholds and the under-3-games rule
  - quarter scoring and the overtime tie leading to a draw
  - Elo sums and K selection, including the anti-farm halving
  - prize eligibility
  - weakest-remaining picks
  - the soft reset and season key at a month boundary in Athens
- `scripts/calibrate-duel-scales.ts`, run once, sets the 6 scales.
- `scripts/check-duels.ts` runs against the **dev** DB: create → accept → 4
  commits; a timeout auto-commit; a forfeit after two misses; rating and
  prize rows; a double commit is a no-op.
- `npm run economy:simulate` with the duel prize added.
- Backend `npx tsc --noEmit` and frontend `ng build`. No browser checks by
  Claude: ask the user for screenshots.

## Out of scope for v1

Pack rewards at season end, points wagers, live real-time play, spectating,
and team-chemistry bonuses.
