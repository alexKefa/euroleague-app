# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personalized EuroLeague stats & fan app. A user picks a favorite team and
the UI "reskins" to that team's colors; the app surfaces standings, rosters,
player pages, league leaders, news, a schedule with per-game box scores, and
a win/loss prediction game with a points/badges leaderboard. Points earned
from predictions feed a small collectibles economy — a daily "Jump Ball"
wheel, points-priced card packs, and a player-to-player trade marketplace —
under a "Cards" hub. The whole app is bilingual (EN/EL) via a custom i18n
service, not a library like ngx-translate.

**Live**: https://clutchapp.up.railway.app (Railway, see Deployment below).

## Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 20 (standalone components, signals), TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript (ESM, run via `tsx`) |
| Database | PostgreSQL (Neon, remote — not local) |
| ORM | Drizzle ORM + Drizzle Kit |
| Auth | JWT (access token kept in memory only, httpOnly refresh cookie), bcrypt |
| Data source | [`euroleague-api`](https://pypi.org/project/euroleague-api/) (Python) for the undocumented EuroLeague feed |

There is no test suite and no lint script configured in either
`package.json` — don't go looking for one.

## Commands

Backend (`backend/`):
```bash
npm run dev              # tsx watch src/index.ts — http://localhost:4000
npm run build            # tsc -p tsconfig.json
npm run db:push          # push schema.ts changes straight to Postgres (see below)
npm run db:generate      # generate a migration file from schema.ts (see below)
npm run db:studio        # Drizzle Studio GUI against the live DB
npm run sync:standings   # tsx src/sync/runSync.ts
npm run sync:news        # tsx src/sync/runNewsSync.ts
npm run economy:report   # tsx src/scripts/economy-report.ts — points/collectibles sanity check
npm run economy:simulate # tsx src/scripts/season-simulation.ts — Monte Carlo: can a season finish the album?
npm run collectibles:expand  # tsx src/scripts/expand-collectibles.ts — regenerate the card catalog
```

Frontend (`frontend/`):
```bash
npm start                # ng serve --proxy-config proxy.conf.json — http://localhost:4200
npm run build            # ng build
npm run watch            # ng build --watch --configuration development
```
`proxy.conf.json` forwards `/api` to `http://localhost:4000` — the frontend
always calls a relative `/api/...` (`core/api-config.ts`), never an absolute
backend URL, so the browser only ever talks to one origin whether that's the
local dev proxy, an ngrok tunnel, or the Railway deploy (see Deployment).

Python sync (`backend/src/sync-py/`, separate venv):
```bash
python standings_sync.py 2025 38     # season, round
python player_stats_sync.py 2025
python games_sync.py                 # check the script for args
python boxscore_sync.py
```
All sync scripts (Python and the two Node ones) upsert, so re-running them
to refresh data is always safe.

## Schema changes — no migrations are checked in

`backend/drizzle/` (generated migration SQL) is intentionally **not**
committed — the workflow is `db:push` (diff `schema.ts` against the live DB
and apply directly), not generate-then-migrate. `drizzle.config.ts` has
`strict: true`, so `db:push` always prompts for confirmation even for
purely additive changes — it can't be scripted through non-interactively.
If you need to apply a schema change without an interactive terminal
(e.g. from an automated session), write the equivalent SQL by hand against
`DATABASE_URL` instead of fighting the prompt.

## Backend architecture

- Routes live in `backend/src/routes/*.ts`, one file per resource, mounted
  in `backend/src/index.ts` under `/api/<resource>`. Add new routers there.
- `backend/src/auth/middleware.ts`: `requireAuth` reads the JWT off
  `Authorization: Bearer`; `requireAdmin` must run *after* `requireAuth` and
  checks `users.isAdmin` in the DB on every call (not cached in the token).
- `backend/src/db/schema.ts` is the single source of truth for the data
  model; `backend/src/db/client.ts` wires up `drizzle-orm/postgres-js`.
- **Predictions points/badges are computed on read, never stored as a
  balance.** `backend/src/routes/predictions.ts` recomputes
  `sum(per-pick points) + sum(point_adjustments)` and badge eligibility on
  every request from `predictions` + `games` + `point_adjustments` (+
  `game_odds`, see below). This mirrors how `isCorrect` was already
  computed lazily (via `computeWinnerTeamId`) before points/badges existed.
  If you change a scoring rule, every read reflects it immediately — no
  backfill job needed. `point_adjustments` is an admin-only manual
  grant/deduction ledger (`POST /predictions/points/adjust`, gated by
  `requireAdmin`); there is no bootstrap flow for the first admin — flip
  `users.is_admin` by hand in the DB.
- **Odds-weighted prediction points** (2026-08-31, redesigned same day from
  a symmetric-penalty curve to a floor-not-penalty one; replaced again
  2026-09-01 with a single direct-odds-multiple formula — see below). Every
  correct pick is worth `POINTS_PER_CORRECT` (10) times the picked team's
  own fair odds — "pay roughly what the market itself would," not a curve
  built around an arbitrary boost constant. `fairProb` is the picked team's
  de-vigged implied win probability (`services/points.ts`'s
  `pointsForCorrectPick`):
  `min(40, max(10, round(10 / fairProb)))` — i.e. `POINTS_PER_CORRECT ×
  fairOdds` (`fairOdds = 1 / fairProb`), floored at the flat rate (fair
  odds are always ≥ 1.0, so this floor only ever bites on a rounding
  fluke) and capped at 40. **There is no favorite/underdog branch at
  all** — a heavy favorite's fair odds sit close to 1.0 so it scores close
  to the flat rate, a real underdog's fair odds are much higher so it
  scores much more, and the one formula covers both continuously with no
  jump anywhere.

  This is the third shape this formula has taken, each change driven by a
  concrete problem with the previous one:
  1. **Symmetric-penalty curve** (original): scaled the favorite side
     *down* (toward ~1pt for a heavy favorite) on the assumption that
     being symmetric around `fairProb = 0.5` would keep the *average*
     payout roughly unchanged. Wrong in practice — people correctly pick
     favorites far more often than they correctly pick underdogs (that's
     what makes them favorites), so most real correct picks landed on the
     low end of that range, dragging the realistic average payout well
     below 10 and making the whole points economy (badges, pack costs)
     harder to earn into than before odds-weighting existed — caught from
     real usage, not simulation.
  2. **Floor-not-penalty, linear underdog boost** (`10 × (1 + 1.5 ×
     (0.5 − fairProb) / 0.5)`, favorites flat at 10, capped ~24pts): fixed
     (1) by flooring every correct pick at the original flat rate — odds
     only ever added upside for a correctly-called upset, never downside
     for a safe one. But real numbers made clear the boost curve
     compressed real underdogs too much (a ~39%-implied pick netted only
     ~13, not the ~25 a direct multiply gives) — an arbitrary boost
     constant, not the market's own price.
  3. **Direct odds multiple, current**: replaces the boost curve with
     `POINTS_PER_CORRECT × fairOdds` outright. Keeping favorites floored at
     flat 10 while steepening only the underdog side to match would need a
     hard jump right at the coin-flip line (a 51% favorite scoring 10
     while a 49% underdog on the same game scores 20) — a real cliff
     rewarding picking whichever side is marked ever-so-slightly the
     underdog. Dropping the favorite floor removes that cliff, at the cost
     of favorites no longer being exactly flat: a correct pick on a 55%
     favorite now scores ~18, not 10. Since most correct picks land on
     favorites, this raises the *average* payout per correct pick more
     than either previous version did. `scripts/season-simulation.ts`
     still only models flat `POINTS_PER_CORRECT` per correct pick, never
     any odds bonus (at any of the three formula versions above) — there's
     no simulated number confirming this against pack-cost/badge-threshold
     pacing yet. Re-run it (after first teaching it to model the odds
     bonus) if real-world points start completing the album noticeably
     faster than the documented ~140-155 median day. `ODDS_POINTS_CAP = 40`
     keeps a real long-shot from scaling unbounded (uncapped, a
     5%-implied underdog would net 200pts).

  A game with no `game_odds` row
  (API not configured, quota exhausted, outside the sync window) resolves
  at exactly the flat rate via the same formula (`coalesce(fairProb, 1)`
  in the SQL version, since `fairOdds` at `fairProb = 1` is exactly 1.0) —
  odds data is a bonus signal, never a scoring dependency. `game_odds`
  (schema.ts) is captured once per game by
  `sync/oddsSync.ts` (`npm run sync:odds`, production `setInterval` in
  `index.ts`, no-ops entirely without `ODDS_API_KEY` — see Environment
  variables below) from **The Odds API** (a plain REST/JSON API, no SDK
  needed) and is *never updated after insert* — that single insert is the
  "fixed snapshot before tipoff" this was deliberately built around, so two
  users who pick the same team score identically regardless of when they
  picked or how the line moved afterward, and the sync job never re-spends
  API quota re-fetching a game it already captured. `sync/oddsTeamMap.ts`
  matches the odds API's team-name strings (unconfirmed exact format —
  normalization + substring matching, plus a manual override map for
  anything that doesn't match automatically) against this app's own
  `teams` table; `oddsSync.ts` logs any odds-API team name it couldn't
  match at all, which is the signal to extend that map. The formula is
  reused as SQL (`services/points.ts`'s `pointsSqlExpr`) inside
  `getUserPoints`/`services/leaderboard.ts`'s `getLeaderboardEntries` (both
  score many predictions per call via one grouped query, not a per-row JS
  loop — same "fewer round trips" reasoning as elsewhere in this app) and
  in plain JS inside `/predictions/me/summary`'s badge-eligibility
  calculation, which already loops resolved picks row-by-row. The
  Predictions page's "Upcoming games" list and its "potential points"
  preview (`predictions.ts`) read `homeFairProb`/`awayFairProb` off
  `GET /games/schedule` (nullable — only present once a game has a
  `game_odds` row) to show real per-pick point values before a pick
  resolves, not just after.
- **Predictions are submitted in one batch, not one request per tap**
  (2026-08-26). Tapping a team on the Predictions page's "Upcoming games"
  card only updates local component state (`pendingPicks` in
  `predictions.ts`, layered over the last-saved `myPicks` via
  `effectivePicks`) — no network call fires until the user taps "Complete
  predictions", which sends the whole diff to `POST /predictions/batch` in
  one request. `POST /predictions` and `DELETE /predictions/:gameId` (the
  original single-pick endpoints) still exist and still work, just unused
  by this page now — a round of ~10 picks used to mean up to 10 sequential
  round trips against the remote DB. `POST /batch` accepts
  `{ gameId, teamId }[]` (`teamId: null` clears that pick), validates each
  pick independently (a stale game doesn't fail the rest of the batch,
  returned per-gameId in an `errors` map), and writes via one multi-row
  `onConflictDoUpdate` insert (`excluded.predicted_winner_team_id` for the
  per-row update value) plus one `DELETE ... WHERE game_id IN (...)` for
  clears — never one write per pick. A malformed (non-UUID) id is rejected
  for the whole batch before any DB query runs, since Postgres's `IN`
  clause throws for the *entire* query on one bad UUID, not just that row.
- **`/me/summary`'s reward-check functions are tuned for round-trip count,
  not query complexity** (2026-08-26) — measured directly against the live
  dev backend: this endpoint took ~1.5-1.7s steady-state (nothing new to
  grant) vs ~0.4-0.5s for `/predictions/me` and ~0.7s for
  `/predictions/leaderboard`, because `checkAndGrantRoundRewards` and
  `checkAndGrantLegendaryMilestones` (`services/cards.ts`) fired several
  sequential round trips each even when nothing new happened (this driver
  doesn't give real `Promise.all` concurrency against Neon — see the
  round-trip-cost note in the collectibles-economy section above).
  `checkAndGrantRoundRewards` originally fetched *every game ever played
  across every season* plus every past claim into Node just to diff them
  there — worse, a naive "complete round with no claim yet" single-query
  rewrite (tried first) still matched every round a user never even
  played, since nothing ever grants for those, so they'd resurface as
  "pending" and get reprocessed on *every single call, forever*, once
  enough seasons/rounds pile up historically. The fix folds the
  `>= GREAT_ROUND_THRESHOLD` correctness check itself into the query's own
  `HAVING` clause, so Postgres only ever returns rounds that actually
  qualify (typically zero) — down to 1 round trip from 2-3, verified at
  ~1.0-1.15s after both this and the equivalent `checkAndGrantLegendaryMilestones`
  fix (combining its two scalar queries into one, same lever as
  `getUserPoints`). `predictions.me`'s own list query is now also
  `.limit(40)` — unbounded before, only ever grows across a season.
- Two independent data-ingestion paths, not one because of an accident:
  `backend/src/sync/` (TypeScript, `tsx`) for standings and news, vs
  `backend/src/sync-py/` (Python + `euroleague-api`) for games/boxscores/
  player stats — the Python path exists because `euroleague-api` is the only
  tested wrapper around EuroLeague's feed for that data.
- **Collectibles economy** (`collectibles`, `userCollectibles`,
  `wheelSpins`, `roundRewards`, `packOpenings`/`packOpeningResults`,
  `ownedPacks`, `tradeOffers`/`tradeOfferItems` in `schema.ts`; routes in
  `collectibles.ts`, `spin.ts`, `packs.ts`, `trades.ts`). Ownership is
  always just a row in `userCollectibles` — there's no separate "balance"
  table for cards, same spirit as points. Three ways to earn a card: the
  daily Jump Ball wheel, points-priced packs, or a perfect prediction round
  (`services/cards.ts`). Points-priced packs (`packs.ts`, `services/packs.ts`)
  come in three purchasable tiers (starter/pro/elite, tiered odds, writes
  batched into two multi-row inserts rather than one per rolled card — that
  was a real latency problem against the remote DB) plus three
  wheel-exclusive, free ones (`wheelStarter`/`wheelPro`/`wheelLegendary`,
  `purchasable: false` — `GET /packs` and `POST /packs/:type/open` both
  exclude them, so the only way to acquire one is through a spin).
  **Every pack (purchasable or wheel) has 5 slots, not 3** (2026-08-25 "album
  completable in a season" pass — see below); wheelStarter/wheelPro used to
  mirror the real starter/pro packs' odds exactly, but that stopped being
  true in this pass: a free pack has no worst-case-EV ceiling to protect the
  way a purchased one does, and the wheel is the dominant card-supply source
  by volume, so wheelStarter/wheelPro now give **guaranteed rares** on their
  extra slots instead of just better odds at one — only wheelLegendary is
  still single-slot, since it's a guaranteed legendary rather than a normal
  pack roll. Purchased packs still open immediately; a wheel win does
  not — `POST /api/spin` (one free roll/24h, admin-only `POST /spin/cheat`
  bypasses the cooldown for testing) picks a pack tier with `SPIN_ODDS`
  (63/23/14 common/rare/legendary — bumped from 65/25/10 in the same pass,
  see the reasoning in `spin.ts`) and inserts an **unopened** row into
  `ownedPacks` (`userId`, `packType`, `openedAt` null) rather than rolling a
  card on the spot. The Packs page's "My Packs" section (`GET /packs/owned`,
  grouped by type client-side) lists those and opens one on demand via
  `POST /packs/owned/:id/open` — same claim-first idempotency pattern as
  `roundRewards`/`referralRewardGranted` (conditional
  `UPDATE ... WHERE opened_at IS NULL`) so a double-click can't open the
  same pack twice. Both that route and the purchase route share
  `rollPackForUser()` (`services/packs.ts`) for the actual roll — so a wheel
  win, once opened, can land on a common/rare already owned. **Legendary is
  different: every legendary roll (any pack, any source) is forced onto a
  card the user doesn't already own** (`forceNewLegendary` in
  `rollPackForUser`) until all 22 are collected, matching what the wheel
  always claimed but a prior refactor had silently stopped guaranteeing.
  Common/rare duplicates are **auto-sold at roll time** (`sellValueFor` in
  `packs.ts`, `sellValue = pointsCost * 0.5`, written straight into
  `packOpeningResults.soldForPoints` and credited via `pointAdjustments` in
  the same transaction as the roll) rather than left for the player to
  manually cash in — there used to be a `POST /packs/results/:id/sell`
  endpoint for that, but a duplicate nobody got around to selling just
  forfeited its value with no way to reclaim it later (nothing outside the
  reveal screen ever surfaced an unsold one again). That endpoint is gone;
  `PackOpenResultCard.sellValue` is now purely informational ("sold for X
  pts"), never a pending action. **Legendary duplicates are excluded from
  this and never sell** (`sellValueFor` returns `null` for that tier) — the
  catalog's legendary `pointsCost` runs up to 10,000 as a display-only
  "collector value" (legendaries were never purchasable), and 50% of that
  was a real infinite-money exploit once a legendary duplicate became
  reachable at all; a duplicate legendary is just a keepsake now.
  Registration grants a 150-point welcome bonus (`auth.ts`'s
  `WELCOME_BONUS_POINTS`, bumped from 100 alongside starter's own 100->150
  repricing so it still equals exactly one Regular Season Pack) — badge
  eligibility (`predictions.ts`'s "Century") deliberately excludes
  `pointAdjustments` like this one, only counting prediction-earned points,
  so a badge can't be bought or gifted. Trades (`trades.ts`) are an opt-in
  marketplace, many-for-one offers, scoped to cards both sides actually own.
  **Listing wishlists + cosmetic foil finish (2026-08-28)**: the
  marketplace has no pricing — every legendary is equally rare by design
  (`forceNewLegendary`), so when the same card has several listings from
  different owners, picking one used to be a genuine coin-flip and an offer
  was a blind guess at what the owner would accept. Two additive changes,
  neither touching trade eligibility or the accept/decline flow: (1) each
  listing can now carry an optional `wishlist` (`userCollectibles.wishlist`,
  jsonb array of other legendary collectible ids) set by its owner via
  `POST /trades/my-cards/:collectibleId/wishlist` and shown to browsers in
  `GET /trades/marketplace` — purely informational, `POST /trades` still
  accepts any combination of the offerer's legendaries, this is never
  enforced server-side; (2) a legendary rolled for the first time (never a
  duplicate — see `forceNewLegendary`) has a 12% (`FOIL_CHANCE` in
  `services/packs.ts`) chance of landing a cosmetic-only `foil` finish
  (`userCollectibles.finish`, "standard" | "foil"), rendered as a rainbow
  holo sweep instead of the tier's normal gold one
  (`collectible-card.css`'s `holo-sweep--prismatic`) plus a small marker on
  the tier badge. Finish carries zero gameplay weight — same album credit,
  same `forceNewLegendary` guarantee, same trade eligibility as standard —
  it exists so two listings of the same legendary aren't perfectly
  interchangeable, and it transfers with the card on a completed trade
  (unlike `tradeable`/`wishlist`, which reset to false/`[]` for the new
  owner, since it describes the physical print rather than a listing
  preference). Tiered/graded legendaries (a CS:GO-skin-style wear scale)
  were considered and deliberately dropped: the whole economy — pity, pack
  slots, wheel odds, `season-simulation.ts` — is calibrated around exactly
  22 legendary catalog entries, and multiplying that into several wear
  tiers per card would force re-deriving all of it rather than being a
  small addition. The Wheel page's admin-only cheat tools (`wheel.html`,
  gated on `currentUser.isAdmin`) got a second button alongside the
  existing "cheat jump ball" one: **cheat foil legendary**
  (`POST /spin/cheat-foil`) grants the same unopened `wheelLegendary` pack
  as the plain cheat, but with `ownedPacks.forceFoil` set — without it, the
  granted pack would still only have the normal 12% `FOIL_CHANCE` on open,
  making a "verify the foil visual" button an unreliable coin flip.
  `rollPackForUser` takes an optional `{ forceFoil }` (services/packs.ts),
  read from the opened row in `routes/packs.ts`'s `POST /owned/:id/open`;
  every real grant path leaves it at its `false` default.
  **"Album completable in a season" pass (2026-08-25)**: the album
  (`frontend/src/app/features/album/`) is the full 208-common/208-rare/
  22-legendary catalog. Simulating the real pity mechanics found the old
  3-slot packs + 65/25/10 wheel odds never finished it — rares were the
  bottleneck by a wide margin. Fixed by going 3->5 slots on every pack (see
  the per-pack cost/odds comments in `services/packs.ts`), making
  wheelStarter/wheelPro rare-heavy as above, and nudging wheel odds to
  63/23/14 once legendary became the last bottleneck. `backend/src/scripts/
  season-simulation.ts` (`npm run economy:simulate`) is a standalone,
  no-DB Monte Carlo simulator kept in sync with these constants specifically
  to re-check this — re-run it after any future odds/cost change instead of
  reasoning about pity/duplicate math by hand. Current numbers: at 100%
  daily wheel engagement, ~95-99% of simulated seasons fully complete the
  album regardless of prediction accuracy (50-80%), median around day
  140-155 of a ~210-day season; realistically-imperfect 85% engagement
  (missing roughly 1 day in 7) drops that to ~77-79%. **Daily wheel
  engagement, not prediction accuracy, is by far the dominant lever on
  whether a player finishes the album** — the wheel outweighs predicted-
  points purchases in sheer volume, so skipping it matters far more than a
  wrong pick does.
  **"Predictions matter more" pass (2026-08-26)**: raising
  `POINTS_PER_CORRECT` was tried first and tested up to 2.5x in
  `season-simulation.ts` — it barely moved either completion% or the
  accuracy-driven spread, because a season of purchased packs is
  structurally ~30-40x smaller in volume than the wheel's, and no
  reasonable points multiplier closes that without inflating points into
  something disproportionate to the rest of the economy (leaderboard,
  "Century" badge). Two small additive rewards were added instead, neither
  touching pack/wheel odds or costs: (1) a **"great round"** (>=8/10
  correct, short of literally perfect) now also grants an unopened
  **wheelPro** pack, alongside perfect round's existing unopened
  **wheelLegendary** pack — same `roundRewards` table/claim, see the branch
  in `checkAndGrantRoundRewards` (`services/cards.ts`); (2) a new
  **legendary milestone**: every `LEGENDARY_MILESTONE_INTERVAL` (60)
  cumulative correct predictions (career-wide, not per-round) grants
  another unopened wheelLegendary pack, via a new `legendary_milestones`
  table (mirrors `roundRewards`' claim-first/seenAt shape exactly, just
  keyed on an ever-increasing milestone number instead of
  `(season, round)`) and `checkAndGrantLegendaryMilestones`. Both are
  binomial/linear-in-accuracy by construction rather than flat, so they
  scale with skill much harder than a points multiplier could — e.g. a
  "great round" fires ~2x/season at 50% accuracy vs ~22x/season at 80%.
  Grants **an unopened pack, not a specific card directly** — same concept
  as a wheel win (this was a follow-up same-day tweak: cards were granted
  directly at first, then unified with the wheel's "open it yourself from
  My Packs" flow so every non-purchase reward channel behaves the same
  way). `roundRewards`/`legendary_milestones` reference the granted pack via
  a new `ownedPackId` column (their old `collectibleId` column is unused by
  new grants, kept only for historical rows from before this tweak).
  Re-simulated at a realistic 85% daily wheel engagement (the scenario that
  used to cap completion at ~77-79% regardless of accuracy): full-album
  completion is now ~91-98% across the 50-75% accuracy range (up from
  ~77-79%), and completion *speed* now differs meaningfully by accuracy too
  (median day ~160 at 50% vs ~144 at 75%) — see `predictions.ts`'s
  `newRoundRewards`/`newMilestoneRewards` (each entry is now
  `{ id, packType, tier }`, not a card) and the tier-aware "Perfect round!"/
  "Great round!"/"Prediction milestone!" banners linking to `/packs` (not
  `/store`) on the Predictions page for the user-facing side.
- **Coach cards (2026-09-03)**: a second, deliberately distinct kind of
  collectible alongside the player common/rare/legendary catalog — one card
  per team's real head coach (`teams.head_coach`, synced by
  `roster_sync.py`), 20 today (every current-season team except AS Monaco,
  which has zero 2026-27 games and is excluded the same way `GET /api/teams`
  already excludes it). `collectibles.tier` is a free-text `varchar` with no
  DB check constraint, so this needed zero migration — just a `"coach"`
  addition to the `Tier`/`CollectibleTier` union everywhere it's declared
  (`services/packs.ts`, `routes/collectibles.ts`'s `TIERS`, frontend
  `core/models.ts`), which the compiler then uses to flag every tier-keyed
  map missing a "coach" arm.
  - **Catalog**: `backend/src/scripts/expand-coach-collectibles.ts`
    (idempotent, mirrors `expand-collectibles.ts`'s matched-by-normalized-
    name-and-team pattern). Deliberately scopes to teams with an actual game
    in `getCurrentSeason()` rather than trusting `teams.head_coach IS NOT
    NULL` alone — `roster_sync.py` only ever *updates* that column for a
    team the feed still recognizes, never clears it for one that drops out,
    so a stale coach from a team no longer in the competition would
    otherwise get its own phantom card (caught directly: the first run of
    this script generated one for Monaco off a coach it hasn't had since
    2025-26). No player-record link (coaches aren't in `players`), no
    photo (`imageUrl: null` — falls back to the same jersey-silhouette icon
    a photo-less player collectible already uses), `pointsCost: 5000` as a
    display-only "collector value" (same idea as legendary's up-to-10000 —
    never actually charged or paid, see below).
  - **Acquisition — random pulls only, forced-unique like legendary**: no
    direct Store purchase (`DIRECT_BUY_PRICE` has no `coach` entry, same
    `NOT_PURCHASABLE` path legendary already takes) and no sell-back on a
    duplicate (`sellValueFor` excludes `coach` alongside `legendary` — same
    "collector-value pointsCost would be a real infinite-money exploit"
    reasoning). `rollPackForUser`'s `forceNewCoach` mirrors
    `forceNewLegendary` exactly: always lands on a coach the user doesn't
    own yet until all 20 are collected, no pity-streak tracking needed
    (`isPityTier` stays `common | rare` only). Two pull sources: the Elite
    pack's 5th slot picked up a `coach: 0.05` share (taken out of `rare`'s
    0.94, `legendary`'s 0.06 left untouched — see why below), and a new
    wheel-exclusive `wheelCoach` pack (single guaranteed-coach slot, exact
    structural mirror of `wheelLegendary`) joins `SPIN_ODDS` at 8%.
  - **Odds tuning — legendary's share was NOT touched, on purpose**: the
    first attempt at `SPIN_ODDS` shaved legendary 14%→11% to make room for
    coach's 8% (63/23/14 → 60/21/11/8) — re-simulating (`economy:simulate`,
    extended to model a 4th forced-unique 20-card pool) showed a real
    regression: 85%-engagement full-album completion at 50-65% accuracy
    dropped from the documented ~91-98%/day~144-181 down to 57-70%, since
    legendary is the tightest existing bottleneck (per the 2026-08-25 pass)
    and *any* cut to it costs more than common/rare's already-comfortable
    100%-completion-well-before-season-end margin can. Fixed by leaving
    legendary at its exact original 14% (Elite pack's legendary slot share
    likewise unchanged at 6%) and taking coach's share out of common/rare
    instead: `SPIN_ODDS` landed at `common 58 / rare 20 / legendary 14 /
    coach 8`. Re-simulated result: 85%-engagement full-album completion is
    now 92-99% across 50-80% accuracy (day 136-163) — at or above the
    pre-coach baseline, not below it — while a season averages 14-16 of the
    20 coaches collected. Re-run `economy:simulate` after any future change
    to either odds table, same standing practice as every prior pass here.
  - **Visual identity — "jade," deliberately not a 4th rarity rung**: coach
    isn't rarer or less rare than a player card, it's a different kind of
    card, so `CollectibleCardComponent`'s `style` getter gives it its own
    frame/badge/holo-sweep in jade/emerald tones (`holoVariant: "jade"`,
    badge label "COACH") rather than reusing gold/silver at any position —
    same treatment mirrored in the pack art (`pack-visual-coach`, both
    `packs.css` and `wheel.css`) and the wheel/pack-opening win reveals
    (`.coach-label`, jade burst). Gets serial numbering too (`showSerial`
    extended to include `coach` — "3/20" suits a 20-card print run). Foil
    finish stays legendary-only, not extended to coach — its jade identity
    already is the flourish. The wheel's disc grew 8→12 wedges (30° each:
    7 common, 3 rare, 1 legendary, 1 coach) since 8 slices can't cleanly fit
    a 4th tier at anything close to its real odds share; `wedgeBoundaries`/
    `WEDGE_TIERS`/`spinToWedge` all scale off the wedge-count constant, nothing
    hardcodes 8 elsewhere. Admin-only `POST /spin/cheat-coach` (mirrors
    `/cheat`/`/cheat-foil` exactly) and a matching Wheel-page button exist
    solely so the jade reveal can be verified on demand instead of waiting
    on an 8%/5% real chance.
  - **Store & Inventory**: both already bundle cards by `name + teamId`
    (`routes/collectibles.ts`'s `/browse`, `inventory.ts`'s client-side
    `allBundles`) — a coach's name never matches a player's, so a coach card
    renders as its own singleton bundle with zero structural changes, just a
    new "Coach" tier filter chip in both.
  - **Left untouched, on purpose**: Album (`album.ts`'s `TIER_ORDER` is the
    explicit literal `["common","rare","legendary"]`) doesn't track coaches
    at all — completing the album still means the same 208+208+22 player
    catalog it always has. Showcase (`users.showcaseCollectibleIds`) isn't
    tier-gated to begin with, so a coach card became showcase-able the
    moment it existed, no code change needed. Trades (`routes/trades.ts`'s
    ~9 `tier === "legendary"` gates) stay legendary-only — coach cards
    aren't tradeable for now, a deliberately smaller first pass.
