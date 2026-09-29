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
- **Bug to fix first (worth doing on its own)**: when a game goes final,
  `liveGamesSync.ts` updates the score but not the quarter breakdown, so
  late points go missing. On prod, 2/10 round-1 games are short: PAN-PRS
  (away 70 vs final 72), BAR-IST (home 88 vs 89). Write the quarter scores
  in the final update, then backfill (show SQL and affected rows first).
  The per-quarter table in the "other live games" popup on the game page
  already shows these wrong.
