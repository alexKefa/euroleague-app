// The "court" Colyseus room (CLUTCH_COURT_SPEC.md §6). One room per invite
// code (filterBy(["code"])). M2: auth, presence, validated movement,
// reconnection. Shots (M3) and H-O-R-S-E (M4) hook in here later.
import { Room, type AuthContext, type Client } from "@colyseus/core";
import type { Delayed } from "@colyseus/timer";
import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { courts, teams, users } from "../db/schema.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { jerseyNumber, kitColors } from "../../../shared/court/kit.js";
import { SHOT_COOLDOWN_SECONDS } from "../../../shared/court/constants.js";
import { ACTIVE_HOOPS, pickTargetHoop } from "../../../shared/court/geometry.js";
import { computeShotLaunch } from "../../../shared/court/shot.js";
import {
  canStart,
  initialHorseState,
  lettersOf,
  reduce as reduceHorse,
  shotGate,
  type HorseInput,
  type HorseState,
} from "../../../shared/court/horse.js";
import { saveHorseResult } from "./horseResults.js";
import type { HoopId } from "../../../shared/court/types.js";
import {
  CLOSE_REPLACED,
  EMPTY_DISPOSE_MS,
  MAX_PLAYERS,
  MOVE_HZ,
  MSG,
  PLAYER_ANIMS,
  RECONNECT_SECONDS,
  isValidCourtCode,
  normalizeYaw,
  validateMove,
  type CorrectionMessage,
  type JoinOptions,
  type MoveMessage,
  type PlayerAnim,
  type SeedMessage,
  type ShootMessage,
  type ShotMessage,
  type ShotRejectedMessage,
  type HorseEventMessage,
  type ToastMessage,
} from "../../../shared/court/protocol.js";
import { CourtPlayer, CourtState } from "./state.js";
import { courtPresence } from "./presence.js";
import { courtPhysics } from "./physics.js";

interface CourtAuth {
  userId: string;
  name: string;
  primary: string;
  secondary: string;
  teamCode: string;
  logoUrl: string;
}

interface ClientData {
  lastMoveAt: number;
  /** Seed for this player's next shot (sent to them in advance for prediction). */
  nextSeed: number;
  /** No new shot until the previous one has finished playing (spec §5.7). */
  shotBusyUntil: number;
}

type CourtClient = Client<{ auth: CourtAuth; userData: ClientData }>;

/** Spawn points along the top of the key, spread so players don't overlap. */
function spawnPoint(index: number): { x: number; z: number } {
  const offsets = [0, -1.6, 1.6, -3.2, 3.2, -4.8, 4.8, 0];
  return { x: offsets[index % offsets.length]!, z: -5 + (index === 7 ? 1.5 : 0) };
}

export class CourtRoom extends Room<{ state: CourtState }> {
  maxClients = MAX_PLAYERS;
  // Disposal is ours: 5 minutes after the last player leaves (not instantly).
  autoDispose = false;
  state = new CourtState();

  private code = "";
  private courtId = "";
  private emptyTimer: Delayed | null = null;
  private joinCounter = 0;
  private shotCounter = 0;

  // ---- H-O-R-S-E (docs/superpowers/specs/2026-11-09-horse-design.md) ----
  private horse: HorseState = initialHorseState();
  /** sessionId -> userId for the current game (leavers are removed from state.players). */
  private horseUsers = new Map<string, string>();
  private horseTick: Delayed | null = null;

  async onCreate(options: Partial<JoinOptions>): Promise<void> {
    if (!isValidCourtCode(options.code)) throw new Error("invalid court code");
    const [court] = await db
      .select({ id: courts.id, ownerUserId: courts.ownerUserId })
      .from(courts)
      .where(and(eq(courts.code, options.code), eq(courts.isActive, true)))
      .limit(1);
    if (!court) throw new Error("court not found");
    this.code = options.code;
    this.courtId = court.id;

    const [owner] = await db
      .select({ primary: teams.primaryColor, secondary: teams.secondaryColor, logoUrl: teams.logoUrl })
      .from(users)
      .leftJoin(teams, eq(users.favoriteTeamId, teams.id))
      .where(eq(users.id, court.ownerUserId))
      .limit(1);

    const s = this.state;
    s.ownerId = court.ownerUserId;
    s.courtColor = kitColors(owner?.primary, owner?.secondary).primary;
    s.courtLogoUrl = owner?.logoUrl ?? "";
    s.mode = "shootaround";
    s.phase = "free";
    s.turnId = "";
    s.setterId = "";
    s.spotX = 0;
    s.spotZ = 0;
    s.spotHoop = "";
    s.turnDeadline = 0;

    courtPresence.open(this.code);
    this.scheduleEmptyDispose();

    this.onMessage(MSG.move, (client: CourtClient, msg: MoveMessage) => this.handleMove(client, msg));
    this.onMessage(MSG.seedRequest, (client: CourtClient) => this.sendSeed(client));
    this.onMessage(MSG.shoot, (client: CourtClient, msg: ShootMessage) => this.handleShoot(client, msg));
    this.onMessage(MSG.horseStart, (client: CourtClient) => this.startHorse(client));
    this.onMessage(MSG.horseLeave, (client: CourtClient) => this.applyHorse({ type: "leave", playerId: client.sessionId }));
  }

