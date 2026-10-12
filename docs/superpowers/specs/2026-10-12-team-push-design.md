# Team & Pinned-Game Push Notifications — Design

Date: 2026-10-12
Status: awaiting review

## Goal

Push the moments a fan cares about for their favourite team, and for the
games and players they pinned: tip-off soon, a close finish or overtime,
and the final score. Each kind can be switched on or off per user. Today
web push sends only lock reminders and round results, behind one device-level
switch.

## Decisions

| Topic | Decision |
|---|---|
| New kinds | `team_tipoff`, `team_close`, `team_final`, and the same close/final for pinned items (chosen 2026-10-12) |
| Settings | Per-type toggles per user (chosen); every type defaults to **on** |
| Pins | Stored on the server too (new table), so the server knows who pinned what. `localStorage` stays as the offline/logged-out copy. |
| Duplicates | `sendPushOnce(kind, key, ...)` with `push_log` (existing), so each user gets each alert once even if several triggers fire (e.g. a fan of the team who also pinned the game). |
| Timing source | The live-games sync, which polls every 20 s from 2 h before tip-off until final. |

## Data

```sql
create table push_preferences (
  user_id uuid primary key references users(id),
  lock_reminders boolean not null default true,
  round_results boolean not null default true,
  team_tipoff boolean not null default true,
  team_close boolean not null default true,
  team_final boolean not null default true,
  pinned boolean not null default true,   -- close + final for pinned games/players
  updated_at timestamptz not null default now()
);
create table watch_pins (
  user_id uuid not null references users(id),
  kind varchar(10) not null,      -- 'game' | 'player'
  target_id uuid not null,        -- game id or player id
  game_id uuid not null references games(id),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, target_id)
);
```

- A missing `push_preferences` row means everything is on.
- Account deletion (services/accountDeletion.ts) adds both tables to its personal-rows list, and the export lists them.
- Applied by hand to dev and production (CLAUDE.md).

## Triggers (in `sync/liveGamesSync.ts`, through a new `services/teamPush.ts`)

All copy is EN + EL, chosen per device language (as `pushJobs.ts` does), and every alert links to `/games/<id>`.

| Kind | Fires when | Recipients | `push_log` key | Copy (EN) |
|---|---|---|---|---|
| `team_tipoff` | a scheduled game's `tipoff_at` is 10–20 min away, checked on each sync tick in the pre-tipoff window | fans of either team (`users.favorite_team_id`) with `team_tipoff` on | `tipoff:<gameId>` | "{HOME} vs {AWAY} starts in 15 minutes. Make your picks." |
| `team_close` | live, Q4 or later, `game_clock_seconds <= 120` and margin ≤ 3; **or** the quarter becomes ≥ 5 (overtime) | fans of either team with `team_close` on, plus users who pinned the game or a player in it with `pinned` on | `close:<gameId>` (one per game, whichever fires first) | "Close finish: {HOME} {hs}–{as} {AWAY}, {clock} left." / "{HOME}–{AWAY} is going to overtime." |
| `team_final` | the sync sets `status = 'final'` | fans with `team_final` on, plus pinners with `pinned` on | `final:<gameId>` | "Final: {HOME} {hs}–{as} {AWAY}." For a pinned player, it adds "{Player}: {pts} pts." |

- Existing lock reminders and round results start honouring `lock_reminders` and `round_results`.
- Deleted users (`deleted_at`) are skipped everywhere.
- All of it is fire-and-forget (`sendPushInBackground` style): a push failure can never break the live sync.

## API

- `GET /api/push/preferences` returns the six booleans (requireAuth).
- `PUT /api/push/preferences` takes a partial body of booleans and upserts them.
- `PUT /api/watch-pins` takes `{ kind, targetId, gameId }` and pins it. `DELETE /api/watch-pins/:kind/:targetId` unpins. `GET /api/watch-pins` lists the user's current pins.
- The pin limit stays at 3 (`MAX_WATCHES`) and is enforced on the server too.

## Frontend

- **`WatchlistService`:** when logged in, pin and unpin also call the API. On login it merges the server list with `localStorage` (union, capped at 3, server wins).
- **Profile notifications card:** under the existing on/off switch, six toggles in EN + EL:
  - Pick lock reminders
  - Round results
  - My team: tip-off
  - My team: close finish
  - My team: final score
  - Pinned games and players

  Toggles are disabled while push is off on the device.

## Verification

1. `backend/src/scripts/check-team-push.ts` on dev tests the pure pieces in `services/teamPush.ts`:
   - `closeGameAlert(game)`: true at Q4 1:50 with margin 2; false at Q4 2:30, margin 4, or Q3; true at Q5
   - `recipientsFor(kind, game)` on fixtures returns fans plus pinners, minus users who turned the kind off, minus deleted users, without duplicates
   - every message has no `{` left in EN or EL
2. A dev run against a simulated game (`liveScoreSimulator`), with `push_log` rows checked once per user per key.
3. `ng build`, then the user turns toggles on and off on a phone and receives a final-score push on dev.

## Out of scope

Native app push, per-team choices beyond the favourite team, quiet hours, and a digest.
