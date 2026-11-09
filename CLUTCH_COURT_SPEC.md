# Clutch Court — Build Spec (v1)

> Brief for Claude Code. Read this whole file before writing any code.
> Work **one milestone at a time**. At the end of each milestone, stop, summarise what was built and how to test it, and wait for my go-ahead before starting the next one.

---

## 1. What we're building

A shared 3D outdoor basketball court inside **Clutch** (my EuroLeague fan app). Friends join the same court through an invite link. On the court they can walk around freely, shoot at the hoops together (shootaround) and play **H-O-R-S-E**.

### In scope (v1)
- A 3D outdoor court that runs in the browser on mobile and desktop.
- Free-roam movement: a virtual joystick on mobile, WASD/arrows on desktop.
- A shooting mechanic that feels good (the most important part).
- **Private courts**: create a court, get a link, friends join (max 8 players).
- **Shootaround**: everyone has their own ball and sees everyone's shots.
- **H-O-R-S-E**: full game loop with turns, letters, elimination and a winner.
- Avatars wear the player's favourite-team colours (Clutch already knows the favourite team).
- Emotes and preset quick phrases (no free text).
- Reconnection after a short network drop.

### Out of scope (do NOT build)
- Defense, steals, blocks, passing, contact or any player-vs-player ball contest.
- Free-text chat or voice chat.
- Public matchmaking or open public courts.
- A friends system (invite links only for now).
- Real EuroLeague or club logos, real player names or likenesses. Use team **colours** and generic players only.

---

## 2. Existing stack (inspect the repo first and follow its conventions)

- **Frontend:** Angular 20, standalone components, Tailwind CSS. Design: "Modern Sport" (Manrope, rounded pills, team-colour gradients, coral accent).
- **Backend:** Node.js + Express + TypeScript.
- **DB:** PostgreSQL (Neon) with Drizzle ORM.
- **Auth:** JWT access token held in memory on the client, plus an httpOnly refresh cookie.
- **Deploy:** Railway.
- **Dev machine:** Windows; prefer PowerShell commands in instructions.

Before Milestone 1, look at the repo structure and propose where the new code goes. Show me the plan before creating folders. Suggested layout, adapt it to what exists:

```
/client                    existing Angular app
  src/app/features/court/  new lazy-loaded feature
/server                    existing Express API (add court endpoints + migrations)
/court-server              NEW Colyseus service (separate Railway service)
/shared/court              NEW shared TS: constants, types, shot math, H-O-R-S-E rules
```

`shared/court` must be importable by both the Angular client and the Colyseus server, so there is a single source of truth for physics constants and game rules.

---

## 3. New dependencies

| Package | Where | Purpose |
|---|---|---|
| `three` (+ `@types/three`) | client | Rendering |
| `@dimforge/rapier3d-compat` | client (M1) + court-server | Ball physics |
| `colyseus` (latest stable) | court-server | Rooms and state sync |
| `@colyseus/schema` | court-server + shared types | Synced state |
| `colyseus.js` | client | Colyseus client |
| `nipplejs` (or a small hand-rolled joystick) | client | Mobile joystick |

Check the current docs for exact APIs and versions. Don't rely on memory for Colyseus API details.

---

## 4. World and physics constants (`shared/court/constants.ts`)

Units are metres, seconds and kilograms. Y is up.

- Court: FIBA full court, 28 × 15 m, with **two hoops** (hoop A at −z, hoop B at +z).
- Rim height 3.05 m, rim inner radius 0.225 m, rim tube radius 0.01 m.
- Backboard 1.80 × 1.05 m. The rim's front edge is 0.15 m from the board; the board is 1.20 m in from the baseline.
- Ball radius 0.12 m, mass 0.6 kg. Tune the restitution values by feel, starting at about 0.75 vs. ground, 0.55 vs. rim and 0.6 vs. board.
- 3-point line 6.75 m; free-throw line 4.6 m from the board face.
- Gravity −9.81 m/s².
- Player speed 4.5 m/s (run). There's no jumping in v1.
- Physics step: fixed 1/60 s.

Balls collide with the ground, rim, backboard, pole and court boundary fence. Balls do **not** collide with players or with each other.

---

## 5. Shot model (the core mechanic)

Goal: a satisfying shot that is easy to learn and hard to master, and identical on client and server.