  async onAuth(_client: Client, options: Partial<JoinOptions>, _context: AuthContext): Promise<CourtAuth> {
    if (typeof options.accessToken !== "string") throw new Error("not signed in");
    let userId: string;
    try {
      userId = verifyAccessToken(options.accessToken).sub;
    } catch {
      throw new Error("session expired");
    }
    if (options.code !== this.code) throw new Error("wrong court");
    // One query: the court is still open, and who this user is.
    const [row] = await db
      .select({
        name: users.username,
        primary: teams.primaryColor,
        secondary: teams.secondaryColor,
        teamCode: teams.code,
        logoUrl: teams.logoUrl,
        courtActive: courts.isActive,
      })
      .from(users)
      .leftJoin(teams, eq(users.favoriteTeamId, teams.id))
      .leftJoin(courts, eq(courts.id, this.courtId))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw new Error("user not found");
    if (!row.courtActive) throw new Error("court closed");
    const kit = kitColors(row.primary, row.secondary);
    return {
      userId,
      name: row.name,
      primary: kit.primary,
      secondary: kit.secondary,
      teamCode: row.teamCode ?? "",
      logoUrl: row.logoUrl ?? "",
    };
  }

  onJoin(client: CourtClient): void {
    const auth = client.auth!;
    // The same account joining twice (a second tab, or a phone that reloaded
    // the page) replaces the old seat. A H-O-R-S-E participant keeps their
    // place in the game: the seat is moved to the new session (spec rule 6).
    let movedFrom: string | null = null;
    this.state.players.forEach((p, sessionId) => {
      if (p.userId === auth.userId && sessionId !== client.sessionId) {
        const hp = this.horse.players[sessionId];
        if (hp && !hp.eliminated) movedFrom = sessionId;
        this.clients.get(sessionId)?.leave(CLOSE_REPLACED);
        this.state.players.delete(sessionId);
      }
    });

    const spawn = spawnPoint(this.state.players.size);
    const p = new CourtPlayer();
    p.userId = auth.userId;
    p.name = auth.name;
    p.teamColorPrimary = auth.primary;
    p.teamColorSecondary = auth.secondary;
    p.teamCode = auth.teamCode;
    p.number = jerseyNumber(auth.userId);
    p.x = spawn.x;
    p.z = spawn.z;
    p.rotY = Math.PI;
    p.anim = "idle";
    p.connected = true;
    p.letters = "";
    p.eliminated = false;
    p.joinedAt = ++this.joinCounter;
    this.state.players.set(client.sessionId, p);
    if (movedFrom) {
      this.horseUsers.set(client.sessionId, auth.userId);
      this.applyHorse({ type: "rekey", from: movedFrom, to: client.sessionId });
    }
    client.userData = { lastMoveAt: Date.now(), nextSeed: newSeed(), shotBusyUntil: 0 };

    this.cancelEmptyDispose();
    courtPresence.setCount(this.code, this.connectedCount());
    this.toast({ kind: "joined", name: auth.name }, client);
    void db.update(courts).set({ lastActiveAt: new Date() }).where(eq(courts.id, this.courtId)).catch(() => {});
  }

