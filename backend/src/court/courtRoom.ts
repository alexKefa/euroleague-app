// The "court" Colyseus room (CLUTCH_COURT_SPEC.md §6). One room per invite
// code (filterBy(["code"])). M2: auth, presence, validated movement,
// reconnection. Shots (M3) and H-O-R-S-E (M4) hook in here later.
import { Room, type AuthContext, type Client } from "@colyseus/core";
import type { Delayed } from "@colyseus/timer";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { courts, teams, users } from "../db/schema.js";
import { verifyAccessToken } from "../auth/tokens.js";
import { jerseyNumber, kitColors } from "../../../shared/court/kit.js";
import {
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
  type ToastMessage,
} from "../../../shared/court/protocol.js";
import { CourtPlayer, CourtState } from "./state.js";
import { courtPresence } from "./presence.js";

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
    // The same account joining twice (a second tab) replaces the old seat.
    this.state.players.forEach((p, sessionId) => {
      if (p.userId === auth.userId && sessionId !== client.sessionId) {
        this.clients.get(sessionId)?.leave();
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
    client.userData = { lastMoveAt: Date.now() };

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
    this.allowReconnection(client, RECONNECT_SECONDS);
  }

  onReconnect(client: CourtClient): void {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      p.connected = true;
      this.toast({ kind: "back", name: p.name }, client);
    }
    client.userData = { lastMoveAt: Date.now() };
    courtPresence.setCount(this.code, this.connectedCount());
  }

  onLeave(client: CourtClient): void {
    const p = this.state.players.get(client.sessionId);
    if (p) {
      this.state.players.delete(client.sessionId);
      this.toast({ kind: "left", name: p.name });
    }
    courtPresence.setCount(this.code, this.connectedCount());
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
