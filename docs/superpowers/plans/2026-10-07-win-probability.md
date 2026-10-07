# Win Probability (part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-game chance, game-page WP chart with swings, live WP on updates and cards, and the Predictions-page model line.

**Architecture:** Pure math in `services/winProb/model.ts` (checked by a tsx script); Elo replay + pre-game snapshot + curve building in `services/winProb/`; two endpoints on `gamesRouter`; live enrichment inside `hub.broadcast`; an SVG card and two small UI additions.

**Tech Stack:** Express + Drizzle (Postgres/Neon), Angular 20 signals, SVG.

**Spec:** `docs/superpowers/specs/2026-10-07-win-probability-design.md`

## Global Constraints

- Schema changes go to production and dev by hand-written SQL (CLAUDE.md).
- EN + EL in `frontend/src/app/core/i18n/win-prob.ts`.
- Pre-game chance frozen at tip-off; points scoring untouched.
- Latency: one query per endpoint where possible; caches in memory.

## Review Focus

1. Overtime (period 5+) and the final buzzer with a tie → 0.5, never NaN.
2. `p0` of exactly 0 or 1 (bad odds row) → clamp to [0.01, 0.99] before Φ⁻¹.
3. Live tick for a game with no `game_win_prob` row and no Elo yet → fallback, no throw inside `broadcast`.
4. Play-by-play with missing clocks or out-of-order events → skipped/sorted, curve monotone in time.
5. A team in 2026-27 with no 2025-26 games → rated 1500.

---

### Task 1: Model math (`services/winProb/model.ts`) + `scripts/check-win-prob.ts`

Produces: `normCdf(x)`, `normInv(p)`, `clampProb(p)`, `eloProb(rHome, rAway, homeEdge)`, `expectedMargin(p0, sigma)`, `secondsLeft(period, clock)`, `winProb(margin, sLeft, mu, sigma)`, `buildCurve(events, p0, sigma)` → `CurvePoint[]`, `biggestSwings(points, n)`.

- [ ] Check script (RED) → implement (GREEN) → commit.

### Task 2: Data layer

- `wp_model`, `game_win_prob` tables (schema.ts + SQL on prod and dev).
- `services/winProb/elo.ts`: `getEloState()` replay cache, `invalidateElo()`, `eloPreGame(gameId)`.
- `services/winProb/pregame.ts`: `activeModel()`, `preGameProb(game)`, `snapshotPreGame(gameId)`.
- `services/winProb/curve.ts`: `gameWinProb(gameId)` (pbp curve + swings, cached for finals; live buffer otherwise).
- `scripts/fit-win-prob.ts`: fit + insert active `wp_model`; prints log loss/Brier/reliability.
- Routes: `GET /api/games/:id/win-prob`, `GET /api/games/win-prob/pregame`.
- [ ] Implement, type-check, apply SQL, run the fit on prod and dev, commit.

### Task 3: Live

- `services/winProb/live.ts`: `enrichGameUpdate(data)` (sync; adds `homeWinProb`, buffers point, snapshots pre-game on first live tick, invalidates Elo on final).
- `hub.broadcast` calls it for `game-update`.
- [ ] Implement, type-check, commit.

### Task 4: Frontend

- `ApiService.getWinProb(gameId)`, `getPreGameWinProbs(season, round)`; `GameUpdate.homeWinProb?`.
- `features/game/win-prob-card.ts` on the game page; live chip in Live Center; Predictions line.
- `core/i18n/win-prob.ts` (+ merge).
- [ ] Implement, `ng build`, commit.

### Task 5: Backfill + deploy

- `scripts/backfill-pbp.ts` (2025-26, batches, delay).
- [ ] Deploy dev; user checks; production on approval. Backfill + re-fit run afterwards.