  async onDrop(client: CourtClient): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = false;
      p.anim = "idle";
      this.toast({ kind: "dropped", name: p.name });
    }
    courtPresence.setCount(this.code, this.connectedCount());
    this.applyHorse({ type: "disconnect", playerId: client.sessionId });
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: CourtClient): void {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = true;
      this.toast({ kind: "back", name: p.name }, client);
    }
    client.userData = { ...(client.userData ?? { nextSeed: newSeed(), shotBusyUntil: 0 }), lastMoveAt: Date.now() };
    courtPresence.setCount(this.code, this.connectedCount());
    this.applyHorse({ type: "reconnect", playerId: client.sessionId });
  }

  onLeave(client: CourtClient): void {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      this.state.players.delete(client.sessionId);
      this.toast({ kind: "left", name: p.name });
    }
    courtPresence.setCount(this.code, this.connectedCount());
    this.applyHorse({ type: "leave", playerId: client.sessionId });
    if (this.clients.length === 0) this.scheduleEmptyDispose();
  }

  async onDispose(): Promise<void> {
    courtPresence.close(this.code);
    if (this.courtId) {
      await db.update(courts).set({ isActive: false }).where(eq(courts.id, this.courtId)).catch(() => {});
    }
  }

  // ---------- movement ----------

  private handleMove(client: CourtClient, msg: MoveMessage): void {
    const p = this.state.players.get(client.sessionId);
    const data = client.userData;
    if (!p || !data || !msg || typeof msg !== "object") return;
    const now = Date.now();
    const elapsed = (now - data.lastMoveAt) / 1000;
    // Max 20 Hz (a little slack for jitter); excess messages are dropped.
    if (elapsed < 1 / MOVE_HZ / 1.5) return;
    data.lastMoveAt = now;

    const accepted = validateMove(p, { x: Number(msg.x), z: Number(msg.z) }, elapsed);
    if (!accepted) {
      client.send(MSG.correction, { x: p.x, z: p.z } satisfies CorrectionMessage);
      return;
    }
    p.x = Math.round(accepted.x * 100) / 100;
    p.z = Math.round(accepted.z * 100) / 100;
    p.rotY = Math.round(normalizeYaw(Number(msg.rotY)) * 100) / 100;
    p.anim = PLAYER_ANIMS.includes(msg.anim as PlayerAnim) ? msg.anim : "idle";
  }

  // ---------- shots (M3: server-authoritative, spec §5.6) ----------

  private sendSeed(client: CourtClient): void {
    const data = client.userData;
    if (data) client.send(MSG.seed, { seed: data.nextSeed } satisfies SeedMessage);
  }

  private handleShoot(client: CourtClient, msg: ShootMessage): void {
    const p = this.state.players.get(client.sessionId);
    const data = client.userData;
    if (!p || !data || !msg || typeof msg !== "object") return;
    const clientShotId = Number.isFinite(msg.clientShotId) ? Number(msg.clientShotId) : 0;
    const reject = () => client.send(MSG.shotRejected, { clientShotId } satisfies ShotRejectedMessage);

    const now = Date.now();
    if (!p.connected || now < data.shotBusyUntil) return reject();

    // Shoot from the claimed spot if it passes the move speed check from
    // where the server last saw the player; otherwise from the server's spot.
    const claimed = validateMove(p, { x: Number(msg.x), z: Number(msg.z) }, (now - data.lastMoveAt) / 1000);
    if (claimed) {
      p.x = Math.round(claimed.x * 100) / 100;
      p.z = Math.round(claimed.z * 100) / 100;
      data.lastMoveAt = now;
    }

    // H-O-R-S-E: only the player whose turn it is, from the right place.
    const h = this.horse;
    const inGame = h.phase === "setting" || h.phase === "matching";
    if (inGame) {
      const reason = shotGate({ phase: h.phase, turnId: h.turnId, spot: h.spot, resolving: !!h.resolving }, client.sessionId, p.x, p.z);
      if (reason) {
        client.send(MSG.shotRejected, { clientShotId, reason } satisfies ShotRejectedMessage);
        return;
      }
    }

    const hoopId: HoopId = ACTIVE_HOOPS.includes(msg.hoopId) ? msg.hoopId : pickTargetHoop(p.x, p.z, p.rotY).hoopId;
    // computeShotLaunch clamps timingError to [-1, 1] (NaN counts as fully late).
    const launch = computeShotLaunch(p.x, p.z, hoopId, Number(msg.timingError), data.nextSeed);
    const result = courtPhysics().simulate(launch);

    data.nextSeed = newSeed();
    data.shotBusyUntil = now + Math.max(result.durationMs, SHOT_COOLDOWN_SECONDS * 1000);
    p.anim = "shoot";

    const shot: ShotMessage = {
      shotId: ++this.shotCounter,
      clientShotId,
      shooterId: client.sessionId,
      hoopId,
      made: result.made,
      perfect: launch.perfect,
      keyframes: result.keyframes,
      durationMs: result.durationMs,
      events: result.events,
      spin: launch.spin,
    };
    if (inGame) {
      // The turn advances when the ball lands, so everyone sees the result first.
      const sid = client.sessionId;
      const at = { x: p.x, z: p.z };
      this.applyHorse({ type: "shotFired", playerId: sid });
      this.clock.setTimeout(() => this.applyHorse({ type: "shotResult", playerId: sid, made: result.made, x: at.x, z: at.z }), result.durationMs);
    }
    this.broadcast(MSG.shot, shot);
    this.sendSeed(client);
  }

  // ---------- H-O-R-S-E ----------

  private startHorse(client: CourtClient): void {
    const players: { id: string; joinOrder: number; connected: boolean }[] = [];
    let ownerSession = "";
    this.state.players.forEach((p, sid) => {
      players.push({ id: sid, joinOrder: p.joinedAt, connected: p.connected });
      if (p.userId === this.state.ownerId && p.connected) ownerSession = sid;
    });
    if (this.horse.phase !== "free" || !canStart(players, ownerSession, client.sessionId)) return;
    this.horseUsers = new Map();
    this.state.players.forEach((p, sid) => this.horseUsers.set(sid, p.userId));
    this.applyHorse({ type: "start", by: client.sessionId, ownerId: ownerSession, players });
    this.horseTick?.clear();
    this.horseTick = this.clock.setInterval(() => this.applyHorse({ type: "tick" }), 250);
  }

  /** Run the reducer, mirror its state into the synced schema, execute its effects. */
  private applyHorse(input: HorseInput): void {
    const { state, effects } = reduceHorse(this.horse, input, Date.now());
    if (state === this.horse && effects.length === 0) return;
    this.horse = state;
    this.mirrorHorse();
    for (const e of effects) {
      if (e.type === "event") {
        const msg: HorseEventMessage = { kind: e.kind, playerId: e.playerId };
        if (e.letters !== undefined) msg.letters = e.letters;
        if (e.remainingMs !== undefined) msg.remainingMs = e.remainingMs;
        if (e.standings) msg.standings = e.standings;
        this.broadcast(MSG.horseEvent, msg);
      } else if (e.type === "save") {
        this.horseTick?.clear();
        this.horseTick = null;
        saveHorseResult(this.courtId, e.result, this.horseUsers).catch((err) => console.error("[court] saving H-O-R-S-E result failed", err));
      } else if (e.type === "returnToFree") {
        this.clock.setTimeout(() => {
          this.horse = initialHorseState();
          this.mirrorHorse();
        }, e.afterMs);
      }
    }
  }

  private mirrorHorse(): void {
    const h = this.horse;
    const s = this.state;
    s.mode = h.phase === "free" ? "shootaround" : "horse";
    s.phase = h.phase;
    s.turnId = h.turnId ?? "";
    s.setterId = h.setterId ?? "";
    s.spotX = h.spot?.x ?? 0;
    s.spotZ = h.spot?.z ?? 0;
    s.spotHoop = h.spot?.hoop ?? "";
    s.turnDeadline = h.deadline ?? 0;
    if (s.turnOrder.length !== h.order.length || h.order.some((id, i) => s.turnOrder[i] !== id)) {
      s.turnOrder.clear();
      for (const id of h.order) s.turnOrder.push(id);
    }
    s.players.forEach((p, sid) => {
      const hp = h.players[sid];
      p.letters = hp ? lettersOf(hp.letters) : "";
      p.eliminated = hp ? hp.eliminated : false;
    });
  }

  // ---------- helpers ----------

  private connectedCount(): number {
    let n = 0;
    this.state.players.forEach((p) => {
      if (p.connected) n++;
    });
    return n;
  }

  private toast(msg: ToastMessage, except?: Client): void {
    this.broadcast(MSG.toast, msg, except ? { except } : undefined);
  }

  private scheduleEmptyDispose(): void {
    this.cancelEmptyDispose();
    this.emptyTimer = this.clock.setTimeout(() => {
      if (this.clients.length === 0) void this.disconnect();
    }, EMPTY_DISPOSE_MS);
  }

  private cancelEmptyDispose(): void {
    this.emptyTimer?.clear();
    this.emptyTimer = null;
  }
}

function newSeed(): number {
  return randomInt(0, 2 ** 32 - 1);
}
