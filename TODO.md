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

## 3. Quarter picks dropped (2026-10-01): clean up the leftover table

Live "who wins the next quarter" picks shipped to dev only (1e37ad8) and were
removed the same day after user feedback: picking every quarter is tedious and
pulls people away from watching the game. Don't rebuild in-game per-quarter
picks. The `quarter_predictions` table still exists on prod and on the dev Neon
branch, but no code uses it. Drop it on both once the removal is confirmed.

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

## 5. Dashboard checklist: fantasy warnings (2026-10-07)

The round checklist marks the fantasy row done once a squad exists. Add
warnings for injured players and players with no game this round. Needs
injury data on `GET /fantasy/lineup` (today it only returns ids, roles
and points), then a warning line on the fantasy row in
`features/dashboard/round-checklist.ts`.
