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
- **Forgot password (2026-09-10)** — full email-based self-service, not the
  admin-assisted alternative that was also considered (originally flagged
  as a todo 2026-08-21). Two new nullable columns on `users`
  (`passwordResetTokenHash`, `passwordResetTokenExpiresAt`, applied
  directly against the live DB per the Schema-changes workflow above, not
  through `db:push`) rather than a separate table — a user only ever has
  one outstanding reset request at a time, and a second request just
  overwrites both columns. `POST /auth/forgot-password` (`routes/auth.ts`,
  rate-limited by the existing `credentialsLimiter`) always responds 200
  with the same generic message regardless of whether the email is
  registered — a different response would let an attacker enumerate real
  accounts by trying addresses one at a time, and the same limiter also
  keeps this from being usable to email-bomb an arbitrary address. Only a
  sha256 hex digest of the raw token is ever stored (`hashResetToken`) —
  same "never store the plain secret" posture as `passwordHash`, except no
  expensive hashing (bcrypt) is needed here since 32 random bytes is
  already unguessable. `POST /auth/reset-password` re-hashes whatever's
  submitted, matches it against a still-unexpired row (1 hour,
  `RESET_TOKEN_EXPIRY_MS`), and clears both columns the moment a reset
  succeeds — so a used or expired link can never be replayed, verified
  directly against the live DB (register a test account, forgot-password,
  reset with a known token, confirm the old password is rejected and the
  new one works, confirm the same token is rejected on reuse, then delete
  the test account).
  `services/email.ts` wraps **Resend** (`RESEND_API_KEY`) — chosen over
  SendGrid/SES for the least setup friction (a generous free tier). Same
  "no-op without an API key" posture as `sync/oddsSync.ts`'s
  `ODDS_API_KEY` check — a missing key just logs the reset link to the
  console instead of failing, so local dev needs no real Resend account.
  **Real gotcha, caught only by testing live, not by reading Resend's
  docs**: without a verified custom domain, Resend's shared
  `onboarding@resend.dev` sender does NOT work "out of the box" for
  arbitrary recipients the way it first looked like it would — it only
  ever delivers to the email address the Resend *account itself* was
  signed up with (every other recipient gets a 403
  `"You can only send testing emails to your own email address"`). This
  app has no verified domain yet (see the Deployment section's "TODO:
  custom domain" — actively being pursued as of this pass specifically to
  unblock this), so as of this pass, forgot-password email only actually
  reaches the Resend account's own inbox; every other user's request still
  writes a real, valid reset token to the DB (so the mechanism is fully
  correct end-to-end) but the email itself silently never lands for them.
  Revisit `RESEND_FROM_EMAIL` once a domain is verified in Resend. The
  emailed link points at `APP_BASE_URL` (the frontend's own origin, not
  the API's, trailing slash stripped defensively in `email.ts` since a
  Railway var can easily carry one) — set on Railway as of this pass.
  **Localized (2026-09-10)** — `sendPasswordResetEmail` takes an
  `EmailLang` ("en" | "el", default "el"), since there's no server-side
  language preference to read (`I18nService` is frontend-only,
  `localStorage`-backed — see Frontend architecture's i18n bullet). The
  frontend passes its current `i18n.lang()` on every
  `POST /auth/forgot-password` call; the backend defaults to "el" for
  anything else, same "el unless explicitly en" rule
  `I18nService.loadLang()` already uses. `EMAIL_COPY` is a tiny two-language
  dictionary local to `email.ts` — not pulled from the frontend's
  `translations.ts`, since that file is Angular-bundled and not importable
  from the backend. Frontend: `/forgot-password` and `/reset-password`
  (reading `?token=`) are new standalone routes mirroring the login page's
  visual shell exactly, plus a "Forgot password?" link added to the login
  page. `AuthService.forgotPassword`/`resetPassword` are deliberately
  separate from `setSession()` — neither call changes
  `accessToken`/`currentUser`,
  since a reset doesn't imply the requester is who they say they are until
  they've actually logged in with the new password afterward.
- **Odds-weighted prediction points** (`services/points.ts`'s `pointsForCorrectPick`,
  reworked twice on 2026-08-31/09-01 before landing on the current formula).
  Every correct pick is worth `POINTS_PER_CORRECT` (10) times the picked team's
  own fair odds — `fairProb` is the picked team's de-vigged implied win
  probability: `min(40, max(10, round(10 / fairProb)))`, i.e.
  `POINTS_PER_CORRECT × fairOdds` (`fairOdds = 1 / fairProb`), floored at the
  flat rate and capped at 40 (`ODDS_POINTS_CAP`, so an uncapped long-shot
  can't scale unbounded — a 5%-implied underdog would otherwise net 200pts).
  **No favorite/underdog branch** — a heavy favorite's fair odds sit near 1.0
  (scores near the flat rate), a real underdog's are much higher (scores much
  more), one continuous formula covers both.

  Two earlier shapes were tried and replaced: a symmetric-penalty curve that
  scaled favorites *down* (wrong in practice — people correctly pick
  favorites far more often, so this dragged the realistic average payout well
  below 10), then a floor-not-penalty linear underdog boost (fixed the
  favorite problem but compressed real underdogs too much vs. a direct market
  multiple). The current direct-multiple formula trades away an exactly-flat
  favorite rate (a 55% favorite now scores ~18, not 10) to avoid a hard cliff
  right at the coin-flip line. `scripts/season-simulation.ts` still only
  models flat `POINTS_PER_CORRECT`, never the odds bonus — re-run it (after
  teaching it to model the bonus) if real points start completing the album
  faster than the documented ~140-155 median day.

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
- **Fantasy Five** (2026-09-05, rebuilt same day to match EuroLeague Fantasy's
  own published Classic Mode rules; `player_fantasy_prices`/`coach_fantasy_prices`/
  `fantasy_lineups`/`fantasy_coach_picks`/`fantasy_pricing_state` in `schema.ts`,
  `services/fantasyScoring.ts`, `routes/fantasy.ts`,
  `frontend/src/app/features/fantasy/`) — a season-long, budget-cap fantasy
  squad mode alongside Predictions, built to compete with EuroLeague Fantasy's
  own core mechanic directly.
  - **Squad**: 10 outfield players (4 Guards + 4 Forwards + 2 Centers,
    `FANTASY_POSITION_QUOTA`, enforced at write time in `POST
    /fantasy/lineup/batch`, not in the DB) + 1 head coach, under one
    `FANTASY_BUDGET_CAP` (100cr nominal — see the re-anchoring note under
    Other known gaps below). Of the 10: 5 "starters" + 1 "sixth man" score
    100% of a locked round's points (`slotRole` column on `fantasy_lineups`);
    the remaining 4 "bench" score `BENCH_SCORE_MULTIPLIER` (50%). Coach
    scoring is result-based, not stat-based (coaches aren't in `players`):
    `COACH_WIN_POINTS` (20) if their team won that round's game, else 0,
    always 100% (there's only one coach).
  - **Pricing**: `computeFantasyPrice`/`computeCoachPrice`
    (`services/fantasyScoring.ts`, run by the manual `npm run
    fantasy:reprice` script, not a cron) blend recent form (last
    `RECENT_FORM_WINDOW` (8) final games, `MIN_RECENT_GAMES` (3) minimum) with
    a season baseline (`playerSeasonStats.valuation`), falling back to the
    player/team's most recent *prior* season when the current season has no
    games yet. The blended raw PIR is rescaled onto a credit range anchored
    to a real sourced reference point (Vezenkov's real EuroLeague Fantasy
    price, 17cr) rather than used as a credit value directly — see
    `FANTASY_PIR_CEILING` and the "price ceiling re-anchors" note under Other
    known gaps for how that ceiling (and the budget cap, which scales with
    it) move over time. `FANTASY_MIN_PRICE` is 4 (explicit user instruction,
    not derived). Coach price interpolates off real standings position
    (`team_season_stats.position`), gated on `wins + losses > 0` so an
    unstarted season's meaningless placeholder position doesn't get read as
    real data (caught 2026-09-06 — a team having *a* position value isn't
    proof it means anything yet; falls back to last season's final standings
    until real games are played).
  - **Locking — whole-round, not per-player**: a per-player mid-round
    "Turns" substitution model (matching real rules' day-1/day-2 game
    blocks) was built and then deliberately reverted the same day (2026-09-07)
    by explicit request ("since a game is live no changes can be made at
    all"). `POST /fantasy/lineup/batch` now checks `getRoundLockTime` (the
    round's earliest tipoff, same rule Predictions uses) once, up front, and
    rejects the *entire* submission — every player, formation, captain, and
    coach — once the round's first game has tipped off. Writes are a plain
    wholesale delete+insert (not a diff) as a result. `GET
    /fantasy/lineup`'s per-player `locked` flag still reports whether that
    specific player's own game has tipped off, but is display-only now (e.g.
    swapping the opponent line for live PIR), never an edit gate.
  - **Round carry-forward + transfers** (2026-09-07): a never-touched round
    seeds itself from the previous round's saved squad the first time it's
    read (`getBaselineSquad`, persisted immediately, same "lazy write on
    read" pattern as round rewards) — but only for the season's actual
    current round, never a future one reached early. Up to
    `FANTASY_TRANSFERS_PER_ROUND` (3) *players* may differ from that baseline
    per save; the coach is a separate, unlimited change; moving an
    already-owned player between starter/sixth-man/bench costs nothing.
    Round 1 (no predecessor) drafts free and unlimited. A round navigator
    (`round` vs. `defaultRound` signals) lets a user browse past rounds
    read-only (reuses the same round-lock guards) and see that round's own
    computed points/PIR breakdown (`GET /fantasy/lineup` computes this
    server-side — `totalPoints`, `totalPir`, `coachPoints`,
    `roundComplete`), with a one-time completion-reveal modal per round.
  - **Live awareness**: `fantasy.ts`'s `liveUpdatesEffect` patches the
    relevant game's status/score into the fixtures list off the app-wide SSE
    `EventsService`, swaps a placed player's opponent line for their
    live/final PIR once their game leaves `scheduled`, and shows a pulsing
    "Live" pill / real scores in the Fixtures popup — no new backend
    endpoints needed (`GET /games/:id` already computes live box scores).
  - **UI**: a court+bench builder using Angular CDK drag-and-drop
    (`@angular/cdk`, needed for touch support HTML5 native DnD lacks) with a
    tap-to-place fallback, a 5-choice formation picker
    (`2-2-1`/`2-1-2`/`3-1-1`/`1-2-2`/`1-3-1`, purely a frontend layout
    affordance — the backend only enforces the overall 4G/4F/2C quota, never
    a per-slot position), and a court background reusing `shot-chart.ts`'s
    half-court SVG geometry (no rim/backboard drawn — removed after repeated
    reports of a starter slot visually overlapping the basket art; a
    translucent "glass floor" gradient was added in its place). **Below
    `sm:`, the pool is a full-screen tap-to-pick popup instead of a
    persistent drag-and-drop column** (`openPicker`/`pickPlayerForSlot`) —
    landed on this after a mobile-crowding pass tried and reverted stacking
    the pool under the court, which reintroduced the exact "court is
    off-screen while scrolling to the pool" bug the original side-by-side
    layout was built to avoid. Desktop/`sm:`+ keeps the pool beside the
    court with full drag-and-drop. A swap popup (⇄ badge on any unlocked
    squad slot) gives a non-drag way to move a player between
    starter/sixth-man/bench. Tapping a player's name/photo anywhere opens an
    info popup with their last 5 games' PIR, rather than navigating away.
  - **Known gap**: `POST /lineup/batch`'s `changedIds` diff is keyed off
    presence/`slotRole` changes only — a captain-only reassignment
    (`isCaptain` flipping with everything else unchanged) never triggers the
    per-player lock recheck. The frontend already blocks this
    (`setCaptain` checks `isLocked`), so it needs a client bypassing the UI
    to hit; worth closing by folding `isCaptain` changes into `changedIds`
    too.
  - **Not verified in a live browser** as of the 2026-09-06/07 UI passes —
    checked by rebuild + template/diff review only, since no Chrome
    extension was connected in those sessions. Worth a real visual pass
    (both breakpoints/themes) when the extension is available.
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
  changes. Fonts, current as of 2026-09-09: **IBM Plex Sans**, one family
  for *all three* roles (display, sans/body, AND mono) — back to a plain
  Google Fonts `@import` in `frontend/src/styles.css`, no self-hosted
  `@font-face`/asset files at all, for the first time since the GFS
  Neohellenic/Noto Sans pairing earlier the same day. Full swap history
  (twelve display/sans swaps and three mono swaps in one day — a
  genuinely wild ride, worth reading in full at least once) is in the
  comment above `.font-display` there.
  This landed here after asking for **IBM Plex *Mono*** specifically,
  which turned out to have zero Greek glyphs at all per Google Fonts'
  own metadata (`subsets: [cyrillic, cyrillic-ext, latin, latin-ext,
  vietnamese]`, no `greek`) — checked directly, not assumed, same
  standard as every font this whole day. Of the entire IBM Plex
  superfamily, only the base **IBM Plex Sans** actually carries Greek
  (Plex Mono, Plex Sans Condensed, and Plex Serif all lack it); given a
  three-way choice (skip it / use Plex Sans everywhere / accept broken
  Greek in the mono role), the pick was Plex Sans for all three roles.
  Notably, IBM Plex Sans was tried once before, very early in this same
  saga (Syne → IBM Plex Sans, 2026-08-26) and rejected then for reading
  "generic dev-tool/AI-product" — worth knowing if it comes up again.
  One hardcoded font-family (not routed through the `font-mono` Tailwind
  class) in `frontend/src/app/features/packs/packs.css`'s
  `.pack-set-code` rule has needed updating by hand on every mono swap
  today. `.font-display` carries a `font-weight: 700` baseline.
  **The short version of a very eventful single day**: Rajdhani/Barlow/
  JetBrains Mono (no Greek at all) → Syne/IBM Plex Sans → Play/Roboto
  Condensed → GFS Neohellenic/Noto Sans → Fervojo (self-hosted, rejected
  same day, "i dont like it") → Moderustic → LT Superior (self-hosted,
  retired Noto Sans, one family for both roles) → Swanston (self-hosted)
  → CYN Gamer (self-hosted) → Hellenica (self-hosted) → Vela Sans
  (self-hosted) → New Computer Modern Sans (self-hosted) for display/sans;
  mono went Rajdhani-trio → Fira Code → Iosevka Charon Mono → Lulu
  Monospace (self-hosted); both roles then unified onto **IBM Plex Sans**
  (Google Fonts, no self-hosting). The first two display swaps went
  through a side-by-side Artifact comparison; every swap after that was a
  named-font "just apply it" request — every self-hosted font's files
  were deleted outright the moment it was replaced, nothing legacy left
  behind at any point in this chain, and `frontend/src/assets/fonts/` is
  now empty again.
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
matches nothing), `RESEND_API_KEY` (unset = forgot-password emails log
their reset link to the console instead of sending, see Forgot password
below), `RESEND_FROM_EMAIL` (defaults to Resend's own shared
`onboarding@resend.dev` sender — only actually delivers to the Resend
account's own signup email until a custom domain is verified, see the
"real gotcha" note under Forgot password below and the Deployment
section's "TODO: custom domain"), `APP_BASE_URL` (defaults to
`http://localhost:4200`; set to the Railway URL in production — this is
the frontend's own origin, not the API's, since that's where the emailed
reset link needs to point).

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

## Branding

- **Timeline correction (2026-09-10)**: this section previously described
  an "isometric 3-bar mark" as the current logo everywhere — that was
  real (commit `ac973cd`, 2026-09-06) but got reverted back to the
  ring+basketball mark by a later, undocumented commit
  (`72c954a`, "Land the C-ring-with-nested-basketball mark…") that never
  updated this doc to match. Caught 2026-09-10 while building the
  forgot-password email's logo — every real surface (favicon, nav,
  login/register hero, splash) still had the ring+ball mark, not the bars.
  The isometric bars now live on only as `logo-spinner.ts`'s loading
  animation (a literal bar-chart pulse, unrelated to this correction) — if
  a future pass wants the isometric mark back as the primary logo, it needs
  rebuilding from scratch; nothing currently references the old SVG.
- **Ring + ball, refined (2026-09-10)** — a full logo redesign, resolved via
  a 4-direction Artifact canvas comparison (this project's standard
  "propose visually, then implement" pattern): a refined ring+ball
  evolution, an abstract "clutch moment" spark mark, a revisit of the
  isometric bars as a proper icon, and a hoop-swish mark. **Refined
  ring+ball was chosen** — same silhouette as the mark that's been live
  since `72c954a` (a "C"-shaped ring with a basketball at its center), but
  with real depth: the ball is now a radial gradient (`#FF9E70` → `#FF6B35`
  → `#C94A24`, same brand orange family, not a flat stroke-only circle),
  its seam lines use a subtle `rgba(0,0,0,0.35)` inset shade instead of a
  second orange tone, and the ring itself is slightly larger/thinner
  (`r=36`/`stroke-width=8`, was `r=34`/`10`) for a lighter, more refined
  read. Geometry: `viewBox 0 0 100 100`, ring path
  `M 78 26 A 36 36 0 1 0 78 74`, ball `circle cx="50" cy="50" r="17"`
  (both concentric — the ring's rightward gap is what reads as a "C").
  Applied everywhere the old mark was, all with a locally-scoped
  `radialGradient` id per usage (`ballGradFavicon`/`ballGradNav`/
  `ballGradHero`/`ballGradSplash`/`ballGradCourt`/`ballGradQr` — kept
  distinct per file rather than one shared id, since several of these
  render simultaneously in the same document and duplicate SVG element
  ids across sibling components is invalid, even though it happens to
  still resolve correctly in every browser tested): `frontend/src/favicon.svg`
  and `frontend/public/favicon.svg` (the latter wins the build — Angular
  copies the `public/**` glob after the explicit `src/favicon.svg` asset
  entry, confirmed against `dist/.../favicon.svg`), the PWA icon set
  (`frontend/public/icons/icon-*.png`, 8 sizes, rasterized from the new
  favicon SVG via a temporary `sharp` install — `npm install sharp
  --no-save` then `npm uninstall sharp` after, so nothing lands in
  `package.json`, matching the "no icon-generation pipeline checked in"
  precedent from the original isometric-bar pass), the top-nav wordmark
  (`app.component.html`), all four auth-page heroes (login/register/
  forgot-password/reset-password — identical inline SVG duplicated across
  all four, updated in all four), the splash-screen intro
  (`shared/splash.html`'s `.brand-icon`, distinct from the *unrelated*
  large background basketball watermark on the same page — that one's its
  own separate SVG, untouched here, see splash.html's own comments), and a
  previously-undocumented **center-court decal**
  (`shared/court-background.ts`'s Fantasy court background, a faint
  `opacity="0.16"` copy of the mark painted under the court lines —
  found and updated in the same pass, translate offset adjusted from
  `-54 -50` to `-50 -50` to match the refined mark's now-perfectly-
  concentric center). The email logo
  (`backend/src/services/email.ts`'s `LOGO_URL`, added the same day for
  the forgot-password email) needed no code change — it already points at
  `icon-192x192.png`, so regenerating that PNG picked up the new design
  automatically.
- **Wordmark lockup, standardized (2026-09-10, same day)** — a second
  design-canvas round, specifically about how the icon combines with the
  literal word "Clutch" (the icon mark itself was already settled above).
  Three lockup options compared: (A) the icon doubling as the letter "C"
  with literal text "lutch" continuing right after — the nav bar's
  existing trick; (B) the icon in its own separate badge next to the full
  word "Clutch" spelled out normally; (C) a from-scratch logotype ("Clutch"
  resting on a thin court-line rule, the ball rolling off the last
  letter). **(A) was chosen** — explicitly the opposite call from the
  forgot-password email's own logo (that one deliberately stayed a
  standalone icon with no wordmark trick, since email image-blocking can
  strand the "lutch" half with nothing to anchor it — a risk that doesn't
  exist for a live web page). This surfaced a real inconsistency:
  `app.component.html`'s nav and `shared/splash.html` already did the
  icon-as-C trick, but all four auth pages (login/register/
  forgot-password/reset-password) used a *different*, separately-gapped
  "icon + full 'Clutch' word" layout instead — their own code comment even
  claimed to match the nav's "combination mark," which it didn't. Fixed by
  converting all four to the same pattern: `aria-label="Clutch" role="img"`
  on the wrapping div (screen readers get the real word), `aria-hidden`
  on both the icon and the visible "lutch" text.

  **First execution of (A) was rejected, then corrected (same day)** — the
  initial pass just dropped the standalone icon (thin `stroke-width="8"`,
  proportioned for an app-icon context) in at a smaller size next to bold
  "lutch" text; direct feedback: it read as two mismatched pieces bolted
  together, not one logo, and a first fix attempt (shifting the ball off-
  center into the ring's "counter," like a real letterform's aperture)
  missed the actual ask — the ball needed to stay centered, matching the
  standalone icon's own geometry, just heavier. The corrected, shipped
  version: same ring center/radius as the standalone icon (`M 78 26 A 36
  36 0 1 0 78 74`, centered on `(50,50)`), but `stroke-width="16"` (was
  `8`) so the ring's weight actually matches "lutch"'s bold type, and a
  **cropped `viewBox="0 0 86 100"`** (was the icon's own `0 0 100 100`) —
  the ring's rightmost edge only reaches ~x=86 given its radius/stroke, so
  the uncropped 100-wide box left visible empty padding between the icon
  and the text no matter how negative a margin was applied; cropping the
  box to the mark's real bounding edge is what actually let the two sit
  flush with a tiny (`-mr-[1.5px]`/`-mr-px`, scaled to each usage's size)
  margin instead of guessing an increasingly large negative value. Applied
  everywhere the wordmark (icon immediately before "lutch"/"Clutch")
  renders: nav (`app.component.html`, `-mr-px` at 24×28), all four auth
  pages (`-mr-[1.5px]` at 36×42), and the splash screen
  (`shared/splash.html`/`splash.css` — `.brand-icon` switched from a fixed
  square `width`/`height` clamp to `height` + `aspect-ratio: 86/100`, since
  the viewBox is no longer square). The standalone icon (favicon, PWA
  icons, `email.ts`'s `LOGO_URL`, the Fantasy court decal, `qr-card.html`)
  is deliberately untouched by any of this — still `stroke-width="8"`,
  uncropped `0 0 100 100` — since those contexts have no adjacent "lutch"
  text to weight-match against, and `email.ts`'s standalone-icon choice
  (no wordmark trick at all) stands for the reason given above.
- **Ring weight tuned down, `16` → `13` (2026-09-10, same day)** — verified
  live via Chrome DevTools (`claude-in-chrome`, not just reasoning about
  the markup): the flush spacing from the pass above was confirmed already
  correct on the real deployed site (`getBoundingClientRect` showed the
  icon and text boxes overlapping by 1.5px, i.e. genuinely touching, and
  `CanvasRenderingContext2D.measureText`'s `actualBoundingBoxLeft` showed
  the "l" glyph's own ink overshooting slightly further left than that —
  no remaining gap at the font-metrics level either). But `stroke-width="16"`
  rendered visibly heavier than "lutch"'s own bold stem (~6.7px vs ~5.5px
  at the auth-hero's ~36px display scale) — dropped to `13` (~5.4px at
  that same scale) to actually match rather than exceed the text weight.
  Same six files as the pass above; the crop/margin values themselves are
  untouched, and still fit since the ring's right edge only retracts by
  about half a viewBox unit at this size — nowhere near enough to reopen
  a visible gap.
- **Flush spacing reverted to a normal gap (2026-09-10, same day)** — the
  fully-flush treatment above (icon/text boxes overlapping) was explicit,
  approved feedback at the time, but reads as too fused once actually
  lived with — asked for "normal" spacing instead. This is NOT a reversion
  of the icon-as-C concept itself (a genuine miscommunication mid-pass: "I
  don't want C+lutch anywhere" from earlier in the day was about the
  *mismatched-weight, gappy* execution, not the combined-mark idea — the
  ball-nested-in-the-ring "C" stays, confirmed explicitly as "ONE PIECE
  but the C with the ball in it"). Swapped the per-usage negative-margin
  hack (`-mr-px`/`-mr-[1.5px]`/`-ml-[3px]`) for a plain flex `gap` on each
  wrapping container instead — simpler, and avoids hand-tuning a margin
  value per usage: `gap-1` (nav, 24px icon), `gap-1.5` (all four auth
  heroes, 36px icon), `gap-2` (splash, up to ~45px icon). Ring
  stroke-width (13) and the cropped `86×100` viewBox are both unchanged
  from the passes above.
- **Icon-as-C wordmark retired entirely, replaced with a full logo
  (2026-09-10, same day)** — everything in the several bullets above this
  one (the icon-as-"C" + "lutch" combination mark, all its spacing/weight
  tuning) is now historical only — superseded, not deleted, since the
  back-and-forth in getting there is worth keeping. Explicit direction:
  "remove anywhere the C + lutch... design a logo and replace everything
  with our logo." Landed via the same design-canvas comparison pattern
  (3 fresh directions, none constrained to the old icon-as-letter idea),
  then iterated live in the canvas per direct feedback (curved not
  straight line, symmetric ball seams — the first cut was missing the
  right-side curve entirely, a real asymmetry bug, not just a style
  choice — text width pinned via `textLength` so the line/ball align to
  it exactly rather than eyeballed, ball moved clear of the last letter
  instead of overlapping it).

  **The shipped mark**: real "Clutch" text (SVG `<text>`, not a
  letterform substitution — a plain, normal, actually-spelled word,
  `font-weight="800"`, `textLength="220" lengthAdjust="spacingAndGlyphs"`
  so its rendered width is a known, exact value everything else aligns
  to), a curved orange line (`stroke="url(#lineGrad...)"`, a
  `feDropShadow` filter for depth — the "shady line" ask) tracking under
  the word from the "C" to the "h", and the ball (same seam pattern as
  the standalone icon: one vertical + two symmetric curves — the earlier
  asymmetric version only had one) riding just past the last letter with
  a small gap, never overlapping it. Text fill is a two-stop
  `var(--color-ink)` gradient (100% → 82% opacity) rather than a fixed
  color, so it stays legible in both themes — the canvas mockup itself
  was only ever checked against a dark background, and a fixed near-white
  fill would have been unreadable in light mode; this is a correctness
  fix made during implementation, not something explicitly requested.
  One `viewBox="0 0 264 150"` SVG (gradient/filter ids suffixed per
  usage — `Nav`/`Hero`/`Splash`/`Qr` — to avoid duplicate-id collisions
  where more than one instance can be mounted at once) replaces the old
  icon-element-plus-text-element pairing everywhere it appeared: the nav
  (`app.component.html`), all four auth pages
  (login/register/forgot-password/reset-password — identical block,
  `width="106" height="60"`), the splash screen
  (`shared/splash.html`/`splash.css` — `.brand-icon`/`.wordmark` merged
  into one `.logo-mark` class, `height: clamp(46px, 13vw, 68px); width:
  auto; aspect-ratio: 264/150`, reusing the existing `icon-in` keyframe
  since there's now only one element to animate in, not two), and
  `public/qr-card.html` (a static, non-Angular page with no `--color-ink`
  var — uses its own already-defined fixed `--ink: #f0f0ec`, and picked
  up an `IBM Plex Sans:wght@800` addition to its Google Fonts link, which
  it didn't previously load at all, having been built with the
  Rajdhani/Barlow/JetBrains-Mono trio instead).

  **Left alone, on purpose**: this pass only ever touches contexts where
  the icon sat next to "Clutch" text. The standalone square icon by
  itself — `favicon.svg` (both copies), the PWA icon set, `email.ts`'s
  `LOGO_URL`, and the Fantasy court background's faint center-court decal
  — has no adjacent text to combine with, was never part of the
  "C+lutch" complaint, and keeps the plain ring+ball mark approved
  earlier the same day.
- **`textLength` forcing dropped, ball clearance widened, nav sized up
  (2026-09-10, same day)** — real bug, not a style tweak: the "h" in
  "Clutch" rendered hidden. Root cause was the `textLength="220"
  lengthAdjust="spacingAndGlyphs"` forcing added in the pass above, meant
  to align the line/ball exactly under the word — "Clutch" at
  `font-weight="800"`/`font-size="80"` in IBM Plex Sans actually renders
  notably wider than 220 (closer to ~258-262 by hand calculation; couldn't
  get an exact browser measurement to confirm — Chrome DevTools was
  disconnected for this pass and a direct Google Fonts fetch from this
  environment's shell was blocked by bot-protection), and cross-browser
  support for `lengthAdjust="spacingAndGlyphs"` actually compressing
  glyphs (not just spacing) to hit that target is inconsistent — so the
  real "h" ended up rendering underneath the ball, which sat at a fixed
  `cx` regardless. Fixed by dropping the forcing entirely: text now
  renders at its natural width, and every measurement past it (the line's
  endpoint, the ball's position) uses a generous hand-estimated safety
  margin instead of a precise-looking number that silently broke —
  `viewBox` widened `264×150` → `320×150`, ball moved `cx=240` → `290` (a
  real gap past the estimated word-end, not flush against it). Same six
  files. Also bumped the nav logo specifically (`49×28` → `81×38` — the
  one explicitly reported as too small on desktop; the four auth-hero
  logos and splash were left at their existing pixel sizes, just
  re-based onto the new 320-wide viewBox so the geometry stays
  consistent). **Not yet re-verified live** — Chrome was disconnected for
  this whole pass; worth a real visual check (both the "h" fix and the
  nav size) next time the extension is available.
- **Home-screen icon cache-busted, `?v=2` (2026-09-10, same day)** — user
  report: "Add to Home Screen" still showed the old flat-icon design after
  the gradient-ball redesign earlier this same day, even on a fresh save.
  Root cause: `icon-*.png`/`favicon.svg` keep the same filename across a
  redesign (this app has no icon-generation pipeline that content-hashes
  them — see the earlier "not checked in, one-off render" note), and
  iOS/Android cache a PWA's home-screen icon at install/save time in a way
  that doesn't reliably revalidate against normal HTTP cache rules even
  across an otherwise-fresh page load — a real, well-known platform
  behavior, not a bug in this app's serving code (`index.ts`'s
  `express.static` uses Express's own default caching, nothing unusually
  aggressive was set). Fixed by appending `?v=2` to every icon URL in both
  `index.html` (favicon, apple-touch-icon) and `manifest.webmanifest`
  (all 8 sizes) — a plain query string, no file renaming needed, but a
  URL the OS has never cached before, so it's forced to fetch fresh.
  **Bump this version param on any future icon change** — same reasoning,
  same fix, every time.
- **`src/favicon.svg` was a stale leftover from an even older logo** as of
  the 2026-09-06 pass (an orange-ring-with-a-cutout "C" mark, never
  actually served, shadowed by `public/favicon.svg` at build time) — kept
  in sync with `public/favicon.svg` ever since rather than deleted, so the
  shadow can't reintroduce a mismatch if the asset order ever changes.

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
  on-court player-icon overlay from v1 didn't survive contact with a real
  phone (visible overlap even capped at 6 candidates/side). Replaced with a
  horizontally-scrolling photo strip of the full roster (both teams),
  positioned above the court rather than on it (`live-court.ts` reverted to
  its pre-feature, top-scorer-agnostic state) — a strip scrolls instead of
  overlapping, so it needs no candidate cap. The separate list-picker card
  further down the page was also removed once the strip covered the full
  roster, consolidating everything into one section right after the score.
  Two real bugs worth remembering if a similar circular-avatar-with-ring
  pattern comes up again: (1) a selection ring applied directly to a custom
  element, or to a `<button>`-boxed wrapper without explicit square sizing,
  renders as an ellipse, not a circle — `rounded-full` only draws a true
  circle on a box that's actually square; (2) `overflow-x-auto` on a
  scrolling row implicitly forces `overflow-y` to `auto` too (real CSS
  axis-coupling behavior), which silently clipped the selection ring/scale
  transform — fixed with top padding on the scroll row rather than fighting
  the axis coupling. Also tightened the pick lock from `final` to Q4 start
  (`isTopScorerPickLocked`: `status === "final"` OR (`"live"` AND `quarter
  >= 4`)) since letting a pick stay open to the final buzzer let it
  degenerate into reading the box score instead of a real live call.

- **Original idea (2026-09-07), superseded by the shipped version above** —
  floated as a free pick vs. a genuine points-stake wager (free pick was
  chosen) and real market odds vs. an internal proxy (proxy was chosen,
  since player-prop coverage on The Odds API was never confirmed for
  EuroLeague) — both open questions the shipped version above resolved.

- **Aggregate "My picks" view, top-scorer tab (2026-09-10)** — until now a
  user's top-scorer picks only ever existed one game at a time
  (`game-detail.ts`'s photo strip); there was no way to see them all
  together the way win/loss Predictions' "My picks" list already did.
  Added `GET /api/top-scorer-predictions/me` (mirrors `predictions.ts`'s
  `GET /me` exactly — one joined, `orderBy(desc(tipoffAt))`, `.limit(40)`
  query) plus `computeTopScorerPlayerIdsForGames` (`topScorerPoints.ts`), a
  batched sibling to the single-game `computeTopScorerPlayerId` so
  resolving correctness for up to 40 rows is one query, not up to 40 (same
  "fewer round trips" reasoning as `topScorerTotalsCte`). Surfaced as a new
  "Top scorer" `appChip` tab next to "Win/Loss" inside the Predictions
  page's existing "My picks" card (`picksTab` signal) — deliberately not a
  separate top-level card or its own page, since it's the same "your
  picks" concept just for a different pick type, and the points/badge
  summary above it already covers both (top-scorer points feed the same
  pool, see the 2026-09-09 entry above). Also fixed a real gap while in
  this area: `game-detail.ts`'s `pickTopScorer` had a `topScorerPickSaving`
  signal that was set/cleared but never read in the template at all — a
  tap showed no loading feedback for however long the request took.
  Reworked into `topScorerPickSavingId` (tracks *which* player id is
  in-flight, not just a bare boolean) so the tapped avatar shows an
  `app-logo-spinner` overlay and the whole strip disables until it
  resolves, instead of a silent wait.

- **Live-reactive top-scorer points formula (2026-09-10)** — until this
  pass, `pointsForCorrectTopScorerPick` priced a pick off a single static
  number (season PPG) no matter when during the game it was made — a pick
  re-made in Q3 after a player had already gone off for 20 priced exactly
  the same as picking that player cold at tipoff. Explicit ask: trust real
  betting odds if available, otherwise our own season/career stats, and
  the payout should keep moving *throughout* the live game as the picture
  of who's actually going to lead becomes clearer — a player already
  sitting on a big lead partway through is now an obvious call and should
  pay less, a player who hasn't gotten going yet (or a normally-quiet
  scorer suddenly hot) is a bigger claim about the rest of the game and
  should pay more. Two open questions were resolved with the user before
  building, since this touches a formula CLAUDE.md had deliberately
  documented as needing to work a specific way, in a production economy
  with no staging environment (see "TODO: no dev/staging environment"
  above):
  1. **Real odds were explicitly deferred, not built** — there's no
     `ODDS_API_KEY` configured even to test whether The Odds API actually
     carries a EuroLeague player-points/top-scorer market (CLAUDE.md's
     existing "Original idea" entry above already flagged this coverage as
     unconfirmed). Decision: build the internal-data version now, revisit
     real odds later once that market's existence is actually verified
     against a live key.
  2. **A pick's *stored* value still never floats after the fact** — this
     was the one non-negotiable carried over from the existing
     `pointsAtPick`/`game_odds` "fixed snapshot, never recomputed"
     philosophy (schema.ts's doc comment on that column). What changed is
     only what a *fresh* pick or a *re-pick* prices at, mid-game — not
     what an already-placed pick is worth after the fact. This needed no
     architecture change at all: re-picking mid-game (already allowed
     anytime up to Q4, see `isTopScorerPickLocked`) already re-prices at
     the moment of the tap; the formula just now looks at more than season
     PPG when it does.
  - **Mechanism** (`services/topScorerPoints.ts`): project a player's
    likely final total as `pointsSoFar + baselinePPG × remainingGameFraction`,
    then normalize that projection against `TYPICAL_TOP_SCORER_PPG` exactly
    like the old formula normalized a flat season PPG. `remainingGameFraction`
    reads `games.quarter`/`gameClockSeconds` (10-minute EuroLeague quarters,
    2400 regulation seconds total) and is exactly `1` pre-tipoff — a
    deliberate property, not a coincidence: with `pointsSoFar = 0` and
    `remaining = 1`, the new formula reduces to precisely the old one, so
    nothing changes for a pick made before a game starts. Verified directly
    (a standalone script, not just reasoning): a typical-PPG favorite picked
    pre-tipoff prices at the flat 10; the same player re-picked in Q3 after
    already scoring 22 drops to the floor of 10 (an obvious call now); a
    similarly-average player who's only scored 2 by Q3 prices *up* to 26
    (bigger claim); a player picked seconds into Q1 with 0 points prices
    essentially identically to a pre-tipoff pick (14 vs 14) — no jarring
    jump right at tipoff.
  - **`baselinePPG`** now falls back through season PPG -> a games-played-
    weighted career PPG (`getTopScorerBaselinePPG`, one query, same
    weighting the collectible card flip's "Career" stat already uses,
    `routes/collectibles.ts`) -> `TYPICAL_TOP_SCORER_PPG` as a neutral
    default when neither exists — same "missing data isn't a scoring
    dependency" fallback chain as before, just feeding a projection now
    instead of being used directly. This is the "figure it out from
    career/season stats" half of the ask; the career step is new — the old
    formula only ever looked at the current season, degrading straight to
    the flat rate for a call-up/transfer/early-season player with no
    season row yet.
  - Nothing schema-side changed — `pointsAtPick` is still a plain nullable
    int, `POST /top-scorer-predictions` just computes a richer input into
    the same formula/column it always wrote to.

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
  - `shared/player-photo.ts`'s jersey placeholder went through several
    visual iterations before landing on a circular frame with a two-color
    gradient, radial sheen, and a jersey silhouette (V-neck/sleeve-cap/
    diagonal-stripe, using only genre-standard, non-proprietary jersey
    conventions — a user-shared reference screenshot from a third-party
    fantasy app was deliberately not fetched/viewed, since imitating another
    product's specific illustration isn't something to build from). The
    jersey silhouette is filled with a diagonal two-color stripe in the
    player's own team colors, clipped to the same path an earlier iteration
    drew as a faint watermark. One consistent template across all 20 teams,
    not a per-team-accurate kit pattern (no visual reference available to
    verify real kits against). `features/store/collectible-card.ts`'s
    no-image fallback got a matching fix: common-tier cards used a fixed
    neutral gray regardless of team (rare/legendary already used the team
    accent) — now a pale team-color wash, with the jersey icon tinted
    per-tier instead of a hardcoded white.
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