- **Reconsidering legendary/coach chances (2026-09-04)**: user report — 15
  Elite ("Final Four") pack opens (1200pts each, ~18,000pts of correct
  predictions) yielded 0 legendaries and 1 coach, and felt boring. CLAUDE.md
  had documented the daily wheel as the *intentional* dominant card-supply
  source (2026-08-25 pass) — the user pushed back on that premise directly:
  the wheel isn't this app's main concept and shouldn't be a prerequisite
  for a real shot at the exciting tiers. Re-ran `economy:simulate` with a
  new zero-wheel-engagement scenario to check the premise: a full season of
  nothing but Elite-pack buying (even at 80% accuracy) averaged only 8.8/22
  legendaries and **0.0/20 coaches** — coach had no non-wheel acquisition
  path at all beyond Elite's own thin per-slot chance. Three additive
  changes, all in the same pass:
  1. **Elite pack's big slot, 6%/5% -> 17%/13% legendary/coach**
     (`services/packs.ts`'s `PACKS.elite`, taken out of that slot's rare
     share, 70% -> down from 89%). Legendary/coach never sell for points
     even as a "duplicate" (`sellValueFor` returns null for both), so this
     only ever *lowers* the slot's points-worst-case EV, not raises it —
     no new purchase-exploit risk, unlike a common/rare odds change would
     be.
  2. **A new Elite-pack-specific pity counter**
     (`pityCounters.eliteBigSlotStreak`, `services/packs.ts`'s
     `ELITE_BIG_SLOT_PITY_THRESHOLD = 6`): 6 consecutive Elite opens whose
     big slot lands on rare forces the 7th onto legendary-or-coach
     (weighted by their relative share). Detected structurally — `isBigSlot()`
     checks a slot's odds for carrying *both* legendary and coach, not by
     pack type — so a future pack with a similarly-shaped slot inherits
     this for free. At the new 30% combined share, a real drought is now
     capped at 6 misses (≈11.8% chance of tripping it) instead of running
     indefinitely; the user's actual reported streak (a ~40% chance event
     at the old 6% legendary-only odds) drops to a ~5.9% chance at 17%,
     before pity even kicks in.
  3. **A new coach milestone track** (`coach_milestones` table, exact
     structural mirror of `legendary_milestones` — same claim-first
     `(userId, milestoneNumber)` mutex, same "grants an unopened pack, not
     a direct card" shape — `services/cards.ts`'s
     `checkAndGrantCoachMilestones`/`COACH_MILESTONE_INTERVAL = 45`, vs.
     legendary's 60): this is what actually fixed the "0.0 coaches all
     season" zero-wheel number, since it accrues from correct predictions
     alone, independent of pack-buying frequency. Frontend: `PackType`
     already had `wheelCoach`; `RewardPack`/`OwnedPackReward` widened to
     include it, a new `newCoachMilestoneRewards` array on
     `PredictionSummary` (parallel to `newMilestoneRewards`, own
     `POST /predictions/coach-milestone-rewards/ack`), and a "Coach
     milestone!" banner on the Predictions page next to the existing
     perfect-round/great-round/legendary-milestone ones.
  Re-simulated result (zero wheel engagement, 50-80% accuracy): coaches
  0.0/20 -> **3.8-6.1/20** (almost entirely from the new milestone track —
  Elite-pack coach hits alone stay rare at realistic, non-wheel-funded
  points income, since so few Elite packs get bought without the wheel's
  duplicate-sell income topping up the points supply). Legendary's own
  zero-wheel number barely moved (2.9-8.9/22, essentially unchanged) for
  the same reason — at low Elite-pack purchase *volume*, the odds bump
  on any single pack matters less than how many packs get opened at all;
  legendary's zero-wheel floor was already coming almost entirely from its
  pre-existing milestone (avg ~2.85-4.73/season, untouched by this pass),
  not from pack RNG. The odds+pity change is instead aimed squarely at the
  user's actual reported scenario — a heavy Elite-pack *purchaser* — where
  it meaningfully tightens the worst-case streak. No regression on the
  100%/85%-wheel-engagement scenarios: legendary still finishes at 22/22,
  and coach actually improved there too (18.8-19.6/20, up from the
  pre-pass 16.2-16.5 baseline) since the milestone stacks on top of
  wheel/pack sources rather than replacing them. Schema change applied
  directly against the live DB (`ALTER TABLE pity_counters ADD COLUMN
  elite_big_slot_streak`, `CREATE TABLE coach_milestones`) rather than
  through `db:push`, per the "no migrations checked in, write raw SQL by
  hand for an automated session" note under Schema changes above — both
  additions are backward-compatible with the pre-pass code (nullable/
  defaulted, never read by it), so applying them ahead of the code deploy
  was safe. Re-run `economy:simulate` (now including its own permanent
  zero-wheel-engagement scenario, not just the 100%/85%/cheapest-first
  ones) after any future odds/interval change.
- **Referrals** (`services/referrals.ts`, `users.referralCode`/
  `referredByUserId`/`referralRewardGranted` in `schema.ts`). Every user
  gets a unique code at registration (`createUniqueReferralCode`), shared as
  a link (`/register?ref=CODE`, shown on Profile). Registering with a valid
  code sets `referredByUserId`; an unrecognized code is silently ignored
  rather than rejecting the signup. The referrer's 400-point bonus
  (`checkAndGrantReferralReward`) only fires once the *referred* user has at
  least one resolved correct prediction — checked opportunistically
  alongside round rewards on every `/predictions/me/summary` call, same
  read-triggered pattern as everything else in this economy — and
  `referralRewardGranted` (claimed via a conditional UPDATE, same
  claim-first idempotency pattern as `roundRewards`) stops it from ever
  firing twice for the same referred user.
- **Leagues** (2026-08-31; `leagues`/`leagueMembers` in `schema.ts`,
  `services/leagues.ts`, `routes/leagues.ts`,
  `frontend/src/app/features/leagues/`). Private friend groups ranked by the
  same lifetime prediction points as the global leaderboard — no separate
  scoring concept. `services/leaderboard.ts`'s `getLeaderboardEntries` was
  extracted out of what used to be `predictions.ts`'s inline `/leaderboard`
  handler so both the global board (`limit: 20`, no `userIds`) and a
  league's scoped board (`userIds`: that league's member ids, no limit)
  share the same ranking/badge logic — the `userIds` filter is applied in
  JS to the same unfiltered totals query both callers already needed,
  rather than parameterizing an array into the raw `sql` template. Unlike
  the global board, a league's leaderboard still includes a member with
  zero resolved predictions (0 points, ranked last) — small known friend
  group, "everyone's here, nobody's scored yet" is worth showing rather
  than silently omitting them until their first pick resolves. Invite codes
  (`services/leagues.ts`'s `createUniqueLeagueCode`) reuse the exact same
  alphabet/length as `users.referralCode`; `POST /leagues/join` is
  idempotent (`onConflictDoNothing`) since a shared invite link can be
  opened by someone already in that league. No v1 delete/kick — only join
  and leave (`POST /leagues/:id/leave`); the creator is just the first
  `leagueMembers` row (`leagues.createdByUserId` is provenance only, not an
  ongoing owner role). **Showcase cards**
  (`users.showcaseCollectibleIds`, `PUT /users/me/showcase`, capped at 3,
  ownership-checked at write time) let a player pin a few owned cards to
  show next to their name on a league leaderboard — global to the user
  (not per-league) so the same picks show in every league they're in, set
  from a new section on the Profile page reusing Trades' exact `Set`-based
  toggle + `CollectibleCardComponent[selected]` pattern. Not pruned if a
  showcased card is later traded away; the league leaderboard route just
  silently drops any id it can't resolve to a still-existing collectible,
  same best-effort staleness as trades' `wishlist` column. Reached via a
  "My leagues →" link on the Predictions page's leaderboard card (not a new
  top-level nav item — the rail is already at its documented max), same
  visual convention as the existing `/predictions-analytics` link right
  next to it.
