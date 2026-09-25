# TODO

Open follow-ups deliberately deferred mid-session. Kept in the repo (not
just in one machine's Claude memory) so every session on every machine sees
them. Remove an entry once it's done.

## 1. Duplicate sell-backs shouldn't count toward leaderboard ranking (deferred 2026-09-25)

- Both `Sold duplicate: …` `point_adjustments` inserts in
  `backend/src/routes/packs.ts` (purchased-pack open, and owned/wheel-pack
  open) don't set `countsTowardRanking`, so they default to `true` — while
  the pack *purchase* deduction is `countsTowardRanking: false`. Net
  effect: opening packs can only ever raise someone's leaderboard Total.
- **Fix**: add `countsTowardRanking: false` to both inserts. The points
  stay spendable.
- Existing rows: only 1 on production as of 2026-09-25 (Tsef, 25pts) —
  needs a one-off `UPDATE`. Follow the production-data rule in CLAUDE.md
  (show SQL + a `SELECT` of affected rows, get confirmation first).
- **Why**: late-season wheel pulls are mostly duplicates (~290 pts/day from
  sell-backs vs ~130–150/week from predictions), so the Total board would
  drift toward rewarding daily spinning over prediction skill.
- **Decided NOT to raise duplicate sell values.** `SELL_BACK_RATE` 0.5
  (common 25 / rare 125) is capped by the purchased-pack worst-case-EV
  guard — a Regular Season pack of all duplicates already refunds ~141 of
  its 150 cost; commons at 30 would be a break-even exploit. Don't revisit
  without re-checking the pack EV math.

## 2. Simulator catalog size is stale (deferred 2026-09-25)

- `backend/src/scripts/season-simulation.ts`'s `CATALOG_SIZE.common/rare`
  is 289/289; the live catalog is 320/320 (checked on production
  2026-09-25).
- Update it, then re-run `npm run economy:simulate` to confirm
  album-completion rates still hold.

## 3. Import real Dunkest (EuroLeague Fantasy) prices into Fantasy Five (deferred 2026-09-18)

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

## 4. Validate the round-to-round Fantasy price delta against real data (deferred 2026-09-18, revisit after round 1)

- Day-one pricing (`computeFantasyPrice`) was calibrated against real
  Dunkest quotations on 2026-09-18 (min 4, Vezenkov anchor 17, new
  `FANTASY_NO_DATA_PRICE = 6` — all confirmed right).
- The per-round delta in `backend/src/services/fantasyDailyReprice.ts`
  couldn't be validated then — zero real games had been played. It has
  since (2026-09-21) been switched to EuroLeague Fantasy's published
  formulas (player `(N − P×1.1)/25`, coach `(N − P)/40`), but those have
  still never been checked against real observed price movement.
- **How**: once round 1 is final (first tipoff was 2026-09-24), pull real
  Dunkest quotations (same token/endpoint as #3), compare the real
  per-player price change against what our formula produces for the same
  real stat lines. No pre-round snapshot survived, so compare against a
  before/after pair across round 2 if needed (grab a snapshot right before
  round 2 tips off).
