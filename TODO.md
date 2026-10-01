# TODO

Open follow-ups deliberately deferred mid-session. Kept in the repo (not
just in one machine's Claude memory) so every session on every machine sees
them. Remove an entry once it's done.

## 1. Import real Dunkest (EuroLeague Fantasy) prices into Fantasy Five (deferred 2026-09-18)

User directive: **"trust dunkest prices for now"** — overwrite our computed
Fantasy Five prices with real EuroLeague Fantasy quotations for every
player/coach we can confidently match, until our own in-season data is good
enough on its own. Partial overwrite of values only, no schema/formula
change; unmatched players keep their computed price.

Steps:
1. Get a fresh Bearer token from the user's own EuroLeague Fantasy account
   (manual: browser DevTools → Network → filter `dunkest` → copy the
   `authorization` header). No public API-key flow. Never commit the token.
2. Pull every page of
   `https://fantaking-api.dunkest.com/api/v1/competitions/49/stats/players/table`
   (`per_page=100`, `active_players=true`, plus `stats_type=avg`). Send
   `origin`/`referer: https://euroleaguefantasy.euroleaguebasketball.net`
   or it 401s. Use `meta.last_page` for the page count (was 4 pages / ~344
   rows incl. ~21 `"Head Coach"` rows on 2026-09-18). Response shape:
   `data.columns` (field names) + `data.players[].row` (positional values);
   fields include `name` ("F. Last"), `position`, `team`, `quotation`
   (price), `fpt`.
3. Export from **production**: active `players` (id, name, team) and
   `teams` (id, code).
4. Match on last name + team: our `players.name` is `"LAST, FIRST"` (part
   before the comma) vs Dunkest's `"F. Last"` (last token). Dunkest's
   `team` is the public-site abbreviation (`KBA`/`RMB`/…), so map through
   `frontend/src/app/shared/team-display-code.ts` first, not raw
   `teams.code`. Matched 268/344 (~78%) on 2026-09-18 — misses are mostly
   name-format issues ("Jr", multi-word surnames), worth hand-checking.
5. Generate one `BEGIN; UPDATE …; COMMIT;` block against
   `player_fantasy_prices` / `coach_fantasy_prices` (season `2026-27`) and
   apply to production after the usual show-SQL-and-confirm step.

Known issues:
- Claude Code's auto-mode classifier blocked the production apply step last
  time. Either grant an explicit permission rule or hand the user the
  generated `.sql` file to run via `psql` themselves.
- The `dev` DB only matched 1/323 — its roster/team assignments are stale
  vs real 2026-27 rosters. Target production directly.
- Nothing from the 2026-09-18 pull was kept (it lived in a session temp
  dir) — re-pull fresh data.

## 2. Validate the round-to-round Fantasy price delta against real data (deferred 2026-09-18, revisit after round 1)

- Day-one pricing (`computeFantasyPrice`) was calibrated against real
  Dunkest quotations on 2026-09-18 (min 4, Vezenkov anchor 17, new
  `FANTASY_NO_DATA_PRICE = 6` — all confirmed right).
- The per-round delta in `backend/src/services/fantasyDailyReprice.ts`
  couldn't be validated then — zero real games had been played. It has
  since (2026-09-21) been switched to EuroLeague Fantasy's published
  formulas (player `(N − P×1.1)/25`, coach `(N − P)/40`), but those have
  still never been checked against real observed price movement.
- **How**: once round 1 is final (first tipoff was 2026-09-24), pull real
  Dunkest quotations (same token/endpoint as #1), compare the real
  per-player price change against what our formula produces for the same
  real stat lines. No pre-round snapshot survived, so compare against a
  before/after pair across round 2 if needed (grab a snapshot right before
  round 2 tips off).

## 3. Live quarter predictions mini-game (deferred 2026-09-29, user deciding)

Idea: more daily interaction than the once-a-day Jump Ball, tied to real
games. During a live game, pick **who wins the next quarter** (home/away).

- **Only the next quarter is open**: pre-game Q1, during Q1 pick Q2, etc.
  A quarter locks the moment it starts. No OT picks.
- **Scoring**: correct = 5pts, wrong = 0, tied quarter = push (0). Points
  are spendable only and **don't count toward the leaderboard**. Worked
  out on read from `games.home/away_score_by_quarter` (no payout job):
  one more subquery in `getUserPoints`'s existing statement.
- **Economy**: roughly 50/50 picks, so ~2.5pts expected each. About 30pts a
  round for someone following 3 games, ~100 if they pick all 40 quarters.
  Points only, so players who never buy are unaffected. Add a quarter-picks
  option to `season-simulation.ts` and re-run before shipping.
- **Build**: new `quarter_predictions` table (user, game, quarter 1-4,
  pick, created_at; one pick per user+game+quarter), applied to prod
  **and** dev. `GET/POST /api/quarter-picks` with server-side
  open-quarter checks. A "Next quarter" panel on the live game page plus a
  compact version on Live Center cards (no new tab). The existing
  live-game updates already carry quarter changes for lock/result UI.
  EN + EL strings.
- **Risk accepted for v1**: the feed is ~20-40s behind TV, so the first
  seconds of a quarter can leak. Small edge, small unranked reward.
  **Must include**: lock all picks for a game whenever its live data is
  more than ~60s old ("picks paused"), so a stalled feed can't leave a
  quarter open for minutes.
- **v2 ideas**: over/under on quarter points (needs a per-matchup line;
  not enough season data yet), a streak bonus, a quarter-picks board.
- **Prerequisite done 2026-09-29**: final quarter scores are now stored
  when a game goes final (the 2 short round-1 games were backfilled), so
  `home/away_score_by_quarter` is safe to score against.

## 4. Recheck milestone intervals against real top-scorer accuracy (deferred 2026-09-30, revisit after ~round 5)

Milestones (a rare card every 2, a Legendary Pack every 18, a Coach pack
every 45 correct picks) count correct winner **and** top-scorer picks
(`services/cards.ts`'s `topScorerCorrectCountSql`). The intervals were tuned
with `scripts/season-simulation.ts` assuming top-scorer accuracy is 0.4x
winner accuracy (`SIM_TOPSCORER_ACC_RATIO`). Real production data on
2026-09-30 (small sample): winner picks 137/223 = 61%, top-scorer picks
23/74 = 31%, a ratio of **0.51**, so players earn slightly more milestone
credit than modeled.

Decision (user, 2026-09-30): keep counting top-scorer picks, keep 18 for now.

Steps once there are a few hundred resolved top-scorer picks:
1. Recompute the real ratio (read-only query on production: resolved
   `top_scorer_predictions` vs `predictions` accuracy).
2. Run `SIM_TOPSCORER_ACC_RATIO=<real ratio> npm run economy:simulate`.
3. If legendary completion is clearly faster than intended, move
   `LEGENDARY_MILESTONE_INTERVAL` 18 -> ~20 (and re-simulate). Update the
   Achievements texts (`i18n/achievements.ts`, the `milestoneHow.*` keys)
   if any interval changes.

## 5. Rethink the cards economy (deferred 2026-10-01, user: "I don't think this will work")

A first attempt is parked on branch **`economy-rework`** (commit `1417387`,
pushed, never deployed). Don't merge it as is.

What it does:
- Jump Ball slices give the store packs (Regular Season / Playoffs / Final
  Four, 5 cards each) or a coach card, instead of the special 8/6/1-card
  wheel packs. Odds 58/20/20/2 -> 58/28/11/3.
- Legendary milestone every 18 -> 9 correct picks; the Fantasy "legendary
  pack every 3 rounds" milestone is retired.
- New Fantasy tracks: every 4 rounds your coach wins -> that coach's card;
  every 3 rounds your captain scores -> his rare card
  (`services/fantasyCardTracks.ts`, tables `fantasy_coach_cards` /
  `fantasy_captain_cards`, which exist on the **dev** Neon branch only).
- Simulated (65% accuracy): daily spinner who never buys finishes the album
  ~day 202/210, buyers ~day 188, 16-19/20 coaches.

User's objections to resolve before shipping anything:
1. **Legendary every 9 correct picks is too much.** It moves the legendary
   supply onto predictions, so it becomes routine for active predictors.
2. **~3% legendary per spin is way too low.** The wheel stops feeling like
   a shot at something big (it was 20% a spin).
3. **Foils get rarer.** A foil only rolls on a newly pulled legendary from a
   pack (`FOIL_CHANCE` 12%, `services/packs.ts`), so fewer pack legendaries
   means fewer foils. Milestone legendaries still open as packs and can foil.

Still agreed (from the same discussion):
- Wheel packs should match the store packs (the free 8-card pack was better
  than the paid 5-card one), and pack art must show the real card count.
  **The art currently says "5 cards" on every pack in production**,
  including 8-, 6- and 1-card wheel packs; this branch fixes it.
- Achievements should hand out more coaches than legendaries; the Fantasy
  coach/captain card tracks were the user's idea.

Next steps: agree on targets first (legendary chance per spin, how many
legendaries come from picks vs. wheel vs. packs, foils per season), then
retune with `npm run economy:simulate` (`SIM_SPIN_*`,
`SIM_LEGENDARY_MILESTONE`, `SIM_FANTASY_COACH_TRACK`,
`SIM_FANTASY_CAPTAIN_TRACK` on that branch). Shipping needs the two tables
on production too (SQL is in the branch's `schema.ts`).