- **Fantasy Five** (2026-09-05; `player_fantasy_prices`/`fantasy_lineups` in
  `schema.ts`, `services/fantasyScoring.ts`, `routes/fantasy.ts`,
  `frontend/src/app/features/fantasy/`) — a season-long, budget-cap fantasy
  squad mode alongside predictions, built to compete with EuroLeague
  Fantasy's own core mechanic directly rather than just accumulating around
  it (predictions/collectibles don't touch "build a squad of real players
  under a cap" at all). A lineup is exactly `FANTASY_ROSTER_SIZE` (5)
  players plus one captain (2x that round's points), drafted under a
  `FANTASY_BUDGET_CAP` (100 credit) cap — no bench, no position-slot
  constraint (any 5 players fill any court slot; position is a browse
  filter only). `fantasy_lineups` rows are wholesale-replaced (delete +
  multi-row insert in one transaction, `POST /fantasy/lineup/batch`) rather
  than diffed like predictions, since a lineup is always exactly 5 fixed
  slots; editable until the round *locks* — the earliest `tipoffAt` among
  that round's games (`getRoundLockTime`), same "whole gameweek locks at
  the first game" rule real fantasy apps use, enforced at the route level
  like predictions' own before-tipoff window. Scoring
  (`getFantasyLeaderboardEntries`) sums each locked player's
  `playerGameStats.valuation` (PIR) for that round's *final* games, captain
  doubled — an unplayed game contributes 0 by construction (no
  `playerGameStats` row yet), so a still-open or bye round needs no
  special-casing, same on-read philosophy as `services/points.ts`. Global
  and league-scoped leaderboards share this one query exactly the way the
  points leaderboard already splits between global/`GET
  /leagues/:id/leaderboard` — `GET /leagues/:id/fantasy-leaderboard` is the
  fantasy twin, kept as a fully separate endpoint/response shape rather
  than folded into the points one so the two economies' numbers stay
  visibly distinct. No nav tab (the rail is already at its documented
  7-item max) — reached via a Dashboard card and a link next to
  Predictions' "My leagues →", same precedent Leagues itself set.
  - **Draft pricing — recent-form + season-baseline blend, not a flat
    season average** (`services/fantasyScoring.ts`'s `computeFantasyPrice`,
    run by the manual `npm run fantasy:reprice` script, same cadence as
    other sync/economy scripts, not a cron): v1 priced a player off nothing
    but season-long average PIR, a single number that can't react to a hot
    or cold streak and won't move until the next manual reprice. Now blends
    **recent form** (average PIR over the last `RECENT_FORM_WINDOW` (8)
    *final* games, once at least `MIN_RECENT_GAMES` (3) exist — below that,
    too noisy a sample, falls back to the season baseline alone) with the
    **season baseline** (`playerSeasonStats.valuation`, blended in at
    `1 - RECENT_FORM_WEIGHT` (0.65 recent / 0.35 season) once recent form is
    trusted, purely to stop one huge/tiny recent game swinging a price too
    hard). Deliberately no separate minutes multiplier on top of PIR (PIR
    is already a box-score sum, so more minutes already raises it — a
    second multiplier would double-count that signal); `LOW_MINUTES_DAMPEN`
    (0.7) only exists to catch the one thing raw PIR can't tell apart from
    a real role player — a low-minutes garbage-time rate — triggered only
    when average minutes fall below `LOW_MINUTES_THRESHOLD` (12). All of
    these constants are unvalidated against real data as of this pass — the
    2026-27 season has zero played games so far, so there's no actual
    recent-form signal yet to tune weights against. Revisit once a few
    rounds are in the books, same "re-check against real numbers" spirit as
    every points-formula revision in this file's sibling section above.
    (Superseded the same day by the season-baseline fallback and, on
    2026-09-06, by the PIR-to-credit scale — see the next two bullets.)
  - **Season-baseline fallback, so day-one prices aren't all identical**
    (same day, later pass): with zero played 2026-27 games, every player's
    blended PIR resolved to null and every price floored at
    `FANTASY_MIN_PRICE` — real, but boring to draft against on day one.
    `scripts/reprice-fantasy-players.ts`'s query now coalesces onto each
    player's own most recent *prior* season with a `player_season_stats`
    row (Postgres `DISTINCT ON`, same idiom used elsewhere in this app for
    "latest row per group") whenever the current season has none yet — real
    last-season performance instead of a flat floor, self-correcting to
    current-season form the moment real games start. A brand-new
    player/team with no history at all still correctly floors — there's
    nothing to fall back to. `computeCoachPrice` mirrors the same fallback
    off `team_season_stats.position`.
  - **PIR-to-credit scale, calibrated to a real sourced reference point**
    (2026-09-06): every version of the formula up to this point used
    blended PIR *as* the credit price directly (rounded, clamped to
    `[FANTASY_MIN_PRICE, FANTASY_MAX_PRICE]`) — not an actual scale, just a
    coincidence that PIR values loosely resemble a plausible credit range.
    Caught directly: with `FANTASY_MAX_PRICE` at 25, Vezenkov (the league's
    real top performer, ~22 PIR last season) priced at 22cr, while real
    EuroLeague Fantasy currently prices Vezenkov at 17cr — a concrete,
    sourced reference point the user provided, not a guess. Rather than
    re-derive a ceiling from scratch, `FANTASY_MAX_PRICE` dropped to 17 and
    a new `FANTASY_PIR_CEILING` (22, calibrated to that same real Vezenkov
    PIR) anchors a linear rescale: `FANTASY_MIN_PRICE + (raw / 
    FANTASY_PIR_CEILING) * (FANTASY_MAX_PRICE - FANTASY_MIN_PRICE)`,
    rounded and clamped, replacing the old direct `Math.round(raw)`. A
    player performing at Vezenkov's level now lands at exactly the credit
    price EuroLeague Fantasy itself lists for him; everyone else scales
    proportionally against that same anchor rather than being clamped
    independently. This also adds real differentiation at the low end,
    which the old 1:1 mapping never had — two bench players at PIR 1 and
    PIR 4 both used to floor at an identical `FANTASY_MIN_PRICE`; now they
    land at visibly different (still low) prices. Applied immediately by
    re-running `npm run fantasy:reprice` against the live DB.
  - **Court-based drag-and-drop roster builder** (`frontend/src/app/shared/
    court-background.ts` + `fantasy.ts`/`.html`): reuses the half-court SVG
    geometry `shot-chart.ts` already draws (same FIBA-approximate
    constants, just the bare court lines with no shot markers) as a
    decorative backdrop, with 5 real HTML drop targets (Angular CDK's
    `DragDropModule` — added as a new dependency, `@angular/cdk`, since
    this app's mobile-first and HTML5's native drag-and-drop API has no
    touch support at all, unlike CDK's) absolutely-positioned on top in a
    cosmetic starting-five formation. A tap still places/removes a player
    without dragging (CDK only intercepts an actual pointer-move past its
    threshold, so a stationary tap fires a normal click alongside it) — a
    deliberate fallback, not just a nicety, given real mobile friction found
    after the first version: a tall wrapping grid of draggable player cards
    meant a finger had to land on a `cdkDrag` element (which CDK sets
    `touch-action: none` on) to reach anything below the fold, blocking the
    browser's own touch-scroll entirely. Fixed by making the player pool a
    single horizontally-scrolling flex strip directly under the court
    instead of a tall grid — the whole builder now fits together without
    needing a page-level scroll to get from pool to court mid-drag. Also
    carries a position filter (Guard/Forward/Center — confirmed via a live
    query, only those 3 values exist in `players.position`) and a per-player
    "vs TEAM" opponent badge plus a "Fixtures" popup, both sourced from the
    existing `GET /games/schedule` for the current round with no backend
    changes needed.
  - **Side-by-side court + pool, formation picker (2026-09-05/06)**: the
    original builder stacked the court above a horizontally-scrolling pool
    strip — on a real phone, scrolling down far enough to reach the pool
    pushed the court off-screen entirely, making drag-and-drop onto a
    starter slot impossible rather than just awkward. `fantasy.html`'s
    roster section is now a permanent two-column row (`flex-[3]`
    court+bench / `flex-[2]` pool, both screen sizes, not just desktop) —
    the pool is its own `overflow-y-auto` list stretched to the left
    column's height (flex's `items-stretch` default), so it scrolls
    independently and both stay visible together regardless of viewport.
    The pool also infinite-scrolls (`onPoolScroll`, same pattern as the
    league-wide advanced-stats table) instead of a "show more" button, and
    each row again shows position + next opponent (e.g. "G · @PAO") and a
    boxed credit chip. Sort defaults to credits descending (`sortKey`
    signal default flipped from `valuation` to `price`) with a direction
    arrow, and the sort controls sit right above the pool instead of a
    disconnected row near the page bottom. Position filters are `G`/`F`/`C`/
    `All` buttons — kept in English for both locales by explicit request
    (`fantasy.posGuard`/`posGuardAbbrev` etc. now have identical `en`/`el`
    values), unlike the rest of this page's translated text.
    A **formation picker** (`fantasy.ts`'s `Formation` type, `FORMATION_POSITIONS`)
    adds a real tactical layer: 5 choices (`2-2-1`/`2-1-2`/`3-1-1`/`1-2-2`/
    `1-3-1`, all summing to 5) picked via a single button that opens a
    dialog (reusing the same modal-overlay pattern as the fixtures/
    leaderboard-entry popups already in this file), not always-visible
    buttons — a deliberate compactness call once a 3-choice row grew to 5.
    Each of the 5 starter slots (`squadSlots()[0..4]`, always starters — see
    `initialSquadSlots`) is tagged with a required position for the chosen
    formation; `slotAcceptsPlayer()` gates both drag-drop (`onDrop`) and
    tap-to-place (`toggle`) against it. This is **purely a frontend
    affordance** — `routes/fantasy.ts`'s `POST /lineup/batch` only ever
    validated the *overall* 4G/4F/2C squad quota across all 10 outfield
    players, never a per-slot position, so adding this never touched the
    submit contract. Changing formation (`setFormation`) re-seats or
    benches whichever starter no longer fits their slot's new requirement
    (never touching a locked player — their round's already started),
    clearing the captain armband if it was theirs. A reload also re-derives
    the right formation from whatever's actually saved
    (`reconcileStarterFormation`, matches the loaded starters' real
    position mix against each formation's G/F/C split) instead of always
    defaulting to `2-2-1` regardless of reality — a mix that matches none
    of the 5 (e.g. a lineup saved before this feature existed) is left
    alone. The court background itself (`shared/court-background.ts`) was
    also visibly too dark against the roster page's near-black surface —
    line strokes were `stroke-line` (near-invisible on a `bg-page`-adjacent
    background) at low opacity; switched to `stroke-muted` at 0.85 opacity
    and slightly thicker strokes, plus a warmer, more opaque court-surface
    gradient (`from-highlight/25 via-card to-card`, was `from-highlight/10
    to-transparent`) so the court reads as an actual surface rather than a
    near-black rectangle with barely-visible lines.
  - **Simulator test games were quietly poisoning real prices** (caught
    2026-09-05, same day): the very first `fantasy:reprice` run priced
    everyone near the floor for a suspicious reason — 3 of the 2026-27
    season's games were marked `status: 'final'` despite a `tipoffAt` of
    2026-09-24 (still in the future), with fabricated box scores
    (`realtime/liveScoreSimulator.ts`'s doing — it fast-forwards a real
    scheduled game through scheduled→live→final for demo/testing, since
    there's nothing real to poll yet). The pricing query has no way to
    tell a real final game from a simulator-fabricated one, so it picked up
    those 3 games' unrealistically low fabricated PIR (avg ~2.4, max 9) as
    real recent form. Backed up (`scripts/backup-db.ts`) then reverted:
    those 3 games back to `scheduled` with scores/quarter/clock nulled, and
    their fabricated `player_game_stats` rows deleted. The 2 real
    predictions already made against them were deliberately left
    untouched — once the game's status is back to `scheduled`, they're
    just normal unresolved picks against the real future game again, no
    cleanup needed there; and since points/pricing are computed on-read
    from `games`' current state rather than a stored balance, reverting the
    game alone was enough to undo any inflated points too. Round 1 wasn't
    otherwise affected (`round_rewards` had zero 2026-27 rows already,
    since 7 of round 1's 10 games were still genuinely scheduled). No
    change needed to `services/fantasyScoring.ts` itself — this was purely
    a data problem, not a formula bug — but it's worth knowing the pricing
    script has no defense against this happening again if the simulator
    gets triggered against a not-yet-real-final game and nobody resets it
    afterward.
  - **Real-rules rebuild (2026-09-05, same day)**: user feedback — "check
    euroleague fantasy rules" — led to fetching EuroLeague Fantasy's own
    published Classic Mode rules and rebuilding the squad shape to match
    exactly, replacing the original 5-player/no-coach design:
    - **Squad**: 10 outfield players (4 Guards + 4 Forwards + 2 Centers,
      `FANTASY_POSITION_QUOTA` in `services/fantasyScoring.ts`, enforced at
      write time in `POST /fantasy/lineup/batch`, not in the DB) + 1 head
      coach, still under one `FANTASY_BUDGET_CAP` (100). Of the 10: 5
      "starters" + 1 "sixth man" score 100% of a locked round's points, the
      remaining 4 "bench" score `BENCH_SCORE_MULTIPLIER` (50%) — a new
      `slotRole` column on `fantasy_lineups` (`"starter" | "sixth_man" |
      "bench"`) drives this, read straight into
      `getFantasyLeaderboardEntries`'s SQL rather than a second table.
    - **Coach**: a new `coach_fantasy_prices` (teamId+season, mirrors
      `player_fantasy_prices`) and `fantasy_coach_picks` (one row per user
      per round — a coach is a single pick, not five) table. No coach-
      specific stat is synced anywhere (coaches aren't in `players`), so
      `computeCoachPrice` prices off real standings position instead
      (`team_season_stats.position`, linearly interpolated 4-16 credits
      across however many teams are playing this season, same prior-season
      fallback pattern as player pricing) — confirmed while building this
      that `team_season_stats` already had 20 real 2026-27 rows synced
      (unlike `player_season_stats`, still empty), so coach pricing
      differentiates immediately (Anadolu Efes's coach at 16, Zalgiris's at
      4) without needing the fallback at all yet.
      **This "confirmation" was wrong — caught 2026-09-06, see the
      "Reconsidering coach pricing" bullet further down** — those 20 rows
      existed but every team had 0 wins/0 losses (no 2026-27 game played
      yet), so `position` 1-20 was just the arbitrary order the feed lists
      an unstarted season's teams in, not a real ranking; "differentiates
      immediately" was true but meaningless — Anadolu Efes at 16 and Real
      Madrid at 5.9 was the bug, not evidence the fallback wasn't needed.
      Coach scoring is
      real-world-result-based, not stat-based — `COACH_WIN_POINTS` (20) for
      their team winning that round's game, `COACH_LOSS_POINTS` (0)
      otherwise, always 100% (never bench-reduced, there's only one).
    - **`FANTASY_MIN_PRICE` dropped 8 → 4** per direct user instruction
      (an explicit "should be minimum 4 cr", not sourced from the official
      rules fetch — nothing in what was fetched specified an exact
      min/max price).
    - **Per-player mid-round substitution ("Turns")**: real rules split a
      round into "Turns" (the block of games on one match-day) and allow a
      bench↔starter swap only for a player who "has not yet taken the
      field" that round — this is *not* the same as the whole round's
      overall lock. Modeled without a literal turns table: a new
      `getTeamRoundGameTipoff(season, round, teamId)` resolves a specific
      player's own team's tipoff within the round (not the round's
      earliest tipoff across every game), and `POST /fantasy/lineup/batch`
      diffs the submitted 10-player squad against what's currently saved —
      only a player whose presence or `slotRole` actually *changed* has
      their own team's tipoff checked against now(); an unchanged player
      passes through regardless of their own lock status, since nothing
      about them is being touched. This is why the batch endpoint went
      back to a diff (like predictions) rather than the original wholesale
      delete+insert — a full replace can't tell "this player's role didn't
      change" from "this player was silently re-locked in place," which
      matters once different players can lock at different times within
      the same round. The coach pick, by contrast, still uses the
      original single overall-round lock (`getRoundLockTime`) — real rules
      don't give the coach a per-turn window of its own.
    - **Reverted to a whole-round lock (2026-09-07)**, by explicit request:
      "since a game is live no changes can be made at all... disable
      everything" — the per-player "Turns" model above was working exactly
      as designed (a player whose own team hadn't tipped off yet stayed
      editable even mid-round), but that was no longer the wanted behavior.
      `POST /fantasy/lineup/batch` now checks `getRoundLockTime` once, up
      front, and rejects the *entire* submission — every player, the
      formation-driven `slotRole` mix, the captain, the coach — once the
      round's first game has tipped off, superseding the coach-only
      `roundLockAt` check mentioned above. `getTeamRoundGameTipoff` and the
      per-player `changedIds`/diff-against-the-old-squad logic it powered
      are gone entirely — provably dead once the blanket check exists
      (a player's own team tipoff can never be earlier than the round's
      overall first tipoff, so nothing could ever have reached the
      per-player check without the blanket one already having fired first)
      — which also dropped the batch endpoint's own round-trip count (no
      more fetching the old squad/coach pick just to diff against it, no
      more one `getTeamRoundGameTipoff` query per changed player). Went
      back to a plain wholesale delete+insert rather than the diff-based
      write the Turns model had required. `GET /fantasy/lineup`'s
      per-player `locked` flag is untouched and still means what it always
      did ("has this specific player's own game tipped off") — it's
      display-only now (e.g. the squad-slot PIR-instead-of-opponent
      swap), never an edit gate. Frontend mirrors this with one
      `roundLocked` computed (`coachLocked()` OR "any of this round's
      fixtures is no longer `scheduled`") folded into the existing
      `isPlayerLocked` check everywhere it already gated an edit
      (remove/swap/drag/captain), plus new guards on the formation,
      captain, and coach pickers and the pool's add button/drag — all of
      it, not just the players whose own games are actually live.
    - **Frontend**: the court still shows only the 5 starters (position-
      accurate slot dots are still purely cosmetic, not tied to G/F/C — a
      player's *real* position only matters for the quota count, not which
      dot they sit on); a "Sixth Man" single slot and a 4-wide "Bench" row
      were added directly below the court, sharing the exact same
      `cdkDropList`/`cdkDrag` slot template (factored via
      `ng-template`/`ngTemplateOutlet` to avoid tripling the markup) so
      dragging between starter/sixth-man/bench/pool all go through one
      `onDrop` handler keyed by slot id. A locked player shows a small lock
      badge and has `cdkDragDisabled` set, rather than being removed from
      view — real rules let you *see* your locked-in picks for the round,
      just not touch them. The coach picker is a separate, non-draggable
      single-select strip (only ~20 choices) rather than another drop
      list. A live Guard/Forward/Center count against the 4/4/2 quota sits
      in the status bar so a user sees why submit is blocked before hitting
      a server-side rejection.
  - **Mobile-clarity pass (2026-09-06)**: user feedback — "everything feels
    so packed" on mobile — plus a tap-target ambiguity: the pool row's
    single `(click)="toggle(...)"` handler covered the whole card, so
    there was no way to see a player's recent form before drafting them,
    only add/remove. Went through two layout iterations before landing;
    both are worth keeping on record since each was wrong for a concrete,
    stated reason:
    1. **Stack the pool under the court on mobile — reverted same day.**
       First cut split the pool row's tap target (name/photo →
       `/players/:id`, price → add) and, on the theory that tapping price
       was now the primary add path, stacked the pool full-width under the
       court instead of keeping the original permanent side-by-side split.
       Wrong, pointed out directly: dragging a pool card onto the court is
       still a fully supported way to build a squad (`onDrop`), there's no
       way to drag while scrolling, and a pool below the court reintroduces
       the *exact* bug the side-by-side layout was originally built to fix
       (see the court+bench/pool comment history in `fantasy.html`) — reach
       the pool by scrolling and the court is off-screen, so nothing can be
       dropped onto it. Tapping being the *primary* add path doesn't make
       dragging a *removed* one.
    2. **Popup-based picker, replacing drag reliance on mobile entirely —
       the actual landing design.** Rather than fight the "pool must be
       visible to drag onto the court" constraint, side-stepped it: below
       `sm:`, the persistent pool column is hidden outright, and tapping an
       *empty* court/bench/sixth-man slot opens a full-screen "Choose a
       player" popup instead (`openPicker`/`pickerSlot`/
       `pickerRequiredPosition`/`pickPlayerForSlot` in `fantasy.ts`) with
       the same search/team/position/sort filters and infinite-scroll list
       the sm:+ pool column already had — a starter slot pins
       `positionFilter` to its own required position for the picker's
       duration instead of showing the position chips, since no other
       position could ever be dropped there anyway
       (`slotAcceptsPlayer`). This removes the mobile crowding without
       reintroducing bug #1: there's no drag at all in the mobile flow, so
       there's nothing that needs the court and the pool on screen at the
       same time. Dragging *between* two squad slots (e.g. bench → starter)
       still works on mobile too, since both ends of that drag are always
       on the court/bench, never the hidden pool. `sm:` and up is
       untouched — pool beside the court, drag-and-drop, and the
       tap-price-to-add path (`addToSquad`, priority: starters matching the
       active formation, then sixth man, then bench) all still work exactly
       as before.
    **Player info, on both breakpoints**: tapping a player's name/photo —
    in the pool, the picker popup, or already placed on the court/bench —
    opens an info popup (`openPlayerInfo`/`infoGameLog`) showing their last
    5 games' PIR and opponent, rather than navigating to `/players/:id`.
    Deliberately never leaves the page: reuses the exact same
    `GET /players/:id/games` the real player-detail page already calls
    (`player-detail.ts`), just trimmed to the first 5 rows client-side (the
    endpoint has no `limit` param, returns a whole season most-recent-
    first) — no new backend endpoint. A placed player's photo used to
    remove them on tap; that moved to a small "×" badge (bottom-left
    corner, opposite the captain "C" badge) via the new `removeFromSquad()`
    so info and removal are two separate, unambiguous affordances.
    **Decimal pricing**: `player_fantasy_prices.price`/
    `coach_fantasy_prices.price` were `integer` — `computeFantasyPrice`/
    `computeCoachPrice` (`services/fantasyScoring.ts`) rounded to a whole
    credit, which collapsed several adjacent players/teams onto the same
    price with no way to tell them apart. Both columns are now `real`
    (altered directly against the live DB per the Schema changes section's
    "no interactive `db:push`" workflow, then `npm run fantasy:reprice`
    re-run to backfill real decimal values) and both formulas round to the
    nearest 0.1 credit instead of the nearest whole one. `routes/fantasy.ts`'s
    budget-cap check now rounds the summed cost to 1 decimal before
    comparing against `FANTASY_BUDGET_CAP` — summing several float prices
    can land a hair off the true total from binary float representation
    (e.g. `27.999999999999996`), which would otherwise wrongly reject a
    squad costing exactly the cap. Every price display in `fantasy.html`
    (pool row, picker row, coach picker, status-bar total) uses Angular's
    `number: '1.1-1'` pipe so a price always shows exactly one decimal
    place, even a whole one (e.g. "12.0" not "12"). The pool/picker price
    button also grew a bit (padding/font bumped, `min-w-[46px]` added) —
    both an explicit sizing ask and a practical need, since two-decimal
    widths like "12.3" no longer fit the original cramped chip.
    **Nav reach**: Fantasy Five had no path into the mobile bottom bar's
    "More" overflow at all (only a Dashboard card and the Predictions
    "My leagues →" neighbor) — added as a `ball`-icon entry appended
    directly onto `app.component.ts`'s `MORE_LINKS` (not through
    `NAV_LINKS`/`MOBILE_OVERFLOW_PATHS` like Schedule/Teams/Standings,
    since it isn't one of the desktop rail's seven at all — this keeps the
    desktop rail unchanged while giving mobile a one-tap path).
    **Copy**: `fantasy.homeAbbrev`/`awayAbbrev` were literal `"vs"`/`"@"`
    in English already but translated Greek words (`"με"`/`"εκτός με"`) in
    `el` — inconsistent with the same file's `posGuard`/`posGuardAbbrev`
    precedent of keeping court shorthand identical across locales, and the
    likely source of the "playing out vs / in vs" wording the user
    described. Both are now the literal `"vs"`/`"@"` symbols in both
    locales.
- **Reconsidering coach pricing — the 2026-09-05 "confirmation" was wrong**
  (2026-09-06): user report — coach prices "way off" (Anadolu Efes's coach
  priced highest at 16cr, Real Madrid's near the bottom at 5.9cr). Root
  cause: `computeCoachPrice` (`services/fantasyScoring.ts`) prices off
  `team_season_stats.position`, and the doc note added when this was built
  (see the Coach bullet above) had confirmed 2026-27 already had 20 real
  rows there and stopped — it never checked whether the *position value
  itself* meant anything yet. It didn't: every 2026-27 row has 0 wins/0
  losses (confirmed directly — no game has been played), so `position`
  1-20 was just whatever placeholder order `Standings.get_standings()`
  returns for a season with nothing to rank, captured verbatim by
  `standings_sync.py` the moment it saw a row for each team. The
  prior-season fallback (`scripts/reprice-fantasy-players.ts`'s
  `repriceCoaches`) already existed for exactly this situation but only
  triggered when the current season had **no row at all**
  (`tss.position is null`) — a row with a meaningless position still
  counted as "has real data" and blocked the fallback. Fixed by gating the
  fallback on `tss.wins + tss.losses > 0` instead of row-existence — a
  team's current-season position is only trusted once they've actually
  played a game; until then every team falls back to last season's real
  final standings, same as a genuinely-missing row already did. Re-ran
  `npm run fantasy:reprice`: 19 of 20 coaches now fall back (Besiktas,
  freshly promoted with no prior EuroLeague season on file, correctly
  floors at `COACH_MIN_PRICE` instead — nothing to fall back to), and the
  resulting order matches reality (Olympiacos, Valencia, Real Madrid,
  Fenerbahce, Zalgiris, Panathinaikos, Barcelona all top-priced off their
  real 2025-26 finishes). This class of bug — a row existing being treated
  as proof the data in it is meaningful — is worth watching for anywhere
  else this app fell back on "confirmed N rows exist" during this same
  transition without also checking *which* season the numbers in those
  rows actually describe.
- **Court/coach visual pass (2026-09-06)**: user feedback after the mobile-
  clarity pass — the picker/info popups should animate open and closed
  instead of snapping, coaches should follow the same popup pattern as
  players, court/bench/sixth-man slots should be bigger, and the coach
  section should stop being a permanent block on the page.
  - **Popup open/close animation**: every popup (`infoPlayerId`,
    `pickerSlotId`, the new `coachPickerOpen`) now has a paired `*Visible`
    signal driving `opacity`/`scale`/`translate-y` Tailwind classes
    (`transition-all duration-200`, `motion-reduce:transition-none`
    respected). `showPopup()` (`fantasy.ts`) flips `*Visible` to `true` two
    `requestAnimationFrame`s after mount, since the element has to actually
    paint in its hidden state once before a CSS transition has anything to
    animate *from* — flipping it synchronously in the same tick that sets
    the id signal would just render already-visible with no animation.
    Closing is the mirror: flip `*Visible` to `false` immediately (playing
    the exit transition) but delay the actual unmount (`infoPlayerId.set(null)`
    etc.) by `POPUP_CLOSE_MS` (200, matched to the Tailwind `duration-200`
    class) via `setTimeout`, so the element stays mounted long enough for
    that transition to finish instead of vanishing mid-animation. Each
    open call clears any pending close timer first, so rapid reopen-while-
    closing can't unmount a popup that was just told to open again.
  - **Per-row reveal on filtering**: `fantasy.css` (new — `styleUrl` added
    to the component) has one keyframe, `fantasy-row-in` (fade + slight
    translateY, `motion-reduce` disables it), applied unconditionally to
    every row in the pool list, the slot-picker popup's list, and the new
    coach-picker popup's list. This needed no JS at all: Angular's `@for`
    (tracked by id) only creates a new DOM node for a row genuinely new to
    the array — narrowing a filter so fewer rows match, or widening it so
    a previously-hidden one reappears, both insert a fresh node and the
    CSS animation plays automatically on insertion; sorting the same rows
    just moves existing nodes and doesn't replay it. Exactly "smooth on
    filtering" with no manual before/after diffing.
  - **Coach: block → slot + popup, same pattern as a player**: the
    always-visible horizontal coach strip is gone. In its place, a third
    small card below the sixth-man/bench block (a "Coach" slot, same
    visual language as a squad slot — `app-team-badge` standing in for a
    player photo, no captain/lock badges since a coach isn't gated the
    same way) opens a new coach-picker popup (`openCoachPicker`/
    `pickCoach`) on tap — mirrors the slot-picker popup's animation and
    per-row reveal exactly. `pickCoach(teamId)` calls the existing
    `selectCoach` then immediately closes the popup, same "pick it and
    you're done" flow as `pickPlayerForSlot`. No search/sort was added to
    the coach popup (~20 teams, same reasoning the original strip never
    had filters either) — just the animated open/close and per-row reveal
    the player pattern also gets. This is also most of "gain some space":
    the coach strip cost real vertical space on every visit regardless of
    whether a coach was being changed; the slot costs only as much room as
    the sixth-man/bench card already used.
  - **Bigger slots, taller court**: starter avatars 36px → 48px, sixth-man
    32px → 42px, bench 28px → 38px (`fantasy.html`'s `ngTemplateOutletContext`
    `size` values — `squadSlot` itself didn't need to change, it already
    takes `size` as a parameter). The court's `aspect-ratio` widened from
    `320/210` to `320/280` to give the bigger avatars proportionally more
    room instead of crowding the same box; `starterSlotPositions()`'s
    percentage-based layout needed no code change since it already
    positions slots relative to the box's own height, not an absolute
    pixel value.
  - **Not yet verified in a live browser** — the Chrome extension wasn't
    connected in this session, so this pass was checked by rebuilding
    (`ng build`, clean) and a careful re-read of the template/component
    diff, not by actually opening `/fantasy` and watching the animations
    play. Worth a real visual pass (both breakpoints, both themes) next
    time the extension is available, especially the popup enter/exit
    timing and the coach slot's layout inside the sixth-man/bench card.
- **Quick save + tap-driven starter/bench swap (2026-09-06)**: user asked
  for a save button next to the formation picker, and for players to be
  movable between the starting five/sixth man and the bench (plus captain
  changes) between a round's game days — real EuroLeague Fantasy rounds
  split across "Turns" (day 1 / day 2 game blocks), and a player who
  hasn't played yet should stay editable even after others in the same
  round have. That per-player timing was already fully built
  (`getTeamRoundGameTipoff`/`isLocked`, documented under Fantasy Five's
  "Per-player mid-round substitution" bullet above) — dragging one squad
  slot onto another already worked within it. What was missing was a
  non-drag way to trigger the same thing, since the rest of this feature's
  mobile-clarity passes had already moved everything else off drag-as-
  primary.
  - **Save button**: a compact button next to the formation-picker button
    at the top of the court, calling the existing `submit()` (`fantasy.ts`)
    — same `canSubmit()`/`submitting()` state the bottom submit button
    already used, just reachable without scrolling.
  - **Swap popup**: every unlocked squad-slot avatar (court, sixth man,
    bench) now has a small "⇄" badge (top-left, opposite the captain "C")
    that opens a popup listing only the *other* side of the active/bench
    line — a starter or sixth-man swaps into bench candidates, a bench
    player swaps into starter/sixth-man candidates — filtered through the
    same `slotAcceptsPlayer` position gating `onDrop` already used, and
    excluding anyone `isLocked()` on either side, so this automatically
    respects the day-1/day-2 window with no new date logic
    (`swapPlayerId`/`swapCandidates`/`performSwap` in `fantasy.ts`). Same
    popup shell/animation/per-row-reveal as the slot-picker and coach
    popups.
  - **Real bug found and fixed while building this**: `onDrop` only ever
    cleared `captainId` when the captain left the squad *entirely*
    (`!slots.some(s => s.playerId === captainId)`), not when they merely
    moved from a starter slot to bench/sixth-man within it — dragging the
    captain onto the bench silently left `captainId` pointing at a player
    who no longer wore a starter slot at all, which `submit()` would then
    send as `isCaptain: true` on a bench entry. `performSwap` would have
    had the identical gap if built the same way. Fixed with a shared
    `releaseCaptainIfNotStarter(slots)` (captain must always be a
    starter), called from both `onDrop` and `performSwap` after any
    squad-slot mutation — this was a pre-existing bug in drag-and-drop,
    not something introduced by the new swap popup, just caught while
    reasoning through the same code path for it.
  - **Known gap, not fixed here**: `routes/fantasy.ts`'s `POST
    /lineup/batch` diffs `changedIds` off `slotRole` changes and
    add/remove only — a captain-only edit (same player, same `slotRole`,
    just `isCaptain` flipping) never lands in `changedIds`, so the
    backend's own per-player tipoff check never runs for a pure captain
    reassignment. The frontend already refuses to let this happen
    (`setCaptain` checks `isLocked`), so a normal user can't hit it, but a
    client bypassing the frontend could still crown an already-played
    starter captain after the fact. Worth closing given the "no
    migrations checked in" schema-change workflow doesn't block a
    route-only fix — flag `isCaptain` changes into `changedIds` too,
    the same way slotRole changes already are.
  - **Duplicate save button, caught and fixed same day**: the new top
    "Save" button and the pre-existing full-width "Lock in lineup" button
    at the bottom of the page both called the exact same `submit()` —
    asked about directly ("what is the lock team button below?"). Per the
    user's choice, the bottom one is gone (along with the now-dead
    `fantasy.submit` translation key); the top Save button is the only
    submit action now, made larger/more prominent (`text-sm`/`px-4 py-1.5`,
    up from a small `text-[11px]` chip) since it's carrying that job alone,
    with the `saved`/`submitError` feedback text moved to sit directly
    under it instead of under the removed bottom button.
- **Live round-game awareness (2026-09-06)**: user asked for three related
  things — a squad player's current PIR while their game is being played,
  visibility into when games are live, and a list of the round's games —
  plus, implicitly, that this needed no new backend work: `GET /games/:id`
  already computes its box score for `status === "live"` the same as
  `"final"` (see the live-scores section above), and `EventsService`
  already runs one shared SSE connection app-wide with a `lastGameUpdate`
  signal the nav badge and dashboard already consume. Fantasy Five just
  hadn't been wired into either yet.
  - `fantasy.ts`'s `liveUpdatesEffect` (a field-initializer `effect()`,
    valid since fields still run in the component's injection context)
    patches the relevant game's `status`/score/quarter/clock straight into
    `fixtureGames()` whenever `events.lastGameUpdate()` ticks for a game
    id that belongs to this round, and calls the new
    `refreshRoundBoxscore(gameId)` (a plain `GET /games/:id` via the
    existing `api.getGame`) whenever that game is live or just went final.
    `loadFixtures()` also fires that same refresh once at load time for
    any game that was *already* live/final before the page opened — the
    SSE stream only ticks on the next change, it doesn't replay past ones.
    `roundPirByPlayerId` (merged from both sides' box score lines) is the
    single source `roundPir(playerId)` reads from everywhere.
  - **Court/bench**: a placed player's slot swaps its "vs/@ opponent" line
    for their live/final PIR (`gameForTeam().get(row.team.id)`, `fantasy.html`)
    the moment their own game's status leaves `scheduled` — a small pulsing
    red dot only while `status === 'live'`, so a finished game shows the
    plain final PIR with no live indicator once it's over.
  - **Round-wide live indicator**: a pulsing "Live" pill next to the round
    number in the status bar, shown whenever `hasLiveGameThisRound()` —
    tapping it opens the same Fixtures popup as the existing button (no
    separate destination needed).
  - **Games list**: the existing Fixtures popup (previously just team
    badges + tipoff time, forward-looking only) now shows the real score
    once a game leaves `scheduled` and a Live/Final status tag instead of
    the tipoff time — satisfies "a list of the games played" by extending
    what was already there rather than building a second, separate list.
- **Court background: rim removed after a letterboxing bug and a failed
  recalibration (2026-09-06)**: user report — the Center starter slot
  visually sits on top of the rim graphic. Root cause: `court-background.ts`
  kept its original `viewBox="0 0 320 210"` when the caller's court
  container (`fantasy.html`) was widened to a taller `320/300` box for
  bigger slot avatars (see the court/coach visual pass above) —
  `preserveAspectRatio="meet"` doesn't stretch a mismatched viewBox to
  fill, it letterboxes, so the real court art kept rendering at its native
  210-tall proportions, centered, occupying only the middle ~70% of the
  now-taller container. `fantasy.ts`'s `ROW_TOP` percentages (Guard/
  Forward/Center) were computed assuming the court art fills the whole
  container, so once it visibly shrank to that centered band, Center's
  position (the largest top%) landed almost exactly on the rim's real
  on-screen spot. First fix attempt: extended the SVG's `viewBox` to
  `0 -90 320 300` (the extra 90 units added entirely above the 3-point
  line as more open half-court floor, not stretched into the basket/key/
  arc geometry) so the art fills the container edge-to-edge again, then
  recalibrated `ROW_TOP` to the corrected coordinates. Reported as still
  overlapping — this session has no live browser connected to verify exact
  pixel geometry, so rather than keep guessing at coordinates, removed the
  rim circle (and its now-unused `rimRadius` field) outright, keeping the
  backboard line, key, restricted area, and 3-point arc. No slot avatar can
  visually collide with a rim that isn't drawn, regardless of where
  positioning math lands it. The taller-viewBox fix (no letterboxing) is
  still in place and still correct on its own terms — worth revisiting
  whether the rim can come back once a live browser is available to check
  real rendered positions directly instead of computing them by hand.
  **Round 2, same day**: reported still overlapping ("over the line of the
  rim") even with the rim circle gone — most likely the backboard line,
  which sat right where the rim used to be (basketY + 3) and was the one
  remaining basket-shaped element. Removed it too (and its now-unused
  `backboardY`/`backboardX1`/`backboardX2` fields) — nothing at the basket
  end remains except the key, restricted-area arc, and 3-point line, none
  of which sit anywhere near where a starter slot renders. Also added a
  translucent "glass floor" gradient (`glassFloorGradient` +
  `glassSheenGradient`, a diagonal cool-blue-to-navy gradient plus a
  soft diagonal white sheen streak, painted as a rounded-rect bottom layer
  before the court lines) per the user's own suggestion, so a slot avatar
  reads as "standing on a floor" wherever it lands rather than floating
  over a blank backdrop with a stray line under it — chosen over a literal
  wood-grain texture to match this app's existing gradient-heavy,
  non-skeuomorphic visual language (team-hero-sweep, the collectible
  cards' holo-sweep) rather than introduce the app's first photographic-
  style texture. Deliberately fixed cool-blue tones rather than
  `--color-page`/`--color-card`-reactive, same reasoning as the `highlight`
  accent staying fixed across themes: a glass floor's icy identity
  shouldn't shift with light/dark mode.
- **Round-to-round carry-forward, transfers, a round navigator, and a
  completion reveal (2026-09-07)** — until now a squad started every round
  from an empty court, drafted fresh each time; asked to make it "stay the
  same" round to round with only a small number of changes allowed, plus a
  way to review past rounds' results. Landed as one connected pass:
  - **Carry-forward + transfer limit**
    (`services/fantasyScoring.ts`'s `getBaselineSquad`,
    `FANTASY_TRANSFERS_PER_ROUND = 3`): `GET /fantasy/lineup` now seeds a
    never-touched round from the immediately previous round's saved squad
    the first time anyone reads it — but only the season's actual current
    round (`getDefaultRound`), never a future one reached early via the
    navigator below — and persists that copy immediately (same "lazy write
    on read" precedent as round rewards/referral grants elsewhere in this
    app), so it's locked in for scoring even if the page is never opened
    again before the round locks. `POST /fantasy/lineup/batch` limits how
    many *players* may differ from that same baseline to 3; the coach is a
    separate, unlimited change, and moving an already-owned player between
    starter/sixth-man/bench costs nothing (only a genuine net swap against
    the baseline counts, computed fresh each save — not tallied
    incrementally — so re-saving the same still-unlocked round as many
    times as you like never resets or drifts the budget). Round 1 (no
    round before it) and any round whose predecessor has no saved squad
    either both stay a free, unlimited draft, same as always. The frontend
    mirrors the same check locally (`localTransfersUsed`/`canUseTransfer`)
    off a `baselinePlayerIds` set the endpoint now returns, so the pool can
    pre-emptively disable a new (non-baseline) pick before a save
    round-trip — same pattern `canAddPosition`'s quota gating already used.
  - **Round navigator + read-only history**: `round` (whichever round is
    being viewed) and `defaultRound` (the season's actual current one) are
    now two separate signals — a new prev/next pair in the status bar
    clamps between 1 and `defaultRound`. `isCurrentRound` folds into
    `roundLocked` (see the whole-round-lock bullet above), so browsing to
    any past round automatically reuses every existing edit guard to make
    it read-only — no separate "view mode" flag needed. The
    formation/captain/save action row is hidden entirely for a past round
    (replaced with plain, non-interactive formation/captain badges) rather
    than just disabled, since nothing there applies to a locked, already-
    scored history view.
  - **Per-round points/PIR review**: `GET /fantasy/lineup` now also
    computes that round's own scoring server-side — each player's raw
    `valuation` and captain/bench-weighted `points`, `totalPoints`,
    `totalPir` (the raw, unweighted sum — "PIR total", a genuinely new
    number, distinct from the weighted score the leaderboard already
    showed), `coachPoints`, and `roundComplete` (every one of the round's
    games final, both EuroLeague match-days, not just the first). Computed
    directly in the route rather than by calling
    `getFantasyLeaderboardEntries` (which would need a whole extra grouped
    query just to get one user's one-round total) since the per-player
    breakdown this endpoint needs anyway already requires fetching the
    same `player_game_stats` rows. Shown in the status bar for whichever
    round is being viewed, current or past.
  - **Live-ish refresh via a light re-fetch, not client-side re-derivation**:
    rather than duplicating this scoring math in the frontend against
    `roundPirByPlayerId` (the live per-player map `liveUpdatesEffect`
    already keeps current for other reasons — see the whole-round-lock
    bullet), `liveUpdatesEffect` now also calls a new `refreshRoundSummary`
    whenever a game in the *currently-viewed* round goes final: a plain
    `GET /fantasy/lineup` re-fetch that only updates the read-only scoring
    signals, deliberately never touching `squadSlots`/`captainId`/
    `coachTeamId`, so it can't clobber an in-progress, unsaved edit the way
    reloading the whole lineup mid-session would.
  - **Completion reveal**: a celebratory modal (`showRoundComplete`,
    `fantasy.css`'s `fantasy-round-complete-in` overshoot-then-settle
    scale/opacity keyframe, matching this app's existing hand-rolled-CSS-
    only animation convention — no library) fires the first time a round
    is seen to be complete, tracked per-round in a session-local
    `celebratedRounds` set so re-visiting an already-celebrated round via
    the navigator doesn't replay it.
  - **Bigger slots, again**: starter/sixth-man/bench avatars bumped once
    more (46/40/36 mobile, 56/50/44 desktop → 50/44/40 mobile, 62/54/48
    desktop) — a further, explicit "make the slots even bigger" ask, on
    top of some of the row-crowding headroom the 2026-09-07 mobile-size-
    down pass earlier the same day was written to protect.
  - Reset round 1's games back to `scheduled` (fabricated box scores
    cleared) after this pass landed, specifically so the new completion
    reveal could be watched fire live rather than only reasoned about from
    a cold reload — the previously-saved round-1 fantasy squad itself was
    left untouched, only the games.
- **Career stats on the collectible card flip** (2026-09-05;
  `scripts/backfill-career-stats.ts`, `GET /api/collectibles/:id/stats`'s
  new `career` field, `features/store/card-preview.ts`'s season/career
  toggle) — the existing tap-to-flip stats view (`CollectibleStatsResponse`)
  only ever showed the current season; user asked for real historical
  averages too. Confirmed directly against the live feed
  (`api-live.euroleague.net/v3/competitions/E/statistics/players/...`, the
  same public REST endpoint `sync-py/player_stats_sync.py` wraps) that
  per-game data exists back to season 2000 (2000-01) — 1999 and earlier
  404 cleanly, so that's the real edge of "as far back as data goes," not
  an arbitrary cutoff — and that `player.code` stays stable for the same
  real person across seasons (checked directly: Vezenkov's code matches in
  both 2025 and 2020), which is what makes matching a historical row back
  to an existing `players` row safe.
  - **`backfill-career-stats.ts` is TypeScript, not Python**, unlike every
    other sync script — practical, not stylistic: this machine's committed
    `sync-py/venv` is a Windows venv (`Scripts/` not `bin/`) and doesn't run
    here at all, and euroleague-api itself additionally needs Python 3.10+
    (`str | None` syntax) while this machine's system `python3` is 3.9.
    Neither was worth fixing just for this one-off — the target endpoint
    turned out to need no auth and no SDK, just a plain `fetch`, confirmed
    by hand with curl first. (Installed Homebrew's `python@3.11` and a
    throwaway venv separately, just to verify the endpoint/column shapes
    directly against euroleague-api before committing to the raw-fetch
    approach — the real `sync-py/venv` on this machine is still broken for
    anyone who needs to run the Python sync scripts locally on macOS; worth
    fixing properly if that comes up again.)
  - **Deliberately never creates a new `players` row** — only enriches
    players *already* in the table (matched by `code`), unlike the regular
    per-season sync (which exists to discover the roster). A dry run first
    confirmed why this matters: of ~4,500 historical stat rows across 25
    seasons (2000-01 through 2024-25), only 831 matched an existing player —
    the rest are retired players this app's card economy has no reason to
    know about. Inserting `players` rows for them would have polluted
    roster-listing routes (which filter on `active`, a flag this script has
    no season-aware way to set correctly) for zero benefit.
  - **`player_season_stats` needed no schema change at all** — it was
    already `(playerId, season)`-keyed for exactly this reason (a player's
    stats differ every season); backfilling historical seasons is just
    more rows in the table the regular sync already writes to, so a long-
    career player like Sergio Llull now legitimately has 18 real seasons on
    file (2007-08 through 2025-26, missing only 2017-18 — a real injury
    gap, not a sync gap).
  - **Career averages are computed on read**, weighted by each season's
    `games_played` (a 3-game cameo shouldn't count the same as a full
    34-game season) — same "no stored aggregate, just a smarter query"
    philosophy as the rest of this app's economy. Percentage columns weight
    only over seasons where that specific column isn't null. Verified
    directly: Llull's career line (8.9 PPG, 483 games, 8.1 PIR across 18
    seasons) correctly reads very differently from his declining 2025-26
    season alone (3.1 PPG) — the two views are meant to tell different
    stories, not agree.
  - Frontend: the flip-card's stats view gained a "This season"/"Career"
    chip toggle (`ChipDirective`, only shown when a `career` line actually
    exists) — both share the same field names (`CareerStats` in models.ts
    deliberately mirrors `PlayerSeasonStats`' per-game fields), so
    `card-preview.ts`'s `activeStatLine()` computed lets the template read
    through one place regardless of which is selected, rather than
    branching on the toggle at every stat field.
- **DB round trips, not query count via `Promise.all`, are the real latency
  lever against Neon.** Measured directly (2026-08-21, local dev against
  the same remote Neon instance production uses): 4 near-identical queries
  fired via `Promise.all` took as long as 4 sequential `await`s — this
  driver/pool doesn't give genuine cross-query concurrency here, so
  wrapping independent queries in `Promise.all` (including across separate
  statements inside one `db.transaction()`) buys nothing and sometimes
  measured slightly worse. Each round trip costs a roughly fixed ~280ms+
  locally regardless. The only real lever found is fewer statements:
  `getUserPoints` (`services/points.ts`) and `rollPackForUser`
  (`services/packs.ts`) were each rewritten from 2 queries to 1 (a combined
  scalar-subquery `SELECT` and a `LEFT JOIN` respectively) for a real,
  verified reduction in `POST /packs/:type/open`'s round trips. This
  latency is likely dominated by network distance from a local dev machine
  to Neon — Railway's production deploy may see much lower per-round-trip
  cost if it's datacenter-close to Neon's region — so don't assume local
  timings translate directly to production before optimizing further.
- `helmet()` + `express-rate-limit` are on by default (`index.ts`).
  `app.set('trust proxy', 1)` is set right after the app is created — without
  it, express-rate-limit sees Railway's proxy-added `X-Forwarded-For` header
  arrive while Express trusts no proxy, and throws
  `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` (this used to just be a noisy console
  warning; a later express-rate-limit version escalated it to a hard
  failure that broke a deploy). `1` trusts exactly one hop, not `true` —
  trusting the whole chain would let a client spoof its own
  `X-Forwarded-For` and bypass IP-based rate limiting.
- **Live scores** run over Server-Sent Events, not WebSockets.
  `backend/src/realtime/hub.ts` is a generic in-memory SSE client registry
  (`broadcast()` to everyone, `sendToUser()` for a future per-user channel —
  not wired to anything yet, see the trade-updates gap below);
  `backend/src/routes/events.ts` exposes the public `GET /api/events`
  stream plus admin-gated `POST /events/simulate` / `.../simulate/stop`.
  EuroLeague's real feed has nothing to poll until the season starts, so
  `backend/src/realtime/liveScoreSimulator.ts` is a stand-in: it ticks a
  real `games` row through scheduled → live → final on a compressed ~96s
  timeline, fabricating a full per-player box score into `player_game_stats`
  alongside the score (upserted every tick, same table the real boxscore
  sync would fill) and flagging players on a scoring streak as "on fire"
  (`onFireIds` on the broadcast event). `routes/games.ts`'s box score
  computation runs for `status === "live"` as well as `"final"`, so the
  existing box score / top performers / double-double UI lights up during a
  live game with no separate code path. Swap-in later: point the
  simulator's tick source at the real feed (or a poller) once the season
  starts — the hub/route/frontend plumbing doesn't need to change.
- **Admin "reset game"/"reset round" (2026-09-08)** — a UI shortcut for
  undoing a live-score-simulator run, instead of hand-writing SQL for it
  every time (this was previously a genuine repeated friction point).
  `POST /api/games/:id/reset` and `POST /api/games/reset-round`
  (`routes/games.ts`, `requireAuth, requireAdmin`) both do the same thing —
  `status` back to `scheduled`, score/quarter/clock cleared, that game's
  `player_game_stats` deleted, and any `predictions`/`top_scorer_predictions`
  made against it deleted too (a prediction against a result that no longer
  exists shouldn't linger) — one game or every game in a round, in one
  `db.transaction()`. Deliberately narrower than the one-off
  `scripts/reset-2026-27-season-data.ts` this mirrors: never touches
  already-granted collectibles/points (`round_rewards`, `point_adjustments`,
  owned packs) — see that script's own "season data only, not a full
  economy wipe" scope note, which a routine admin button needs to respect
  even more strictly since it's reachable far more casually than a one-off
  script. Surfaced on the Schedule page (`features/schedule/`): a small ↺
  icon next to any non-`scheduled` game (admin-only, via the existing
  `auth.currentUser()?.isAdmin` gate this page already used for the
  simulate/complete-simulation buttons), plus a third admin button
  resetting the whole visible round. Both go through
  `shared/confirm-dialog.ts` first (same component/pattern as Leagues'
  "leave league" confirmation) since this deletes real prediction rows, not
  just cosmetic state. **Real bug caught while verifying this**: the single-
  game endpoint's `.returning()` gives back a raw `games` row with no
  `homeTeam`/`awayTeam` join, but the first version spliced that response
  straight into the Schedule page's `games` list — crashed the template
  (`Cannot read properties of undefined (reading 'code')` on
  `game.homeTeam.code`) and left the stale pre-reset row on screen even
  though the reset had actually succeeded server-side. Fixed by reloading
  the current round after a successful reset instead of trying to keep the
  list's joined shape in sync with a raw table row — same fix shape the
  round-reset path already used for the same reason.
- In production the backend also serves the built Angular app as static
  files with an SPA fallback (see Deployment below) — absent in local dev,
  where `ng serve` handles the frontend on its own port instead.

## Frontend architecture

- Routes are lazy-loaded standalone components (`frontend/src/app/app.routes.ts`).
  Desktop (`sm:` and up) gets an icon-only left rail; mobile gets an
  icon-only bottom tab bar — `app.component.ts` and `shared/nav-icon.ts`.
  No text labels sit on screen; the desktop rail surfaces them as a
  hover/focus tooltip instead. Nav icons render a soft duotone fill when
  active (`[active]` input on `app-nav-icon`) — that weight change is what
  signals the active tab now that there's no label color to lean on.
  Desktop and mobile intentionally show a **different set** of primary
  icons, not the same `NAV_LINKS` array rendered twice (2026-08-24
  redesign — mobile bottom-tab space was cramped at 6 icons, desktop's
  vertical rail isn't):
  - **Desktop rail** (`NAV_LINKS`): Home, News, Schedule, Picks, Fantasy
    Five, Cards, Teams, Standings — all eight, directly. Fantasy Five
    joined 2026-09-07 by explicit request; it used to be mobile/dashboard-
    only, deliberately left off the rail's then-documented 7-item max —
    that cap wasn't load-bearing enough to keep it off once someone
    actually asked for it on desktop.
  - **Mobile bottom bar** (`MOBILE_NAV_LINKS`): just Home, News, Picks,
    Cards — the four checked every session. A trailing **"More"** tab
    (always last, `dots-vertical` icon) toggles a popover (`moreOpen`
    signal, closes on outside-click/Escape/link-click) listing
    `MORE_LINKS` — Schedule, Teams, Standings, and Fantasy Five,
    destinations checked occasionally rather than constantly
    (`MOBILE_OVERFLOW_PATHS` is the single set both `MOBILE_NAV_LINKS` and
    `MORE_LINKS` derive from — add a path there, not to two places by
    hand). Add anything similarly "occasional" to that same set, not as a
    5th+ mobile tab. Fantasy joining the desktop rail didn't change this —
    `MOBILE_OVERFLOW_PATHS` keeps it in "More" on mobile specifically so
    the bottom bar stays at exactly four.
  - **Profile/Login live in the top bar only**, on both breakpoints — not
    as a nav tab. Desktop shows email+admin-badge+logout (`sm:` and up) or
    login+register; mobile gets a compact profile icon (logged in) or
    login-icon+register-button (logged out) in the same top bar.
  The nav tab labeled "Cards" points at `/inventory` (My Cards), which
  acts as its own hub — Store, Jump Ball (wheel), Packs, and Trades are
  reached as buttons from there, not as their own top-level nav items.
  Top-level nav pages (Home, News, Schedule, Picks, Cards) don't have an
  in-page "back to dashboard" link — the nav itself covers that;
  drill-down pages reached by clicking into something (a game, a player, a
  team roster, wheel/packs/trades/store from the Cards hub) still have a
  contextual back-link to their specific parent.
- **Analytics quartet** — `/stats`, `/compare`, `/teams`, `/standings`
  (all `features/`; all four are top-level nav on desktop, all four sit
  behind mobile's "More" tab — see the nav bullet above). None are gated
  behind login.
  - `/standings` (`StandingsComponent`) is the full-width, sortable
    version of the dashboard's cramped standings widget — same
    `GET /api/standings` (`StandingsRow[]`, 21 rows, already fetched by
    the dashboard, nothing new backend-side), just every column that
    widget has no room for: PPG/PAPG, offensive/defensive rating,
    rebound/assist %. Defaults to the backend's own rank order; clicking
    any other column sorts by it (descending first, except Losses which
    reads naturally ascending like Rank). Reached via a "full standings"
    link on the dashboard's Standings card and a button on the Teams hub.
  - `/stats` (`AdvancedStatsComponent`) is a sortable, filterable
    league-wide table over `GET /api/players/advanced-stats`
    (`backend/src/routes/players.ts`) — every column `playerSeasonStats`
    has, including the advanced ones (TS%, eFG%, rebound/assist/turnover
    rates, possessions/game, usage% — see below). Only ~200 rows for the
    whole league, so the backend returns the full table once and all
    search/team/min-games filtering and column-click sorting happens
    client-side rather than round-tripping per filter change. Reached via a
    "full stats table" link on the dashboard's Leaders card, the roster
    page, the game-detail top-performers card, and the player-detail
    advanced-stats card. `/analytics-builder` (`AnalyticsBuilderComponent`,
    behind login, up to 5 saved custom "views" comparing hand-picked
    players/columns) keeps its own copy of this same column list
    (`analytics-builder.ts`'s `COLUMNS` — see the comment there) rather than
    importing `/stats`'s, so any column added to one should be added to the
    other by hand.
  - **Usage% (2026-08-26)**: `playerSeasonStats.usagePercentage` is the one
    column in that table NOT synced verbatim from euroleague-api — its
    `advanced` player-stats endpoint has no usage field at all (confirmed by
    directly printing that endpoint's actual response columns). Computed
    instead by `sync_usage_percentage()` in
    `backend/src/sync-py/player_stats_sync.py`, run after the normal
    traditional/advanced upsert loop: the standard formula
    (`100 × (FGA + 0.44×FTA + TOV) × (teamMinutes/5) ÷ (minutes ×
    (teamFGA + 0.44×teamFTA + teamTOV))`) per game, averaged across the
    season, built from `player_game_stats`' raw per-game columns via one SQL
    query. `player_game_stats` has no per-game team column — only
    `players.team_id`, the player's *current* team — so team totals are
    built by grouping on that current team_id, restricted to rows where it
    actually matches one side of that specific game
    (`p.team_id IN (g.home_team_id, g.away_team_id)`); a traded player's old
    games with their old team fail that filter and are silently excluded
    from both their own average and their old teammates' team totals — same
    "current team only" simplification as the traded-player gap below, not
    a new one. Surfaced with no backend route changes needed, since
    `/advanced-stats` already selects the whole `playerSeasonStats` row.
  - **`boxscore_sync.py`'s `minutes` column was silently null for every row
    until 2026-08-26**: the feed's `Minutes` field comes back as `"MM:SS"`
    (or the literal string `"DNP"`), never a plain number — `safe_float()`
    on a string like `"33:21"` raises `ValueError`, which its own
    except-clause swallows into `None`. Went unnoticed because nothing read
    `player_game_stats.minutes` until the usage% calculation above needed
    it — box scores, top performers, and double-doubles never touch that
    column. Fixed with a dedicated `parse_minutes()` (splits on `:`,
    `"DNP"` → `None`) and a full re-sync of all 426 `final` games'
    box scores to backfill it.
  - `/compare` (`PlayerCompareComponent`) is an animated player
    head-to-head — two search-to-pick players (from the same
    `/advanced-stats` payload, no extra round trip), a "VS" hero with
    team-color gradients, and a curated 10-category divergent bar
    comparison (points/rebounds/assists/steals/blocks/turnovers/FG%/PIR/
    TS%/AST-TO) that animates via CSS width transitions whenever either
    player changes — same technique as the roster page's team-vs-league
    bars, no animation library. Supports `?a=<playerId>` (and `?b=`)
    query-param prefill, used by the player-detail page's "Compare" link
    so landing there only needs picking an opponent. Turnovers is the one
    category where *lower* wins — `higherIsBetter: false` on that
    `CompareCategory`, everything else defaults true.
  - `/teams` (`TeamsHubComponent`) is a directory of every team — a
    lightweight `GET /api/teams` (21 rows, no player data), searchable,
    each card linking to that team's existing `/teams/:id` roster page.
    Deliberately does **not** bulk-load every team's roster: a team's
    players only ever load on demand when you click into its card, via
    the roster page's own existing `GET /teams/:id/roster` call — nothing
    new needed backend-side for that. Also carries the top-of-page
    Compare/Advanced-Stats buttons (reusing `/compare` and `/stats`
    directly) so the three analytics destinations read as one hub. Team
    head-to-head is a deliberately *unbuilt* future addition to this same
    hub — thin to build today since standings/games only cover the
    2025-26 season (teams meet at most twice), revisit once multiple
    seasons exist.
- `frontend/src/app/core/`: `ApiService` (all HTTP calls), `AuthService`
  (holds `accessToken`/`currentUser` as signals, access token is
  memory-only — never localStorage — restored on boot via the httpOnly
  refresh cookie through `restoreSession()`), `auth.interceptor.ts`
  (attaches the bearer token to same-origin API requests only), `ThemeService`,
  `I18nService` (`core/i18n/`, one dictionary file per feature merged into
  `translations.ts`; `i18n.t('namespace.key')` in templates — this is a
  hand-rolled service, not ngx-translate or Angular's built-in i18n).
- Team "reskinning": `ThemeService.applyTeam()` sets `--accent-primary`/
  `--accent-secondary` CSS variables on `documentElement`, cached to
  `localStorage` so the right colors apply immediately on next boot
  (before the dashboard's own fetch resolves — see the bootstrap-race note
  below). An ambient radial-gradient glow on `body` (`styles.css`) also
  derives from those same variables. Tailwind's `page`/`card`/`line`/
  `muted`/`ink`/`highlight` colors (`frontend/tailwind.config.js`) are
  themselves backed by CSS variables (not fixed hex), which is what makes
  the dark/light toggle (`ThemeService.toggleColorScheme()`, stamps
  `data-theme` on `<html>`) repaint the whole app with zero template
  changes. Fonts, current as of 2026-09-09: **New Computer Modern Sans**
  (display AND sans/body, one family for both roles — 2 real weight
  files, Regular/Bold, wired with `100 500`/`600 900` ranges so
  font-medium/font-semibold land on the nearer one) and **Lulu Monospace**
  (mono/labels, single weight, `100 900` range) — both self-hosted, set
  up in `frontend/src/styles.css`, full `@font-face` blocks and swap
  history in the comment above `.font-display` there.
  **New Computer Modern Sans** (`frontend/src/assets/fonts/NewCMSans-*.otf`,
  ~650-670KB each — far larger than any pick before it) is the sans
  member of Antonis Tsolomitis's New Computer Modern family (Samos,
  Greece), a modern, hugely-extended descendant of Donald Knuth's
  original Computer Modern (the classic TeX/LaTeX font) — full Latin,
  Greek (monotonic AND polytonic — no other pick here has been checked
  against polytonic), Cyrillic, and math symbol coverage, 5000+ glyphs.
  Distributed via CTAN (the Comprehensive TeX Archive Network), about as
  authoritative a primary source as font licensing gets. Its own
  `License.txt` names an exception list of fonts under
  GPL3+FontException+DistributionException; the two files used here
  (`NewCMSans10-Regular`/`-Bold`) aren't on that list, so they fall under
  the package's default **GUST Font License (GFL)** instead — a real,
  established license (gust.org.pl), not an aggregator paraphrase.
  **Lulu Monospace** (`LuluMonospace-Regular.otf`) is by Stelios
  Ypsilantis — "free for personal & commercial use," verified against
  both the designer's Behance post and a co-designer's ipassas.com store
  listing (its narrow carve-outs — government/bank/political/police
  commercial use — don't apply here); the designer's own site no longer
  resolves, so the file came from a mirror (myfontlib.com) while the
  license was confirmed at the two primary sources above. Every
  self-hosted font's license is preserved verbatim as `*-LICENSE.txt`
  alongside it. One hardcoded font-family (not routed through the
  `font-mono` Tailwind class) in
  `frontend/src/app/features/packs/packs.css`'s `.pack-set-code` rule has
  needed updating by hand on every mono swap so far. Every self-hosted
  pick's Greek coverage was verified glyph-by-glyph against the real font
  binary, not trusted from a README or aggregator claim — this mattered
  in practice more than once: Hauora Sans's README overclaimed Greek
  support its published package didn't ship, LT Superior's GitHub repo
  had no license file in its plain tree (the real OFL.txt only existed
  inside its release zip), and CYN Gamer's own Fontesk listing didn't
  name its actual license at all (turned out to be CC BY 4.0, found on
  the designer's blog). `.font-display` carries a `font-weight: 700`
  baseline.
  **The short version of a very eventful single day**: Rajdhani/Barlow/
  JetBrains Mono (no Greek at all) → Syne/IBM Plex Sans → Play/Roboto
  Condensed → GFS Neohellenic/Noto Sans → Fervojo (self-hosted, rejected
  same day, "i dont like it") → Moderustic → LT Superior (self-hosted,
  retired Noto Sans, one family for both roles) → Swanston (self-hosted)
  → CYN Gamer (self-hosted) → Hellenica (self-hosted) → Vela Sans
  (self-hosted) → **New Computer Modern Sans** (self-hosted) for
  display/sans; mono went Rajdhani-trio → Fira Code → Iosevka Charon Mono
  → **Lulu Monospace** (self-hosted). The first two display swaps went
  through a side-by-side Artifact comparison; every swap after that was a
  named-font "just apply it" request — each self-hosted font's files were
  deleted outright the moment it was replaced, nothing legacy left behind
  at any point in this chain.
- Forms use Angular Reactive Forms (`ReactiveFormsModule` + `FormBuilder`),
  not template-driven/`ngModel` — follow that pattern for new forms.
- **Buttons**: `shared/button.directive.ts`'s `ButtonDirective` (`[appButton]`,
  standalone) is the shared button styling — "Court Line", picked over two
  other directions via a side-by-side design-canvas comparison. An attribute
  directive rather than a wrapping component, so the host stays a real
  `<button>`/`<a>` and `routerLink`/`type="submit"`/`[disabled]`/`(click)`
  all keep working unchanged; only the class list swaps in. Usage:
  `appButton` alone (bare attribute — binds `""`, which the directive
  treats as `"primary"`) or `appButton="outline"` / `appButton="secondary"`
  for the other two variants, plus optional `appButtonSize="sm"` (default
  `"md"`). Any other classes on the same element (`class="w-full"` etc.)
  merge fine with the directive's host-bound classes — Angular unions
  static class attributes with directive host bindings, doesn't clobber.
  Deliberately NOT migrated: selection/toggle controls (team pickers, the
  language switch, tier-filter pills, the wheel-disc tier legend, trades'
  "list for trade" toggle) since they're a different semantic (persistent
  selection state, not a one-shot action) with their own conditional-class
  pattern; destructive actions (trades' decline/cancel, which turn red on
  hover) since that hover-to-red safety signal isn't one of the three
  reviewed variants; plain text links (`text-highlight font-semibold`, no
  background); and one-off contexts like icon-only nav buttons and the
  card-preview modal's overlay controls (sit on a translucent image
  backdrop, not the page/card background the directive's colors assume).
- Known bootstrap race: `AppComponent.restoreSession()` and the dashboard's
  standings fetch fire independently on app load. If standings resolve
  first, the dashboard doesn't yet know `favoriteTeamId` yet for that
  render. It no longer falls back to the top-ranked team for guests (that
  was actively misleading — it looked like "your team"), but a logged-in
  user can still briefly see no team-hero before it resolves. Self-corrects
  on the next interaction; not yet fixed with a resolver/bootstrap
  reordering.

## Environment variables (backend `.env`)

Required: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
Optional (defaults shown): `PORT` (4000), `JWT_ACCESS_EXPIRES_IN` (15m),
`JWT_REFRESH_EXPIRES_IN` (30d), `EUROLEAGUE_API_BASE_URL`,
`EUROLEAGUE_COMPETITION_CODE`, `NODE_ENV` (gates the refresh cookie's
`secure` flag), `ODDS_API_KEY` (unset = odds-weighted scoring quietly
degrades to the flat rate everywhere, see the Leagues/predictions section
below), `ODDS_API_SPORT_KEY` (defaults to `basketball_euroleague` — only
inferred from web search, not confirmed against a live call; verify with
`GET https://api.the-odds-api.com/v4/sports/?apiKey=KEY` if odds sync
matches nothing).

## Deployment

Live on Railway as a single service (project + service both named
"euroleague-app"): https://clutchapp.up.railway.app. `DATABASE_URL` points
at the same Neon instance as local dev — there's no separate prod database.

- **Config-as-code**: `.railway/railway.ts` (Railway's TypeScript
  infra-as-code — `railway config plan` to preview changes, `railway config
  apply` to apply). Not `railway.json`/`nixpacks.toml` — Railway's default
  "Railpack" builder doesn't reliably read those in this monorepo (no root
  `package.json`) and silently hangs instead of erroring. The working setup
  pins an explicit Dockerfile builder.
- **`Dockerfile`** (repo root): multi-stage — builds the frontend, builds
  the backend, copies the frontend's `browser/` output into
  `backend/public/`, runs `node backend/dist/index.js`. Same-origin
  end-to-end (see the backend-architecture note on static-file serving) —
  deliberately not split into a separate frontend host (e.g. Firebase
  Hosting), to avoid cross-site refresh-cookie/CORS complications for what's
  a small personal-scale app.
- **Domain**: the Railway-generated `*.up.railway.app` name is a shared
  global namespace across all Railway users — renaming the *service* is
  destructive in `railway.ts` (shows as delete+recreate in `config plan`,
  drops env vars/history), but renaming just the *domain* is safe
  (`railway domain update <old> --domain <new>`, non-destructive).
  **TODO: custom domain** — user wants something cleaner than
  `clutchapp.up.railway.app` ("a more normal url"), explicitly deferred
  rather than done immediately. Options already considered: DuckDNS
  (`clutch.duckdns.org` — free, instant, no approval), is-a.dev
  (`clutch.is-a.dev` — free, nicer, but needs a GitHub PR + manual review),
  or a cheap real domain (~$1-15/yr via Namecheap/Porkbun/Cloudflare) for a
  fully clean look. Whichever is picked, wire it up with `railway domain
  <hostname>` on the `euroleague-app` service — Railway auto-provisions
  HTTPS once DNS is verified.
- **Redeploy**: currently manual (`railway up --service euroleague-app`)
  from a local checkout — not yet wired to auto-deploy on `git push`.
- The same Railway account has an unrelated older project ("valiant-passion" /
  service "dsg-backend") — don't confuse it with this one.

## Branding (2026-09-06)

- **Isometric 3-bar mark** replaces the old flat version everywhere: browser
  favicon (`frontend/src/favicon.svg` and `frontend/public/favicon.svg` — the
  latter wins the build (Angular copies the `public/**` glob after the
  explicit `src/favicon.svg` asset entry, confirmed directly against
  `dist/.../favicon.svg`), the PWA home-screen icon set
  (`frontend/public/icons/icon-*.png`, 8 sizes, rasterized from one 100x100
  SVG source via `sharp` at build time — not checked in as a generator
  script, just a one-off render since there's no icon-generation pipeline in
  this repo), the top-nav wordmark lockup (`app.component.html`, right next
  to the "Clutch" text — bumped from 17px to 22px so the extra dimension
  actually reads), and the splash-screen intro (`shared/splash.html`, each
  bar's 3 faces wrapped in its own `<g class="bar bar-N">` so `splash.css`'s
  existing per-bar `scaleY` rise-in animation still applies to the whole
  extruded shape as one rigid unit — `transform-box: fill-box` works the
  same on an SVG `<g>` as it did on the plain `<rect>` it replaced). Same
  silhouette/heights and the same three brand-orange shades as the original
  flat mark (a short/tall/medium triptych), just rendered as three
  isometric blocks (top face lit, front face mid-tone, implicit side shading
  via a third, darker polygon) instead of flat rounded rects — chosen from
  3 candidate directions sketched in an Artifact first (an isometric
  version, a version with a basketball rim/net worked into the tall bar's
  cap, and a glossy jewel-toned glass version) per this project's usual
  "propose visually, then implement" pattern for design work.
- **`src/favicon.svg` was a stale leftover from an even older logo** — an
  orange-ring-with-a-cutout "C" mark, never actually served (shadowed by
  `public/favicon.svg` at build time) and out of sync with every other
  brand surface, which all agreed on the flat bar mark before this pass.
  Updated to match rather than deleted, so both copies stay identical and
  the shadow can't reintroduce a mismatch if the asset order ever changes.

## Album leaderboard (2026-09-06)

- **Competitive layer added to the collectibles side of the app** — until
  now Predictions (points) and Fantasy Five both had global + league-scoped
  leaderboards; the Album (`features/album/`) had none at all, no way to
  see how your collection stacked up against anyone else's. Added the same
  global/league-scoped pair, following the exact precedent both existing
  economies already set:
  - `backend/src/services/albumLeaderboard.ts`'s `getAlbumLeaderboardEntries`
    ranks by `count(distinct collectible_id)` in `user_collectibles` per
    user against the one shared catalog-size total
    (`getCollectibleCatalogTotal`, exported separately since
    `routes/leagues.ts` needs it standalone to fill in zero-card members —
    see below). `GET /api/collectibles/leaderboard` (global, `limit: 20`)
    and `GET /api/leagues/:id/album-leaderboard` (league-scoped, no limit)
    share it exactly the way `getLeaderboardEntries`/
    `getFantasyLeaderboardEntries` already split between their own
    global/league routes — a `userIds` filter applied in JS to one
    unfiltered query, not parameterized into the SQL.
  - Same "everyone's here" league inclusion as the points/fantasy league
    boards: a member who owns zero collectibles has no row in
    `user_collectibles` at all and so is absent from
    `getAlbumLeaderboardEntries`'s own result — `routes/leagues.ts`'s
    `/:id/album-leaderboard` adds them back in itself (ranked last, 0/total),
    same pattern as its sibling `/:id/leaderboard`/`/:id/fantasy-leaderboard`
    routes, right down to resolving their showcase cards separately since
    they were never part of the ranked query result to begin with.
  - Frontend: rather than embed this in `league-detail.html` (which is
    where the *points* leaderboard's league view lives), it follows Fantasy
    Five's own precedent instead — a new "Leaderboard" tab on the Album
    page itself (`features/album/album.ts`, `tab` signal), with the same
    global/my-league `app-dropdown` toggle, ranked list, and showcase-card
    entry modal, copied near-verbatim from `fantasy.html`'s own leaderboard
    tab. Two different existing conventions for "where does a league-scoped
    board live" already coexisted in this app before this pass (points on
    League Detail, Fantasy on its own page) — Album followed Fantasy's
    since, like Fantasy, it's a single-focus feature page without an
    existing home on League Detail to slot into.

## Other known gaps

- A traded player's season-long stat averages (across both teams) are
  attributed entirely to their *current* team's roster page, not split per-team.
- `boxscore_sync.py` was re-run in full on 2026-08-26 (426 `final` games,
  7948 rows) as part of fixing the `minutes`-parsing bug documented above —
  treat any earlier "checked on <date>, covers N of M games" note as stale.
- Redeploys to Railway are manual, not triggered by `git push` (see
  Deployment above).
- **Fantasy price ceiling now re-anchors instead of staying pinned to the
  season-start anchor forever** (flagged 2026-09-09, fixed same day) —
  `FANTASY_MAX_PRICE` (17, `services/fantasyScoring.ts`) was hard-pinned to
  wherever Vezenkov's raw blended-PIR value happened to sit on day one
  (`FANTASY_PIR_CEILING`, the scaling denominator), so nobody could ever
  price above 17cr even once their real in-season form clearly overtook
  his. Fixed by pulling the pre-scale value out into its own
  `computeRawFantasyValue()`, renaming the old constant to
  `FANTASY_PIR_CEILING_FLOOR`, and making `computeFantasyPrice()` accept an
  optional `ceiling` (still defaults to the floor for a caller with no
  whole-pool context). `scripts/reprice-fantasy-players.ts` now computes
  every player's raw value up front each run, takes
  `Math.max(FANTASY_PIR_CEILING_FLOOR, ...that pool's own max)`, and passes
  it through — so the ceiling can only ever move *up* from the original
  Vezenkov calibration (never down, so a thin early-season sample can't
  collapse the whole price curve), and whoever actually tops the pool that
  run lands at exactly `FANTASY_MAX_PRICE` by construction, no longer
  requiring it to be Vezenkov specifically. `FANTASY_MIN_PRICE`'s floor
  behavior was already correct and untouched. Verified live: re-running
  `npm run fantasy:reprice` against the real DB re-anchored to raw value
  22.10 (Vezenkov's own prior-season value edges just above the 22.0 floor)
  and still topped the board at Vezenkov/17cr — expected, since real
  2026-27 play still hasn't produced anyone who beats his prior-season
  number yet; the mechanism will move the ceiling for real once someone's
  actual in-season form does.

  **Follow-up, same day: `FANTASY_BUDGET_CAP` now scales with that same
  ceiling movement** — explicit ask ("budget should improve if current
  players increased their cr"): if real price inflation makes an
  otherwise-unchanged squad cost more, the 100cr cap should grow to match,
  rather than quietly squeezing a user's transfer room for owning players
  who got better. Considered three shapes (asked the user to pick):
  tie the cap to the ceiling ratio (chosen), per-user headroom tracking
  each user's own owned-squad cost increase, or market-wide average price
  inflation. Landed on the simplest, most consistent option — same
  mechanism for every user, no extra per-user state to track.
  `computeBudgetCap(ceiling)` (`services/fantasyScoring.ts`) is
  `FANTASY_BUDGET_CAP × (ceiling / FANTASY_PIR_CEILING_FLOOR)`, rounded to
  the same tenth-credit precision as a price. The ceiling itself now
  persists per season in a new `fantasy_pricing_state` table (season PK,
  `ceiling`, `updatedAt` — schema change applied directly against the live
  DB, not through `db:push`, per the Schema-changes workflow above) —
  `scripts/reprice-fantasy-players.ts` upserts it every run rather than
  leaving it a value that only ever existed transiently inside that one
  script invocation, since `routes/fantasy.ts` needs it cheaply on every
  lineup load/save (`getBudgetCap()`), not just once a week when reprice
  runs. `GET /fantasy/lineup` now returns `budgetCap` (falls back to the
  flat `FANTASY_BUDGET_CAP` if reprice has never run for a season —
  `emptyLineupResponse`'s default), and `POST /lineup/batch`'s over-budget
  check compares against it instead of the flat constant. Frontend:
  `fantasy.ts`'s `budgetCap` changed from a fixed constant to a signal set
  from the load response (`overBudget` and the status-bar display both
  updated to call it). Verified live: re-running `fantasy:reprice` after
  creating the table wrote `{ season: '2026-27', ceiling: 22.1 }`, which
  computes to a 100.5cr cap today — a small, correct move matching how
  little the ceiling itself has moved so far (see above).
- **TODO: no dev/staging environment** — everything today is one production
  Railway service on `main`, deployed by hand from a local checkout, against
  the one live Neon database (`DATABASE_URL` is identical between local dev
  and prod — see Environment variables above). There's no separate URL to
  try a risky change against before it's live, and local dev itself already
  writes straight into the real database (real users' points, cards, trades)
  rather than a sandboxed copy. Worth splitting into a `dev` branch +
  a second Railway environment/URL deployed from it — Railway supports
  multiple environments per project natively, which pairs well with Neon's
  own cheap copy-on-write database branching for a genuinely isolated
  staging DB, rather than standing up a whole second Railway project. The
  real cost isn't the branch or the URL, it's that `db:push` is
  interactive-only (`drizzle.config.ts`'s `strict: true`, see Schema
  changes above) with no migrations checked in — keeping two databases'
  schemas in sync would become a manual step to remember on every schema
  change, not something CI could enforce today.
  **Setup started 2026-09-04, paused mid-way — pick back up from here:**
  global `@railway/cli` was upgraded 5.44.0 → 5.49.1 (done, lasting). The
  `.railway/railway.ts` config-as-code workflow this doc describes
  (`railway config plan`/`apply`) turned out to be **broken on this Windows
  setup** — the `railway` npm package's `assertMinimumIacCliVersion()`
  shells out to `railway --version` to double check the CLI, and that
  spawn always fails (reproduced identically on git-bash and native
  PowerShell, filed as product feedback), so `config plan`/`apply` always
  dies with a misleading "upgrade your CLI" error no matter the real CLI
  version. Don't re-fight that tool — drive the dev environment/branch
  setup with plain imperative `railway` CLI commands instead
  (`railway environment new dev --duplicate production`,
  `railway variables --set ... --environment dev`, `railway domain`,
  `railway up --environment dev`), which work fine. Still to do: (1) create
  a Neon branch DB for `dev` — blocked on Neon auth, either run
  `npx neonctl auth` (opens a browser login) or create a branch named
  "dev" off production by hand in the Neon console and hand over its
  pooled connection string; (2) create the `dev` git branch; (3) create the
  Railway `dev` environment and point its `DATABASE_URL` at the Neon dev
  branch; (4) get a domain + first deploy for it.
- Some teams could have zero rows in `players` if `roster_sync.py` (see
  below) hasn't been run for a freshly-registered club yet — found
  2026-08-21 with Besiktas Istanbul via the live-score simulator, fixed for
  the 2026-27 season by adding that script (2026-09-02, see below). The
  simulator still accounts for the case (a team with no roster can't score,
  rather than the scoreboard advancing with no player ever credited for
  it), but real features reading `players` for a team with none synced
  (roster page, "players to watch", etc.) will just show empty/sparse.
- **Live in-game "top scorer" prop predictions, v1 shipped (2026-09-08)** —
  the 2026-09-07 idea (below, kept for context) is now built: pick which
  player will be a game's top scorer, a new prediction type distinct from
  both win/loss Predictions and Fantasy Five. Both open design questions
  from the original idea were resolved before building:
  - **Free pick, not a stake** — same no-risk philosophy as win/loss
    Predictions, not the genuine-wager alternative that was floated.
  - **Internal proxy, not real odds** — `services/topScorerPoints.ts`
    prices a pick off the player's own `playerSeasonStats.pointsPerGame`
    (normalized against a `TYPICAL_TOP_SCORER_PPG` constant, calibrated off
    real max-PPG values from the last 3 seasons), not The Odds API — same
    "internal proxy" precedent `computeFantasyPrice` already set, chosen
    since that provider's EuroLeague player-prop coverage was never
    confirmed to exist.
  - **Locks at the start of the 4th quarter, not at tipoff** (originally
    shipped locking at `final`; tightened same-day — see the follow-up pass
    below) — the one deliberate behavioral deviation from win/loss
    Predictions: a pick can be made or changed any time up to Q4 starting,
    including while it's live, since "live" is the whole point of a prop
    tied to an in-progress game. `top_scorer_predictions` (schema.ts) is a
    separate table from `predictions` for exactly this reason, not an
    extension of it.
  - **v1 deliberately does not touch the shared points economy** — `GET
    /api/top-scorer-predictions/:gameId` returns `isCorrect` and the
    frontend shows a points *preview*, but nothing here calls into
    `getUserPoints()`, `services/leaderboard.ts`, or badge eligibility yet.
    Wiring a correct pick into the real points/leaderboard total is a
    follow-up decision, not bundled into this pass.
  - **Resolution**: `computeTopScorerPlayerId` (mirrors `computeWinnerTeamId`)
    finds the game's max `player_game_stats.points`; a tie between two or
    more players resolves to `null` (no winner) — a real, expected case for
    a shared stat total (unlike a tied final score), surfaced in the UI as
    "no clear top scorer" rather than looking like a bug. Verified directly
    by forcing a tie via a manual DB edit during testing.
  - **Both surfacing ideas from 2026-09-07 were built, not just one**: a
    list picker below the scoreboard (candidate pool is each team's full
    active roster via the already-existing `GET /teams/:id/roster`, not
    just "players to watch") and a photo-based picker tied to the live
    court — see the same-day follow-up pass below for how that second
    surface's shape changed after real mobile testing.
  - **Real bug caught and fixed during this same pass**: `game-detail.ts`'s
    `ngOnInit` originally gated its pick fetch on `auth.currentUser()` being
    already set — but on a fresh page load that signal isn't populated yet
    (`restoreSession()` resolves it asynchronously off the httpOnly refresh
    cookie), the same "bootstrap race" already documented under Frontend
    architecture for the dashboard's team-hero. A logged-in user's own pick
    silently never loaded. Fixed by always attempting the fetch and
    swallowing a logged-out 401, rather than depending on that signal's
    timing.
  - **Not yet done, left as real follow-ups**: `TYPICAL_TOP_SCORER_PPG` and
    the points cap are unvalidated against real 2026-27 play (the season
    has zero played games as of this pass, so every pick currently prices
    at the flat fallback rate — same season-transition gap
    `computeFantasyPrice` hit).

- **Top-scorer picks wired into the shared points economy (2026-09-09)** —
  the leaderboard/badge integration flagged as an open follow-up above is
  now built. Explicit decision, asked directly rather than assumed: a
  correct top-scorer pick adds to the *same* points pool as win/loss
  Predictions (one leaderboard, one "Century" badge threshold), not a
  separate track.
  - **Points captured at pick time, never recomputed** — a new
    `top_scorer_predictions.points_at_pick` column (schema change applied
    directly to the live DB, per the Schema-changes workflow above) stores
    `pointsForCorrectTopScorerPick()`'s output at the moment `POST
    /top-scorer-predictions` is called (or a pick is changed), priced off
    the player's `playerSeasonStats.pointsPerGame` for *that specific
    game's season* as of right then. `GET /:gameId` always reads this
    stored value back, never re-prices live — this is the point of the
    column: a pick made mid-live-game shows and scores exactly what it was
    worth "at the exact time" it was made, regardless of how the player's
    season PPG moves afterward (more games synced) or when the pick is
    later viewed/resolved — same "fixed snapshot before resolution"
    philosophy `game_odds` already established for win/loss picks. Nullable
    only for defense (zero real picks existed at migration time, nothing to
    backfill); a null sums as the flat `TOP_SCORER_POINTS_PER_CORRECT` rate
    everywhere it's read, same "missing data isn't a scoring dependency"
    convention as everywhere else in this economy.
  - **`topScorerTotalsCte()`** (`services/topScorerPoints.ts`) is the one
    place "which player was a game's top scorer, with
    `computeTopScorerPlayerId`'s exact tie-null rule" lives as a reusable
    SQL fragment (three CTEs: per-game max points, per-game leader-or-null,
    per-user summed `points_at_pick` for correct/final picks) — shared by
    `points.ts`'s `getUserPoints` (single user, `getUserTopScorerPoints`)
    and `leaderboard.ts`'s `getLeaderboardEntries` (every user at once via
    a `union` of user ids across all three totals CTEs — correct/bonus/
    top-scorer — replacing the old two-way `full outer join`, since a
    three-way one gets unwieldy fast) rather than duplicating this logic in
    both places or in `predictions.ts`'s `/me/summary` (which just calls
    `getUserTopScorerPoints` once and seeds its `predictionPoints` loop
    with it, no per-pick detail needed there since nothing else in that
    response depends on individual top-scorer picks).
  - **Real bug caught during this pass**: the first version of
    `per_game_leader` used `max(pgs.player_id)` to pick the single leader's
    id — failed live with `function max(uuid) does not exist`, since
    Postgres has no built-in max/min aggregate for `uuid` (unlike every
    other id-typed column this app's SQL usually groups by). Fixed with
    `(array_agg(pgs.player_id))[1]`, safe to index blindly only because the
    surrounding `case when count(*) = 1` already guarantees exactly one row.
  - **Deliberately left out of scope**: only the *points total* (and
    Century's threshold) includes top-scorer picks — the leaderboard's own
    `correct`/`total`/`accuracy` fields and the streak/round-based badges
    ("On a Roll", "Perfect Round") stay scoped to win/loss Predictions
    only, since those are structurally about a different kind of pick;
    folding top-scorer accuracy into the same stat would conflate two
    different-difficulty games rather than just share a currency. Round
    rewards/legendary milestones (the 10-pick-per-round completion
    mechanics) are untouched for the same reason.
  - **Verified live** (not just type-checked): inserted a real correct
    pick (an existing final game's actual, untied high scorer,
    `points_at_pick = 27`) directly against the production DB, confirmed
    `getUserTopScorerPoints` summed exactly 27, then deleted the test row —
    the table was empty before and after.
  - Frontend: `TopScorerPrediction.pointsAtPick` (models.ts) is shown next
    to "Your pick" on the game-detail page's live-score section
    (`+{{ pick.pointsAtPick }} pts`, reusing `predictions.pts`'s existing
    i18n key rather than adding a duplicate).

- **Same-day follow-up pass (2026-09-08), after real mobile testing** — the
  on-court overlay from the initial v1 above didn't survive contact with a
  real phone:
  - **On-court overlay replaced with a horizontally-scrolling photo strip
    positioned above the court**, not on it. Even capped at 6 candidates/side
    with 28px icons, real-phone testing showed visible overlap (the court
    renders far narrower than its 480px cap on a real screen); a mobile
    report ("even 5-6 players" still looks packed) confirmed capping/
    shrinking further wasn't the fix — the underlying problem was fighting
    for space *inside* the court's fixed footprint at all. Moved the
    picker entirely off `<app-live-court>` (all `players`/`pickPlayer`/
    `picksLocked` overlay plumbing removed from `live-court.ts`/`.html`,
    which reverts to its pre-feature, top-scorer-agnostic state) into a new
    section in `game-detail.html` directly above where the court renders:
    two horizontally-scrolling rows (home, away) of tappable player photos,
    sized up to 52px (bigger, per explicit request, than both the old
    on-court icons and the list picker's 28px rows) since a horizontal
    strip has no realistic crowding ceiling the way stacking on the court
    did — it scrolls instead of overlapping, so it shows the *full* roster
    ranked by live points/season PPG rather than a capped top-N.
  - **Ring-around-selected-player bug, fixed twice**: the first attempt put
    `ring-2`/`ring-highlight` directly on `<app-player-photo>` itself
    (the custom element tag) — same mistake `collectible-card.html`'s own
    `[class.ring-highlight]="selected"` precedent had already avoided by
    applying the ring to a real wrapping `<div>` instead. Moved the ring to
    a wrapping element and it was *still* visibly elongated/oval, not
    circular — root cause: a `<button>`'s implicit box (from default
    line-height/inline sizing) isn't actually square even when its content
    is, so `rounded-full` (border-radius 9999px) on a non-square box draws
    an ellipse. Fixed by explicitly sizing the ring wrapper (`[style.width.
    px]`/`[style.height.px]` bound to the icon size, `inline-flex` +
    `leading-none`) so its box is guaranteed square regardless of the
    button/content's own implicit sizing.
  - **Real player photos surfaced, not just jersey silhouettes**: both the
    strip and the list picker were missing `[primaryColor]` on
    `<app-player-photo>` (only `teamCode` was passed), so every photo-less
    fallback rendered in this app's generic reskin accent instead of the
    *player's own team* color — confirmed and fixed by passing
    `d.game.homeTeam.primaryColor`/`awayTeam.primaryColor` (the one team-
    color field `GameTeamSummary` actually carries; it has no
    `secondaryColor`) through at all four call sites. Verified with real
    photo URLs temporarily pulled live from
    `api-live.euroleague.net/v3/.../statistics/players/traditional`
    (`player.imageUrl`, matched by `players.code` — the same field
    `player_stats_sync.py` normally populates from once real 2026-27 games
    exist) for visual QA only; reverted to `NULL` afterward rather than
    left as an undocumented, sync-bypassing write — the real fix for
    missing 2026-27 photos is still "wait for `player_stats_sync.py`", not
    this ad hoc backfill.
  - **Q4 lock tightened from `final`**: leaving a pick open all the way to
    the final buzzer let it degenerate into just reading the box score once
    a game is already decided, undercutting the whole point of the
    internal-proxy formula rewarding a real long-shot call. `isTopScorerPickLocked`
    (`services/topScorerPoints.ts`) now locks at `status === "final"` OR
    (`"live"` AND `quarter >= 4`) — Q4 chosen as late enough to keep three
    full quarters of genuine live picking/repicking (the feature's actual
    point), early enough that the last stretch still carries real
    uncertainty. Enforced on both `POST`/`DELETE` routes and mirrored
    client-side (`game-detail.ts`'s `isTopScorerLocked`, kept in sync by
    hand like the points-formula mirror). The photo strip disables and
    dims once locked instead of silently no-op'ing on tap, since it was
    (at the time) the only picking surface still visible once locked — see
    the next bullet, since the separate list picker it was contrasted
    against no longer exists — verified directly: a tap on a non-picked
    player during Q4 correctly left the existing pick untouched.
  - **List picker removed entirely; strip consolidated into one section
    with a title, right after the score** (same day, later in the pass):
    once the photo strip covered the full roster (not just a capped top-N)
    the separate vertical list further down the page was fully redundant —
    two ways to pick the same thing, one of them scrolled past the
    Highlights/box-score cards to reach. Deleted the whole list card
    (title, hint, two-column roster list, "your pick" line) and moved its
    title/hint/locked-message/error/"your pick" text to sit directly above
    the strip instead, all in one `@if` block — a user now sees what this
    feature is and picks it in one place near the top of the page, not
    split across two cards. The now-fully-unused points-preview mirror
    (`pointsForCorrectTopScorerPick`, its constants, and the per-row "~10
    pts" display the deleted list showed) was deleted with it rather than
    left dead — nothing renders a points estimate anywhere in v1 now.
  - **Ring-clipping bug #2, same underlying CSS quirk as the mobile-density
    pass**: even after the earlier oval-ring fix, the picked player's ring
    still rendered with its top edge cut off. Cause: `overflow-x-auto` on
    the scrolling strip row implicitly forces `overflow-y` to compute as
    `auto` too (a real CSS behavior — setting only one axis to a
    scrolling value stops the other axis's `visible` from applying), which
    silently clipped the ring/`scale-105` since the row had no vertical
    room to spare. Fixed with top padding on the scroll row (`pt-3`) rather
    than fighting the axis-coupling directly — doubles as the "add padding
    above the strip" ask, since the same padding creates breathing room
    under the title too.

- **Original idea (2026-09-07, superseded by the shipped version above)** —
  a new prediction type layered on top of a *live* game, distinct from both
  the existing win/loss game predictions and Fantasy Five: pick a specific
  in-game outcome (the user's own example: "PAO-Baskonia's top scorer will
  be Jerian Grant") rather than which team wins.
  - **Open design question — free pick vs. real stake**: existing
    predictions are a free daily pick that *earns* points, never risks
    them; the user explicitly floated this as possibly a genuine bet
    instead — stake some of your existing points, lose them on a wrong
    call. Whichever way this goes needs its own scoring path
    (`services/points.ts`'s formula assumes a free pick with a floor at the
    flat rate, not a stake that can go to zero) and its own UI framing
    (predictions' existing "pick a team" card doesn't fit a wager amount).
  - **Odds** — the user's own example cites a real "6x" market odds figure
    for a specific prop. `game_odds`/`oddsSync.ts` (The Odds API) only
    captures the moneyline market today; a player-prop market (top scorer,
    points over/under, etc.) may or may not be available from that same
    provider for EuroLeague specifically — needs checking before assuming
    real odds are even sourceable the way moneyline odds already are,
    versus computing an internal proxy (e.g. off `playerSeasonStats`) the
    way `computeFantasyPrice` does for draft prices.
  - **Surfacing UI (2026-09-07, two concrete ideas from the user)** — tied
    to a *live* game specifically (the game-detail page's scoreboard), not
    the upcoming-games list predictions already uses:
    1. Small player icons overlaid directly on the game-detail page's
       court/scoreboard visual, tappable to quick-predict a prop for that
       specific player (e.g. tap a player's icon to bet they'll be the
       game's top scorer) — reuses whatever player-photo/avatar component
       already exists (`shared/player-photo.ts`) rather than a new one.
    2. A separate menu/list below the scoreboard for the same picks — a
       more conventional list-based alternative (or complement) to the
       on-court icons, closer to predictions' existing pick-a-team card
       pattern.
    Game-detail already has a court/scoreboard visual to attach idea 1 to
    (`shared/live-court.ts`'s `<app-live-court>`, `homeColor`/`awayColor`/
    `homeLogoUrl`/`awayLogoUrl`/`homeScore`/`awayScore`/`hotSide`/`active`
    inputs) — but it's team-level only today (logos, colors, score, an
    "on fire" glow), nothing player-level, so the per-player icon overlay
    would be new input/template work on top of it, not a from-scratch
    court.

## Season transition (2026-27, 2026-09-02)

- `backend/src/services/season.ts`'s `getCurrentSeason()` (latest season
  with any `games` row — see the comment there for why this replaced a
  "most games played" heuristic) is the one place that should decide
  "current season" anywhere a route needs one without an explicit
  `?season=` param, **but only for an endpoint making a "these are this
  season's leaders" claim** — not for every "latest known stats" lookup.
  `GET /players/leaders` used to independently pick "the latest season
  that happens to have `player_season_stats` rows", which quietly
  disagrees with `getCurrentSeason()` during a transition like this one:
  2026-27 games were synced (schedule + `roster_sync.py`) weeks before
  `player_stats_sync.py` has anything to sync (it needs played games), so
  it kept showing 2025-26 numbers as if they were the current season's
  leaders. Fixed by pointing it at `getCurrentSeason()`; with zero
  `player_season_stats` rows for 2026-27 it now correctly returns an empty
  list rather than falling back, which the dashboard's `hasLeaders()`
  empty-state handling already knew how to render. `GET /players/round-mvp`
  (dashboard "Top Performances") had the identical bug one level up: its
  own "most recently completed round" search spanned every season ever
  synced, so with zero completed 2026-27 rounds it fell back to a real,
  legitimately-completed round from *last* season (2025-26's round 38) —
  fixed the same way, scoping the completed-round search to
  `getCurrentSeason()`'s games only (2026-09-02).
  `GET /players/advanced-stats` and `GET /players/:id` were **deliberately
  left on their original "latest season with data" behavior** — tried
  `getCurrentSeason()` there too the same day, but `/advanced-stats` is
  also `/compare`'s entire player-search data source (see the `/compare`
  bullet below), and with zero 2026-27 rows the search box had nothing to
  search at all, not just an empty leaderboard. A player-detail/compare
  page showing last season's real numbers as "latest known" is a different
  (and reasonable) claim than a leaderboard implying "these are this
  season's leaders" — reverted back to the season-with-data pick for both.
- `backend/src/scripts/reset-2026-27-season-data.ts` (one-off, run once
  2026-09-02): rounds 2-5 of the already-synced 2026-27 schedule carried
  leftover dev/test data from before this transition — 31 games marked
  `final` with fabricated scores despite tipoff dates weeks in the future,
  fabricated `player_game_stats`, real predictions made against those fake
  results (62 of the app's 86 total), and `round_rewards` grants for
  "completing" round 2-4 off the back of them. The script reverted those
  games to `scheduled`, deleted their fabricated box scores and the
  predictions made against them, and deleted the round 2-4 `round_rewards`
  ledger rows (so the real completion of those rounds can grant normally
  later instead of finding a claim already on file) — but deliberately
  left the cards/packs those fake grants already paid out sitting in the
  affected user's inventory untouched, along with every other
  collectibles/points table, per an explicit "season data only, not a full
  economy wipe" scope decision. It also nulled every `players.photo_url`
  (all 208 that had one were synced against 2025-26 rosters) so
  `PlayerPhotoComponent`'s jersey-number placeholder shows everywhere until
  `player_stats_sync.py` repopulates real photos once 2026-27 games are
  actually played. Always run `scripts/backup-db.ts` before it or a similar
  one-off — it deletes rows and isn't itself idempotent-safe to reason
  about twice.
- `backend/src/scripts/clear-collectible-images.ts` (one-off, run once
  2026-09-02, right after the reset above): `collectibles.image_url` is a
  snapshot copied from `player.photoUrl` at catalog-generation time
  (`scripts/expand-collectibles.ts`), not a live join — so nulling
  `players.photo_url` alone left every collectible card's own baked-in
  image untouched, still showing 2025-26 photos everywhere a card renders
  (Store, Inventory, Album, pack reveals, trades, leagues). Nulls
  `image_url` on all 438 rows; card identity (id, name, tier, pointsCost,
  team) and every `user_collectibles` ownership/trade/wishlist row are
  untouched. `CollectibleCardComponent`'s no-image fallback (`collectible-
  card.html`) was changed from a generic bust-silhouette icon to the same
  jersey-silhouette shape `PlayerPhotoComponent` uses, so a photo-less card
  reads the same way a photo-less player does. Re-run `collectibles:expand`
  (or the admin `PATCH /collectibles/:id`) once real 2026-27 photos exist
  to repopulate.
- `backend/src/sync-py/roster_sync.py` (added 2026-09-02): syncs team
  rosters (player↔team, name, position, jersey number) from EuroLeague's
  live club-roster endpoint, which is populated as soon as clubs register
  their squads — unlike `player_stats_sync.py`'s season-stats endpoint,
  which has nothing until real games are played. Run this first for a
  freshly-synced season so roster/team pages aren't empty for months.
  Deliberately never touches `players.photo_url` (the roster endpoint has
  no photo field at all) — see the script's own doc comment.
- `backend/src/scripts/reset-economy-full.ts` (one-off, run once
  2026-09-02): a broader "every user starts the season at zero" wipe,
  explicitly requested after `reset-2026-27-season-data.ts`'s narrower
  "season data only" pass (offered and declined earlier the same day) left
  every user's owned cards/points/packs untouched. Fully empties
  `user_collectibles`, `owned_packs`, `pack_openings`/`pack_opening_results`,
  `wheel_spins`, `point_adjustments`, `trade_offers`/`trade_offer_items`,
  `round_rewards`, `legendary_milestones`, `pity_counters`, and
  `leagues`/`league_members` (not filtered to any user or season — every row
  in each table), and resets every user's `showcase_collectible_ids` to
  `[]` and `referral_reward_granted` to `false` so a referral already paid
  out of the now-wiped `point_adjustments` can be legitimately re-earned.
  Deliberately leaves `predictions` and `games` alone — those were already
  handled by `reset-2026-27-season-data.ts`, and this pass is scoped to the
  collectibles/points economy only. One side effect worth knowing: every
  user's one-time 150pt welcome bonus (a `point_adjustments` row) is gone
  with the rest of that table and is not re-granted by this script.
- **Jersey-style placeholders, team colors, and stale collectible teams**
  (2026-09-02, same day, after the above): once every player photo and card
  image was nulled, three more problems surfaced from actually looking at
  the result.
  - `GET /teams` returned all 21 rows unconditionally, so AS Monaco (out of
    the 2026-27 competition entirely — see the roster_sync.py note above)
    still showed up in the Teams hub, the favorite-team picker, and every
    other consumer. Fixed by scoping it to teams that actually appear in
    `getCurrentSeason()`'s games — Monaco's `teams` row, its 38 real
    2025-26 games, and its `team_season_stats` are all untouched (a hard
    delete would violate those FKs anyway, and would destroy real
    history); this only narrows what one endpoint returns.
  - `scripts/fix-collectible-teams.ts` (one-off): `collectibles.teamId` is
    a snapshot taken when `expand-collectibles.ts` first created each card,
    matched by player name — that script only ever INSERTs a new
    (teamId, tier, name) combo, it never re-checks an existing row when a
    player transfers. A full offseason of real transfers left 117 of 437
    collectibles (27%) pointing at a player's old team, discovered because
    every one of AS Monaco's 21 cards was among them. Corrected by
    resolving each collectible's player by name against `players.teamId`
    (the always-current source) and updating in place — safe only because
    `reset-economy-full.ts` had already wiped every `user_collectibles`/
    trade/pack-opening row referencing these ids, so no ownership was at
    risk. 6 cards still show Monaco afterward: those 3 players (e.g. Nikola
    Mirotic) aren't on any 2026-27 roster in our data at all, so there's no
    current team to correct them to — a real data gap, not a bug in the
    fix. Those 6 were then removed from the catalog outright
    (`scripts/remove-collectibles-without-team.ts`) rather than left
    showing a team that isn't even in the competition — safe for the same
    reason (no ownership left to break), and the script verifies zero
    references remain in every table that could point at a collectible id
    before deleting, aborting instead of deleting if it finds one.
  - `teams.primaryColor`/`secondaryColor` (`sync/teamColors.ts`,
    `sync-py/standings_sync.py`'s matching `TEAM_COLORS`) were originally
    picked as subtle theme-accent colors (glows, borders, translucent
    overlays) — never validated as literal kit colors, which is exactly
    why they looked "messed up" once rendered as solid jersey fills.
    Re-checked against teamcolorcodes.com and corrected in both files
    (`scripts/fix-team-colors.ts` applied it to the live DB — note
    `standings_sync.py`'s upsert uses
    `COALESCE(teams.primary_color, EXCLUDED.primary_color)`, so it only
    ever fills a NULL column; simply editing the Python dict and
    re-syncing would **not** have updated already-populated rows). Most
    consequential: Baskonia was solid green from a 2010-2016 kit era
    rather than its actual red/navy; Real Madrid and Dubai Basketball both
    have a white primary kit with a colored trim, not the solid dark tone
    used before.
  - `shared/player-photo.ts`'s jersey placeholder went through three
    visual iterations the same day: a translucent icon over a soft
    gradient circle (original) → a flat, full-bleed colored square modeled
    directly on EuroLeague Fantasy's own player tiles (checked live against
    euroleaguefantasy.euroleaguebasketball.net) → back to a circle after
    that read as too flat/plain with the wrong corners and font, this time
    with a real two-color gradient, a soft radial sheen for depth, a
    translucent jersey watermark, and a mono font for the number. Landed on
    the circle+gradient+depth combination — if it needs to change again,
    that history is why a flat square was already tried and rejected.
    **v4 (2026-09-05)**: user shared a reference screenshot of a third-party
    fantasy app's jersey tile and asked to imitate it — declined to fetch or
    view the actual asset (both a specific webpage under that account's own
    fantasy-team ID and, once the user gave it directly, a raw asset URL on
    that product's own CDN) since reproducing another product's specific
    copyrighted illustration, even by eye, isn't something to build from;
    landed instead on an original jersey illustration using only
    genre-standard basketball-jersey conventions (V-neck, sleeve caps, a
    diagonal stripe) that aren't anyone's proprietary design. Keeps v3's
    circular outer frame (never the complaint) but the jersey silhouette —
    the same path v3 already drew as a 16%-opacity watermark — is now the
    actual fill: a diagonal two-color stripe pattern (team
    primaryColor/secondaryColor) clipped to that path, layered with a sheen
    gradient (light top-left, dark bottom-right) and a soft radial shadow
    right under the collar so the V-neck reads as cut into the fabric
    rather than flat-drawn on top of it — about as close to "real jersey"
    as a hand-rolled SVG reasonably gets without 3D tooling this app has no
    other use for. One consistent template across all 20 teams (not a
    per-team real-kit-accurate pattern) — matching each team's actual
    current kit style precisely isn't verifiable without a visual
    reference, which this session didn't have (no browser tool connected).
    `features/store/collectible-card.ts`'s no-image fallback got a matching
    but separate fix: its common tier's `photoTint` was a fixed neutral
    gray regardless of team (rare/legendary already used the team accent),
    which is why roughly half the Store — every common card — showed no
    team color at all. Now uses a pale team-color wash (`tint()`, blends
    the accent toward white) for common, and the jersey icon itself is
    tinted per-tier (`iconColor`/`iconAccent` on `TierStyle`) instead of a
    hardcoded white that had barely any contrast against common's old pale
    background.
    **Real photos backfilled, 2026-09-09** (`scripts/backfill-player-photos.ts`,
    `npx tsx src/scripts/backfill-player-photos.ts`) — asked directly to see
    real player images instead of the placeholder while checking Fantasy
    Five's roster builder UI, since 2026-27 still has zero played games so
    `player_stats_sync.py` hasn't had anything to repopulate `photo_url`
    from. Same real endpoint `player_stats_sync.py` wraps
    (`api-live.euroleague.net/v3/.../statistics/players/traditional`),
    fetched directly via `fetch` for the same practical reason
    `backfill-career-stats.ts` gives (this machine's `sync-py/venv` doesn't
    run), matched by `players.code` against season 2025-26 (the most recent
    with real per-game data) and only ever writing a currently-`NULL`
    `photo_url` — never overwrites, never touches any other column. Unlike
    the 2026-09-08 top-scorer-predictions QA pull (which was reverted to
    `NULL` afterward as throwaway QA), **this one is deliberately left in
    place** — a player's photo doesn't change season to season for the same
    real person, so this is the same real image `player_stats_sync.py`
    would eventually write once 2026-27 has real stats, just sourced a
    season early rather than fabricated. Covers 208 of ~425 `players` rows
    (163 of them on a current 2026-27 roster) — only players with real
    2025-26 per-game minutes are in that dataset at all, so a call-up/
    incoming transfer/reserve with no EuroLeague minutes last season still
    shows the placeholder until real 2026-27 data exists. Safe to re-run
    (idempotent — skips anyone already photo'd) if more players get synced.
- **`teams.code` vs. the public-site team abbreviation** (2026-09-02):
  asked to make the app's 3-letter team codes match
  euroleaguebasketball.net's own standings page. Checked the site's mobile
  view (the desktop table shows full names instead) and found 11 of 20
  differ from `teams.code` entirely — e.g. Baskonia is "BAS" in this app
  but "KBA" on the site, Real Madrid is "MAD" here but "RMB" there. Confirmed
  directly against EuroLeague's live API
  (`api-live.euroleague.net/v2/.../clubs/{code}/people`) that this isn't
  cosmetic: `BAS` returns Baskonia's real roster, `KBA` returns `"Team KBA
  does not exist in season E2026"`. `teams.code` is the feed's own internal
  club code and a real request parameter (`sync-py/roster_sync.py` sends it
  straight into that URL; `standings_sync.py`/`games_sync.py` upsert
  `ON CONFLICT(code)` using whatever the feed itself calls each club) — renaming
  it to match the site would silently break every future sync for that team.
  A `teams.displayCode` column was tried first and reverted: the site's
  abbreviation is shown in ~45 places across ~20 frontend files, and
  threading a second code through every backend response shape that
  constructs an explicit team object (routes/games.ts, routes/players.ts,
  routes/collectibles.ts, services/leaderboard.ts, etc. — none of them just
  spread the full `teams` row) would have meant touching most of the same
  files anyway, for a value that's purely presentational. Landed on
  `frontend/src/app/shared/team-display-code.ts` instead: a hardcoded
  `code -> site abbreviation` map (kept next to `teamColors.ts`/
  `TEAM_COLORS` as a sibling "this is presentation data, not sync data"
  concern), a pure `displayTeamCode()` function, and a `TeamCodePipe`
  (`{{ team.code | teamCode }}`) for template call sites. `PlayerPhotoComponent`,
  `CollectibleCardComponent`, and `TeamBadgeComponent` apply it internally to
  their own `teamCode`/`code` inputs, so every one of their many callers
  (`[teamCode]="x.team.code"`) gets the correction for free without
  changing the caller. `teams-hub.ts`'s search also matches the site
  abbreviation, not just the internal code and team name, so searching
  "KBA" still finds Baskonia.
- **Stale collectible teams, round 2 — departed players, not just transfers**
  (2026-09-04): user report — Biberovic and De Colo still showing under
  Fenerbahce in Store/Inventory despite roster syncs (requested 2 days
  earlier) correctly marking them gone. Root cause: `collectibles.teamId`
  is a one-time snapshot from `expand-collectibles.ts`, matched by player
  name, never re-synced afterward — same underlying gap as the
  `fix-collectible-teams.ts` pass on 2026-09-02, but that pass only
  corrected cards for players who *transferred to a different real
  2026-27 team* (re-resolved against `players.teamId`). It never touched
  players who left the league/roster entirely, because `players.active`
  (roster_sync.py's flag for "no longer on any current-season roster
  fetch," see schema.ts's comment on `players.teamId`) didn't exist yet at
  the time — it was added afterward, in the "stop departed players
  lingering on their old team's roster page" pass. So a departed player's
  `players.teamId` *also* stays frozen at their last club (can't be
  nulled, NOT NULL FK) — re-joining against it the way the first fix did
  wouldn't have helped here either; `active` is the only signal that
  actually says so. Checked league-wide, not just the two reported names:
  46 inactive players / 92 collectible rows were still pinned to their old
  team. `backend/src/scripts/retire-inactive-player-collectibles.ts`
  (one-off, run once 2026-09-04, `backup-db.ts` run first) removed all 92
  outright — unlike `remove-collectibles-without-team.ts`'s MCO cleanup
  (which only ever aborted on finding a reference, since ownership had
  already been wiped by `reset-economy-full.ts` by that point), 25 of
  these were genuinely owned and 27 had real `pack_opening_results`
  history, so the script deletes those referencing rows too rather than
  aborting. Explicitly confirmed with the user first: no compensation (no
  sell-back credit, no replacement pack) for any of the 25 owned rows,
  **including the one owned legendary** (Glynn Watson) even though that
  drops the catalog's real legendary count to 21 against the 22 every
  other economy calculation in this file (`season-simulation.ts`,
  `forceNewLegendary`, wheel odds) assumes — worth knowing if legendary
  pull rates or album-completion numbers ever look off going forward.
  `wheel_spins`/`round_rewards`/`legendary_milestones`'s legacy
  `collectibleId` columns and `trade_offers`/`trade_offer_items` had zero
  references and were left untouched. This is a one-off cleanup, not a
  recurring safeguard — a future roster sync that moves another active
  player to inactive will reintroduce the same staleness until something
  re-runs this same check (or it becomes a standing sweep instead of a
  one-off script).
