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

**Live**: https://getclutchapp.com (Railway, see Deployment below).

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

Full-stack features typically touch every layer: `schema.ts` (Drizzle, not
Prisma) → a backend route/service → an Angular component → both i18n
dictionaries. Whenever a change adds or edits user-facing text, update the
Greek string in the same pass, not as a follow-up — see Frontend
architecture's i18n bullet below for how the dictionary files are
organized.

## Visual Verification

Claude has no reliable browser access in this environment (the Chrome
extension is frequently disconnected) and creating throwaway accounts to
poke at the UI has caused real cleanup problems before. Do **not** open
Chrome, launch a browser session, or create throwaway test accounts just
to visually verify a styling/UI change. Instead: (1) confirm the dev
server (or a production build) actually compiles/rebuilds with no errors,
(2) describe precisely what changed and where, and (3) ask the user for a
screenshot if real visual confirmation is needed — they can check
`localhost:4201`/`4200` or the live site far faster than a simulated
browser session can. Exception: when the user explicitly asks for
Chrome-driven testing (e.g. "use the browser to check X"), do it — this
rule is about *not defaulting* to it, not a hard ban.

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
npm run sync:injuries    # tsx src/sync/runInjurySync.ts — basketnews.com's EuroLeague injury report
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
- **Injuries — now (partly) synced, not purely admin-entered (2026-09-19)**
  — `playerInjuries`' original "admin-entered, not synced" design (no
  official EuroLeague feed has this data at all) is unchanged as a
  fallback, but `sync/injurySync.ts` now also pulls a daily automated
  report from **basketnews.com's EuroLeague injury report** — the only
  other source found for this at all — via `npm run sync:injuries` /
  a 24h `setInterval` in `index.ts` (prod-only, same pattern as the other
  sync jobs there). That page (`news-212393-euroleague-injury-report-updated.html`)
  is confirmed to be a persistent, in-place-updated page ("updated daily"
  per its own subtitle, checked live), not a dated one-off news article —
  otherwise a fixed URL wouldn't work for a recurring job. Parsed with
  `cheerio` against its real HTML table (`#injury-reports-table` — team
  header rows carry the team as `<tr id="team-slug">`, a real player row is
  always exactly 5 plain `<td>`s with no `colspan`, which is what
  distinguishes it from a team's "No injured players" placeholder row).
  `sync/injuryTeamMap.ts` hand-maps basketnews' kebab-case team slugs to
  `teams.code` (confirmed against a live fetch, mirrors `oddsTeamMap.ts`'s
  "no algorithmic match" reasoning). Status labels map off basketnews' own
  on-page "Player status color guide" legend (Ready/Expected/Questionable/
  Game-time/Doubtful/Out/Uncertain), not guesswork — Expected→probable,
  Game-time/Uncertain→questionable (no clean 1:1 counterpart for either),
  Ready is never written (it's basketnews' own "healthy"/placeholder
  status). Rows whose comment matches `/coach'?s?\s+decision/i` are
  excluded outright — a healthy scratch, not an injury; **this exact
  regex check caught a real bug in the one-off manual import that preceded
  this job** (`scripts/import-basketnews-injuries.ts`, a same-day earlier
  pass): two Zalgiris players had been imported as "questionable" off a
  WebFetch-summarized read of the article that silently dropped the
  raw comment's "(Coach decision)" qualifier — the first real
  `sync:injuries` run correctly excluded and reconciled both away.
  `playerInjuries.source` ("admin" | "sync", schema change applied
  directly against the live DB per the Schema-changes workflow above) is
  what lets the sync's own reconcile step (delete a `source: "sync"` row
  for a player no longer on the report — a recovery) never touch a human's
  own entry through `routes/injuries.ts`'s admin form, which always writes
  `source: "admin"` regardless of what a row's source was before. A sync
  run whose parse comes back with zero rows bails out entirely rather than
  reconciling — a real page-structure change should surface as a loud
  failure, not silently wipe every synced row. No Greek translation source
  exists for the sync path (basketnews is English-only) — `noteEl` is left
  untouched on a conflict update (never nulled out), so a human's own
  hand-translated note survives a re-sync of the same player.
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
- **"Fix everything" album-completability pass (2026-09-21)** — direct
  request, after `economy:simulate` (extended the same session to model
  top-scorer prediction points and Fantasy Five, see that script's own doc
  comment) showed a real gap at 50% wheel engagement (a realistic, not-
  fully-engaged player, in between the already-documented 85%/0% floors):
  full-album completion was only 5/13/23/31/43/68% across 50-80% win/loss
  accuracy — legendary was still the bottleneck, and the two milestone
  tracks above (the single biggest non-wheel lever, per
  `LEGENDARY_MILESTONE_INTERVAL`'s own doc comment) only ever counted
  win/loss picks, giving zero credit for a real, separate skill (top-scorer
  picking) or for Fantasy Five's steady ~1900pts/season (which fed only
  spending power, never the bottleneck tier directly). Two additive
  changes, both in `services/cards.ts`:
  1. **`checkAndGrantLegendaryMilestones`/`checkAndGrantCoachMilestones` now
     count correct top-scorer picks too**, not just win/loss —
     `topScorerCorrectCountSql()` mirrors `topScorerPoints.ts`'s
     `topScorerTotalsCte()`'s per-game-leader derivation (same tie-null
     rule) as a scalar count instead of a summed-points CTE, added directly
     into the existing "correct" scalar subquery so both milestone
     functions stay a single round trip.
  2. **A new third milestone track, Fantasy Five-based**: `fantasyMilestones`
     (schema.ts, exact structural mirror of `legendaryMilestones`/
     `coachMilestones`) + `checkAndGrantFantasyMilestones`
     (`FANTASY_MILESTONE_INTERVAL = 6`) grants an unopened `wheelLegendary`
     pack every 6 completed Fantasy Five rounds — counted from this user's
     own `fantasy_round_points` rows (services/fantasyScoring.ts), not
     prediction accuracy at all. Deliberately engagement-based, not
     skill-based, on purpose — Fantasy's round carry-forward means a squad
     drafted once keeps scoring every subsequent round with zero further
     weekly effort, so this rewards "did you keep an active squad" the same
     way the wheel's own milestone already rewards daily spin habit,
     structurally different from the pick-based track above. Wired into
     `routes/fantasy.ts`'s `GET /lineup` (unconditionally, not gated on the
     currently-viewed round's own completeness, since the underlying count
     is career-wide — same "return every unseen grant" shape as
     `checkAndGrantFantasyRoundPoints`), with a new
     `POST /fantasy/milestone-rewards/ack` and a "Fantasy milestone!" banner
     on the Fantasy Five page (`shownFantasyMilestoneRewards`, same
     merge-by-id/immediate-ack pattern as Predictions' own milestone
     banners).
  - **Re-simulated before building** (interval picked by trial against
    `economy:simulate`, not from independent design rationale — flagged
    directly): at 50% wheel engagement, both changes together raised full-
    album completion from 5/13/23/31/43/68% to 38/69/84/93/98/99% across
    50-80% accuracy, with zero regression at 85%/100% engagement (still
    ~100% everywhere) or the cheapest-first spending policy. The 0%-
    engagement floor (never touches the wheel) stays at 0% full completion
    — commons/rares still depend on wheel volume, a separate bottleneck
    this pass didn't touch — but legendary count nearly tripled at low
    accuracy (2.9→10.0 at 50%, up to 8.9→16.7 at 80%), a real improvement
    to "does skill/engagement alone give a shot at the exciting tier" even
    short of full completion. `season-simulation.ts`'s
    `SIM_FANTASY_MILESTONE` default was updated from 0 (off) to 6 to match
    the shipped constant, so a plain `economy:simulate` run now reflects
    reality; `SIM_TOPSCORER_ACC_RATIO` (default 0.4, an assumed fraction of
    win/loss accuracy) remains the one genuinely speculative input in this
    whole model — no real top-scorer-pick accuracy data exists to calibrate
    it against.
  - **Verified against the real service functions, not just the
    simulator**: a throwaway test user on the `dev` Neon branch was given
    60 fabricated correct top-scorer picks (games + `player_game_stats` +
    `top_scorer_predictions` rows) and 6 fabricated `fantasy_round_points`
    rows, then `checkAndGrantLegendaryMilestones`/
    `checkAndGrantFantasyMilestones` were called directly — both granted
    exactly one milestone, a second call each stayed idempotent (no double
    grant), and everything fabricated (including the test user) was deleted
    afterward. Schema change (`CREATE TABLE fantasy_milestones`) applied
    directly against both the `dev` and production databases per the
    Schema-changes workflow above, ahead of the code deploy — safe since
    the table is new and unreferenced by any pre-pass code.
