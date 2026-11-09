# Clutch Court: H-O-R-S-E (M4) design

Date: 2026-11-09. Parent spec: `CLUTCH_COURT_SPEC.md` §6.5 and M4. M1–M3 (practice,
shared courts, server-authoritative shots) are live.

## Intent

Friends on a shared court can play a casual game of H-O-R-S-E against each other.
Results are saved, but the game does not touch points, leaderboards or achievements.

**Done when:** a full 3-player game works on phones, including one turn timeout and one
disconnect, and the result is saved.

### Decisions (from the brainstorm)

| Question | Decision |
|---|---|
| Tie into the Clutch economy? | No. Casual; save results only. |
| Who sets after a full round? | Rotate to the next active player (spec §6.5.4), not classic "keep setting while you make". |
| Lobby phase | Dropped. Start goes straight into the first set. |
| Hoops | Half court: hoop A only ("either hoop" in the spec collapses to A). |
| Set shots | From inside the 3-point area only (no threes), per spec. |
| Owner left the court | The earliest-joined connected player may start. |
| Everyone leaves mid-game | Game abandoned, saved with no winner. |

## Architecture

The rules are a pure reducer in `shared/court/horse.ts`, following the same split as
`shot.ts` (pure) and `sim.ts` + room (effects).

- **`shared/court/horse.ts`** (pure, no timers or I/O): game state type, `reduce(state,
  event, now) -> { state, effects }`, and helpers (`canShoot`, `isOnSpot`). The caller
  passes `now`, so timeouts are deterministic in tests.
- **`backend/src/court/courtRoom.ts`**:
  - turns client messages, shot results and a clock tick into reducer events;
  - mirrors the reducer state into the synced Colyseus state (`mode`, `phase`, `turnId`,
    `setterId`, `spotX/Z/Hoop`, `turnDeadline`, and per player `letters` and
    `eliminated`);
  - carries out the effects.
- **Shot gating:** before simulating, the room asks `canShoot()`. A refusal goes out on
  the existing `shotRejected` message, now with a `reason`.
- **Client** (`features/court`): HUD (scoreboard, turn banner, countdown, start button,
  winner screen), the floor ring at the spot, and a client-side block on shooting when
  it isn't your turn.
- **DB:** one transaction when a game ends: a `horse_games` row plus one
  `horse_game_players` row per player. The tables already exist in dev and prod
  (`backend/src/db/sql/2026-11-09-clutch-court.sql`).

## Game rules (the reducer)

### State

- `phase`: `free | setting | matching | over`
- `order`: player ids in join order (fixed at start)
- per player: `letters` (0–5), `eliminated`, `disconnectedAt | null`, `eliminatedAt`
- `setterId`, `turnId`, `spot { x, z, hoop } | null`, `matchQueue` (ids still to match
  this round), `deadline` (ms), `resolving` (a shot is in the air), `winnerId`,
  `startedAt`, `endedAt`

### Events

- `start { players, by }`
- `shotResult { playerId, made, x, z }`
- `tick` (the room sends one every 250 ms)
- `disconnect { playerId }`, `reconnect { playerId }`
- `leave { playerId }` (left the court, or `horse:leave` forfeit)

### Rules

1. **Start.** Requires at least 2 connected players, sent by the owner, or by the
   earliest-joined connected player if the owner isn't on court. `order` is those
   players in join order. Everyone else is a spectator until the game ends. The first
   setter is `order[0]` and `phase = setting`.
2. **Setting turn.** The shot must start inside the 3-point area of hoop A
   (`insideThreePoint`).
   - **Make:** `spot` is the shot position, `phase = matching`, and `matchQueue` is every
     active player after the setter, in order.
   - **Miss:** the setter role passes to the next active player in `order`.
3. **Matching turn.** The shot must start within 1.0 m of `spot`.
   - **Miss:** +1 letter. At 5 letters the player is eliminated.
   - **Make:** no change.
   - The turn then moves to the next id in `matchQueue`. When the queue is empty, the
     setter role rotates to the next active player after the current setter, and
     `phase = setting`.