1. **Target:** a shot automatically targets the nearer hoop in front of the player. If none is within ±60°, the player first turns to face the nearest hoop.
2. **Input:** hold-and-release.
   - On mobile, hold the shoot button; on desktop, hold Space.
   - A meter fills while holding. Releasing in the green **sweet spot** gives a perfect release.
   - Output: `timingError` in the range [−1, 1], where 0 is perfect.
3. **Ideal velocity:** `shared/court/shot.ts` computes the launch velocity that drops the ball through the rim centre.
   - The ball starts at the release point (player position + 2.2 m height).
   - The arc's apex is about 1.0–1.5 m above the rim, scaled by distance.
   - The function is pure, so the client and server share it.
4. **Error:** add error to the ideal velocity.
   - Use angular deviation plus a power deviation, both scaled by `|timingError|` and by distance (3s are harder than layups).
   - Use a seeded RNG (seed supplied by the server) for a small random component, so a perfect release is ~95% from close range, not 100%.
5. **Simulate:** run Rapier to resolve make or miss.
   - A make means the ball passes downward through the rim plane inside the rim radius.
   - Simulate a maximum of 4 s, or until the ball settles or leaves the court.
6. **Authority** (from Milestone 3 on):
   - The client sends only `{ timingError, hoopId }`.
   - The server uses the player's server-side position, computes and simulates the shot, and broadcasts the result:
     - `shotId`, `shooterId`, `made`
     - `keyframes`: ball position sampled at 30 Hz, quantised to centimetres
   - Clients play back the keyframes (interpolated) instead of simulating, so every screen shows the same arc.
   - The local shooter may start a predicted animation immediately and blend into the server keyframes when they arrive (expected within about 100 ms).
7. **Rate limit:** one shot per player in flight; at least 0.8 s between shots. The server clamps `timingError` to [−1, 1].
   - In v1 we accept that a modified client could always send 0. Note it as a known limitation, but don't over-engineer it.

In **Milestone 1** (single player, no server), the client runs the same shot pipeline locally with Rapier.

---

## 6. Multiplayer design

### 6.1 Room creation and joining
- `POST /api/courts` (Express, authenticated).
  - Creates a DB record with a short unique code: 6 chars, uppercase, no ambiguous characters such as 0/O and 1/I.
  - Returns `{ code, url }`, where `url` is `https://<clutch-domain>/court/<code>`.
- `GET /api/courts/:code` returns `{ exists, active, playerCount? }` for the join screen.
- The Colyseus room type `"court"` uses `filterBy(["code"])`. The client calls `joinOrCreate("court", { code, accessToken })`.
- In `onAuth`, the Colyseus room:
  - verifies the JWT with the same secret as the Express API;
  - checks that the court code exists and is active (shared Drizzle schema or an internal HTTP call; pick the simpler option for this repo and explain why);
  - loads the user's display name and favourite team.
- If the user isn't logged in, opening the link goes through the existing login flow and returns to `/court/:code`.
- If the access token is expired, refresh it via the existing refresh flow before joining.
- Max 8 clients per room. The room auto-disposes 5 minutes after the last player leaves, and `courts.is_active` is set to false.
- Reconnection: `allowReconnection(client, 30)`.

### 6.2 Synced state (`@colyseus/schema`)

```ts
class Player extends Schema {
  @type("string") userId;
  @type("string") name;
  @type("string") teamColorPrimary;   // hex
  @type("string") teamColorSecondary; // hex
  @type("number") x; @type("number") z; @type("number") rotY;
  @type("string") anim;               // idle | run | shoot | emote:<id>
  @type("boolean") connected = true;
  @type("string") letters = "";       // H-O-R-S-E progress, e.g. "HO"
  @type("boolean") eliminated = false;
}

class CourtState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") ownerId;
  @type("string") mode = "shootaround"; // "shootaround" | "horse"
  @type("string") phase = "free";       // free | lobby | setting | matching | over
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("string") turnId = "";          // whose shot it is
  @type("string") setterId = "";
  @type("number") spotX = 0; @type("number") spotZ = 0;
  @type("string") spotHoop = "";        // "A" | "B"
  @type("number") turnDeadline = 0;     // epoch ms
}
```

Keep shot keyframes **out** of the synced state and send them as messages.