- **Legendary catalog replaced with each team's real "brand name" players
  (2026-09-22)** — direct request: "replace our legendary cards with the
  brand name players of each team." Explicit decisions confirmed with the
  user first, since this touches real production collectible ownership:
  2 legendaries per team (not 1), picked by real synced season PIR
  (`playerSeasonStats.valuation`, not a hand-curated fame list), old rows
  removed outright with no compensation. That last part was verified safe
  *before* running anything destructive — a direct production query found
  **zero** real `userCollectibles` rows for any of the 20 old legendaries
  and zero pending trades referencing one (only 6 historical
  `packOpeningResults` log rows, not live ownership), so nobody actually
  lost an owned card.
  - `backend/src/scripts/replace-legendary-catalog.ts` (one-off, kept for
    history — not safe to re-run once real legendary ownership exists,
    since it force-deletes every row referencing the old catalog in one
    transaction: `tradeOfferItems`/`tradeOffers`, `userCollectibles`,
    `packOpeningResults`, `wheelSpins`/`roundRewards`/`legendaryMilestones`/
    `coachMilestones`'s legacy `collectibleId` columns, then the old
    `collectibles` rows themselves, before inserting the new 40). Season
    PIR uses the same per-player current-season-else-most-recent-prior-
    season fallback as `reprice-fantasy-players.ts`, needed since 2026-27
    has zero played games league-wide as of this pass — every real pick
    this run actually came from each player's 2025-26 form. Run against
    `dev` first and verified (40 rows, exactly 2/team) before running
    against production. Top picks: Sasha Vezenkov (PIR 22.1), Mike
    James/Mathias Lessort (19.1-19.6), matching this file's own existing
    Fantasy-pricing calibration reference points.
  - `expand-collectibles.ts`'s ongoing legendary-generation logic was
    modernized to match: was "1 per team, skip any team that already has
    one" (so a re-run after this migration would never notice the new
    2-per-team model existed), now "top up to `LEGENDARIES_PER_TEAM` (2),
    filling only what's missing" — also replaced its hardcoded
    `SEASON = "2025-26"` with the same dynamic current-season-with-fallback
    query the migration script uses, since a hardcoded season string goes
    stale every transition. Verified idempotent on both `dev` and
    production immediately after (re-run inserted 0 new legendaries on
    both, as expected with the catalog already at exactly 2/team).
  - **Doubling the pool (20 -> 40) required re-tuning the whole economy** —
    without any other change, `economy:simulate` showed 50%-engagement
    full-album completion collapsing to 0-4% across every accuracy (down
    from the "fix everything" pass's own 5-99% just above). Retuned in the
    same pass: `LEGENDARY_MILESTONE_INTERVAL` 60->25, `FANTASY_MILESTONE_
    INTERVAL` 6->3 (`services/cards.ts`), `SPIN_ODDS` 58/20/14/8 ->
    58/20/20/2 (`routes/spin.ts`), Elite pack big slot 17%/13% -> 24%/6%
    legendary/coach (`services/packs.ts`) — both odds bumps taken entirely
    out of **coach's** share, not common's/rare's, since coach isn't
    album-tracked and so is a genuinely free lever (a lesson directly
    reused from the 2026-09-03 coach-cards pass's own odds tuning).
    Result: 50%-engagement completion restored to 37/72/89/96/99/100%
    across accuracy 50-80% — matching or exceeding the original 22-card
    numbers at every level — with zero regression to commons/rares (never
    touched) or the 85%/100%/cheapest-first scenarios (still ~100%
    everywhere). The 0%-engagement floor even improved in relative terms:
    22-33/40 legendaries (55-81%) vs the original 2.9-8.9/22 (13-40%),
    since the career-wide milestones (now tighter) don't depend on wheel
    engagement at all. Coach supply dropped moderately as the one real
    tradeoff — acceptable since coach was never part of "album complete."
    `season-simulation.ts`'s own `CATALOG_SIZE.legendary` and milestone/
    odds defaults were updated to match so a plain `economy:simulate` run
    reflects the new reality; re-run it after any future change to either
    interval or either odds table.
  - **`CATALOG_SIZE.common`/`rare` was stale in the simulator (208/208 vs
    the live catalog's real 289/289)**, 2026-09-22, caught while updating
    `season-simulation.ts` after the legendary-doubling pass above —
    ongoing roster syncs had grown the real catalog since 208/208 was first
    measured, undetected because nothing compared the constant against
    live data. Fixed to 289/289; legendary numbers were unaffected, but it
    revealed real album-completion at 50% wheel engagement was much lower
    than the stale constant implied (~15% vs a previously-reported ~99%).
  - **"Explore retuning" — a genuinely new bottleneck found and fixed**
    (2026-09-22, same day): direct user report after spending ~10,000
    points on a mix of Elite/Pro packs — only 1 legendary, a handful of
    rares. Re-simulating (`economy:simulate`'s zero-wheel-engagement
    scenario, extended this pass with `avg commons`/`avg rares`/`avg packs
    bought` diagnostics) found **rares, not legendary, were the actual
    non-wheel bottleneck**: only 95/289 (33%) owned on average at 80%
    accuracy after a full season of buying whatever pack was affordable —
    every purchasable pack is common-heavy by design, and duplicate
    saturation makes the last third of a 289-card tier exponentially
    harder without real pull volume. Two things that turned out NOT to be
    the fix, checked directly before finding the real one: a 5x
    points-income test only reached 45% rares before diminishing returns
    flattened out (ruling out "just give more points"), and a dedicated
    `save-for-elite` spend policy (added to the simulator to model a
    deliberate saver, since `highest-affordable`'s spend-immediately
    behavior meant points rarely actually reached Elite's 1200 cost before
    getting spent on cheap Starter packs first — avg packs bought was
    56.8 Starter/4.7 Pro/**zero** Elite) found only ~6 Elite packs/season
    even when every point was saved specifically for it — not remotely
    enough raw pull volume regardless of duplicate handling.
    The actual fix, once found: the existing great/perfect-round rewards
    (`checkAndGrantRoundRewards`) were already the dominant non-wheel
    source of rares, completely independent of both the wheel and pack
    purchases. A new **rare milestone** (`checkAndGrantRareMilestones`,
    `rare_milestones` table — exact structural mirror of
    `legendaryMilestones`/`coachMilestones`, career-wide cumulative correct
    picks as the counter) extends that same proven mechanic to fire on
    every correct pick instead of only within a round. Direct user choice
    on two design questions before building: grants the card **directly**
    into `user_collectibles` rather than an unopened pack (rares are
    lower-stakes than legendary, so instant credit with no "open it
    yourself" friction fits better — this is actually a *reversion* to how
    `legendaryMilestones`/`coachMilestones` originally worked, before their
    now-unused `collectibleId` columns were superseded by the 2026-08-26
    "reward a pack" pass), and `LEGENDARY_MILESTONE_INTERVAL` was tightened
    alongside it (25 -> 18) so legendary — now the trailing tier once rares
    stopped being the bottleneck — keeps pace.
    `RARE_MILESTONE_INTERVAL = 2` wasn't invented from scratch — a great
    round already implies almost exactly that rate (8+ correct in one round
    -> 4 guaranteed rares from a wheelPro pack). Elite pack's own 1st slot
    was also bumped common -> rare in the same pass (worst-case EV 487.5 ->
    587.5 against its 1200 cost, still a safe 612.5pt margin — no new
    sell-back exploit) — a smaller, independent improvement, not the actual
    fix (it alone barely moved rares at all once the real "how points
    actually get spent" bottleneck was understood).
    Re-simulated (3000 users/scenario) with everything combined: 100%/85%
    wheel engagement stayed 100% full-album completion everywhere (and got
    *faster* — e.g. 75% accuracy/100% engagement median day 137 -> 111,
    since the new milestones stack on top of wheel income too). 50% wheel
    engagement — previously the range most exposed to the old rare
    bottleneck — rose to 94-100% across 50-80% accuracy. The 0%-engagement
    floor (`highest-affordable` policy, realistic mixed spending): rares
    95-212/289 (33-73%, varies by accuracy) rose to 145-286/289 (50-99%),
    commons 142-212/289 rose to 148-246/289 (51-85%), legendary 22-32/40
    rose to 26-39/40 (66-97%) — an 80%-accuracy points-only player now
    actually reaches full album completion (1%) by day 210, up from a hard
    0% across the entire accuracy range before this pass. `save-for-elite`
    specifically reaches rares 53-99% and legendary 68-99%, but commons
    stay low (2-21/289, since that policy never buys a common-guaranteed
    Starter/Pro pack) — a real remaining gap only for a purely
    Elite-focused buyer, not a concern for realistic mixed spending.
    Schema change (`CREATE TABLE rare_milestones`) applied directly against
    both the live production DB and the `dev` Neon branch in the same pass
    (see the dev/prod schema-drift gap under Other known gaps below — this
    one was caught immediately rather than left to drift).
    Deliberately left untouched, per explicit user direction ("jump ball
    secondary... leave it as is"): `SPIN_ODDS`, the wheel's own pack odds,
    and Elite's big slot legendary/coach split — the fix targeted
    predictions/Fantasy as the primary progression path, not the wheel.
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
  - **Predictions/Fantasy/Battles/Total leaderboard tabs (2026-09-25)** —
    League Detail's old 3-way Points/Fantasy/Battles segmented control split
    into 4: **Predictions** shows win/loss + top-scorer pick points only
    (`LeaderboardEntry.predictionPoints`, `services/leaderboard.ts` — the
    same value Century's badge threshold already checked internally, now
    also returned to the client), **Total** shows the combined `points`
    total exactly as the old "Points" tab did (correct/top-scorer points +
    every `countsTowardRanking` `point_adjustments` row — battle stakes,
    Fantasy's converted round points, welcome/referral bonus, admin
    grants), and **Battles** is unchanged (still the challenge list, not a
    ranking). Predictions is a client-side re-sort of the same entries
    Total already fetched (`league-detail.ts`'s `predictionsRows` computed)
    — no second API call. **Fantasy's stat pill was relabeled "CP" (Clutch
    Points)**, with a new info icon (`features/fantasy/fantasy-cp-info.ts`,
    same modal chrome as `battles-info.ts`) explaining the real mechanic
    behind it: `services/fantasyScoring.ts`'s existing
    `FANTASY_POINTS_CONVERSION_RATE` (0.5) already converts half of each
    completed round's CP into real app Points — this pass didn't add that
    conversion, only surfaced it, since CP being a PIR-based score on a
    different scale from Predictions/Total's currency was invisible to a
    user before. The CP relabel is in the shared
    `fantasy-leaderboard-list.ts` component, so it also applies to Fantasy
    Five's own Leaderboard tab, not just League Detail's.
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
  - **Daily/round price variation — real, entity-specific formulas
    (2026-09-21)**: `services/fantasyDailyReprice.ts` (added 2026-09-16, run
    on a background interval in `index.ts`, `[fantasy daily reprice]` in the
    logs) nudges every player's/coach's price after each of their *final*
    games — separate from `computeFantasyPrice`/`computeCoachPrice`/the
    manual `fantasy:reprice` script above, which only ever set the
    season-long *baseline* this daily job nudges day to day, never
    recomputing from scratch. Originally used one unsourced guessed formula
    applied identically to both (`gamePoints / (currentPrice * 10)`, picked
    only to loosely match EuroLeague Fantasy's own public worked example)
    since neither real formula was known at launch. Replaced with
    EuroLeague Fantasy's actual published formulas once sourced (two
    separate EuroLeague Fantasist/@ELFantasist graphics) — **players and
    coaches are genuinely different formulas, not shared constants**:
    player `X = (N - P*1.1) / 25`, coach `X = (N - P) / 40` (no breakeven
    multiplier at all, and a wider /40 divisor than a player's /25 — a
    coach's price moves more gently per round for a same-sized miss). `X`
    is always the credit gain/loss, `N` that round's real fantasy points
    (`computeFantasyGamePoints`/`pointsForCoachResult`), `P` the price
    *before* the round. A player's `P*1.1` is a breakeven bar scaled to
    their own price (score below ~110% of your price, lose credits; above,
    gain), which is what gives a cheap player's price more room to swing
    than an expensive one's for the same performance — a coach only needs
    to match their own price to hold steady. Both still clamped to
    `+-DAILY_PRICE_MAX_DELTA` (1.0) as a safety net against one outlier
    stat line — not part of either sourced formula, just close to the
    natural range each already produces. Each (player/coach, game) pair is
    applied at most once (claim-first via `fantasy_price_change_log`/
    `fantasy_coach_price_change_log`, same idempotency shape as the other
    interval sync jobs), so swapping either formula only changes *future*
    deltas — no backfill/replay of already-applied rows.
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
    **Mid-round substitutions (2026-09-25)** — partially reopened by
    request ("since we are on day 2/2 unlock the changes"): once the round
    has tipped off but some of its games are still to come, `POST
    /lineup/batch` routes to `saveMidRoundSubstitutions`
    (`services/fantasyScoring.ts`) instead of rejecting. Same 10 players and
    coach required (no transfers), rows updated in place (priceAtPick
    untouched, no budget re-check). Any of the 10 may change
    slotRole/captaincy, and the formation can change — including a player
    whose game already finished (first shipped restricting that to
    not-yet-played players; loosened the same day by direct request: "all
    players should be switchable with each other and change formation").
    Since scoring is computed on read, moving a played player rescores their
    finished game at the new role. The one exception is the captaincy: it
    can leave a played captain but can only be handed *to* a player whose
    game hasn't tipped off (`CAPTAIN_PLAYED`; "captain can only switch to a
    day 2 player"). Frontend mirrors it via `subsWindowOpen`/`editLocked`/
    `canTakeCaptaincy` in `fantasy.ts` (`isPlayerLocked` returns false for
    everyone inside the window; pool, remove-X, and coach stay locked via
    `roundLocked()`).
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
    translucent "glass floor" gradient was added in its place, then replaced
    2026-09-16 with a warm saturated hardwood look — see
    `shared/court-background.ts`'s own doc comment). **Below
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
    **Drag & drop polish (2026-09-25)** — every drop list is
    `cdkDropListSortingDisabled` + `cdkDropListHasAnchor`, and the rules in
    `styles.css` (global, since the preview lives on `<body>` and they need
    `:has()`) hide CDK's placeholder out of flow in any list other than the
    source — CDK otherwise inserts it next to a hovered slot's occupant,
    growing the slot and shoving the court around mid-drag. Adds a
    lift/tilt preview, a hovered-slot glow, and a landing pop-in (the
    occupied-slot element is keyed on player id via a one-item `@for` so a
    newly arrived player gets a fresh element). Don't add a
    `cdkDragStartDelay` for touch: CDK *cancels* the drag if the finger moves
    before the delay elapses, so a normal quick drag on a phone silently did
    nothing (shipped briefly to dev, reported as "does not swap players").
    Also no drop animation on `.cdk-drag-animating` — a fly-and-fade toward
    the hidden target placeholder overlapped the landing pop and read as a
    leftover trace. `reseatStartersForFormation` is stable (starters already
    in a fitting slot stay put), so a bench player lands where dropped; a
    swap no formation supports now flashes a "doesn't fit" pill instead of
    silently snapping back. Every player list shows a position chip plus a
    T1/T2 match-day chip (`turnByTeamId`, multi-day rounds only).
    The mobile picker sizes
    itself to `window.visualViewport` so the keyboard never covers results,
    and hides its secondary filters while the keyboard is up.
  - ~~**Known gap**: `POST /lineup/batch`'s `changedIds` diff is keyed off
    presence/`slotRole` changes only — a captain-only reassignment never
    triggers the per-player lock recheck.~~ Stale, not an active fix
    (caught 2026-09-10 while about to work on it): this described the
    reverted per-player "Turns" model's diff logic — the "Locking —
    whole-round, not per-player" revert right above (same day) already
    replaced it wholesale with one up-front `roundLockAt` check plus a
    delete+insert, no diffing at all. `changedIds` doesn't exist anywhere
    in the codebase any more (confirmed by grep), and the lock check now
    runs unconditionally before any per-player logic on every
    `/lineup/batch` call regardless of what changed — a captain-only
    payload hits the exact same round-wide gate a full squad rewrite
    does. This bullet just never got removed once the revert made it
    moot.
  - ~~**Not verified in a live browser** as of the 2026-09-06/07 UI
    passes~~ — done 2026-09-10: registered a fresh test account and drove
    the real builder (desktop drag-and-drop, mobile tap-to-pick popup,
    formation switching, captain/coach pickers, position/team filters,
    both themes at both breakpoints). Everything held up — no console
    errors, drag-and-drop places correctly, switching formation
    auto-reflows the squad into the new slot mix, the disabled Save
    button surfaces a missing-requirements badge instead of silently
    failing on an incomplete squad.
  - **Real bug caught and fixed during that pass**: `roundLocked()`
    (`fantasy.ts`) used to OR in
    `fixtureGames().some((g) => g.status !== "scheduled")` alongside the
    server's real `lockAt`-based `coachLocked()` snapshot — the intent was
    reacting to a live SSE tick without waiting on a clock, but the
    backend's actual gate (`POST /lineup/batch`'s `lockAt <= now`) has no
    status condition at all, and a game's `status` can disagree with its
    `tipoffAt`. Hit live: a brand-new account saw round 1 as locked even
    though its earliest game was two weeks out, because that game's row
    was leftover "final" test/simulator data with a future `tipoffAt` (see
    the season-transition scripts above — this looks like the same
    category of stale row `reset-2026-27-season-data.ts` was built to
    clean up, just recurred since). Fixed by computing `roundLocked()`
    from `lockAt()` vs `Date.now()` directly — the same value the
    backend's gate uses — keeping `fixtureGames()` only as a reactivity
    trigger (read, never branched on) so it still re-checks the clock on
    every SSE tick without trusting any game's status field. The stale
    DUB-vs-MAD row itself (season 2026-27, round 1) was left untouched —
    a data cleanup, not a code fix, and out of scope for this pass.
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
- **History-aware back-links (2026-09-19)** — every drill-down page's
  "&larr; back" link (player detail, a team roster, a game, Compare,
  Stats, the Injury Report, Trades, Wheel/Packs/Album, Standings, Teams
  hub, League Detail, Predictions History/Analytics, both admin pages —
  19 pages total) used to hard-code a single assumed parent route, even
  though most of these are reachable from several different places (a
  team roster alone has 7+ entry points: Standings, the dashboard,
  Injuries, a game, Teams hub, another player's page). Reported live: open
  a player from the Injury Report, tap "back", land on that player's team
  roster instead of the Injury Report. `core/nav-history.service.ts`'s
  `NavHistoryService` tracks the URLs this session has actually navigated
  through inside the app (a signal-backed stack pushed on every router
  `NavigationEnd`, capped at 50) and exposes `previousUrl()` — every one of
  those 19 back-links now reads
  `[routerLink]="navHistory.previousUrl() ?? '<old hardcoded target>'"`,
  with the label switching to a generic `nav.back` ("Back"/"Πίσω") instead
  of the old page-specific name whenever `previousUrl()` is real, since
  that name is no longer necessarily accurate. Falls back to the exact
  original hardcoded destination+label only when there's no real in-app
  previous page (this session's first render, a refresh, or a shared
  link) — deliberately not real browser history (`Location.back()`),
  since that could leave the app entirely on a fresh tab with no prior
  in-app navigation.
- Known bootstrap race: `AppComponent.restoreSession()` and the dashboard's
  standings fetch fire independently on app load. If standings resolve
  first, the dashboard doesn't yet know `favoriteTeamId` yet for that
  render. It no longer falls back to the top-ranked team for guests (that
  was actively misleading — it looked like "your team"), but a logged-in
  user can still briefly see no team-hero before it resolves. Self-corrects
  on the next interaction; not yet fixed with a resolver/bootstrap
  reordering.
- **"Add to Home Screen" prompts** (undocumented until 2026-09-15 — found
  by grepping the codebase, not from any changelog entry) —
  `shared/install-banner.ts` (`<app-install-banner>`, mounted globally in
  `app.component.html`) is a dismissible iOS/Android nudge, not a bare
  browser popup: it detects platform via user-agent (iPadOS 13+ reports as
  a plain "Macintosh", told apart from a real Mac only by
  `navigator.maxTouchPoints > 1`), waits until a visitor's 2nd visit before
  showing at all (`MIN_VISITS_BEFORE_SHOWING`, tracked in `localStorage` —
  never nags on a first landing), and backs off for 2 weeks on dismiss or
  effectively forever once `appinstalled` fires. **Deliberately doesn't
  depend on a service worker** — Chrome's native `beforeinstallprompt`
  normally wants one to consider the app installable, but this app ships
  none (see [[feedback_no_service_worker]]), so Android almost always
  falls back to the same manual numbered-steps panel iOS uses rather than
  a one-tap native install button; the native-prompt path (`deferredPrompt`
  + `appinstalled` listeners) still works unmodified if a service worker
  is ever added later. Skips itself entirely inside an in-app browser
  (Messenger/Instagram/Line/WeChat/Snapchat — `shared/in-app-browser.ts`'s
  `isInAppBrowser()`, UA-substring sniffing since there's no direct API for
  this) since its "tap the Share icon"/"tap the menu icon" steps assume a
  real browser's own chrome, which none of those in-app WebViews have. A
  visitor who arrives at `/register` with a `?ref=`/`?promo=` link
  (`isHighIntentArrival()`) skips the visit-count wait entirely — they
  followed a real invite specifically to sign up, not "just passing
  through".
  - **The Messenger/Instagram problem specifically**: those apps open a
    shared link in their own locked-down WebView with no address bar, no
    browser menu, and no `beforeinstallprompt` — there's no way to add to
    home screen from inside it at all, install-banner.ts included (it just
    stays hidden there, correctly, since its own steps don't apply). The
    only fix is getting the visitor into a real browser tab first.
    `shared/open-in-browser-banner.ts` (`<app-open-in-browser-banner>`) is
    the nudge for that: shown at most once ever per device (tracked the
    moment it renders, not just on dismiss — by a 2nd visit the visitor's
    either already acted on it or isn't going to), instructing them to tap
    the in-app browser's own "⋯"/browser-icon menu and choose "Open in
    Browser". The component itself doesn't own the "is this a
    shareable-link flow" judgment call — that's left to whatever page
    embeds it. `register.component.html` gates it behind
    `@if (referralCode() || promoCode())` (only a real `?ref=`/`?promo=`
    arrival is a shared-link flow there). **`landing.html` (2026-09-15)
    mounts it unconditionally** instead, right below the header — `/welcome`
    *is* the QR-flyer/shared-link destination by definition (see the
    Landing page section below), so unlike register there's no query param
    to gate on; every visitor there is a plausible Messenger/Instagram
    arrival. This closed a real gap that existed until this pass: the
    flyer's QR and any social-shared landing-page link previously gave a
    Messenger/Instagram visitor no nudge to escape the WebView at all.

## Design Requests

When asked to apply a specific font, color, or style change, apply it
directly across the app and stop — do not build comparison Artifacts,
specimen pages, or run research detours unless the user explicitly asks
to compare options first. A "change the font" request means app-wide,
across every role the current typeface fills (display/sans/mono, per the
font-swap history above), not just the one role that happens to be easiest
to change. This app went through roughly a dozen live font swaps in a
single day (see the `.font-display` comment above) precisely because
requests were applied directly and judged live, not staged as design
proposals — keep doing that, not the reverse.

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
"euroleague-app"): https://getclutchapp.com. `DATABASE_URL` points
at the same Neon instance as local dev — there's no separate prod database.

**Deploy workflow** — standard end-of-task sequence once a change is
ready: type-check the backend (`npx tsc -p tsconfig.json --noEmit`),
build the frontend (`ng build`), commit, push, then `railway up --service
euroleague-app --environment <dev|production>`. After deploying, verify
the change is **actually live** — `railway status` has reported a stale
"Building" state for a deployment that had already finished and moved to
a different, newer one; the reliable check is `railway logs
<deployment-id> --deployment` for a real "listening on" line, or diffing
the served JS bundle's content for a string unique to the change, not
just trusting the CLI's status output. Check once and report — don't poll
deploy status in a loop.

**Production data changes** — never run a bulk `UPDATE`/`DELETE` against
the production database without first showing the exact SQL (or
equivalent Drizzle/script code), showing a `SELECT` of the rows it would
affect, and getting explicit confirmation before executing. Always back
up (or dry-run against the `dev` Neon branch first, when available) before
a season rollover, a points reset, or any other one-off script that
mutates real rows — see the Season transition section's own scripts for
the established pattern.

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
  **Custom domain — done** (undocumented until 2026-09-15, caught the same
  way every other "Timeline correction" in this file has been: by comparing
  what's actually live against what this doc claimed). The "a more normal
  url" ask this bullet used to track as a TODO is resolved — production
  answers at `getclutchapp.com` (a real registered domain, not the DuckDNS/
  is-a.dev free-subdomain options this bullet used to list as candidates),
  wired up via `railway domain <hostname>` on the `euroleague-app` service
  same as documented. `qr-card.html`'s QR code already encodes
  `https://getclutchapp.com/welcome` for real. No record of exactly when
  this shipped — worth keeping in mind that infra changes like this one can
  land without a CLAUDE.md update alongside them.
- **Redeploy**: currently manual (`railway up --service euroleague-app`)
  from a local checkout — not yet wired to auto-deploy on `git push`.
- The same Railway account has an unrelated older project ("valiant-passion" /
  service "dsg-backend") — don't confuse it with this one.
- **Dev/staging environment (2026-09-10)** — the "no dev/staging environment"
  gap tracked below under Other known gaps (setup paused 2026-09-04 on a
  Windows machine) is done, finished on a macOS checkout where the
  `.railway/railway.ts` config-as-code brokenness documented there didn't
  reproduce (untested whether it's actually Windows-specific or just
  environment-specific — still avoided it here in favor of the same plain
  imperative `railway` CLI commands the paused note already recommended).
  One **euroleague-app** Railway project now has two environments sharing
  the one service: `production` (`main` branch, `clutchapp.up.railway.app`
  at the time — since renamed to `getclutchapp.com`, see the Deployment
  section's domain bullet above) and `dev` (`dev` branch, auto-generated
  `euroleague-app-dev.up.railway.app` domain — no custom domain chosen for
  it, not worth it for an internal staging URL). `dev` was created via
  `railway environment new dev --duplicate production`, which cloned every
  production env var, then only `DATABASE_URL` and `APP_BASE_URL` were
  overwritten to point at the dev branch/domain — every other var
  (`JWT_*_SECRET`, `ODDS_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
  `NODE_ENV=production`) is intentionally shared with prod, since none of
  them are database- or domain-scoped and `NODE_ENV=production` is what
  makes the refresh cookie's `secure` flag and the static-frontend serving
  behave the same as real production (`dev` is still served over real
  HTTPS, so there's no reason to run it as `NODE_ENV=development`).
  **Database**: a Neon branch named `dev`
  (`br-odd-dawn-axpif6gt`, project `EuroleagueProj`/`round-truth-86080193`)
  created off `production` (`br-late-queen-ax4i8kmo`) via `neonctl branches
  create --parent`, copy-on-write per Neon's own branching model — a full
  independent copy of real data at branch time, cheap to store, and
  completely isolated from prod from that point on (nothing written to `dev`
  ever touches `production`, and vice versa). `dev`'s `DATABASE_URL` uses
  the branch's own pooled connection string
  (`neonctl connection-string dev --pooled`), matching the `-pooler` suffix
  pattern production's own `DATABASE_URL` already uses. `neonctl auth`
  needed an interactive browser login (run by the user, not scriptable) and
  defaults to prompting for an org on every command once authenticated —
  pass `--org-id org-dark-hat-10818944` to skip that prompt in a
  non-interactive session.
  **First deploy**: `railway up --environment dev --service euroleague-app`
  from the `dev` git branch, verified live (`GET /` → 200,
  `GET /api/teams` → real rows read back from the Neon dev branch, not
  production). The schema-sync gap the original TODO flagged as the "real
  cost" is still exactly that — `db:push`'s `strict: true` interactive
  prompt (see Schema changes above) means a schema change still has to be
  pushed to `dev` and `production` as two manual, separate steps; nothing
  here automated that, it only made having a place to run the `dev` push
  against first possible. To use going forward: branch off `dev` (not
  `main`) for a change worth trying live before it's real, `railway up
  --environment dev` to deploy it there, verify at
  `euroleague-app-dev.up.railway.app`, then merge to `main` and
  `railway up --environment production` (or `--service euroleague-app` with
  production linked, the existing default) once satisfied. The CLI's linked
  environment/service (`railway environment <name>` / `railway service
  <name>`) is a local, per-checkout default — it was left pointed back at
  `production`/`main` after this setup, not `dev`, so an unqualified future
  `railway up` doesn't accidentally deploy to the wrong one.

## Branding

- **Current mark ("v14", 2026-09-14)** — the logo went through roughly a
  dozen rejected directions (isometric bars, ring+ball, an icon-as-"C"
  wordmark, a pure-SVG "Clutch"+curved-line+ball comet mark, several
  hand-drawn basketball icon/shading attempts, a "Bracket" mark) before
  landing on the current one: a user-supplied Canva illustration — a
  backboard/hoop/net graphic with an orange basketball, and a bold serif
  "Clutch" wordmark stacked below it (icon-above-text, not side-by-side).
  None of the earlier directions are live anywhere in the app; if that
  history ever matters again it's in git log, not worth re-deriving here.
  - **Two real source exports, not an algorithmic recolor**: a light
    variant (`clutch-mark.png`) and a separately-designed dark variant
    (`clutch-mark-dark.png`) — both genuinely transparent PNGs. Earlier
    attempts (v11–v13) tried to derive the dark variant by recoloring the
    light one (threshold bands, flood-fill masks, chroma-key de-matting,
    boundary color-decontamination) and kept failing in different ways
    (fringing, blocky edges, dark-on-dark elements collapsing together) —
    don't re-attempt a recolor; a real second Canva export was what
    actually worked, and no processing pipeline is needed for either file.
  - **Two lockups**: the full mark (icon + baked-in "Clutch" text) is used
    at 96px on the login/register/forgot-password/reset-password/claim
    hero and via `.logo-mark` (aspect-ratio matches the real trimmed
    dimensions — 738×698 light / 592×560 dark) on the splash screen. A
    cropped icon-only variant (`clutch-icon.png`/`clutch-icon-dark.png`,
    cut at the icon/text boundary since the baked-in text is illegible at
    icon size) is used on the nav bar and `/welcome`'s header, each paired
    with a real, live "Clutch" `<span>` — same pairing every earlier
    pictorial mark used. `qr-card.html` is a fixed-dark card regardless of
    viewer theme, so it always points at `clutch-mark-dark.png` only.
  - **Theme switching**: every usage renders both a `.brand-mark-light`
    and `.brand-mark-dark` `<img>`, toggled via `styles.css` (same
    dark-unscoped-default/light-explicit-override convention as
    `.icon-ink-invert`) — necessary because this is a raster mark with no
    vector source to recolor via `var(--color-ink)` the way the old SVG
    wordmarks could.
  - **Nav wordmark font (2026-09-14, undocumented until this pass — caught
    the same way every prior "Timeline correction" in this file has been,
    by checking what's actually live)**: the nav's "Clutch" `<span>` uses
    a new `.brand-wordmark` class (`styles.css`, "Bigshot One" from Google
    Fonts) instead of the regular `font-sans` stack, to echo the logo's
    own bold vintage-serif wordmark. The logo's actual typeface ("Kabal")
    isn't genuinely free (checked directly — only unlicensed mirrors claim
    otherwise), so this is a free lookalike, not the exact face. No
    Greek-coverage requirement, same exemption as the logo's own literal
    "Clutch" text — it's a proper noun, never translated.
  - **Favicon/PWA icons/email logo**: rasterized from these same sources
    via a temporary local `sharp` install (`npm install sharp --no-save`,
    run, then `npm uninstall sharp` — no icon-generation pipeline is
    checked in). Files: `frontend/public/favicon-v14.png`,
    `frontend/public/icons/icon-v14-*.png` (8 sizes), referenced from
    `index.html` (favicon link + apple-touch-icon), `manifest.webmanifest`
    (all 8), and `backend/src/services/email.ts`'s `LOGO_URL`. Angular's
    `assets` config just globs `public/**` — no per-file asset entry to
    update. **Bump the version suffix (`v14` → `v15`, etc.) on any future
    icon-visible change and rename every file** — a query-string cache-bust
    was tried once and proved unreliable (a browser tab's favicon
    specifically can ignore it, caching by origin+path); a genuinely new
    filename is the only cache buster confirmed to work.
  - **Fantasy court center-court decal now uses the real mark too
    (2026-09-16)** — `shared/court-background.ts` used to render a plain
    vector "C" glyph here instead (extracted from an earlier Archivo Black
    wordmark attempt via `fontTools`), specifically because the current
    mark is a raster PNG with no vector source. Switched to an inline SVG
    `<image>` referencing `clutch-icon-dark.png` directly (same file the
    nav bar's dark-mode icon uses) at low opacity (0.2) — there's no
    per-decal rasterization step needed since `<image href>` just embeds
    the PNG as-is; the old vector "C" is gone from this file entirely, not
    kept as a fallback.

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

## Landing page (2026-09-11)

- **`/welcome`** (`frontend/src/app/features/landing/`) — a public,
  unauthenticated pitch page for cold traffic (the QR card, a shared link),
  deliberately not the `""` route (the real dashboard, unchanged for anyone
  who already knows the app). `LandingComponent.ngOnInit` bounces an
  already-logged-in visitor straight to `/` rather than showing the pitch
  again; `app.component.ts`'s `hideChrome()` (keyed on the current URL
  being exactly `/welcome`) suppresses the logged-in app shell's top bar,
  desktop rail, and mobile tab bar specifically on this route — those
  otherwise render unconditionally around every route including this one.
  **Timeline correction (2026-09-15)**: this bullet originally said "not
  yet live" — stale. `/welcome` has since been redeployed and is live in
  production, and the custom-domain decision this note was waiting on has
  also landed (see the Deployment section's domain bullet). `qr-card.html`'s
  QR now encodes `https://getclutchapp.com/welcome` for real — that's what
  the printed flyer/banner should point at.
  **Root-URL sharing for social (2026-09-17)**: IG/social posts share the
  plain `getclutchapp.com` now instead of typing `/welcome` into every bio
  link — `frontend/src/app/core/first-visit.guard.ts`, added as
  `canActivate` on the `""` route, bounces a visitor to `/welcome` only when
  they're both logged out *and* have never been marked as visited
  (`frontend/src/app/shared/visited.ts`'s `clutch-visited` localStorage
  flag — a one-time "have they ever been oriented" marker, deliberately its
  own key rather than reusing install-banner.ts's own visit *counter*, which
  is a different concern). `LandingComponent.ngOnInit` also marks it, so a
  visitor who lands on `/welcome` directly (an old link, or the guard's own
  redirect) isn't shown the pitch again on their next plain root visit. The
  guard waits on `AuthService.restoreSession()` rather than reading
  `currentUser()` immediately — that signal is still null for the first
  stretch of boot even for a real logged-in user restoring their session off
  the httpOnly refresh cookie (the bootstrap race documented under Frontend
  architecture below), and deciding before that resolves would wrongly bounce
  a real returning user to `/welcome`. `restoreSession()` itself was made
  idempotent (cached via `shareReplay`, `sessionRestore$`) so the guard and
  `AppComponent`'s own unrelated boot-time call share one `/auth/refresh` +
  `/users/me` round trip instead of firing two. The QR flyer (`qr-card.html`)
  is unaffected — it already points at `/claim?ref=...`, a different flow
  entirely, not `/welcome`.
  - **Interactive "reskin" demo**: tapping a real team logo (fetched from
    the already-public `GET /api/teams`) repaints a small preview card in
    that team's kit colors — the app's actual core mechanic
    (`ThemeService.applyTeam`), demonstrated rather than described. Never
    calls `applyTeam()` itself though — that would cache into
    `localStorage` and mutate `<html>` globally, clobbering a real logged-in
    user's actual colors if this ever ran while signed in. Instead
    `previewPrimary` (in `landing.ts`) computes a scoped value written only
    to a local `--accent-primary` custom property on the preview's own
    wrapper div; Tailwind's existing `bg-team-primary`/`border-team-primary`
    utilities pick it up via normal CSS cascade with zero effect outside
    that one element. Raw team colors are used at full intensity when
    already bright enough (a real live-reported bug: blending everything
    toward white first turned Olympiacos red into pink) — only a color dark
    enough to actually risk disappearing (checked via `hexLuma`) gets
    lifted, and a genuinely near-black one blends toward the app's own
    `--color-muted` grey rather than white, since mixing near-black with
    white still reads as a washed pastel.
  - **"Cards & collectibles" step showcases one real card per catalog
    tier** (common/rare/legendary/coach) using the actual
    `CollectibleCardComponent`, not a hand-drawn approximation — real player
    photos/names come from the same public `GET /players/advanced-stats`
    payload `/compare` already uses unauthenticated, shuffled once per page
    load (`shuffled()` in `landing.ts`) so the showcase doesn't always land
    on 3 players from the same club (a real reported bug — the payload's
    own row order groups by team). The coach card uses a real team's actual
    head coach name. **Real layout bug, took three live-reported rounds to
    actually fix**: `CollectibleCardComponent`'s name/badge/banner text is
    fixed-px, not proportional to its own `maxWidth` input — shrinking that
    input directly (tried at 104px, then 76px) either collapsed the whole
    card to a ~14px dot (a bare flex row with no `flex-shrink:0` lets
    flexbox's default shrink squeeze items toward nothing instead of
    wrapping) or left the fixed-size banner text dominating the tiny card
    face and hiding the photo under it entirely. Fixed by rendering each
    card at its real, correctly-proportioned size (130px, matching Album's
    own grid) and scaling the *whole* rendered card down via a CSS
    `transform: scale()` to the actual on-page footprint — photo, banner,
    and badge all shrink together in proportion, rather than shrinking just
    the box. The four cards fan out (rotation + a slight vertical drop on
    the outer two, pivoting from the bottom edge) rather than sitting in a
    grid, echoing `shared/splash.html`'s own mini-card fan.
  - Six-slide carousel (autoplaying every 4.5s, stopping on any manual
    dot/arrow/team-pick interaction): team-color demo, live scores,
    predictions & points, Fantasy Five, cards, leagues, then a closing CTA
    slide (icon "zap") with a real `routerLink="/register"` button reading
    "Γίνε Clutcher" ("Become a Clutcher") — scaled up via `transform:
    scale()` rather than fighting `ButtonDirective`'s own size classes with
    more of the same (unreliable, depends on Tailwind's generated rule
    order). The copy pane has a fixed `min-h-[260px]` — real reported bug:
    without it, a shorter step's pane would shrink, carrying the prev/next
    arrow buttons out from under the cursor on a fast double-click.

## Card Battles (2026-09-22)

- **Shipped as a single-card instant duel, after four rejected directions
  the same day** — worth reading in full if this ever needs another pass,
  since the history is what actually explains why it's shaped this way.
  Original pitch: a literal "3D battle" (rejected immediately for build
  cost — no game engine, no P2P netcode). v1: a turn-based ATK/DEF/HP fight
  over 5 cards. v2, after "I don't like how it works": 3v3, tier/foil
  damage multipliers, a Pokemon-style active-card duel with lunge/shake
  animations. v2 still didn't land — "I still don't like the style...
  confusing to actually play... doesn't feel like a real card battle" —
  the signal the whole *mechanic* was the mismatch, not its skin: a
  fabricated combat formula on a stats app reads as arbitrary next to real
  basketball. v3: tied the outcome to a real EuroLeague round's results
  instead (3-card squads, summed real PIR) — but the very next reaction was
  "it's almost the same with fantasy but with 3 players", a fair call:
  mechanically it *was* just a smaller Fantasy Five. Asked for another PvP
  angle entirely; landed on **v4 (shipped)**: one card each, resolved
  *instantly* as a weighted-random duel, no squad, no waiting on a real
  round — genuinely distinct from Fantasy Five, and simple enough to make
  the one dramatic reveal moment worth animating well. Every prior
  version's code/schema was deleted outright each time, never kept behind
  a flag — nothing in production ever depended on any of it.
  - **Mechanic** (`services/battles.ts`): `battles` (schema.ts) holds both
    sides directly as two nullable collectible FK columns
    (`challengerCollectibleId` set at creation, `opponentCollectibleId` set
    at accept) — no child table at all, since it's always exactly one card
    per side; v2's `battlePicks` table was dropped along with everything
    else. `computeCardPowers` gives each card a power score — tier sets a
    floor (common 20 / rare 35 / legendary 55), real current-season-or-
    career PIR (same fallback chain used everywhere else this app derives
    a card stat from player data) adds on top. `resolveDuel` is a
    proportional weighted coin flip (`P(challenger wins) = powerA /
    (powerA + powerB)`) — a much stronger card is heavily favored but never
    guaranteed, confirmed live at ~83% (25/30) for a legendary vs. a common
    in a real trial run. Coach cards still excluded (no `players` row, so
    no real PIR to weigh).
  - **Resolution is synchronous, not read-driven** — a real behavioral
    simplification from v2/v3, not just a smaller schema: `POST
    /battles/:id/accept` (routes/battles.ts) computes both powers and rolls
    the duel *immediately*, inside one transaction (`for("update")` lock so
    a double-accept can't roll twice), sets `status: "finished"` and
    `winnerUserId` right there, and grants the winner `BATTLE_WIN_POINTS`
    (25) via the same `point_adjustments` self-attributed-grant shape
    `packs.ts` already uses. `GET /battles/:id` is a pure read with zero
    side effects as a result — a real, deliberate contrast with v2/v3's
    "resolve as a side effect of a GET" pattern, since there's no longer
    anything to wait on.
  - **More interaction + "show card of player" (same-day follow-up,
    direct ask)**: the opponent now sees the challenger's already-picked
    card *before* choosing their own (`battle-detail.html`, the `pending &&
    iAmOpponent()` branch) — `GET /:id` already returned
    `challengerCard` regardless of status, so this needed no backend
    change, only surfacing data the route already sent. Turns picking into
    a real reaction (go bigger, or risk a weaker card anyway) instead of
    two blind simultaneous picks.
  - **3D reveal** (`features/battles/battle-detail.css`, no library) — the
    duel is already decided server-side by the time this plays; it's pure
    presentation. `revealStage` (`battle-detail.ts`) steps through
    idle → approaching → clashed → revealed on a fixed timer
    (`setTimeout` chain matching the CSS transition durations) the moment a
    finished battle loads. `perspective` + `rotateY` slide both cards in
    from off-screen, "clash" in the middle with a brightness flash, then
    the loser rotates face-away, grayscales, and shrinks while the winner
    scales up slightly — a real 3D transform, not a 2D fake, but plain CSS
    (`transform-style: preserve-3d`), the same "no engine needed for a
    single contained moment" reasoning that scoped down the original 3D
    pitch. **Basketball effect** (direct ask, same follow-up): reuses
    `NavIconComponent`'s existing `"ball"` icon (no new asset) between the
    two cards — dribble-bounces while the cards close in, spins on
    impact, then swishes away (fades + drops) once the result shows, with
    the plain "vs" label crossfading in behind it at rest.
  - **Verified live against the `dev` Neon database** (not production), one
    end-to-end script driving the real HTTP routes: every validation path
    (unowned card, self-challenge, wrong acceptor, wrong decliner, double-
    accept), the full challenge → accept → instant-resolve flow, exactly
    one reward row landing on the actual computed winner, and a 30-trial
    statistical run confirming the power-weighted odds behave as designed
    (favored, not guaranteed) — all passed. Not verified in a live browser
    — the Claude in Chrome extension wasn't connected this session.
  - **Schema applied to `dev` only, not production** — the current
    single-table `battles` shape (schema.ts) exists on the `dev` Neon
    branch only; apply the same `CREATE TABLE` to production's
    `DATABASE_URL` before this code deploys there, per the Schema-changes
    workflow above. (Note: this table has been dropped and recreated three
    times on `dev` alone across today's four versions — always the
    dev-only branch, production was never touched mid-iteration.)
  - **Real infra incident during the v2 verification pass, worth
    remembering regardless of the mechanic**: the first attempt to point
    the local backend at `dev` silently failed — a stale `tsx watch`
    process from an old, unrelated session (this machine had 8 of them
    accumulated, dated across two weeks, none ever cleanly killed at
    session end) was still squatting on port 4000 with the default `.env`
    (production) `DATABASE_URL`. Two throwaway test accounts briefly leaked
    into production before this was caught and cleaned up (confirmed
    nothing else was affected). Fixed by killing every stale process on the
    machine and, critically, **verifying which database a freshly started
    local server actually landed in by registering a throwaway user and
    checking for its id on both databases directly** — an HTTP 200 or a
    clean startup log looked identical regardless of which DB was actually
    wired up. Do this trace-check every time before trusting a "pointed at
    dev" local server for anything beyond a `GET`.
- **Real bug caught live, same day, worth remembering as a general Angular
  signals footgun**: "everything is laggy, like animating without ending".
  `BattleDetailComponent`'s constructor `effect()` (watching
  `EventsService.lastBattleUpdate()`) read `this.battle()` directly as
  `current` — but that same effect's body calls `refresh()`, which writes
  `this.battle`. Since `battle` was a tracked dependency of the very effect
  that writes it, every write re-triggered the effect, which could call
  `refresh()` again, forever — a silent infinite fetch loop present in
  *every* version of this component since the very first one, only made
  visible once the basketball's `infinite` CSS bounce gave it something to
  visibly keep restarting. Fixed with `untracked(() => this.battle())` so
  only a genuinely new `lastBattleUpdate()` push re-runs the effect; also
  added a `hasPlayedReveal` guard so the reveal animation itself only ever
  plays once per battle regardless. Checked for the same read-what-you-
  write pattern elsewhere (`trades.ts`'s equivalent effect) — clean, this
  was specific to battle-detail.ts, not a systemic issue.
- **Same-day follow-ups, all direct asks**:
  - **Real-time challenge toast** (`shared/battle-challenge-toast.ts`,
    mounted globally in `app.component.html` next to `install-banner.ts`)
    — "immediately notify a user... without having to reach my leagues".
    Leagues has no nav icon of its own (see Frontend architecture's nav
    bullet), so there was nowhere to hang a persistent badge; the app-wide
    SSE connection already exists regardless, so a toast that pops up over
    whatever page you're on was the natural fit instead. Fires on a
    `battle-update` push with `reason: "challenged"`, fetches the
    challenger's name, shows a dismissible "X challenged you to a duel!"
    with a one-tap "View challenge", auto-hides after 10s. Only fires while
    this tab has a live connection — a challenge sent while the app is
    fully closed still only surfaces via the league's Battles tab later,
    same limitation every SSE-pushed feature in this app already has (real
    push notifications to a closed app/device would be a much bigger,
    separate feature).
  - **Card photo now shown in the Battles list** (`GET /battles/mine`,
    `league-detail.html`) — that list was text-only (name + status), no
    visual at all. Carries the challenger's card (name/tier/image/team) on
    each row now, rendered via the existing `PlayerPhotoComponent` (same
    circular-photo-with-jersey-fallback component roster/game pages already
    use) rather than a full `CollectibleCardComponent`, which reads too
    heavy for a compact list row.
  - **Card power made visible, not just invisible math** — "stats should
    also count for the coin flip" was already true (`computeCardPowers`
    factors real PIR in alongside tier), this surfaces it instead of it
    only mattering silently server-side. New `POST /battles/card-powers`
    (one request covers every candidate card in the picker, not a round
    trip per tap) shows a power number under each of your own cards while
    picking; `GET /battles/:id` now also returns `challengerPower`, so once
    you can see the challenger's card (the same-day reveal above) you also
    see a live win-% for whichever of your own cards is currently picked —
    turns picking into an actually informed decision instead of a blind
    guess, tying the "stats should count" and "more interaction" asks
    together in one change.
  - **Discussed but not built, offered as follow-ups**: a rematch/best-of-N
    flow, a per-league duel win/loss record, and a post-duel reaction/emoji.
    None built yet — flagged for whichever the user actually wants next.
- **Real infinite-farming exploit caught live, fixed same day** — "thats by
  the way infinite farming glitch. users should risk something." The
  original win reward (`BATTLE_WIN_POINTS`) was a flat `point_adjustments`
  grant minted from nothing on every resolution, with zero cost to
  challenge. Since a duel is a coin flip, not a skill contest, two players
  (colluding or not) could just duel back and forth forever, each netting
  free points roughly half the time, for free — exactly the kind of
  "infinite money" exploit this app's economy has been careful to avoid
  everywhere else (see e.g. `forceNewLegendary`, legendary duplicates never
  selling for points). Explicitly **not** fixed by wagering the card
  itself (discussed and rejected earlier the same day, same reasoning as
  above) — fixed by making the points genuinely zero-sum instead:
  `BATTLE_STAKE_POINTS` (renamed from `BATTLE_WIN_POINTS`, still 25) is now
  a real stake taken from the loser's own balance via two
  `point_adjustments` rows at resolution (+25 winner, -25 loser, both
  `countsTowardRanking: true` — a duel result is a competitive outcome, not
  a redemption spend like a pack purchase, so it should move the
  leaderboard). Both `POST /battles` and `POST /battles/:id/accept` check
  `getUserPoints()` first (same "check affordability before the spend"
  pattern `packs.ts` already uses) — the *opponent's* balance at either
  call, and the *challenger's* balance again at accept time specifically
  (`CHALLENGER_INSUFFICIENT_POINTS`), since time may have passed since they
  sent the challenge and they could have since spent the points elsewhere.
  Frontend (`battle-detail.ts`) fetches the same `PredictionSummary.points`
  Store/Packs already use to show/gate on the current balance, with a
  stake/balance readout in the card picker and both buttons disabled below
  the stake. **Verified live against `dev`**: a 0-point account is rejected
  outright; after granting both sides 100 points, a resolved duel showed
  the combined total unchanged before vs. after (200 → 200, genuinely
  zero-sum) with exactly one +25/-25 pair of rows on the right two users;
  draining the challenger's balance after they'd already sent a challenge
  correctly blocked the opponent's accept with `CHALLENGER_INSUFFICIENT_POINTS`.
- **Stake made variable, same day** — two direct asks together: "when user
  accepting the challenge he should be informed with the points he loses"
  and "probably lower tier cards should get more points when competing
  against higher ones". The flat 25pt stake became `computeStakeForWinProb`
  (`services/battles.ts`, `BATTLE_STAKE_BASE` 25 / `BATTLE_STAKE_CAP` 100) —
  deliberately reusing the *exact* shape of `points.ts`'s own
  `pointsForCorrectPick` (predictions): the **winning** side's own pre-duel
  win probability sets the payout, `min(CAP, max(BASE, round(BASE /
  winProb)))` — a heavy favorite winning pays close to BASE, a real
  underdog pulling off the upset pays up to CAP. Both win-scenario stakes
  are computable the moment both cards are known (accept time, before the
  roll), so `POST /:id/accept` checks each side can cover *their own*
  potential loss precisely (not the old flat 25) before rolling, and
  freezes the actual transferred amount on a new `battles.stake_points`
  column (schema change applied directly to `dev`) so the reveal screen can
  show the real number instead of a hardcoded "+25". Frontend
  (`battle-detail.ts`) duplicates the same pure formula client-side (no new
  round trip) to show a live "+N pts if you win / -M pts if you lose"
  readout as the accepting player tries different cards — answers both
  asks in one change, same as the earlier photo/power-visibility pass did.
  **Verified live**: ran real duels until both a favorite-win and an
  underdog-win were observed, confirmed the underdog's win stake (88) was
  genuinely larger than the favorite's win stake (35) for the same
  legendary-vs-common matchup.

## Other known gaps

- A traded player's season-long stat averages (across both teams) are
  attributed entirely to their *current* team's roster page, not split per-team.
- `boxscore_sync.py` was re-run in full on 2026-08-26 (426 `final` games,
  7948 rows) as part of fixing the `minutes`-parsing bug documented above —
  treat any earlier "checked on <date>, covers N of M games" note as stale.
- Redeploys to Railway are manual, not triggered by `git push` (see
  Deployment above).
- **`dev`'s database schema silently drifts behind production** — every
  schema change in this app is applied by hand against `DATABASE_URL`
  (see Schema changes above), and nothing ever reminds anyone to run that
  same SQL against the `dev` Neon branch too. First caught 2026-09-17
  verifying the Fantasy auto-fill tool above (`dev` was missing
  `fantasy_price_change_log`, `fantasy_coach_price_change_log`, and
  `fantasy_round_points`, all added to production 2026-09-16 — `GET
  /fantasy/lineup` 500'd and the `[fantasy daily reprice]` background job
  failed every run on `dev` because of it) — then confirmed much larger
  the same day once `main`'s ~80 commits of accumulated work were finally
  merged into the long-stale `dev` git branch: a full column-level diff
  (`information_schema.columns`, not just table names) found `dev` also
  missing `favorite_players`, `promo_code_redemptions`,
  `legendary_polls`, `legendary_poll_candidates`,
  `legendary_poll_votes`, and `promo_codes.quantity`. All hand-added to
  `dev` to restore parity (2026-09-17) — but **this was reactive, not a
  fix**: nothing prevents the same drift from recurring the next time a
  schema change lands only on production. A full recheck (`select
  table_name, column_name, data_type, is_nullable from
  information_schema.columns where table_schema='public'`, diffed
  between the two `DATABASE_URL`s) found zero drift immediately after
  this pass — that's a snapshot, not a standing guarantee. Worth running
  that same diff again before trusting `dev` for testing anything that
  touched the schema recently, or before a future `dev`→`main` git merge
  after a long gap like this one, until this becomes either real
  migrations (checked in, run against both databases) or a standing
  checklist step on every schema change.
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
- ~~No dev/staging environment~~ — done, see the Deployment section's
  "Dev/staging environment" entry above. Local dev's own `DATABASE_URL`
  still points at the same shared production Neon database it always has
  (see Environment variables above) — only the *deployed* Railway service
  gained an isolated `dev` counterpart, local dev itself was out of scope
  for this pass and still writes straight into real data.
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
  that had no staging environment yet at the time (the gap tracked under
  Other known gaps below — since closed, see the Deployment section's
  "Dev/staging environment" entry):
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
- **Fantasy Five simulation button — built (2026-09-17, same day it was
  flagged)**. Scoping it turned out to answer its own open design
  questions: reason (2) from the original note — exercising Fantasy scoring
  against real-shaped data without waiting for real rounds — was already
  fully covered by existing tools. Fantasy points are read straight off
  `games`/`player_game_stats` (`GET /fantasy/lineup`), the exact tables
  `POST /api/events/simulate/round` already fabricates finals into, and
  `checkAndGrantFantasyRoundPoints` already fires correctly the moment a
  round's games are all final — verified live (see below), not assumed.
  So the only real gap was reason (1), auto-generating a squad, which is
  what got built:
  - `services/fantasyScoring.ts`'s `POST /lineup/batch` validation+write
    logic (round lock, slot-role counts, one-captain rule, position/club
    quotas, transfer limit, budget check, the transaction) was extracted
    into a standalone `saveFantasyLineup(userId, season, round, entries,
    coachTeamId)` — the route now just does request-shape parsing
    (types/uuid format/enum) and delegates. `getBudgetCap` moved from a
    route-local function to an export there too.
  - `autoFillFantasySquad(userId, season, round)` (same file) builds a
    random valid squad — reserves `COACH_MIN_PRICE` of budget for the
    coach, then per position (`FANTASY_POSITION_QUOTA`) shuffles that
    position's active-player pool and greedily takes affordable, club-
    limit-respecting picks, falling back to a cheapest-first pass (budget
    constraint dropped, club limit still enforced) if the randomized pass
    can't fill a quota — then calls `saveFantasyLineup` with the result.
    Never a special-cased shortcut: an auto-filled squad passes the exact
    same rules a real save does, since it's *written* by the same function.
  - `POST /fantasy/admin/auto-fill` (`requireAuth, requireAdmin`) — targets
    the calling admin by default, or `userId` in the body (e.g. a freshly
    created test account). A single "Auto-fill squad" button was added to
    the Fantasy Five page (admin-only, current-round-and-unlocked only).
  - **Verified live against the Railway `dev` environment's database, not
    production** (explicit instruction this session: "testing should be
    done on development database for now") — auto-filled a squad for
    round 1 (10 players correctly split 5 starter/1 sixth-man/4 bench, one
    captain, under the 100.5cr budget cap), then called the existing
    `POST /api/events/simulate/round` to finalize all 9 of that round's
    games, then re-read `GET /fantasy/lineup`: `roundComplete: true`,
    scoring computed correctly from the fabricated box scores, and
    `newFantasyRoundPoints` showed a real grant — confirmed as exactly one
    `point_adjustments` row server-side (the `onConflictDoNothing` claim-
    first guard holds under a repeat read, same as `roundRewards`).
  - **Real bug caught during this verification, unrelated to the new code**:
    `GET /fantasy/lineup` 500'd with `relation "fantasy_round_points" does
    not exist` (and `[fantasy daily reprice] failed: relation
    "fantasy_price_change_log" does not exist` in the logs) — see the new
    "dev/prod schema drift" gap below. Fixed by hand-applying the same
    `CREATE TABLE` for `fantasy_price_change_log`,
    `fantasy_coach_price_change_log`, and `fantasy_round_points` to the
    `dev` Neon branch that production already had. Not a code bug at all;
    dev's schema had simply never caught up.

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
    **Real 2026-27 club photos start appearing, 2026-09-16** — asked which
    script surfaces real photos as clubs release their actual 2026-27
    rosters. Neither existing photo source covers this: `player_stats_sync.py`
    still returns zero rows for `E2026` (confirmed live — the season
    genuinely has zero played games), and `backfill-player-photos.ts` only
    ever sources last season's (2025-26) photos. Checked the club-roster
    endpoint `roster_sync.py` already hits directly (`/clubs/{code}/people`)
    and found its `person.images` field — documented in that script as
    always `{}` when written — has started carrying real photos for a
    handful of players (5 of ~330 as of this check, across 5 different
    clubs; keyed `"action"` for most, `"headshot"` for one) even though no
    game has been played. `roster_sync.py` now captures this going forward
    (`extract_photo_url()`, written via `COALESCE(new, existing)` so a run
    that finds nothing for a given player — still nearly everyone — can't
    blank out a real photo already on file). Since this machine's
    `sync-py/venv` doesn't run locally, `npm run roster:sync-photos`
    (`scripts/sync-roster-photos.ts`) is the TS/fetch equivalent — same
    workaround as `backfill-player-photos.ts`/`backfill-career-stats.ts` —
    and is the one to actually run for this locally; unlike that one-off,
    it's meant to be safe to re-run periodically (unconditionally
    overwrites with whatever the feed has *now*, so a real 2026-27 photo
    supersedes an older 2025-26 one) since clubs are registering photos
    gradually rather than all at once. Run once already (2026-09-16),
    backfilling exactly the 5 players found live.
    **Follow-up same day: those photos (and the 2025-26 backfill's own 208)
    weren't reaching card images at all** — user report ("many players do
    have photos... I don't see all players there [on cards]") surfaced two
    separate real gaps, not one. First,
    `collectibles:expand`(`expand-collectibles.ts`) was re-run and inserted
    292 common + 292 rare + 10 legendary cards for players who'd joined a
    roster since the catalog was last expanded — it only ever creates a
    card for a player who doesn't have one yet, it was just stale.
    Second, and the actual root cause of "many players have photos but
    their cards don't": `collectibles.image_url` is a one-time snapshot of
    `players.photo_url` taken only at insert (see `expand-collectibles.ts`
    and the "Jersey-style placeholders" pass above that nulled every
    `image_url` on 2026-09-02) — it is never re-synced afterward, so the
    208 players photo'd by `backfill-player-photos.ts` on 2026-09-09 (and
    now this session's 5 new ones) never propagated to their
    *already-existing* card rows at all, only to a brand-new card created
    after their photo existed. New one-off-but-rerunnable script,
    `npm run collectibles:sync-images`
    (`scripts/sync-collectible-images.ts`) — matches each collectible to
    its player the same way `expand-collectibles.ts` matches on insert
    (team + normalized display name) and overwrites `image_url` wherever
    it disagrees with that player's current `photo_url`, only ever when
    the player actually has one (never blanks a card back to null). Run
    live 2026-09-16: 337 of 955 collectibles updated — confirms the gap
    was real and large, not just the 5 from today. Run this (or fold it
    into `collectibles:expand` itself as a real follow-up, not done here)
    any time `players.photo_url` gets backfilled for a batch of players
    whose cards already exist, not just for new players.
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
