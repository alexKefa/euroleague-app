# Win probability (part 1: model, pre-game, game chart, live)

Date: 2026-10-07 · Status: approved in conversation; the user asked to go straight to implementation.

## Goal

A EuroLeague win-probability model, which as far as we know no public product
offers. Part 1 delivers:

- a pre-game win chance for every game,
- a win-probability chart on every game page, with the biggest swings,
- live win % during games (game page and live score cards),
- the pre-game chance on the Predictions page.

Part 2 (the Clutch Index, Win Probability Added per player) gets its own
design once part 1 is live.

Approach C: ship a formula model now, backfill last season's play-by-play in
the background, then re-fit and measure calibration.

## Facts this design relies on

- `game_odds.home_fair_prob` is already de-vigged. Only 40 games have odds,
  so Elo supplies most pre-game chances.
- Live updates (`broadcast("game-update", …)`) carry score, `quarter`
  (5+ = overtime) and `gameClockSeconds` (left in the period). Producers:
  `sync/liveGamesSync.ts` and `realtime/liveScoreSimulator.ts`.
- `pbp_events` exists for finished games of 2026-27 only (30 games, 17k
  events); `syncMissingGameExtras(season, limit)` can backfill 2025-26, whose
  380 games are already in `games`.
- In `pbp_events`, `points > 0` only on `2FGM`, `3FGM`, `FTM`.

## The model

Notation: `m` = home score − away score; `s` = seconds left in the game
(regulation: `(4 − period)·600 + clock`; overtime: the period's clock);
`p0` = pre-game home win probability; `σ` = fitted spread of final margins.

- Pre-game expected margin: `μ = σ · Φ⁻¹(p0)`.
- In-game: `WP_home = Φ( (m + μ·s/2400) / (σ·√(s/2400)) )`.
- `s = 0`: 1 if `m > 0`, 0 if `m < 0`, 0.5 if tied (overtime follows).
- Away chance is `1 − WP_home`.

Pre-game chance `p0`:
1. `game_odds.home_fair_prob` when the game has odds;
2. otherwise Elo: `p = 1 / (1 + 10^(−(R_home + H − R_away)/400))`;
3. otherwise (no rating for a team) Elo with that team at 1500.

Elo is replayed in memory from final results (2025-26 then 2026-27, in
tip-off order), not stored: K and H from the active model; ratings carry
into a new season regressed one third toward 1500. The replay is cached and
invalidated when a game goes final.

Constants live in `wp_model` (version, sigma, elo_k, elo_home, active) so
tuning needs no deploy. `scripts/fit-win-prob.ts` fits them on 2025-26
results (grid search: Elo K and H by log loss of game results; σ by maximum
likelihood of final margins given μ) and inserts a new active version.

The pre-game chance is frozen at tip-off in `game_win_prob` (game_id, pre_home_prob, source `odds`|`elo`, model_version, created_at),
written on the first live tick (insert, on conflict do nothing). Scheduled
games compute it on read. Final games without a row (e.g. before this
shipped) compute it from the Elo replay as of their tip-off.

## Where the numbers come from

- **Finished games**: the curve is computed from `pbp_events` on read, one
  point per event with a distinct (period, clock), and cached in memory
  (final games never change).
- **Live games**: `hub.broadcast` adds `homeWinProb` to every `game-update`
  (from the cached `p0`, or 0.5 plus home edge until it loads) and appends
  the point to an in-memory per-game buffer. After a restart the buffer
  restarts from the next tick. Once a game is final and its play-by-play has
  synced, the play-by-play curve replaces the buffer.

## Endpoints

- `GET /api/games/:id/win-prob` →
  `{ status, pre: { homeProb, source } | null, points: { period, clock, s, homeProb }[], swings: { period, clock, homeProbBefore, homeProbAfter, teamId, playerName, playType }[], fromPlayByPlay: boolean }`.
  Swings: the 3 largest absolute changes between consecutive points on the
  play-by-play curve, labelled with the scoring event that caused them.
- `GET /api/games/win-prob/pregame?season=&round=` →
  `{ [gameId]: { homeProb, source } }` for that round's games.

## UI

- **Game page**: a "Win probability" card above "where the game was won".
  SVG line of the home win %, area above 50 % in the home colour and below in
  the away colour, quarter gridlines, the pre-game value as the start. Tap or
  drag to scrub (time, score, %). The 3 biggest swings are marked and listed
  ("Q4 1:12 · Sloukas 3-pointer · PAO 41% → 68%"). A one-line summary
  (peaks and lows) for screen readers. Before tip-off: "Model: PAO 62% ·
  Odds: 58%" (an "Elo" tag when there are no odds). Live: the chart grows
  per tick and a win % pill sits by the score.
- **Live score cards** (Live Center): a small win % chip in the leading
  team's colour, updated when it moves by at least 1 point.
- **Predictions page**: a muted "Model 62%" line under each game before
  tip-off. Points scoring is unchanged.
- EN + EL in `core/i18n/win-prob.ts`; team colours from team fields; chart
  axis text in theme tokens.

## Edge cases

- A final game without play-by-play yet: live points or the pre-game value,
  with "Full chart after the next play-by-play sync (hourly)".
- No active model row: endpoints return `pre: null`, the card is hidden.
- Clock parsing gaps: points with a missing clock are skipped.

## Verification

- `backend/src/scripts/check-win-prob.ts` (Node `assert`, run with `tsx`):
  monotonic in margin; `s = 0` gives 1 / 0 / 0.5; home + away = 1; at the
  start equals `p0`; Elo probability symmetric; curve from synthetic events;
  swing selection and labelling.
- Backend type-check and `ng build`.
- Phase C (after the backfill): `fit-win-prob.ts` prints log loss, Brier
  score and a 10-bucket reliability table on 2025-26.
- Dev deploy and a phone check before production.

## Out of scope (part 1)

- Clutch Index / WPA per player (part 2).
- Possession-aware or trained models (phase C may add a possession term).
- Win % on share cards; push alerts on big swings.