### 6.3 Messages

Client → server:

| Message | Payload | Notes |
|---|---|---|
| `move` | `{ x, z, rotY, anim }` | Max 20 Hz. The server rejects moves faster than speed × 1.25 and clamps to court bounds plus the fence. |
| `shoot` | `{ timingError, hoopId }` | See §5. During H-O-R-S-E, only accepted from `turnId`. |
| `emote` | `{ id }` | Preset IDs only. |
| `quick` | `{ id }` | Preset phrase IDs only, e.g. "Nice shot!", "Again?", "GG". |
| `horse:start` | `{}` | Owner only; needs ≥ 2 connected players. |
| `horse:leave` | `{}` | Return to shootaround. |

Server → client:

| Message | Payload |
|---|---|
| `shot` | `{ shotId, shooterId, hoopId, made, keyframes: Int16Array-friendly number[], durationMs }` |
| `horse:event` | `{ type: "set" \| "matched" \| "letter" \| "eliminated" \| "winner", playerId, letters? }` |
| `toast` | `{ text }` (system notices such as "Nikos joined") |

### 6.4 Movement and interpolation
- The local player moves instantly (client-authoritative position, server-validated).
- If the server rejects a move, it sends a correction and the client snaps or lerps back.
- Remote players are rendered about 100 ms in the past, interpolated between buffered snapshots.

### 6.5 H-O-R-S-E rules (`shared/court/horse.ts`, a pure state machine)
1. The owner starts the game. The turn order is the join order of the connected players.
2. **Setting:** the current setter shoots from anywhere within the 3-point line area of either hoop.
   - On a make, `phase = matching`, and `spotX/Z/Hoop` record where the setter shot from.
   - On a miss, the setter role passes to the next player and the phase stays `setting`.
3. **Matching:** every other non-eliminated player, in turn order, must shoot from within **1.0 m** of the spot, at the same hoop.
   - The server only accepts the shot if the shooter is inside the radius, and the client shows a ring on the floor at the spot.
   - A miss adds the next letter of HORSE. Five letters means eliminated.
4. After everyone has matched, the setter role passes to the next non-eliminated player after the current setter.
5. When one player is left, they win: `phase = over`. Show the winner screen and save the result. After 10 s, return to `free` (shootaround).
6. Turn timer: 20 s per shot. On timeout, setting counts as a miss and matching counts as a letter.
7. A disconnected player's turns are skipped while disconnected. If they don't come back within 30 s, they're eliminated.
8. A player joining mid-game watches until the next game.

Unit-test this module thoroughly, since it's the heart of the multiplayer logic.

---

## 7. Database (Drizzle migrations in the existing API)

```
courts
  id              uuid pk
  code            varchar(6) unique not null
  owner_user_id   fk users.id not null
  is_active       boolean default true
  created_at      timestamptz default now()
  last_active_at  timestamptz

horse_games
  id              uuid pk
  court_id        fk courts.id
  winner_user_id  fk users.id null
  started_at      timestamptz
  ended_at        timestamptz

horse_game_players
  game_id         fk horse_games.id
  user_id         fk users.id
  final_letters   varchar(5)
  placement       int
  pk (game_id, user_id)
```

Match the column naming conventions already used in the repo.

---

## 8. Client architecture (Angular)

- Lazy-loaded route `/court/:code` (and `/court/practice` for single player). Three.js, Rapier and Colyseus must **not** end up in the main bundle; verify with the build stats.
- Suggested structure, adapt it to the repo's conventions:

```
features/court/
  court.routes.ts
  court-page.component.ts     // Angular shell: loading, join, HUD overlays (Tailwind)
  engine/
    game-engine.ts            // owns renderer, loop, dispose(); plain TS, no Angular
    scene-builder.ts          // court, hoops, fence, lights
    player-controller.ts      // input → local movement
    remote-players.ts         // interpolation buffers
    ball-playback.ts          // keyframe playback (+ local sim in practice mode)
    input/joystick.ts, input/keyboard.ts, input/shoot-meter.ts
    avatar-factory.ts         // loads glb, tints jersey by team colours
  net/
    court-client.service.ts   // Colyseus connection, state → engine
  hud/
    shoot-meter.component.ts, horse-scoreboard.component.ts,
    emote-wheel.component.ts, invite-sheet.component.ts
```

