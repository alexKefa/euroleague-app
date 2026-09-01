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
  - **Desktop rail** (`NAV_LINKS`): Home, News, Schedule, Picks, Cards,
    Teams, Standings — all seven, directly.
  - **Mobile bottom bar** (`MOBILE_NAV_LINKS`): just Home, News, Picks,
    Cards — the four checked every session. A trailing **"More"** tab
    (always last, `dots-vertical` icon) toggles a popover (`moreOpen`
    signal, closes on outside-click/Escape/link-click) listing
    `MORE_LINKS` — Schedule, Teams, and Standings, destinations checked
    occasionally rather than constantly (`MOBILE_OVERFLOW_PATHS` is the
    single set both `MOBILE_NAV_LINKS` and `MORE_LINKS` derive from — add
    a path there, not to two places by hand). Add anything similarly
    "occasional" to that same set, not as a 5th+ mobile tab.
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
  changes. Fonts: Rajdhani (display/headings), JetBrains Mono (mono/labels),
  Barlow (sans/body) — set up in `frontend/src/styles.css`. `.font-display`
  also carries a `font-weight: 700` baseline there (see the comment above
  it) since Rajdhani's normal weight reads light for headings/scores and
  most templates using the class don't separately add `font-bold`.
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
- **Redeploy**: currently manual (`railway up --service euroleague-app`)
  from a local checkout — not yet wired to auto-deploy on `git push`.
- The same Railway account has an unrelated older project ("valiant-passion" /
  service "dsg-backend") — don't confuse it with this one.

## Other known gaps

- A traded player's season-long stat averages (across both teams) are
  attributed entirely to their *current* team's roster page, not split per-team.
- `boxscore_sync.py` was re-run in full on 2026-08-26 (426 `final` games,
  7948 rows) as part of fixing the `minutes`-parsing bug documented above —
  treat any earlier "checked on <date>, covers N of M games" note as stale.
- Redeploys to Railway are manual, not triggered by `git push` (see
  Deployment above).
- Some teams have zero rows in `players` — e.g. Besiktas Istanbul, found
  2026-08-21 while testing the live-score simulator. Not a sync bug in
  anything built this session; whatever ran the roster sync just hasn't
  covered every team yet. The simulator accounts for this (a team with no
  roster can't score, rather than the scoreboard advancing with no player
  ever credited for it), but real features reading `players` for a team
  with none synced (roster page, "players to watch", etc.) will just show
  empty/sparse — worth knowing if a team's page looks unexpectedly bare.