4. **Resolution delay.** A shot's result is applied when the ball finishes (after the
   shot's `durationMs`), not when it is simulated. While `resolving`, no shot is
   accepted and the timer is paused.
5. **Turn timer.** 20 s per turn. A timeout counts as a miss: in setting the role passes;
   in matching the player gets a letter.
6. **Disconnects.**
   - A disconnected player's turn is skipped immediately with no letter.
   - Disconnected for 30 s means eliminated.
   - Reconnecting in time clears `disconnectedAt`; the player rejoins the rotation in
     their original position.
7. **Leaving.** Leaving the court, or sending `horse:leave`, means immediate elimination.
8. **End.**
   - When at most one active player remains, `phase = over`. The winner is that player,
     or `null` if nobody is left (abandoned).
   - Placement: winner 1, then by elimination time, latest eliminated first.
   - Effects `save` and `returnToFree` fire; the room switches back to `free`
     (shootaround) after 10 s.
9. **Mid-round edge cases.**
   - If the setter is eliminated or leaves while others are matching, the round still
     finishes and the role then passes to the next active player after them.
   - If the last remaining matcher is eliminated and only the setter is left, the setter
     wins.

### Effects

`event { type: set | matched | letter | eliminated | winner | turn, playerId, letters? }`,
`save { result }`, `returnToFree { afterMs: 10000 }`.

## Network

| Direction | Message | Payload |
|---|---|---|
| Client to server | `horse:start` | `{}` |
| Client to server | `horse:leave` | `{}` (forfeit) |
| Server to client | `horse:event` | `{ type, playerId, letters?, remainingMs }` |
| Server to client | `shotRejected` | `{ clientShotId, reason: notYourTurn \| outsideArc \| offSpot \| busy }` |

`remainingMs` drives the countdown, because phone and server clocks are not in sync. The
client sets its local deadline to `performance.now() + remainingMs` on every `turn` event.

## Client UX

All strings are added to `core/i18n/court.ts` in EN and EL in the same pass.

- **Shootaround:** the starter sees **Start H-O-R-S-E**, disabled with the hint "Need 2+
  players" while fewer than 2 are on court.
- **During a game:**
  - Scoreboard strip: name plus five letter slots, current shooter highlighted,
    eliminated players dimmed.
  - Turn banner: "Your turn: set a shot from inside the arc", "Match {name}'s shot",
    "{name} is setting…", with a countdown ring.
  - A pulsing gold floor ring of radius 1.0 m at the spot while matching.
  - The local shoot button is blocked when it isn't your turn, with a hint.
  - Spectators see "You're in the next game".
  - Event flashes: "**H!**" (the new letter) over the shooter, "Eliminated".
  - A Forfeit option sends `horse:leave`.
- **Winner screen:** winner name plus final standings with letters. Auto-closes after 10 s.

## Persistence

On `save`, a single transaction:

- `horse_games (court_id, winner_user_id, started_at, ended_at)`
- `horse_game_players (game_id, user_id, final_letters 'HOR', placement)`

A failure is logged; players still see the normal winner flow. Egress cost is about 2
statements per game.

## Testing

1. **Unit:** `shared/court/horse.test.ts`, run by `npm run test:court`. One test per
   rule in this spec (§ Rules 1–9), including timeouts, disconnect skip, 30 s
   elimination, reconnect, forfeit, abandoned game, placements, and the mid-round edge
   cases.
2. **Server integration (local, dev DB):** three scripted clients play a full game with
   one timeout and one disconnect. The script checks the winner, the placements and the
   saved rows.
3. **Manual:** the done-when scenario on phones.

## Out of scope

Points, rewards, leaderboards, game history UI, spectator chat, choosing the set hoop,
classic setter-keeps-control rules, and a lobby phase.