- Run the render loop inside `NgZone.runOutsideAngular()`.
- Push HUD-relevant state into Angular **signals** at a low rate (only when values change), not every frame.
- `ngOnDestroy` must dispose the renderer, geometries, materials and textures, cancel the animation frame, leave the room and remove listeners. Navigating away and back 10 times must not leak memory (check in DevTools).
- Handle `devicePixelRatio`: cap at 2, or 1.5 on low-end devices.
- Handle WebGL context loss gracefully.
- The invite sheet uses `navigator.share` when available and otherwise copies the link.

---

## 9. Assets

- Court: built procedurally in Three.js (planes, line markings via a canvas texture or decals) for v1. No model needed.
- Hoop, backboard, pole and chain net: simple procedural meshes.
- Players: one generic rigged character (e.g. from Mixamo) with idle, run, shoot, and 3–4 emote animations.
  - The jersey and shorts are separate materials tinted with the team colours.
- Ball: a sphere with a basketball texture.
- Compress models with `gltf-transform` (Draco or Meshopt), and textures to KTX2 where it helps.
- Use placeholder capsules for avatars until Milestone 5.

---

## 10. Performance budget

- 60 fps target and 30 fps minimum on a mid-range Android phone with 8 players on court.
- < 100 draw calls; use shared materials and instancing for repeated objects.
- Game payload (JS + WASM + assets, gzipped) < 4 MB.
- Shadows: one directional light with a small shadow map, or baked blob shadows under players. Pick the cheaper option.

---

## 11. Testing

- **Unit:** `shared/court/shot.ts` (the ideal velocity lands in the rim; error scales with `timingError`) and `shared/court/horse.ts` (every rule in §6.5, including timeouts, disconnects and the last player standing).
- **Server:** a bot script that connects 8 fake clients to one room, moves them and fires shots for 2 minutes. Assert no crashes, keep the tick time under budget, and log bandwidth per client.
- **Manual:** two browsers plus a phone on the same court, plus a reconnect test (toggle airplane mode for 10 s).

---

## 12. Milestones (stop and report after each)

### M0 — Repo plan
Inspect the repo and propose the folder layout, packages and how `shared/court` will be consumed by both apps. **Wait for approval.**

### M1 — Single-player court (`/court/practice`)
- Procedural court, hoops and fence; camera follows the player (third person, adjustable for mobile).
- Joystick and keyboard movement, with capsule avatars.
- Shoot meter and the full local shot pipeline (§5) with Rapier.
- Make/miss feedback: net swish, sound, small camera shake on a make, and a "streak" counter.

**Done when:** shooting feels good on a phone, and I can hit perfect releases consistently from mid-range after a minute of practice.

### M2 — Multiplayer basics
- `court-server` Colyseus service, runnable locally and deployable to Railway.
- `POST/GET /api/courts`, the migration, the join flow with JWT auth, the invite sheet and the redirect through login.
- Synced movement with interpolation; name tags above players.

**Done when:** two logged-in users on different devices see each other run around the same court via a shared link.

### M3 — Shared shootaround
- Server-authoritative shots (§5.6), keyframe playback, rate limits.

**Done when:** everyone sees the same arcs and the same make/miss for every player's shots.

### M4 — H-O-R-S-E
- `horse.ts` state machine with tests, server integration, HUD (scoreboard, whose turn, spot ring, timer) and the winner screen.
- Results saved to the DB.

**Done when:** a full game with 3 players works, including a timeout and a disconnect.

### M5 — Polish
- Rigged avatars with team-colour jerseys and animations.
- Emote wheel and quick phrases.
- Reconnection UX, the performance pass against §10, the bot load test, and memory-leak checks.

---

## 13. Working rules for Claude Code

- One milestone at a time. Don't start the next one without my go-ahead.
- Before coding a milestone, list the files you'll create or change.
- Don't refactor unrelated parts of the existing app.
- Keep shared logic pure and typed in `shared/court`, with no Three.js or Colyseus imports there.
- Give PowerShell commands for anything I need to run.
- Check the current library docs for exact APIs rather than guessing, especially Colyseus and Rapier.
- When a decision isn't covered here, pick the simplest option, note it in your milestone summary, and keep going.
